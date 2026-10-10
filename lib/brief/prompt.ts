import type { CallRow, LeadRow } from '@/lib/db/types';
import { formatIst } from '@/lib/time';
import { QUALIFIED_RUBRIC } from './qualified';

/** Marker the mock Gemini uses to read the lead back out of the prompt. */
export const LEAD_JSON_MARKER = 'LEAD_FIELDS_JSON';

export const BRIEF_SYSTEM_INSTRUCTION = `You write a short handoff brief for an interior designer at Aangan Studio, Pune, about a new enquiry that came in by phone.
Use only what is in the transcript and the extracted lead fields. Never invent facts, names, dates or details that are not there.
Never include any price, range, rate, per-square-foot figure, typical cost or amount of money from Aangan or the agent.
The one exception: if the CALLER (a USER line) stated their own budget, put it in caller_stated_budget in their own words. Mention it nowhere else, and never quote a money figure in any other field. Otherwise caller_stated_budget is null.
Assess the five criteria from the rubric, in this order: real_project, service_area, timeline, budget, decision_maker. For each give met, unclear or not_met and a short quote from the transcript as evidence (or "Not discussed."). For the budget criterion, never quote a figure in the evidence.
In uncertainties, list anything unclear about budget or the decision-maker, as the rubric asks, plus anything else the designer should check. Use an empty list only if nothing is unclear.
suggested_opening is one warm, specific question for the designer's first call.
Write in plain, friendly English. Be brief.`;

export function bookingLine(lead: LeadRow): string {
  if (lead.booking_confirmed && lead.booked_slot_start) return `Consultation booked: ${formatIst(lead.booked_slot_start)}`;
  return `Call back: ${lead.callback_preference ?? 'no preferred time given'}`;
}

export function buildBriefPrompt(lead: LeadRow, call: CallRow): { system: string; prompt: string } {
  const fields = {
    caller_name: lead.caller_name, enquiry_type: lead.enquiry_type, locality: lead.locality,
    in_service_area: lead.in_service_area, property_type: lead.property_type, carpet_area_sqft: lead.carpet_area_sqft,
    scope: lead.scope, completion_deadline: lead.completion_deadline, timeline_fit: lead.timeline_fit,
    decision_maker: lead.decision_maker, budget_mentioned: lead.budget_mentioned, outcome: lead.outcome,
    callback_preference: lead.callback_preference, notes_for_designer: lead.notes_for_designer,
  };
  const prompt = `## Qualification rubric
${QUALIFIED_RUBRIC}

## ${LEAD_JSON_MARKER}
\`\`\`json
${JSON.stringify(fields, null, 2)}
\`\`\`

## Booking
${bookingLine(lead)}

## Transcript (AGENT = Aangan's phone assistant, USER = caller)
${call.transcript ?? '(no transcript)'}

Write the brief as JSON matching the schema.`;
  return { system: BRIEF_SYSTEM_INSTRUCTION, prompt };
}
