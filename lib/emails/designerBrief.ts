import { briefToHtml, briefToText } from '@/lib/brief/render';
import type { Brief } from '@/lib/brief/schema';
import type { DesignerRow, LeadRow } from '@/lib/db/types';
import { humanise } from '@/lib/format';
import { formatIst } from '@/lib/time';
import { button, detailsTable, detailsText, esc, layout } from './html';

export interface DesignerBriefInput {
  lead: LeadRow;
  designer: DesignerRow;
  acceptUrl: string;
  callerNumber: string | null;
  brief: Brief | null;
  /** Name of the previous designer when the lead was reassigned */
  reassignedFrom?: string;
}

/** "Kothrud · apartment · Mon 7 Sep, 11:00 am" — also used by reminder and escalation subjects. */
export function leadLabel(lead: LeadRow): string {
  const when = lead.booking_confirmed && lead.booked_slot_start ? formatIst(lead.booked_slot_start) : 'call back';
  return `${lead.locality ?? 'locality not given'} · ${humanise(lead.property_type) ?? 'property not given'} · ${when}`;
}

/** SPEC §12: `New lead · {locality} · {property} · {booked slot or "call back"}` */
export function designerBriefSubject(lead: LeadRow): string {
  return `New lead · ${leadLabel(lead)}`;
}

export function leadRows(lead: LeadRow, callerNumber: string | null): [string, string | number | null][] {
  return [
    ['Name', lead.caller_name],
    ['Phone', callerNumber],
    ['Locality', lead.locality],
    ['Property', humanise(lead.property_type)],
    ['Carpet area', lead.carpet_area_sqft ? `${lead.carpet_area_sqft} sq ft` : null],
    ['Scope', lead.scope],
    ['Needs it by', lead.completion_deadline],
    ['Decision-maker', humanise(lead.decision_maker)],
    ['Consultation', lead.booking_confirmed && lead.booked_slot_start ? formatIst(lead.booked_slot_start) : null],
    ['Call back', lead.booking_confirmed ? null : lead.callback_preference ?? 'No preference given'],
    ['Notes', lead.notes_for_designer],
  ];
}

/** Designer handoff email (SPEC §12): brief + lead details + a big Accept button. */
export function designerBriefEmail({ lead, designer, acceptUrl, callerNumber, brief, reassignedFrom }: DesignerBriefInput) {
  const rows = leadRows(lead, callerNumber);
  const first = designer.name.split(' ')[0];
  const intro = reassignedFrom
    ? `Hi ${first}, this lead has been reassigned to you from ${reassignedFrom}. Please accept it so the studio knows you have it.`
    : `Hi ${first}, a new enquiry has been assigned to you. Please accept it so the studio knows you have it.`;
  const note = reassignedFrom ? `Reassigned to you from ${reassignedFrom}.` : null;
  const noBrief = 'Brief not available — see the lead details below.';

  const html = layout('New lead for you', `
<p>${esc(intro)}</p>
<p>${button(acceptUrl, 'Accept this lead')}</p>
${brief ? briefToHtml(brief) : `<p><em>${esc(noBrief)}</em></p>`}
<p style="margin:16px 0 4px"><strong>Lead details</strong></p>
${detailsTable(rows)}
<p style="margin-top:20px">${button(acceptUrl, 'Accept this lead')}</p>`);

  const text = [
    intro,
    note,
    '',
    brief ? briefToText(brief) : noBrief,
    '',
    'Lead details:',
    detailsText(rows),
    '',
    `Accept this lead: ${acceptUrl}`,
    '',
  ].filter((l) => l !== null).join('\n');

  return { subject: designerBriefSubject(lead), html, text };
}
