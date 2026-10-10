import type { DesignerRow, LeadRow } from '@/lib/db/types';
import { leadLabel } from './designerBrief';
import { button, esc, layout } from './html';

/** SPEC §12 Reminder: +15 working minutes, not accepted — same lead, "still waiting for you". */
export function reminderEmail({ lead, designer, acceptUrl, minutesWaiting }: {
  lead: LeadRow; designer: DesignerRow; acceptUrl: string; minutesWaiting: number;
}) {
  const subject = `Still waiting for you · New lead · ${leadLabel(lead)}`;
  const body = `Hi ${designer.name.split(' ')[0]}, ${lead.caller_name ?? 'this caller'} is still waiting for you. The lead has been with you for ${minutesWaiting} working minutes and hasn't been accepted yet. If it isn't accepted soon, the front desk will be asked to reassign it.`;
  const html = layout('Still waiting for you', `
<p>${esc(body)}</p>
<p>${button(acceptUrl, 'Accept this lead')}</p>
<p style="color:#666">The full brief is in the original "New lead" email.</p>`);
  const text = `${body}\n\nAccept this lead: ${acceptUrl}\n\nThe full brief is in the original "New lead" email.\n`;
  return { subject, html, text };
}
