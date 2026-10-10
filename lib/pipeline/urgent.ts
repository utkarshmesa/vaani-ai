import { getRepo } from '@/lib/db';
import type { CallRow, LeadRow } from '@/lib/db/types';
import { emailAlreadySent, sendEmail } from '@/lib/emails/send';
import { urgentEmail, type UrgentKind } from '@/lib/emails/urgent';
import { env } from '@/lib/env';
import { ATTENTION } from './attention';

const REASON: Record<UrgentKind, string> = {
  transfer_failed: ATTENTION.transferFailed,
  existing_client_after_hours: ATTENTION.existingClientAfterHours,
  call_dropped: ATTENTION.callDropped,
};

/** Flag the lead and email the front desk — at most once per lead. */
export async function sendUrgent(kind: UrgentKind, lead: LeadRow, call: CallRow): Promise<LeadRow> {
  const repo = getRepo();
  lead = await repo.updateLead(lead.id, { needs_attention: true, attention_reason: REASON[kind] });
  if (await emailAlreadySent(lead.id, 'urgent')) return lead;
  const e = env();
  const email = urgentEmail(kind, lead, call, `${e.APP_BASE_URL}/dashboard`);
  await sendEmail({ ...email, to: e.FRONT_DESK_EMAIL, tag: 'urgent', leadId: lead.id, callId: lead.call_id });
  return lead;
}
