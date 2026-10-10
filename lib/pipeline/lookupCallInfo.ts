import { getAdapters } from '@/lib/adapters';
import { getRepo } from '@/lib/db';

export interface CallInfo {
  /** Credits, only once Vaani has finished post-processing the call. */
  credits: number | null;
  fromNumber: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cost and caller number come only from call-history (NOTES.md §1.2, §1.4). The call may not be listed yet:
 * try `attempts` times, `delayMs` apart. Errors are recorded, never thrown — a missing cost is retried by cron.
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
      await getRepo().insertEvent({ type: 'call_lookup_failed', call_id: callId, meta: { error: String((err as Error)?.message ?? err), attempt: i + 1 } });
    }
  }
  return { credits: null, fromNumber: null };
}
