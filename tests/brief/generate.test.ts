import { describe, expect, it } from 'vitest';
import { generateBrief } from '@/lib/brief/generate';
import { buildBriefPrompt } from '@/lib/brief/prompt';
import { cannedBrief } from '@/lib/brief/canned';
import { parseBrief, type Brief } from '@/lib/brief/schema';
import { scanText } from '@/lib/priceScan';
import { mocks } from '@/lib/adapters/mocks';
import type { CallRow, LeadRow } from '@/lib/db/types';
import { loadFixture } from '../helpers';
import { VALID_BRIEF } from './validBrief';

function leadFor(over: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'lead-1', call_id: 'call-1', caller_name: 'Priya', enquiry_type: 'new_enquiry', locality: 'Kothrud',
    in_service_area: 'yes', property_type: 'apartment', carpet_area_sqft: 1400, scope: 'Kitchen, living room, both bedrooms',
    completion_deadline: 'By March', timeline_fit: 'yes', decision_maker: 'yes', budget_mentioned: 'none', outcome: 'booked',
    decline_reason: null, callback_preference: null, notes_for_designer: 'Referred by Shruti Joshi.',
    booked_slot_start: '2026-09-07T05:30:00.000Z', booking_confirmed: true, cal_booking_uid: 'b1', designer_id: null,
    brief_json: null, brief_text: null, clock_started_at: null, email_sent_at: null, reminder_sent_at: null, escalated_at: null,
    accepted_at: null, reassign_count: 0, consultation_outcome: null, outcome_requested_at: null, outcome_logged_at: null,
    needs_attention: false, attention_reason: null, created_at: '2026-09-02T04:57:40.000Z', ...over,
  };
}
const callFor = (transcript: string): CallRow => ({
  call_id: 'call-1', received_at: '2026-09-02T04:57:40.000Z', from_number: null, duration_ms: 1, transcript, summary: 's',
  entities: null, dispositions: null, recording_url: null, raw_payload: {}, vaani_credits: null, vaani_inr: null,
  gemini_input_tokens: 0, gemini_output_tokens: 0, gemini_inr: 0, total_inr: null, price_flag: false, price_flag_lines: [],
  processing_started_at: null, processed_at: null, processing_error: null,
});
const T01 = loadFixture('t01').data.transcript;
const json = (b: Brief) => JSON.stringify(b);

describe('buildBriefPrompt', () => {
  it('includes the rubric, the lead fields and the transcript, and forbids prices and invention', () => {
    const { system, prompt } = buildBriefPrompt(leadFor(), callFor(T01));
    expect(system).toMatch(/never include any price, range, rate/i);
    expect(system).toMatch(/never invent/i);
    expect(system).toMatch(/caller_stated_budget/);
    expect(prompt).toContain('Real project — not just advice');
    expect(prompt).toContain('"caller_name": "Priya"');
    expect(prompt).toContain('USER: Hi, I\'m Priya.');
    // The instruction must name "price"/"rate" to forbid them, but it never carries a figure.
    expect(system).not.toMatch(/\d/);
  });
});

describe('generateBrief', () => {
  it('returns a validated brief and the token usage', async () => {
    mocks.gemini.responder = () => json(VALID_BRIEF);
    const r = await generateBrief(leadFor(), callFor(T01));
    expect(r.brief).toMatchObject({ headline: VALID_BRIEF.headline, criteria: VALID_BRIEF.criteria });
    expect(r).toMatchObject({ attempts: 1, inputTokens: 2000, outputTokens: 400, removedLines: [], needsAttention: false });
    expect(r.text).toContain('Priya · Kothrud');
  });

  it('sets booking from the lead, not from the model', async () => {
    mocks.gemini.responder = () => json({ ...VALID_BRIEF, booking: 'Tuesday at 3' });
    expect((await generateBrief(leadFor(), callFor(T01))).brief?.booking).toBe('Consultation booked: Mon 7 Sep, 11:00 am');
    const cb = await generateBrief(leadFor({ outcome: 'callback', booking_confirmed: false, booked_slot_start: null, callback_preference: 'Saturday morning' }), callFor(T01));
    expect(cb.brief?.booking).toBe('Call back: Saturday morning');
  });

  it('regenerates once when the brief contains a price, and keeps the clean second brief', async () => {
    mocks.gemini.responder = (_req, attempt) => json(attempt === 1
      ? { ...VALID_BRIEF, what_they_want: 'A full redesign; similar flats run around 20 lakh.' }
      : VALID_BRIEF);
    const r = await generateBrief(leadFor(), callFor(T01));
    expect(r).toMatchObject({ attempts: 2, needsAttention: false, removedLines: [], inputTokens: 4000, outputTokens: 800 });
    expect(scanText(r.text).flag).toBe(false);
  });

  it('if the second brief still has a price, sends it without the offending lines and needs attention', async () => {
    mocks.gemini.responder = () => json({
      ...VALID_BRIEF,
      what_they_want: 'Similar flats cost around 2,000 per sq ft.',
      uncertainties: ['Budget unclear.', 'Our rates start at a fixed figure.'],
    });
    const r = await generateBrief(leadFor(), callFor(T01));
    expect(r.attempts).toBe(2);
    expect(r.needsAttention).toBe(true);
    expect(r.removedLines).toEqual(['Similar flats cost around 2,000 per sq ft.', 'Our rates start at a fixed figure.']);
    expect(r.brief?.uncertainties).toEqual(['Budget unclear.']);
    expect(scanText(r.text).flag).toBe(false);
  });

  it('retries once on invalid JSON', async () => {
    mocks.gemini.responder = (_req, attempt) => (attempt === 1 ? '{"headline": "oops"' : json(VALID_BRIEF));
    const r = await generateBrief(leadFor(), callFor(T01));
    expect(r.attempts).toBe(2);
    expect(r.brief).not.toBeNull();
  });

  it('gives up gracefully (no brief, failure recorded) when Gemini fails', async () => {
    mocks.gemini.generateJson = async () => { throw new Error('Gemini 503'); };
    const r = await generateBrief(leadFor(), callFor(T01));
    expect(r.brief).toBeNull();
    expect(r.text).toBeNull();
    expect(r.failure).toContain('Gemini 503');
  });

  describe("caller's own budget (decision D1)", () => {
    const transcript = `${T01}\n\n[10:25:30] USER: Our budget is 18 to 22 lakh for the whole flat.`;

    it('keeps a budget the caller actually stated, and does not flag it', async () => {
      mocks.gemini.responder = () => json({ ...VALID_BRIEF, caller_stated_budget: '18 to 22 lakh for the whole flat' });
      const r = await generateBrief(leadFor({ budget_mentioned: 'not_a_concern' }), callFor(transcript));
      expect(r.brief?.caller_stated_budget).toBe('18 to 22 lakh for the whole flat');
      expect(r).toMatchObject({ attempts: 1, needsAttention: false });
      expect(r.text).toContain('Caller-stated budget (their words): 18 to 22 lakh for the whole flat');
    });

    it('drops a "caller budget" whose figures the caller never said', async () => {
      mocks.gemini.responder = () => json({ ...VALID_BRIEF, caller_stated_budget: 'about 25 lakh' });
      const r = await generateBrief(leadFor(), callFor(transcript));
      expect(r.brief?.caller_stated_budget).toBeNull();
    });

    it('drops a figure that only the agent said', async () => {
      const leaky = `${T01}\n\n[10:25:30] AGENT: Projects like this are 18 lakh.`;
      mocks.gemini.responder = () => json({ ...VALID_BRIEF, caller_stated_budget: '18 lakh' });
      const r = await generateBrief(leadFor(), callFor(leaky));
      expect(r.brief?.caller_stated_budget).toBeNull();
    });
  });
});

describe('cannedBrief (mock Gemini default)', () => {
  it('builds a valid, price-free brief from the prompt for any fixture lead', () => {
    const { system, prompt } = buildBriefPrompt(leadFor(), callFor(T01));
    const parsed = parseBrief(cannedBrief({ system, prompt, jsonSchema: {} }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.brief.headline).toBe('Priya · Kothrud · apartment · Kitchen, living room, both bedrooms');
      expect(scanText(JSON.stringify(parsed.brief)).flag).toBe(false);
    }
  });
});
