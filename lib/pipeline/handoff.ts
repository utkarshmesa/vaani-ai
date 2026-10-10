import { generateBrief } from '@/lib/brief/generate';
import type { Brief } from '@/lib/brief/schema';
import { now } from '@/lib/clock';
import { geminiInr, totalInr } from '@/lib/cost';
import { getRepo } from '@/lib/db';
import type { CallRow, DesignerRow, Json, LeadRow, SettingsRow } from '@/lib/db/types';
import { designerBriefEmail } from '@/lib/emails/designerBrief';
import { sendEmail } from '@/lib/emails/send';
import { acceptLink } from '@/lib/leads/links';
import { pickDesigner } from '@/lib/rotation';
import { clockStart } from '@/lib/workingHours';
import { ATTENTION } from './attention';

export const BRIEF_ATTENTION = 'Brief had a possible price — lines removed';

/**
 * SPEC §7.3d for booked (confirmed) and callback leads: assign a designer (§9), generate the brief (§11),
 * send the designer email (§12) and start the working-hours clock (§13).
 * Safe to re-run: an assigned designer and a generated brief are kept; a sent email is not resent.
 */
export async function handoff(lead: LeadRow, call: CallRow, settings: SettingsRow): Promise<LeadRow> {
  const repo = getRepo();
  if (lead.email_sent_at) return lead;

  let designer = lead.designer_id ? await repo.getDesigner(lead.designer_id) : null;
  if (!designer) {
    designer = pickDesigner(await repo.listDesigners());
    if (!designer) {
      return repo.updateLead(lead.id, { needs_attention: true, attention_reason: ATTENTION.noDesigner });
    }
    await repo.updateDesigner(designer.id, { last_assigned_at: now().toISOString() });
    lead = await repo.updateLead(lead.id, { designer_id: designer.id });
    await repo.insertEvent({ type: 'designer_assigned', lead_id: lead.id, call_id: lead.call_id, meta: { designer_id: designer.id, designer: designer.name } });
  }

  if (!lead.brief_json) ({ lead, call } = await addBrief(lead, call, settings));

  await sendDesignerBrief(lead, designer, call);

  const sentAt = now();
  return repo.updateLead(lead.id, {
    email_sent_at: sentAt.toISOString(),
    clock_started_at: clockStart(sentAt, settings).toISOString(),
  });
}

/** Generate the Gemini brief, store it on the lead and its token cost on the call. A failed brief never blocks the email. */
async function addBrief(lead: LeadRow, call: CallRow, settings: SettingsRow): Promise<{ lead: LeadRow; call: CallRow }> {
  const repo = getRepo();
  const r = await generateBrief(lead, call);

  if (r.inputTokens || r.outputTokens) {
    const inTok = call.gemini_input_tokens + r.inputTokens;
    const outTok = call.gemini_output_tokens + r.outputTokens;
    const gInr = geminiInr(inTok, outTok, settings);
    call = await repo.updateCall(call.call_id, {
      gemini_input_tokens: inTok, gemini_output_tokens: outTok, gemini_inr: gInr, total_inr: totalInr(call.vaani_inr, gInr),
    });
  }

  if (!r.brief) {
    await repo.insertEvent({ type: 'brief_failed', lead_id: lead.id, call_id: lead.call_id, meta: { error: r.failure ?? 'unknown', attempts: r.attempts } });
    return { lead, call };
  }

  const attention = r.needsAttention
    ? { needs_attention: true, attention_reason: lead.attention_reason ? `${lead.attention_reason}; ${BRIEF_ATTENTION}` : BRIEF_ATTENTION }
    : {};
  lead = await repo.updateLead(lead.id, { brief_json: r.brief as unknown as Json, brief_text: r.text, ...attention });
  await repo.insertEvent({
    type: 'brief_generated', lead_id: lead.id, call_id: lead.call_id,
    meta: { attempts: r.attempts, input_tokens: r.inputTokens, output_tokens: r.outputTokens, removed_lines: r.removedLines },
  });
  return { lead, call };
}

/** The designer email with brief and a designer-bound Accept link. Also used on reassignment. */
export async function sendDesignerBrief(lead: LeadRow, designer: DesignerRow, call: CallRow, opts: { reassignedFrom?: string } = {}) {
  const email = designerBriefEmail({
    lead,
    designer,
    acceptUrl: acceptLink(lead.id, designer.id),
    callerNumber: call.from_number,
    brief: (lead.brief_json as unknown as Brief | null) ?? null,
    reassignedFrom: opts.reassignedFrom,
  });
  await sendEmail({ ...email, to: designer.email, tag: 'designer_brief', leadId: lead.id, callId: lead.call_id });
}
