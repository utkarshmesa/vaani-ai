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

function createMockVaani(): MockVaani {
  const m: MockVaani = {
    fixedCost: 12.5,
    notListed: new Set(),
    fromNumbers: new Map(),
    patches: [],
    async findCall(callId) {
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
    async updatePersona(agentId, body) { m.patches.push({ section: 'persona', agentId, body }); return { ok: true }; },
    async updateTraining(agentId, body) { m.patches.push({ section: 'training', agentId, body }); return { ok: true }; },
    async updateExperience(agentId, body) { m.patches.push({ section: 'experience', agentId, body }); return { ok: true }; },
    async updateAnalysis(agentId, body) { m.patches.push({ section: 'analysis', agentId, body }); return { ok: true }; },
  };
  return m;
}

function createMockCalcom(): MockCalcom {
  const m: MockCalcom = {
    bookings: [],
    async listBookings({ eventTypeId, afterStart, beforeEnd }) {
      return m.bookings.filter((b) =>
        b.eventTypeId === eventTypeId
        && new Date(b.start) >= afterStart
        && new Date(b.end) <= beforeEnd);
    },
  };
  return m;
}

function createMockGemini(): MockGemini {
  const m: MockGemini = {
    fixedInputTokens: 2000,
    fixedOutputTokens: 400,
    responder: DEFAULT_RESPONDER,
    requests: [],
    async generateJson(req) {
      m.requests.push(req);
      const attempt = m.requests.length;
      return { text: m.responder(req, attempt), inputTokens: m.fixedInputTokens, outputTokens: m.fixedOutputTokens };
    },
  };
  return m;
}

function createMockResend(): MockResend {
  const m: MockResend = {
    outbox: [],
    failWith: null,
    async send(email) {
      if (m.failWith) throw new Error(m.failWith);
      const id = `mock_${m.outbox.length + 1}`;
      m.outbox.push({ ...email, id });
      return { id };
    },
  };
  return m;
}

export const mocks = {
  vaani: createMockVaani(),
  calcom: createMockCalcom(),
  gemini: createMockGemini(),
  resend: createMockResend(),
};

/** Restore every mock to its initial state, keeping object identity (getAdapters() returns these objects). */
export function resetMocks(): void {
  Object.assign(mocks.vaani, { fixedCost: 12.5, notListed: new Set(), fromNumbers: new Map(), patches: [] });
  Object.assign(mocks.calcom, { bookings: [] });
  Object.assign(mocks.gemini, { fixedInputTokens: 2000, fixedOutputTokens: 400, responder: DEFAULT_RESPONDER, requests: [] });
  Object.assign(mocks.resend, { outbox: [], failWith: null });
}
