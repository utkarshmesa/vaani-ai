import { getRepo } from '@/lib/db';
import type { VaaniEvent } from './payload';
import { sendUrgent } from './urgent';

/** True if the most recent transfer event recorded for the call is a failure. */
export async function lastTransferFailed(callId: string): Promise<boolean> {
  const events = (await getRepo().listEvents({ callId }))
    .filter((e) => e.type === 'transfer_failed' || e.type === 'transfer_successful');
  return events.at(-1)?.type === 'transfer_failed';
}

/**
 * SPEC §7.2: record transfer outcomes on the call. Final handling normally happens when post-processing arrives;
 * if it already has (events can arrive in either order), a failure upgrades the lead and alerts the front desk.
 */
export async function handleTransferEvent(ev: VaaniEvent & { callId: string }): Promise<void> {
  const repo = getRepo();
  const failed = ev.event === 'human_transfer_failed';
  const d = ev.data;
  await repo.insertEvent({
    type: failed ? 'transfer_failed' : 'transfer_successful',
    call_id: ev.callId,
    meta: { reason: (d.reason as string) ?? null, sip_status: (d.sip_status as string) ?? null, target: (d.phone_number as string) ?? null },
  });
  if (!failed) return;

  // If the call is still being processed, processCall re-checks after it finishes (see upgradeIfTransferFailed).
  const call = await repo.getCall(ev.callId);
  if (call?.processed_at) await upgradeIfTransferFailed(ev.callId);
}

/**
 * A transfer failure can arrive before, during or after post-processing. Whichever path sees both the processed lead
 * and the failure upgrades it — via compare-and-set, so the urgent email goes out exactly once.
 */
export async function upgradeIfTransferFailed(callId: string): Promise<void> {
  const repo = getRepo();
  const lead = await repo.getLeadByCallId(callId);
  if (!lead || lead.outcome !== 'existing_client_transferred' || !(await lastTransferFailed(callId))) return;
  const upgraded = await repo.updateLeadIf(lead.id, { outcome: 'transfer_failed' }, [], { outcome: 'existing_client_transferred' });
  if (!upgraded) return;
  await sendUrgent('transfer_failed', upgraded, (await repo.getCall(callId))!);
}
