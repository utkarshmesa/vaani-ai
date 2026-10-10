import type { DesignerRow, LeadRow } from '@/lib/db/types';
import { leadRows } from './designerBrief';
import { button, detailsTable, detailsText, esc, layout } from './html';

/** SPEC §12 Escalation: +30 working minutes, not accepted → front desk, with a Reassign button. */
export function escalationEmail({ lead, designer, reassignUrl, minutesWaiting, callerNumber, dashboardUrl }: {
  lead: LeadRow; designer: DesignerRow; reassignUrl: string; minutesWaiting: number; callerNumber: string | null; dashboardUrl: string;
}) {
  const who = lead.caller_name ?? callerNumber ?? 'unknown caller';
  const subject = `Not accepted in ${minutesWaiting} min · ${designer.name} · ${lead.locality ?? 'locality not given'} · ${who}`;
  const body = `${designer.name} has not accepted this lead after ${minutesWaiting} working minutes. Please call ${designer.name.split(' ')[0]}, or reassign the lead to the next designer in the rotation.`;
  const rows = leadRows(lead, callerNumber);
  const html = layout('Lead not accepted', `
<p>${esc(body)}</p>
${detailsTable(rows)}
<p style="margin-top:20px">${button(reassignUrl, 'Reassign to the next designer', '#b7791f')}</p>
<p><a href="${esc(dashboardUrl)}">Open the dashboard</a></p>`);
  const text = `${body}\n\n${detailsText(rows)}\n\nReassign to the next designer: ${reassignUrl}\nDashboard: ${dashboardUrl}\n`;
  return { subject, html, text };
}
