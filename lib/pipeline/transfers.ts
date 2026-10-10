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

  const lead = await repo.getLeadByCallId(ev.callId);
  const call = await repo.getCall(ev.callId);
  if (!lead || !call?.processed_at || lead.outcome !== 'existing_client_transferred') return;
  const upgraded = await repo.updateLead(lead.id, { outcome: 'transfer_failed' });
  await sendUrgent('transfer_failed', upgraded, call);
}
