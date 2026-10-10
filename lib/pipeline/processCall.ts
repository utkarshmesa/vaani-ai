import { now } from '@/lib/clock';
import { estimateVaaniCost, totalInr, vaaniInr } from '@/lib/cost';
import { getRepo } from '@/lib/db';
import type { Json, LeadOutcome } from '@/lib/db/types';
import { mapEntities } from '@/lib/mapEntities';
import { scanAgentLines } from '@/lib/priceScan';
import { callerFromCallStarted, lookupCallInfo } from './lookupCallInfo';
import { isYes, numberField, textField, type VaaniEvent } from './payload';
import { routeLead } from './route';
import { lastTransferFailed } from './transfers';

export interface ProcessOptions {
  /** Call-history attempts for calls that trigger an urgent email (they need the caller's number). Default 4. */
  urgentLookupAttempts?: number;
  /** Delay between call-history attempts. Default 5000 ms (≈20 s total, PLAN.md Q3). */
  lookupDelayMs?: number;
}

export type CallResult =
  | { kind: 'call'; status: 'processed'; callId: string; outcome: LeadOutcome }
  | { kind: 'call'; status: 'duplicate'; callId: string; outcome?: undefined }
  | { kind: 'call'; status: 'error'; callId: string; error: string; outcome?: undefined };

/** A claim older than this is assumed to belong to a crashed run and can be taken over. */
const STALE_CLAIM_MS = 5 * 60_000;
const URGENT_OUTCOMES: LeadOutcome[] = ['transfer_failed', 'incomplete', 'existing_client_transferred'];

/** SPEC §7.3 — process one call_postprocessing event. Idempotent by call_id; never throws. */
export async function processCall(ev: VaaniEvent & { callId: string }, raw: unknown, opts: ProcessOptions = {}): Promise<CallResult> {
  const repo = getRepo();
  const callId = ev.callId;
  const d = ev.data;

  const existing = await repo.getCall(callId);
  if (existing?.processed_at) return { kind: 'call', status: 'duplicate', callId };

  const duration = numberField(d, 'call_duration');
  await repo.upsertCall({
    call_id: callId,
    received_at: existing?.received_at ?? ev.timestamp ?? now().toISOString(),
    raw_payload: raw as Json,
    duration_ms: duration === null ? null : Math.round(duration),
    transcript: textField(d, 'transcript'),
    summary: textField(d, 'summary'),
    entities: (d.entities ?? null) as Json,
    dispositions: (d.dispositions ?? null) as Json,
    recording_url: textField(d, 'recording_url'),
  });

  if (!(await repo.claimCallProcessing(callId, new Date(now().getTime() - STALE_CLAIM_MS)))) {
    return { kind: 'call', status: 'duplicate', callId };
  }

  try {
    const settings = await repo.getSettings();

    // a. Lead fields
    const mapped = mapEntities(d.entities);
    let outcome = mapped.outcome;
    if (outcome === 'existing_client_transferred' && (await lastTransferFailed(callId))) outcome = 'transfer_failed';
    if (mapped.problems.length) {
      await repo.insertEvent({ type: 'mapping_problems', call_id: callId, meta: { problems: mapped.problems } });
    }

    // b. Price scan on AGENT lines; Vaani's own price_mentioned disposition is a second check.
    const scan = scanAgentLines(textField(d, 'transcript'));
    const dispositions = (d.dispositions ?? {}) as Record<string, unknown>;
    const vaaniSaysPrice = isYes(dispositions.price_mentioned);
    const priceLines = scan.lines.length ? scan.lines
      : vaaniSaysPrice ? ['(Vaani price_mentioned disposition = Yes; no line matched the scanner)'] : [];

    // c. Cost and caller number from call-history. If it can't supply them: cost estimated from call length
    //    (replaced by the real figure by the cron if call-history recovers), number from the call_started webhook.
    const info = await lookupCallInfo(callId, {
      attempts: URGENT_OUTCOMES.includes(outcome) ? (opts.urgentLookupAttempts ?? 4) : 1,
      delayMs: opts.lookupDelayMs ?? 5000,
    });
    const estimate = info.credits === null && duration !== null ? estimateVaaniCost(duration, settings) : null;
    const credits = info.credits ?? estimate?.credits ?? null;
    const vInr = estimate ? estimate.inr : vaaniInr(credits, settings);
    const current = (await repo.getCall(callId))!;
    const call = await repo.updateCall(callId, {
      from_number: info.fromNumber ?? current.from_number ?? (await callerFromCallStarted(callId)),
      vaani_credits: credits,
      cost_estimated: estimate !== null,
      vaani_inr: vInr,
      total_inr: totalInr(vInr, current.gemini_inr),
      price_flag: scan.flag || vaaniSaysPrice,
      price_flag_lines: priceLines,
    });

    // One lead row per call (kept across retries).
    let lead = await repo.getLeadByCallId(callId);
    if (!lead) lead = await repo.insertLead({ ...mapped.fields, outcome, call_id: callId });

    // d. Route
    lead = await routeLead(lead, call, settings);

    // e. Done
    await repo.updateCall(callId, { processed_at: now().toISOString(), processing_error: null });
    return { kind: 'call', status: 'processed', callId, outcome: lead.outcome };
  } catch (err) {
    const message = String((err as Error)?.stack ?? err).slice(0, 2000);
    await repo.updateCall(callId, { processing_error: message, processing_started_at: null });
    await repo.insertEvent({ type: 'processing_error', call_id: callId, meta: { error: message } });
    return { kind: 'call', status: 'error', callId, error: message };
  }
}
