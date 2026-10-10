import { now } from '@/lib/clock';
import { getRepo } from '@/lib/db';
import { CONSULTATION_OUTCOMES, type ConsultationOutcome, type LeadRow } from '@/lib/db/types';
import { pickDesigner } from '@/lib/rotation';
import { sendDesignerBrief } from '@/lib/pipeline/handoff';
import { clockStart } from '@/lib/workingHours';
import { ATTENTION } from '@/lib/pipeline/attention';

export type AcceptResult =
  | { status: 'accepted'; lead: LeadRow }
  | { status: 'already_accepted'; lead: LeadRow }
  | { status: 'reassigned_away'; lead: LeadRow; currentDesigner: string | null }
  | { status: 'not_found' };

/**
 * Accept link → accepted_at (once). The link names the designer it was sent to; the update is a compare-and-set on
 * that designer, so an Accept racing a Reassign can't accept a lead that has just moved.
 */
export async function acceptLead(leadId: string, designerId: string): Promise<AcceptResult> {
  const repo = getRepo();
  if (!(await repo.getLead(leadId))) return { status: 'not_found' };
  const updated = await repo.updateLeadIf(leadId, { accepted_at: now().toISOString() }, ['accepted_at'], { designer_id: designerId });
  if (updated) return { status: 'accepted', lead: updated };

  const lead = (await repo.getLead(leadId))!;
  if (lead.designer_id !== designerId) {
    const current = lead.designer_id ? await repo.getDesigner(lead.designer_id) : null;
    return { status: 'reassigned_away', lead, currentDesigner: current?.name ?? null };
  }
  return { status: 'already_accepted', lead };
}

export type OutcomeResult = { status: 'logged'; lead: LeadRow } | { status: 'invalid_value' } | { status: 'not_found' };

export function isConsultationOutcome(v: string | null | undefined): v is ConsultationOutcome {
  return !!v && (CONSULTATION_OUTCOMES as readonly string[]).includes(v);
}

/** Outcome link → consultation_outcome. A later click corrects the value; the first logged time is kept. */
export async function logOutcome(leadId: string, value: string): Promise<OutcomeResult> {
  if (!isConsultationOutcome(value)) return { status: 'invalid_value' };
  const repo = getRepo();
  const lead = await repo.getLead(leadId);
  if (!lead) return { status: 'not_found' };
  const updated = await repo.updateLead(leadId, {
    consultation_outcome: value,
    outcome_logged_at: lead.outcome_logged_at ?? now().toISOString(),
  });
  return { status: 'logged', lead: updated };
}

export type ReassignResult =
  | { status: 'reassigned'; lead: LeadRow; from: string; to: string }
  | { status: 'already_reassigned'; lead: LeadRow }
  | { status: 'already_accepted'; lead: LeadRow; by: string | null }
  | { status: 'no_designer'; lead: LeadRow }
  | { status: 'not_found' };

/**
 * SPEC §9/§13: next designer by rotation (excluding the current one), reassign_count + 1, the brief re-sent,
 * and the clock plus reminder/escalation flags restarted.
 */
export async function reassignLead(leadId: string, fromDesignerId: string): Promise<ReassignResult> {
  const repo = getRepo();
  let lead = await repo.getLead(leadId);
  if (!lead) return { status: 'not_found' };
  if (lead.designer_id !== fromDesignerId) return { status: 'already_reassigned', lead };
  const from = lead.designer_id ? await repo.getDesigner(lead.designer_id) : null;
  if (lead.accepted_at) return { status: 'already_accepted', lead, by: from?.name ?? null };

  const next = pickDesigner(await repo.listDesigners(), { excludeId: lead.designer_id });
  if (!next) {
    lead = await repo.updateLead(lead.id, { needs_attention: true, attention_reason: 'No other active designer to reassign to' });
    return { status: 'no_designer', lead };
  }

  // Compare-and-set: only one of two simultaneous clicks (or an Accept racing this) can move the lead.
  const moved = await repo.updateLeadIf(
    lead.id,
    { designer_id: next.id, reassign_count: lead.reassign_count + 1 },
    ['accepted_at'],
    { designer_id: fromDesignerId, reassign_count: lead.reassign_count },
  );
  if (!moved) {
    const current = (await repo.getLead(leadId))!;
    if (current.accepted_at && current.designer_id === fromDesignerId) return { status: 'already_accepted', lead: current, by: from?.name ?? null };
    return { status: 'already_reassigned', lead: current };
  }
  lead = moved;

  const settings = await repo.getSettings();
  const call = (await repo.getCall(lead.call_id))!;
  await repo.updateDesigner(next.id, { last_assigned_at: now().toISOString() });

  await sendDesignerBrief(lead, next, call, { reassignedFrom: from?.name });

  const sentAt = now();
  lead = await repo.updateLead(lead.id, {
    email_sent_at: sentAt.toISOString(),
    clock_started_at: clockStart(sentAt, settings).toISOString(),
    reminder_sent_at: null,
    escalated_at: null,
    // An unassignable lead flagged earlier is resolved by a successful reassignment.
    ...(lead.attention_reason === ATTENTION.noDesigner ? { needs_attention: false, attention_reason: null } : {}),
  });
  return { status: 'reassigned', lead, from: from?.name ?? 'the previous designer', to: next.name };
}
