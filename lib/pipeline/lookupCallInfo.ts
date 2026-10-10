import { getAdapters } from '@/lib/adapters';
import { getRepo } from '@/lib/db';

export interface CallInfo {
  /** Credits, only once Vaani has finished post-processing the call. */
  credits: number | null;
  fromNumber: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cost and caller number come only from call-history (NOTES.md §1.2, §1.4). A call that is "not listed yet" is
 * retried `attempts` times, `delayMs` apart. An API error is recorded and not retried — retrying a broken
 * endpoint only delays the call (call-history returns 500 on this account). Never throws.
 */
export async function lookupCallInfo(callId: string, opts: { attempts?: number; delayMs?: number } = {}): Promise<CallInfo> {
  const attempts = Math.max(1, opts.attempts ?? 1);
  for (let i = 0; i < attempts; i++) {
    if (i > 0 && opts.delayMs) await sleep(opts.delayMs);
    try {
      const item = await getAdapters().vaani.findCall(callId);
      if (item) {
        const done = item.post_processing_status === 'completed' && typeof item.call_cost === 'number';
        return { credits: done ? item.call_cost : null, fromNumber: item.from_number };
      }
    } catch (err) {
      await getRepo().insertEvent({ type: 'call_lookup_failed', call_id: callId, meta: { error: String((err as Error)?.message ?? err).slice(0, 500) } });
      break;
    }
  }
  return { credits: null, fromNumber: null };
}

/** The caller's number from Vaani's call_started webhook (recorded by processEvent), if one arrived. */
export async function callerFromCallStarted(callId: string): Promise<string | null> {
  const events = await getRepo().listEvents({ callId, type: 'caller_number' });
  const last = events.at(-1)?.meta as { phone_number?: string } | undefined;
  return last?.phone_number ?? null;
}
