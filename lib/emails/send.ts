import { getAdapters, type EmailType } from '@/lib/adapters';
import { getRepo } from '@/lib/db';

export interface SendEmailInput {
  to: string;
  tag: EmailType;
  subject: string;
  html: string;
  text: string;
  leadId?: string | null;
  callId?: string | null;
}

/** Send through the Resend adapter and write the audit event (SPEC §6 events). */
export async function sendEmail(e: SendEmailInput): Promise<{ id: string }> {
  const repo = getRepo();
  try {
    const { id } = await getAdapters().resend.send({
      to: e.to, subject: e.subject, html: e.html, text: e.text, tag: e.tag, leadId: e.leadId ?? undefined,
    });
    await repo.insertEvent({
      type: 'email_sent', lead_id: e.leadId ?? null, call_id: e.callId ?? null,
      meta: { tag: e.tag, to: e.to, subject: e.subject, message_id: id },
    });
    return { id };
  } catch (err) {
    await repo.insertEvent({
      type: 'email_failed', lead_id: e.leadId ?? null, call_id: e.callId ?? null,
      meta: { tag: e.tag, to: e.to, subject: e.subject, error: String((err as Error)?.message ?? err) },
    });
    throw err;
  }
}

/** Has an email with this tag already gone out for the lead? */
export async function emailAlreadySent(leadId: string, tag: EmailType): Promise<boolean> {
  const sent = await getRepo().listEvents({ leadId, type: 'email_sent' });
  return sent.some((ev) => (ev.meta as { tag?: string } | null)?.tag === tag);
}
