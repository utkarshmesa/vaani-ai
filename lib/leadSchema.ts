import { LEAD_OUTCOMES } from '@/lib/db/types';

/**
 * Single source of truth for the lead fields (SPEC §8). It drives:
 *  - the Vaani extraction data points pushed by `npm run vaani:configure`,
 *  - the entity mapper (lib/mapEntities.ts),
 *  - the designer brief.
 * Must mirror the table in VAANI_AGENT.md exactly (enforced by tests/unit/leadSchema.test.ts).
 */
export interface LeadFieldDef {
  name: string;
  /** Allowed values for enum-style extraction. */
  values?: readonly string[];
  nullable: boolean;
  prompt: string;
}

export const LEAD_FIELDS = [
  { name: 'caller_name', nullable: true, prompt: "The caller's name as they gave it." },
  {
    name: 'enquiry_type', values: ['new_enquiry', 'existing_client', 'vendor_or_other'], nullable: false,
    prompt: 'Is this a new project enquiry, an existing Aangan client, or something else (vendor, sales, spam)?',
  },
  { name: 'locality', nullable: true, prompt: "The locality or area of the property in the caller's words." },
  {
    name: 'in_service_area', values: ['yes', 'no', 'unclear'], nullable: true,
    prompt: 'Is the property in Pune city or PCMC? "unclear" if not stated or unrecognised.',
  },
  {
    name: 'property_type', values: ['apartment', 'independent_house', 'villa', 'office', 'clinic', 'studio', 'other'],
    nullable: true, prompt: 'The type of property.',
  },
  { name: 'carpet_area_sqft', nullable: true, prompt: 'Approximate carpet area in square feet as a number, if stated.' },
  { name: 'scope', nullable: true, prompt: 'Which rooms or areas the caller wants designed and executed, in one line.' },
  { name: 'completion_deadline', nullable: true, prompt: 'When the caller needs the project completed, in their words.' },
  {
    name: 'timeline_fit', values: ['yes', 'no', 'unclear'], nullable: true,
    prompt: '"no" if they need completion in under about 8 weeks; "unclear" if about 8–10 weeks or not stated; otherwise "yes".',
  },
  {
    name: 'decision_maker', values: ['yes', 'authorised_rep', 'no', 'unclear'], nullable: true,
    prompt: 'Is the caller the decision-maker or authorised by them?',
  },
  {
    name: 'budget_mentioned', values: ['none', 'not_a_concern', 'clearly_too_low'], nullable: true,
    prompt: 'Did the caller volunteer a budget? "clearly_too_low" only if the agent said it was well below the scope. Never record the figure.',
  },
  {
    name: 'outcome', values: LEAD_OUTCOMES, nullable: false,
    prompt: 'The call\'s final outcome. "booked" only if the agent confirmed a booking from the tool. "incomplete" if the call ended before the essentials were collected.',
  },
  {
    name: 'decline_reason', nullable: true,
    prompt: 'If declined: out_of_area, advice_only, out_of_scope, too_small, timeline, budget, not_decision_maker, other.',
  },
  { name: 'booked_slot_iso', nullable: true, prompt: 'If booked: the consultation start time in ISO 8601 with +05:30.' },
  { name: 'callback_preference', nullable: true, prompt: "If a callback was requested: the caller's preferred time." },
  {
    name: 'notes_for_designer', nullable: true,
    prompt: 'Anything the designer should know: referrer, uncertainties on budget or decision-maker, unusual details. No prices or budget figures.',
  },
] as const satisfies readonly LeadFieldDef[];

export type LeadFieldName = (typeof LEAD_FIELDS)[number]['name'];
export const LEAD_FIELD_NAMES: LeadFieldName[] = LEAD_FIELDS.map((f) => f.name);

/** Codes listed in the decline_reason prompt; anything else maps to "other". */
export const DECLINE_REASONS = [
  'out_of_area', 'advice_only', 'out_of_scope', 'too_small', 'timeline', 'budget', 'not_decision_maker', 'other',
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
