/** Row shapes for the Supabase schema (supabase/migrations/0001_schema.sql). Timestamps are ISO strings. */

export const LEAD_OUTCOMES = [
  'booked', 'callback', 'declined', 'existing_client_transferred', 'transfer_failed', 'incomplete', 'other',
] as const;
export type LeadOutcome = (typeof LEAD_OUTCOMES)[number];

export const CONSULTATION_OUTCOMES = ['site_visit', 'proposal', 'not_fit', 'no_show'] as const;
export type ConsultationOutcome = (typeof CONSULTATION_OUTCOMES)[number];

export type Iso = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface DesignerRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  last_assigned_at: Iso | null;
}

export interface CallRow {
  call_id: string;
  received_at: Iso;
  from_number: string | null;
  duration_ms: number | null;
  transcript: string | null;
  summary: string | null;
  entities: Json | null;
  dispositions: Json | null;
  recording_url: string | null;
  raw_payload: Json;
  vaani_credits: number | null;
  vaani_inr: number | null;
  gemini_input_tokens: number;
  gemini_output_tokens: number;
  gemini_inr: number;
  total_inr: number | null;
  price_flag: boolean;
  price_flag_lines: string[];
  processing_started_at: Iso | null;
  processed_at: Iso | null;
  processing_error: string | null;
}

export type CallInsert = Pick<CallRow, 'call_id' | 'raw_payload'> & Partial<Omit<CallRow, 'call_id'>>;
export type CallPatch = Partial<Omit<CallRow, 'call_id'>>;

export interface LeadRow {
  id: string;
  call_id: string;
  // §8 lead fields
  caller_name: string | null;
  enquiry_type: string | null;
  locality: string | null;
  in_service_area: string | null;
  property_type: string | null;
  carpet_area_sqft: number | null;
  scope: string | null;
  completion_deadline: string | null;
  timeline_fit: string | null;
  decision_maker: string | null;
  budget_mentioned: string | null;
  outcome: LeadOutcome;
  decline_reason: string | null;
  callback_preference: string | null;
  notes_for_designer: string | null;
  // booking
  booked_slot_start: Iso | null;
  booking_confirmed: boolean;
  cal_booking_uid: string | null;
  // handoff
  designer_id: string | null;
  brief_json: Json | null;
  brief_text: string | null;
  clock_started_at: Iso | null;
  email_sent_at: Iso | null;
  reminder_sent_at: Iso | null;
  escalated_at: Iso | null;
  accepted_at: Iso | null;
  reassign_count: number;
  consultation_outcome: ConsultationOutcome | null;
  outcome_requested_at: Iso | null;
  outcome_logged_at: Iso | null;
  needs_attention: boolean;
  attention_reason: string | null;
  created_at: Iso;
}

export type LeadInsert = Pick<LeadRow, 'call_id' | 'outcome'> & Partial<Omit<LeadRow, 'id' | 'call_id' | 'outcome'>>;
export type LeadPatch = Partial<Omit<LeadRow, 'id' | 'call_id'>>;

export interface EventRow {
  id: number;
  lead_id: string | null;
  call_id: string | null;
  type: string;
  at: Iso;
  meta: Json;
}

export type EventInsert = Pick<EventRow, 'type'> & Partial<Pick<EventRow, 'lead_id' | 'call_id' | 'meta' | 'at'>>;

export interface SettingsRow {
  credit_to_inr: number;
  gemini_input_inr_per_mtok: number;
  gemini_output_inr_per_mtok: number;
  credits_loaded: number;
  low_balance_threshold_credits: number;
  /** ISO weekdays, Monday = 1 … Sunday = 7 */
  working_days: number[];
  /** "HH:MM", IST */
  work_start: string;
  /** "HH:MM", IST */
  work_end: string;
  reminder_minutes: number;
  escalation_minutes: number;
  low_balance_alerted_at: Iso | null;
}
