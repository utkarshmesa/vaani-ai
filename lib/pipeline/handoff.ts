import { now } from '@/lib/clock';
import { getRepo } from '@/lib/db';
import type { CallRow, LeadRow, SettingsRow } from '@/lib/db/types';
import { designerBriefEmail } from '@/lib/emails/designerBrief';
import { sendEmail } from '@/lib/emails/send';
import { env } from '@/lib/env';
import { buildLinkUrl } from '@/lib/links';
import { pickDesigner } from '@/lib/rotation';
import { clockStart } from '@/lib/workingHours';
import { ATTENTION } from './attention';

const ACCEPT_LINK_DAYS = 14;

/**
 * SPEC §7.3d for booked (confirmed) and callback leads: assign a designer (§9), send the designer email (§12)
 * and start the working-hours clock (§13). Safe to re-run: an assigned designer is kept, a sent email is not resent.
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
    const assignedAt = now().toISOString();
    await repo.updateDesigner(designer.id, { last_assigned_at: assignedAt });
    lead = await repo.updateLead(lead.id, { designer_id: designer.id });
    await repo.insertEvent({ type: 'designer_assigned', lead_id: lead.id, call_id: lead.call_id, meta: { designer_id: designer.id, designer: designer.name } });
  }

  const e = env();
  const exp = Math.floor(now().getTime() / 1000) + ACCEPT_LINK_DAYS * 86_400;
  const acceptUrl = buildLinkUrl(e.APP_BASE_URL, { leadId: lead.id, action: 'accept', exp }, e.LINK_SIGNING_SECRET);
  const email = designerBriefEmail({ lead, designer, acceptUrl, callerNumber: call.from_number });

  await sendEmail({ ...email, to: designer.email, tag: 'designer_brief', leadId: lead.id, callId: lead.call_id });

  const sentAt = now();
  return repo.updateLead(lead.id, {
    email_sent_at: sentAt.toISOString(),
    clock_started_at: clockStart(sentAt, settings).toISOString(),
  });
}
