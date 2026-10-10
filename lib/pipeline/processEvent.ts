import { getRepo } from '@/lib/db';
import { processCall, type CallResult, type ProcessOptions } from './processCall';
import { readEvent } from './payload';
import { handleTransferEvent } from './transfers';

export type ProcessResult =
  | CallResult
  | { kind: 'transfer'; event: string; callId: string }
  | { kind: 'ignored'; event: string }
  | { kind: 'invalid'; reason: string };

/** Entry point for a Vaani webhook body (run after the HTTP response, SPEC §7.1). */
export async function processEvent(body: unknown, opts: ProcessOptions = {}): Promise<ProcessResult> {
  const ev = readEvent(body);

  switch (ev.event) {
    case 'call_postprocessing':
      if (!ev.callId) return { kind: 'invalid', reason: 'call_postprocessing without call_id' };
      return processCall({ ...ev, callId: ev.callId }, body, opts);

    case 'human_transfer_failed':
    case 'human_transfer_successful':
      if (!ev.callId) return { kind: 'invalid', reason: `${ev.event} without room_name` };
      await handleTransferEvent({ ...ev, callId: ev.callId });
      return { kind: 'transfer', event: ev.event, callId: ev.callId };

    case 'call_started':
      // Fallback source of the caller's number while call-history is unavailable (NOTES.md).
      if (ev.callId) await recordCallerNumber(ev.callId, ev.data.phone_number);
      return { kind: 'ignored', event: ev.event };

    case '':
      return { kind: 'invalid', reason: 'missing event type' };

    default:
      // call_ended, human_transfer_initiated, …: the raw event is already stored.
      return { kind: 'ignored', event: ev.event };
  }
}

/**
 * call_started carries `phone_number`. For inbound calls this should be the caller (unverified until the first
 * live call — NOTES.md). Record it, and fill the call's number if it was processed without one.
 */
async function recordCallerNumber(callId: string, phone: unknown): Promise<void> {
  if (typeof phone !== 'string' || !phone.trim()) return;
  const repo = getRepo();
  await repo.insertEvent({ type: 'caller_number', call_id: callId, meta: { phone_number: phone.trim(), source: 'call_started' } });
  const call = await repo.getCall(callId);
  if (call && !call.from_number) await repo.updateCall(callId, { from_number: phone.trim() });
}
