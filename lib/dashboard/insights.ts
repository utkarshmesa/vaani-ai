import { formatInTimeZone } from 'date-fns-tz';
import type { CallRow, DesignerRow, EventRow, LeadRow, SettingsRow } from '@/lib/db/types';
import { TZ } from '@/lib/time';
import { parseTranscript } from '@/lib/transcript';
import { isWorkingTime, workingMinutesBetween } from '@/lib/workingHours';

/**
 * Founder-facing views of the same data (the questions Nikhil asks, not the components we built):
 * has the leak stopped, where do enquiries drop out, are designers following through,
 * did refusing to quote cost bookings, and when do calls arrive. Pure and tested.
 */

/** SPEC §1: ~48% of enquiries got no response within 48 hours, so ~52% did. */
export const BASELINE_RESPONSE_48H = 0.52;
const H48 = 48 * 60 * 60_000;

/** Test traffic (simulate --test-id, stress runs, Vaani web test calls) — hidden from the founder by default. */
export function isTestCall(callId: string): boolean {
  return /^(test|stress|webrtc)-/i.test(callId);
}

/** A caller asking what it costs (their own words). Budget figures they volunteer are not a price question. */
const PRICE_QUESTION = [
  /\b(?:price|prices|pricing|cost|costs|costing|charges?|fees?|rates?|quote|quotation|estimate)\b/i,
  /\bhow much\b/i,
  /\b(?:kitna|kitne|kitni|kharcha|kharch)\b/i,
  /कितना|कितने|कितनी|खर्च|कीमत|दाम/,
];
export function callerAskedAboutPrice(transcript: string | null | undefined): boolean {
  return parseTranscript(transcript).some((l) => l.speaker === 'USER' && PRICE_QUESTION.some((re) => re.test(l.text)));
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** Who left between the previous step and this one */
  lost?: { count: number; label: string };
}

export interface DesignerStat {
  id: string;
  name: string;
  active: boolean;
  leads: number;
  accepted: number;
  waiting: number;
  medianWorkingMinutesToAccept: number | null;
  reminders: number;
  escalations: number;
  outcomesLogged: number;
  proposals: number;
}

export interface PriceOutcome { asked: number; converted: number; share: number | null }

/** Below this many callers in either group, a booking-rate comparison is noise, so the page does not draw one. */
export const MIN_GROUP_TO_COMPARE = 10;

export interface Insights {
  /**
   * Like the baseline ("got a response within 48 hours"), over every new enquiry: an honest decline from Vaani is an
   * answer on the call; a good-fit enquiry is answered when its designer accepts; a dropped call counts as unanswered
   * (the front desk is emailed, but whether they called back is not recorded).
   */
  response48h: {
    within: number; resolved: number; pending: number; share: number | null; baseline: number;
    declinedOnCall: number; acceptedInTime: number; droppedUnanswered: number;
  };
  funnel: FunnelStep[];
  declineReasons: { reason: string; count: number }[];
  outcomeLoggedShare: number | null;
  afterHours: { calls: number; newEnquiries: number; handedOff: number; booked: number };
  /** [ISO weekday 1–7 (Mon–Sun)][3-hour bucket 0–7] → calls, IST */
  heatmap: number[][];
  priceQuestions: { askers: PriceOutcome; others: PriceOutcome; askersBooked: number; comparable: boolean };
  designers: DesignerStat[];
}

export interface InsightsInput {
  now: Date;
  calls: CallRow[];
  leads: LeadRow[];
  /** email_sent events for those leads */
  emailEvents: EventRow[];
  designers: DesignerRow[];
  settings: SettingsRow;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const isExistingClient = (l: LeadRow) =>
  l.enquiry_type === 'existing_client' || l.outcome === 'existing_client_transferred' || l.outcome === 'transfer_failed';
export const isVendorOrOther = (l: LeadRow) => !isExistingClient(l) && (l.enquiry_type === 'vendor_or_other' || l.outcome === 'other');
export const isNewEnquiry = (l: LeadRow) => !isExistingClient(l) && !isVendorOrOther(l);
const handedOff = (l: LeadRow) => Boolean(l.email_sent_at && l.designer_id);
const converted = (l: LeadRow) => handedOff(l) || l.outcome === 'booked' || l.outcome === 'callback';
type MetaTo = { tag?: string; to?: string };

export function computeInsights(input: InsightsInput): Insights {
  const { calls, leads, settings: s, now } = input;
  const callById = new Map(calls.map((c) => [c.call_id, c]));
  const receivedAt = (l: LeadRow) => Date.parse(callById.get(l.call_id)?.received_at ?? l.created_at);

  // The enquiry funnel
  const newEnq = leads.filter(isNewEnquiry);
  const captured = newEnq.filter((l) => l.outcome !== 'incomplete');
  const fit = captured.filter((l) => l.outcome !== 'declined');
  const handed = fit.filter(handedOff);
  const accepted = handed.filter((l) => l.accepted_at);
  const held = accepted.filter((l) => l.consultation_outcome && l.consultation_outcome !== 'no_show');
  const proposals = held.filter((l) => l.consultation_outcome === 'proposal');
  const funnel: FunnelStep[] = [
    { key: 'calls', label: 'Calls answered', count: calls.length },
    {
      key: 'new', label: 'New project enquiries', count: newEnq.length,
      lost: { count: calls.length - newEnq.length, label: 'existing clients, vendors or unprocessed' },
    },
    { key: 'captured', label: 'Details captured', count: captured.length, lost: { count: newEnq.length - captured.length, label: 'dropped before the essentials' } },
    { key: 'fit', label: 'Good fit for the studio', count: fit.length, lost: { count: captured.length - fit.length, label: 'declined (not a fit)' } },
    { key: 'handed', label: 'Sent to a named designer', count: handed.length, lost: { count: fit.length - handed.length, label: 'not handed off (see Needs attention)' } },
    { key: 'accepted', label: 'Designer accepted', count: accepted.length, lost: { count: handed.length - accepted.length, label: 'not accepted yet' } },
    { key: 'held', label: 'Consultation held', count: held.length, lost: { count: accepted.length - held.length, label: 'no-show or outcome not logged yet' } },
    { key: 'proposal', label: 'Proposal sent', count: proposals.length, lost: { count: held.length - proposals.length, label: 'site visit, not a fit, or pending' } },
  ];
  const reasons = new Map<string, number>();
  for (const l of captured) if (l.outcome === 'declined') reasons.set(l.decline_reason ?? 'other', (reasons.get(l.decline_reason ?? 'other') ?? 0) + 1);

  // Has the leak stopped? Every new enquiry, answered within 48 hours of the call (see Insights.response48h).
  let within = 0; let resolved = 0; let pending = 0; let acceptedInTime = 0; let droppedUnanswered = 0;
  const declinedOnCall = captured.length - fit.length;
  for (const l of newEnq) {
    const start = receivedAt(l);
    if (l.outcome === 'declined') { within++; resolved++; continue; }
    if (l.outcome !== 'incomplete' && l.accepted_at && Date.parse(l.accepted_at) - start <= H48) { within++; resolved++; acceptedInTime++; continue; }
    if (now.getTime() - start >= H48) { resolved++; if (l.outcome === 'incomplete') droppedUnanswered++; } else pending++;
  }

  // Calls the studio would have missed
  const closed = (l: LeadRow) => !isWorkingTime(new Date(receivedAt(l)), s);
  const heatmap = Array.from({ length: 7 }, () => Array(8).fill(0) as number[]);
  for (const c of calls) {
    const d = new Date(c.received_at);
    heatmap[Number(formatInTimeZone(d, TZ, 'i')) - 1][Math.floor(Number(formatInTimeZone(d, TZ, 'H')) / 3)]++;
  }

  // Did refusing to quote cost bookings?
  const askers = newEnq.filter((l) => callerAskedAboutPrice(callById.get(l.call_id)?.transcript));
  const askerSet = new Set(askers);
  const others = newEnq.filter((l) => !askerSet.has(l));
  const outcome = (xs: LeadRow[]): PriceOutcome => {
    const n = xs.filter(converted).length;
    return { asked: xs.length, converted: n, share: ratio(n, xs.length) };
  };

  // Designers. Reminders go to the designer's own address, so they are attributed by recipient when addresses are
  // unique (in the Resend sandbox they may all be the owner's); an escalation belongs to whoever got the last reminder.
  const byEmail = new Map<string, string | null>();
  for (const d of input.designers) byEmail.set(d.email.toLowerCase(), byEmail.has(d.email.toLowerCase()) ? null : d.id);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const reminderEvents = input.emailEvents.filter((e) => (e.meta as MetaTo)?.tag === 'reminder').sort((a, b) => a.at.localeCompare(b.at));
  const reminderOwner = (e: EventRow) => byEmail.get(((e.meta as MetaTo)?.to ?? '').toLowerCase()) ?? leadById.get(e.lead_id ?? '')?.designer_id ?? null;
  const reminders = new Map<string, number>();
  const escalations = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string | null) => { if (id) m.set(id, (m.get(id) ?? 0) + 1); };
  for (const e of reminderEvents) bump(reminders, reminderOwner(e));
  for (const e of input.emailEvents) {
    if ((e.meta as MetaTo)?.tag !== 'escalation') continue;
    const last = reminderEvents.filter((r) => r.lead_id === e.lead_id && r.at <= e.at).at(-1);
    bump(escalations, last ? reminderOwner(last) : leadById.get(e.lead_id ?? '')?.designer_id ?? null);
  }
  const allHanded = leads.filter(handedOff);
  const designers: DesignerStat[] = input.designers
    .map((d) => {
      const mine = allHanded.filter((l) => l.designer_id === d.id);
      const acc = mine.filter((l) => l.accepted_at);
      return {
        id: d.id, name: d.name, active: d.active,
        leads: mine.length,
        accepted: acc.length,
        waiting: mine.length - acc.length,
        medianWorkingMinutesToAccept: median(acc.map((l) => workingMinutesBetween(new Date(l.clock_started_at ?? l.email_sent_at!), new Date(l.accepted_at!), s))),
        reminders: reminders.get(d.id) ?? 0,
        escalations: escalations.get(d.id) ?? 0,
        outcomesLogged: mine.filter((l) => l.consultation_outcome).length,
        proposals: mine.filter((l) => l.consultation_outcome === 'proposal').length,
      };
    })
    .filter((d) => d.active || d.leads || d.reminders || d.escalations)
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));

  return {
    response48h: { within, resolved, pending, share: ratio(within, resolved), baseline: BASELINE_RESPONSE_48H, declinedOnCall, acceptedInTime, droppedUnanswered },
    funnel,
    declineReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    outcomeLoggedShare: ratio(accepted.filter((l) => l.consultation_outcome).length, accepted.length),
    afterHours: {
      calls: calls.filter((c) => !isWorkingTime(new Date(c.received_at), s)).length,
      newEnquiries: newEnq.filter(closed).length,
      handedOff: handed.filter(closed).length,
      booked: handed.filter((l) => closed(l) && l.booking_confirmed).length,
    },
    heatmap,
    priceQuestions: {
      askers: outcome(askers), others: outcome(others), askersBooked: askers.filter((l) => l.booking_confirmed).length,
      comparable: askers.length >= MIN_GROUP_TO_COMPARE && others.length >= MIN_GROUP_TO_COMPARE,
    },
    designers,
  };
}
