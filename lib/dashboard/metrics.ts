import {
  CONSULTATION_OUTCOMES, LEAD_OUTCOMES,
  type CallRow, type ConsultationOutcome, type DesignerRow, type EventRow, type LeadOutcome, type LeadRow, type SettingsRow,
} from '@/lib/db/types';
import { isCompleteRecord } from '@/lib/mapEntities';
import { isWorkingTime, workingMinutesBetween } from '@/lib/workingHours';
import type { DateRange } from './range';

export interface AttentionItem {
  callId: string;
  leadId: string | null;
  at: string;
  callerName: string | null;
  number: string | null;
  reasons: string[];
}

export interface CallListRow {
  callId: string;
  at: string;
  callerName: string | null;
  number: string | null;
  locality: string | null;
  outcome: LeadOutcome | null;
  designer: string | null;
  accepted: boolean;
  priceFlag: boolean;
  durationMin: number | null;
  costInr: number | null;
}

export interface Metrics {
  range: DateRange;
  rc1: { calls: number; afterHours: number; afterHoursShare: number | null };
  rc2: {
    complete: number;
    completeShare: number | null;
    outcomes: Record<LeadOutcome, number>;
    declineReasons: { reason: string; count: number }[];
  };
  rc3: {
    handedOff: number;
    accepted: number;
    medianWorkingMinutesToAccept: number | null;
    medianMinutesToAccept: number | null;
    acceptedWithin30: number;
    eligibleForWithin30: number;
    acceptedWithin30Share: number | null;
    escalations: number;
    reassignments: number;
    outcomeRequests: number;
    outcomesLogged: number;
    consultationOutcomes: Record<ConsultationOutcome, number>;
  };
  cut: { flagged: { callId: string; at: string; callerName: string | null; lines: string[] }[] };
  cost: {
    totalInr: number;
    vaaniInr: number;
    geminiInr: number;
    perCall: number | null;
    totalMinutes: number;
    perMinute: number | null;
    bookedConsultations: number;
    perBooked: number | null;
    proposals: number;
    perProposal: number | null;
    projectedMonthEnd: number | null;
    unknownCostCalls: number;
    creditsUsedAllTime: number;
    creditsRemaining: number;
  };
  attention: AttentionItem[];
  calls: CallListRow[];
}

export interface MetricsInput {
  range: DateRange;
  now: Date;
  /** Calls received in the range */
  calls: CallRow[];
  /** Leads for those calls */
  leads: LeadRow[];
  /** email_sent events for those leads */
  emailEvents: EventRow[];
  designers: DesignerRow[];
  settings: SettingsRow;
  /** Sum of vaani_credits over all calls ever (for credits remaining) */
  creditsUsedAllTime: number;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const zeroes = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** Pure dashboard computation (SPEC §14). */
export function computeMetrics(input: MetricsInput): Metrics {
  const { calls, leads, settings: s, range } = input;
  const leadByCall = new Map(leads.map((l) => [l.call_id, l]));
  const designerName = new Map(input.designers.map((d) => [d.id, d.name]));
  const tagCount = (tag: string) => input.emailEvents.filter((e) => (e.meta as { tag?: string })?.tag === tag).length;

  // RC1 — coverage
  const afterHours = calls.filter((c) => !isWorkingTime(new Date(c.received_at), s)).length;

  // RC2 — one structured record per call
  const outcomes = zeroes(LEAD_OUTCOMES);
  for (const l of leads) outcomes[l.outcome]++;
  const reasons = new Map<string, number>();
  for (const l of leads) if (l.outcome === 'declined') reasons.set(l.decline_reason ?? 'other', (reasons.get(l.decline_reason ?? 'other') ?? 0) + 1);
  const complete = leads.filter((l) => isCompleteRecord(l)).length;

  // RC3 — designer follow-through
  const handedOff = leads.filter((l) => l.email_sent_at && l.designer_id);
  const accepted = handedOff.filter((l) => l.accepted_at);
  const workingToAccept = accepted.map((l) => workingMinutesBetween(new Date(l.clock_started_at ?? l.email_sent_at!), new Date(l.accepted_at!), s));
  const wallToAccept = accepted.map((l) => (Date.parse(l.accepted_at!) - Date.parse(l.email_sent_at!)) / 60_000);
  const waitingMinutes = (l: LeadRow) => workingMinutesBetween(new Date(l.clock_started_at ?? l.email_sent_at!), input.now, s);
  const acceptedWithin30 = workingToAccept.filter((m) => m <= s.escalation_minutes).length;
  const eligible = handedOff.filter((l) => l.accepted_at || waitingMinutes(l) >= s.escalation_minutes).length;
  const consultationOutcomes = zeroes(CONSULTATION_OUTCOMES);
  for (const l of leads) if (l.consultation_outcome) consultationOutcomes[l.consultation_outcome]++;

  // CUT — price check
  const flagged = calls.filter((c) => c.price_flag).map((c) => ({
    callId: c.call_id, at: c.received_at, callerName: leadByCall.get(c.call_id)?.caller_name ?? null, lines: c.price_flag_lines,
  }));

  // Cost
  const vaaniInr = sum(calls.map((c) => c.vaani_inr ?? 0));
  const geminiInr = sum(calls.map((c) => c.gemini_inr));
  const totalInr = vaaniInr + geminiInr;
  const totalMinutes = sum(calls.map((c) => c.duration_ms ?? 0)) / 60_000;
  const bookedConsultations = leads.filter((l) => l.booking_confirmed).length;
  const proposals = consultationOutcomes.proposal;
  let projectedMonthEnd: number | null = null;
  if (range.isCurrentMonth) {
    const elapsed = Math.min(input.now.getTime(), range.to.getTime()) - range.from.getTime();
    if (elapsed > 0) projectedMonthEnd = totalInr * ((range.to.getTime() - range.from.getTime()) / elapsed);
  }

  // Needs attention
  const attention: AttentionItem[] = [];
  for (const c of calls) {
    const l = leadByCall.get(c.call_id) ?? null;
    const why: string[] = [];
    if (c.processing_error) why.push('Processing error — check the raw payload');
    if (l?.needs_attention && l.attention_reason) why.push(...l.attention_reason.split('; '));
    if (c.price_flag) why.push('Price flag: the agent may have quoted a price');
    if (l && l.email_sent_at && l.designer_id && !l.accepted_at && waitingMinutes(l) >= s.escalation_minutes) {
      why.push(`Not accepted after ${s.escalation_minutes} working minutes (${designerName.get(l.designer_id) ?? 'unknown designer'})`);
    }
    if (why.length) attention.push({ callId: c.call_id, leadId: l?.id ?? null, at: c.received_at, callerName: l?.caller_name ?? null, number: c.from_number, reasons: why });
  }

  const callRows: CallListRow[] = calls
    .map((c) => {
      const l = leadByCall.get(c.call_id);
      return {
        callId: c.call_id,
        at: c.received_at,
        callerName: l?.caller_name ?? null,
        number: c.from_number,
        locality: l?.locality ?? null,
        outcome: l?.outcome ?? null,
        designer: l?.designer_id ? designerName.get(l.designer_id) ?? null : null,
        accepted: Boolean(l?.accepted_at),
        priceFlag: c.price_flag,
        durationMin: c.duration_ms === null ? null : c.duration_ms / 60_000,
        costInr: c.vaani_inr === null ? null : c.vaani_inr + c.gemini_inr,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  return {
    range,
    rc1: { calls: calls.length, afterHours, afterHoursShare: ratio(afterHours, calls.length) },
    rc2: {
      complete,
      completeShare: ratio(complete, calls.length),
      outcomes,
      declineReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    },
    rc3: {
      handedOff: handedOff.length,
      accepted: accepted.length,
      medianWorkingMinutesToAccept: median(workingToAccept),
      medianMinutesToAccept: median(wallToAccept),
      acceptedWithin30,
      eligibleForWithin30: eligible,
      acceptedWithin30Share: ratio(acceptedWithin30, eligible),
      escalations: tagCount('escalation'),
      reassignments: sum(leads.map((l) => l.reassign_count)),
      outcomeRequests: tagCount('outcome_request'),
      outcomesLogged: leads.filter((l) => l.consultation_outcome).length,
      consultationOutcomes,
    },
    cut: { flagged },
    cost: {
      totalInr, vaaniInr, geminiInr,
      perCall: ratio(totalInr, calls.length),
      totalMinutes,
      perMinute: ratio(totalInr, totalMinutes),
      bookedConsultations,
      perBooked: ratio(totalInr, bookedConsultations),
      proposals,
      perProposal: ratio(totalInr, proposals),
      projectedMonthEnd,
      unknownCostCalls: calls.filter((c) => c.vaani_credits === null).length,
      creditsUsedAllTime: input.creditsUsedAllTime,
      creditsRemaining: s.credits_loaded - input.creditsUsedAllTime,
    },
    attention: attention.sort((a, b) => b.at.localeCompare(a.at)),
    calls: callRows,
  };
}
