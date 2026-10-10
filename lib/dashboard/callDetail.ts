import { getRepo } from '@/lib/db';
import type { CallRow, DesignerRow, EventRow, LeadRow } from '@/lib/db/types';

export interface TimelineItem {
  at: string;
  label: string;
  detail: string | null;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
}

export interface CallDetail {
  call: CallRow;
  lead: LeadRow | null;
  designer: DesignerRow | null;
  timeline: TimelineItem[];
}

const EMAIL_LABEL: Record<string, string> = {
  designer_brief: 'Designer email sent',
  reminder: 'Reminder sent to designer',
  escalation: 'Escalated to front desk',
  urgent: 'Urgent email to front desk',
  outcome_request: 'Outcome request sent',
  low_balance: 'Low-balance email',
};

const meta = (e: EventRow) => (e.meta ?? {}) as Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? null : String(v));

/** Human-readable audit trail for one call, from the events table. Unknown event types are skipped. */
function describe(e: EventRow): Omit<TimelineItem, 'at'> | null {
  const m = meta(e);
  switch (e.type) {
    case 'webhook_received':
      return m.event === 'call_postprocessing' ? { label: 'Call summary received from Vaani', detail: null, tone: 'neutral' }
        : m.event === 'call_started' ? { label: 'Call started', detail: null, tone: 'neutral' } : null;
    case 'caller_number': return { label: 'Caller number captured', detail: null, tone: 'neutral' };
    case 'call_lookup_failed': return { label: 'Vaani call-history unavailable — cost estimated', detail: null, tone: 'warn' };
    case 'cost_filled': return { label: 'Vaani cost confirmed', detail: `${s(m.credits)} credits`, tone: 'good' };
    case 'transfer_failed': return { label: 'Transfer to the team failed', detail: s(m.reason), tone: 'bad' };
    case 'transfer_successful': return { label: 'Transferred to the team', detail: null, tone: 'good' };
    case 'booking_confirmed': return { label: 'Booking confirmed in Cal.com', detail: s(m.uid), tone: 'good' };
    case 'booking_not_found': return { label: s(m.reason) ?? 'Booking not found', detail: null, tone: 'warn' };
    case 'designer_assigned': return { label: `Assigned to ${s(m.designer)}`, detail: null, tone: 'neutral' };
    case 'brief_generated':
      return { label: 'Designer brief generated', detail: Number(m.attempts) > 1 ? `regenerated once (price check)` : null, tone: 'neutral' };
    case 'brief_failed': return { label: 'Brief could not be generated', detail: s(m.error), tone: 'warn' };
    case 'email_sent': return { label: EMAIL_LABEL[s(m.tag) ?? ''] ?? 'Email sent', detail: s(m.subject), tone: m.tag === 'urgent' || m.tag === 'escalation' ? 'warn' : 'neutral' };
    case 'email_failed': return { label: 'Email failed', detail: s(m.error), tone: 'bad' };
    case 'lead_accepted': return { label: 'Accepted by designer', detail: null, tone: 'good' };
    case 'lead_reassigned': return { label: `Reassigned from ${s(m.from)} to ${s(m.to)}`, detail: null, tone: 'warn' };
    case 'outcome_logged': return { label: 'Consultation outcome logged', detail: s(m.value)?.replace(/_/g, ' ') ?? null, tone: 'good' };
    case 'processing_error': return { label: 'Processing error', detail: s(m.error)?.split('\n')[0] ?? null, tone: 'bad' };
    default: return null;
  }
}

export async function loadCallDetail(callId: string): Promise<CallDetail | null> {
  const repo = getRepo();
  const call = await repo.getCall(callId);
  if (!call) return null;
  const lead = await repo.getLeadByCallId(callId);
  const designer = lead?.designer_id ? await repo.getDesigner(lead.designer_id) : null;
  const byCall = await repo.listEvents({ callId });
  const byLead = lead ? await repo.listEvents({ leadId: lead.id }) : [];
  const events = [...new Map([...byCall, ...byLead].map((e) => [e.id, e])).values()];
  const timeline = events
    .map((e) => {
      const d = describe(e);
      return d ? { at: e.at, ...d } : null;
    })
    .filter((t): t is TimelineItem => t !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
  return { call, lead, designer, timeline };
}
