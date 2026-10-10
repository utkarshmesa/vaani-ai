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

    case '':
      return { kind: 'invalid', reason: 'missing event type' };

    default:
      // call_started, call_ended, human_transfer_initiated, …: the raw event is already stored.
      return { kind: 'ignored', event: ev.event };
  }
}
