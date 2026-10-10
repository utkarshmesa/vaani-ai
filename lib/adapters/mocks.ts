import type {
  CalBooking, CalcomAdapter, GeminiAdapter, GeminiRequest, OutgoingEmail, ResendAdapter, VaaniAdapter,
} from './types';

/**
 * Mock adapters used when MOCK_EXTERNAL=1 and always in tests. State is module-level so a dev server
 * (npm run simulate) and the tests can inspect it. Call resetMocks() between tests.
 */

export interface MockVaani extends VaaniAdapter {
  /** Credits returned for every listed call. */
  fixedCost: number;
  /** Calls that are "not listed yet" in call-history (to exercise the cost retry). */
  notListed: Set<string>;
  /** Caller numbers by call_id; others get a deterministic placeholder. */
  fromNumbers: Map<string, string>;
  patches: { section: string; agentId: string; body: unknown }[];
}

export interface MockCalcom extends CalcomAdapter {
  bookings: CalBooking[];
}

export interface MockGemini extends GeminiAdapter {
  fixedInputTokens: number;
  fixedOutputTokens: number;
  /** Produces the response text. Checkpoint 4 replaces the default with a canned brief built from the prompt. */
  responder: (req: GeminiRequest, attempt: number) => string;
  requests: GeminiRequest[];
}

export interface MockResend extends ResendAdapter {
  outbox: (OutgoingEmail & { id: string })[];
  /** When set, send() throws this message (to exercise error handling). */
  failWith: string | null;
}

const DEFAULT_RESPONDER = () => JSON.stringify({ mock: true });

/**
 * SPEC §15: in mock mode Cal.com holds bookings at the t01 and t13 slots.
 * eventTypeId null matches whatever CALCOM_EVENT_TYPE_ID is configured.
 */
export const FIXTURE_BOOKINGS: CalBooking[] = [
  { uid: 'mock-cal-t01', start: '2026-09-07T05:30:00.000Z', end: '2026-09-07T06:15:00.000Z', status: 'accepted', eventTypeId: null, attendeeName: 'Priya' },
  { uid: 'mock-cal-t13', start: '2026-09-18T10:30:00.000Z', end: '2026-09-18T11:15:00.000Z', status: 'accepted', eventTypeId: null, attendeeName: 'Kavita' },
];

function createMockVaani(): MockVaani {
  return {
    fixedCost: 12.5,
    notListed: new Set(),
    fromNumbers: new Map(),
    patches: [],
    async findCall(callId) {
      const m = mocks.vaani;
      if (m.notListed.has(callId)) return null;
      return {
        call_id: callId,
        call_type: 'Inbound',
        from_number: m.fromNumbers.get(callId) ?? '+919800000000',
        to_number: '+912000000000',
        start_time: null,
        call_cost: m.fixedCost,
        post_processing_status: 'completed',
      };
    },
    async updatePersona(agentId, body) { mocks.vaani.patches.push({ section: 'persona', agentId, body }); return { ok: true }; },
    async updateTraining(agentId, body) { mocks.vaani.patches.push({ section: 'training', agentId, body }); return { ok: true }; },
    async updateExperience(agentId, body) { mocks.vaani.patches.push({ section: 'experience', agentId, body }); return { ok: true }; },
    async updateAnalysis(agentId, body) { mocks.vaani.patches.push({ section: 'analysis', agentId, body }); return { ok: true }; },
  };
}

function createMockCalcom(): MockCalcom {
  return {
    bookings: structuredClone(FIXTURE_BOOKINGS),
    async listBookings({ eventTypeId, afterStart, beforeEnd }) {
      return mocks.calcom.bookings.filter((b) =>
        (b.eventTypeId === null || b.eventTypeId === eventTypeId)
        && new Date(b.start) >= afterStart
        && new Date(b.end) <= beforeEnd);
    },
  };
}

function createMockGemini(): MockGemini {
  return {
    fixedInputTokens: 2000,
    fixedOutputTokens: 400,
    responder: DEFAULT_RESPONDER,
    requests: [],
    async generateJson(req) {
      const m = mocks.gemini;
      m.requests.push(req);
      const attempt = m.requests.length;
      return { text: m.responder(req, attempt), inputTokens: m.fixedInputTokens, outputTokens: m.fixedOutputTokens };
    },
  };
}

function createMockResend(): MockResend {
  return {
    outbox: [],
    failWith: null,
    async send(email) {
      const m = mocks.resend;
      if (m.failWith) throw new Error(m.failWith);
      const id = `mock_${m.outbox.length + 1}`;
      m.outbox.push({ ...email, id });
      // Make `npm run simulate` visible in the dev-server console (quiet under Vitest).
      if (!process.env.VITEST) console.info(`[mock-resend] ${email.tag} → ${email.to} · ${email.subject}`);
      return { id };
    },
  };
}

export const mocks: { vaani: MockVaani; calcom: MockCalcom; gemini: MockGemini; resend: MockResend } = {
  vaani: createMockVaani(),
  calcom: createMockCalcom(),
  gemini: createMockGemini(),
  resend: createMockResend(),
};

/**
 * Restore every mock — state and methods (tests may replace a method) — keeping object identity,
 * since getAdapters() hands out these same objects.
 */
export function resetMocks(): void {
  Object.assign(mocks.vaani, createMockVaani());
  Object.assign(mocks.calcom, createMockCalcom());
  Object.assign(mocks.gemini, createMockGemini());
  Object.assign(mocks.resend, createMockResend());
}
