import { getAdapters } from '@/lib/adapters';
import { now } from '@/lib/clock';
import { totalInr, vaaniInr } from '@/lib/cost';
import { getRepo } from '@/lib/db';
import { CONSULTATION_OUTCOMES, type ConsultationOutcome, type LeadRow, type SettingsRow } from '@/lib/db/types';
import { escalationEmail } from '@/lib/emails/escalation';
import { lowBalanceEmail } from '@/lib/emails/lowBalance';
import { outcomeRequestEmail } from '@/lib/emails/outcomeRequest';
import { reminderEmail } from '@/lib/emails/reminder';
import { sendEmail } from '@/lib/emails/send';
import { env } from '@/lib/env';
import { acceptLink, outcomeLink, reassignLink } from '@/lib/leads/links';
import { nextWorkingDayAt, workingMinutesBetween } from '@/lib/workingHours';

/** Cost lookups stop after this long; the dashboard shows the call as "cost unknown". */
const COST_RETRY_DAYS = 7;
const LOW_BALANCE_REPEAT_MS = 24 * 60 * 60_000;
const OUTCOME_REQUEST_TIME = '10:00';

type LeadField = keyof LeadRow;

/**
 * Claim a once-only flag, send, and release the claim if sending fails so the next tick retries.
 * The claim (a conditional update) keeps overlapping ticks from sending twice.
 */
async function sendOnce(lead: LeadRow, flag: LeadField, send: () => Promise<unknown>): Promise<boolean> {
  const repo = getRepo();
  const claimed = await repo.updateLeadIf(lead.id, { [flag]: now().toISOString() }, [flag]);
  if (!claimed) return false;
  try {
    await send();
    return true;
  } catch (err) {
    await repo.updateLead(lead.id, { [flag]: null });
    throw err;
  }
}

/** Leads that have been handed to a designer and are waiting for Accept. */
const awaitingAccept = (l: LeadRow) => l.designer_id && l.email_sent_at && l.clock_started_at && !l.accepted_at;

/** SPEC §13: not accepted after `reminder_minutes` working minutes → reminder to the designer (once). */
export async function sendReminders(leads: LeadRow[], s: SettingsRow): Promise<string[]> {
  const repo = getRepo();
  const sent: string[] = [];
  for (const lead of leads) {
    if (!awaitingAccept(lead) || lead.reminder_sent_at) continue;
    if (workingMinutesBetween(new Date(lead.clock_started_at!), now(), s) < s.reminder_minutes) continue;
    const designer = (await repo.getDesigner(lead.designer_id!))!;
    const ok = await sendOnce(lead, 'reminder_sent_at', () => {
      const email = reminderEmail({ lead, designer, acceptUrl: acceptLink(lead.id, designer.id), minutesWaiting: s.reminder_minutes });
      return sendEmail({ ...email, to: designer.email, tag: 'reminder', leadId: lead.id, callId: lead.call_id });
    });
    if (ok) sent.push(lead.id);
  }
  return sent;
}

/** SPEC §13: not accepted after `escalation_minutes` working minutes → front desk, with Reassign (once). */
export async function sendEscalations(leads: LeadRow[], s: SettingsRow): Promise<string[]> {
  const repo = getRepo();
  const e = env();
  const sent: string[] = [];
  for (const lead of leads) {
    if (!awaitingAccept(lead) || lead.escalated_at) continue;
    if (workingMinutesBetween(new Date(lead.clock_started_at!), now(), s) < s.escalation_minutes) continue;
    const designer = (await repo.getDesigner(lead.designer_id!))!;
    const call = await repo.getCall(lead.call_id);
    const ok = await sendOnce(lead, 'escalated_at', () => {
      const email = escalationEmail({
        lead, designer, reassignUrl: reassignLink(lead.id, designer.id), minutesWaiting: s.escalation_minutes,
        callerNumber: call?.from_number ?? null, dashboardUrl: `${e.APP_BASE_URL}/dashboard`,
      });
      return sendEmail({ ...email, to: e.FRONT_DESK_EMAIL, tag: 'escalation', leadId: lead.id, callId: lead.call_id });
    });
    if (ok) sent.push(lead.id);
  }
  return sent;
}

/**
 * SPEC §12: outcome request to the designer at 10:00 the next working day after the booked slot;
 * for callbacks, the next working day after Accept.
 */
export function outcomeRequestDue(lead: LeadRow, s: SettingsRow): Date | null {
  if (lead.booking_confirmed && lead.booked_slot_start) return nextWorkingDayAt(new Date(lead.booked_slot_start), OUTCOME_REQUEST_TIME, s);
  if (lead.outcome === 'callback' && lead.accepted_at) return nextWorkingDayAt(new Date(lead.accepted_at), OUTCOME_REQUEST_TIME, s);
  return null;
}

export async function sendOutcomeRequests(leads: LeadRow[], s: SettingsRow): Promise<string[]> {
  const repo = getRepo();
  const sent: string[] = [];
  for (const lead of leads) {
    if (!lead.designer_id || lead.outcome_requested_at || lead.consultation_outcome) continue;
    const due = outcomeRequestDue(lead, s);
    if (!due || now() < due) continue;
    const designer = (await repo.getDesigner(lead.designer_id))!;
    const ok = await sendOnce(lead, 'outcome_requested_at', () => {
      const links = Object.fromEntries(CONSULTATION_OUTCOMES.map((v) => [v, outcomeLink(lead.id, v)])) as Record<ConsultationOutcome, string>;
      const email = outcomeRequestEmail({ lead, designer, links });
      return sendEmail({ ...email, to: designer.email, tag: 'outcome_request', leadId: lead.id, callId: lead.call_id });
    });
    if (ok) sent.push(lead.id);
  }
  return sent;
}

/** SPEC §13: retry missing call_cost lookups (one call-history scan for all of them). */
export async function retryMissingCosts(s: SettingsRow): Promise<string[]> {
  const repo = getRepo();
  const since = new Date(now().getTime() - COST_RETRY_DAYS * 86_400_000);
  const missing = (await repo.listCalls({ missingCost: true, from: since })).filter((c) => c.processed_at);
  if (!missing.length) return [];

  const found = await getAdapters().vaani.findCalls(missing.map((c) => c.call_id));
  const filled: string[] = [];
  for (const call of missing) {
    const item = found.get(call.call_id);
    if (!item || item.post_processing_status !== 'completed' || item.call_cost === null) continue;
    const vInr = vaaniInr(item.call_cost, s);
    await repo.updateCall(call.call_id, {
      vaani_credits: item.call_cost, vaani_inr: vInr, total_inr: totalInr(vInr, call.gemini_inr),
      from_number: call.from_number ?? item.from_number,
    });
    await repo.insertEvent({ type: 'cost_filled', call_id: call.call_id, meta: { credits: item.call_cost } });
    filled.push(call.call_id);
  }
  return filled;
}

/** SPEC §13: credits_loaded − sum(vaani_credits) < threshold → owner email, at most once a day. */
export async function checkLowBalance(s: SettingsRow): Promise<boolean> {
  const repo = getRepo();
  const used = (await repo.listCalls()).reduce((sum, c) => sum + (c.vaani_credits ?? 0), 0);
  const remaining = s.credits_loaded - used;
  if (remaining >= s.low_balance_threshold_credits) return false;
  if (s.low_balance_alerted_at && now().getTime() - Date.parse(s.low_balance_alerted_at) < LOW_BALANCE_REPEAT_MS) return false;

  const e = env();
  await repo.updateSettings({ low_balance_alerted_at: now().toISOString() });
  try {
    const email = lowBalanceEmail({
      remainingCredits: remaining, thresholdCredits: s.low_balance_threshold_credits, creditsLoaded: s.credits_loaded,
      dashboardUrl: `${e.APP_BASE_URL}/dashboard`,
    });
    await sendEmail({ ...email, to: e.OWNER_EMAIL, tag: 'low_balance' });
  } catch (err) {
    await repo.updateSettings({ low_balance_alerted_at: s.low_balance_alerted_at });
    throw err;
  }
  return true;
}
