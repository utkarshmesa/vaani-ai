import type { CallRow, LeadRow } from '@/lib/db/types';
import { humanise } from '@/lib/format';
import { formatIst } from '@/lib/time';
import { detailsTable, detailsText, esc, layout } from './html';

export type UrgentKind = 'transfer_failed' | 'existing_client_after_hours' | 'call_dropped';

const NUMBER_PENDING = 'number pending — see the dashboard';

/** SPEC §12 "Urgent" → front desk: transfer failed / after-hours existing client / incomplete call. */
export function urgentEmail(kind: UrgentKind, lead: LeadRow, call: CallRow, dashboardUrl: string) {
  const number = call.from_number ?? NUMBER_PENDING;
  const who = lead.caller_name ?? call.from_number ?? 'unknown caller';
  const subject = {
    transfer_failed: `URGENT · Transfer failed · ${who}`,
    existing_client_after_hours: `URGENT · Existing client after hours · ${who}`,
    call_dropped: `Call back — call dropped · ${call.from_number ?? 'number pending'}`,
  }[kind];
  const lead_in = {
    transfer_failed: 'Vaani tried to transfer this caller to the team and the transfer did not connect. Please call them back.',
    existing_client_after_hours: 'An existing client called outside working hours. Please call them back.',
    call_dropped: 'This call dropped before Vaani could collect the details. Please call the number back.',
  }[kind];

  const rows: [string, string | number | null][] = [
    ['Caller number', number],
    ['Name', lead.caller_name],
    ['Called at', formatIst(call.received_at)],
    ['Enquiry', humanise(lead.enquiry_type)],
    ['Locality', lead.locality],
    ['Best time to call', lead.callback_preference],
    ['Notes', lead.notes_for_designer],
  ];
  const summary = call.summary ?? '(no summary)';

  const html = layout(subject, `
<p>${esc(lead_in)}</p>
${detailsTable(rows)}
<p><strong>What happened on the call</strong><br>${esc(summary)}</p>
<p><a href="${esc(dashboardUrl)}">Open the dashboard</a></p>`);
  const text = `${lead_in}\n\n${detailsText(rows)}\n\nWhat happened on the call:\n${summary}\n\nDashboard: ${dashboardUrl}\n`;
  return { subject, html, text };
}
