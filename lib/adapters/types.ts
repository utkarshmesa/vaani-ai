/**
 * Interfaces for every external service. All calls to Vaani, Cal.com, Gemini and Resend go through these
 * (CLAUDE.md). Real implementations live next to this file; mocks in ./mocks.ts.
 */

// ---- Vaani ---------------------------------------------------------------

/** One row of GET /api/call-history, normalised. See NOTES.md §1.4. */
export interface VaaniCallHistoryItem {
  call_id: string;
  call_type: string; // 'Inbound' | 'Outbound'
  from_number: string | null;
  to_number: string | null;
  /** Start_time as returned (no offset; assumed UTC — unverified). */
  start_time: string | null;
  /** Credits. Only trust it when post_processing_status is 'completed'. */
  call_cost: number | null;
  post_processing_status: string; // 'completed' | 'processing' | 'not_processed'
}

export interface VaaniAdapter {
  /** Pages through call-history (no server-side filter exists) looking for callId. null if not listed yet. */
  findCall(callId: string, opts?: { maxPages?: number }): Promise<VaaniCallHistoryItem | null>;
  updatePersona(agentId: string, body: unknown): Promise<unknown>;
  updateTraining(agentId: string, body: unknown): Promise<unknown>;
  updateExperience(agentId: string, body: unknown): Promise<unknown>;
  updateAnalysis(agentId: string, body: unknown): Promise<unknown>;
}

// ---- Cal.com -------------------------------------------------------------

export interface CalBooking {
  uid: string;
  start: string;
  end: string;
  status: string; // 'accepted' | 'pending' | 'cancelled' | 'rejected' | 'awaiting_host'
  eventTypeId: number | null;
  attendeeName?: string;
  attendeeEmail?: string;
}

export interface CalcomAdapter {
  /** GET /v2/bookings filtered by event type, start >= afterStart and end <= beforeEnd. Follows the cursor. */
  listBookings(q: { eventTypeId: number; afterStart: Date; beforeEnd: Date }): Promise<CalBooking[]>;
}

// ---- Gemini --------------------------------------------------------------

export interface GeminiRequest {
  system: string;
  prompt: string;
  /** JSON Schema for the response (responseJsonSchema). The caller still validates with zod. */
  jsonSchema: object;
}

export interface GeminiResult {
  /** Raw response text (JSON). */
  text: string;
  /** usageMetadata.promptTokenCount */
  inputTokens: number;
  /** usageMetadata.candidatesTokenCount + thoughtsTokenCount (thinking is billed as output). */
  outputTokens: number;
}

export interface GeminiAdapter {
  generateJson(req: GeminiRequest): Promise<GeminiResult>;
}

// ---- Resend --------------------------------------------------------------

export const EMAIL_TYPES = ['designer_brief', 'reminder', 'escalation', 'urgent', 'outcome_request', 'low_balance'] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag: EmailType;
  leadId?: string;
}

export interface ResendAdapter {
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

// ---- Bundle --------------------------------------------------------------

export interface Adapters {
  vaani: VaaniAdapter;
  calcom: CalcomAdapter;
  gemini: GeminiAdapter;
  resend: ResendAdapter;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
