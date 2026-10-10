import type { DesignerRow, LeadRow } from '@/lib/db/types';
import { humanise } from '@/lib/format';
import { formatIst } from '@/lib/time';
import { button, detailsTable, detailsText, layout } from './html';

export interface DesignerBriefInput {
  lead: LeadRow;
  designer: DesignerRow;
  acceptUrl: string;
  callerNumber: string | null;
}

/** SPEC §12: `New lead · {locality} · {property} · {booked slot or "call back"}` */
export function designerBriefSubject(lead: LeadRow): string {
  const when = lead.booking_confirmed && lead.booked_slot_start ? formatIst(lead.booked_slot_start) : 'call back';
  return `New lead · ${lead.locality ?? 'locality not given'} · ${humanise(lead.property_type) ?? 'property not given'} · ${when}`;
}

function leadRows(lead: LeadRow, callerNumber: string | null): [string, string | number | null][] {
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

/** Designer handoff email. Checkpoint 4 adds the Gemini brief to this template. */
export function designerBriefEmail({ lead, designer, acceptUrl, callerNumber }: DesignerBriefInput) {
  const rows = leadRows(lead, callerNumber);
  const intro = `Hi ${designer.name.split(' ')[0]}, a new enquiry has been assigned to you. Please accept it so the studio knows you have it.`;
  const html = layout('New lead for you', `
<p>${intro}</p>
${detailsTable(rows)}
<p style="margin-top:20px">${button(acceptUrl, 'Accept this lead')}</p>`);
  const text = `${intro}\n\n${detailsText(rows)}\n\nAccept this lead: ${acceptUrl}\n`;
  return { subject: designerBriefSubject(lead), html, text };
}
