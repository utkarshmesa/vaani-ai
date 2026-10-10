import { describe, expect, it } from 'vitest';
import { processEvent } from '@/lib/pipeline/processEvent';
import { getRepo } from '@/lib/db';
import { mocks } from '@/lib/adapters/mocks';
import { setNow } from '@/lib/clock';
import { scanText } from '@/lib/priceScan';
import { loadFixture, type FixtureName } from '../helpers';
import { VALID_BRIEF } from '../brief/validBrief';

async function run(name: FixtureName) {
  const p = loadFixture(name);
  setNow(p.timestamp);
  await processEvent(p, { lookupDelayMs: 0 });
  return { call: (await getRepo().getCall(p.call_id))!, lead: (await getRepo().getLeadByCallId(p.call_id))! };
}

describe('brief in the pipeline (SPEC §7.3d, §11)', () => {
  it('booked and callback leads get a brief, stored and emailed, with Gemini cost on the call', async () => {
    for (const name of ['t01', 't13', 'price_leak'] as const) {
      const { call, lead } = await run(name);
      expect(lead.brief_json, name).not.toBeNull();
      expect(lead.brief_text, name).toContain(lead.caller_name!);
      expect(scanText(lead.brief_text).flag, name).toBe(false);
      expect(call).toMatchObject({ gemini_input_tokens: 2000, gemini_output_tokens: 400 });
      // 2,000 × 25/1e6 + 400 × 210/1e6 with the placeholder rates
      expect(call.gemini_inr).toBeCloseTo(0.134, 6);
      expect(call.total_inr).toBeCloseTo(12.5 + 0.134, 6);
    }
    const designerMails = mocks.resend.outbox.filter((m) => m.tag === 'designer_brief');
    expect(designerMails).toHaveLength(3);
    for (const m of designerMails) expect(m.text).toContain('Suggested opening:');
  });

  it('declined, transferred and incomplete calls get no brief and no Gemini cost', async () => {
    for (const name of ['t10', 't09', 't09_failed', 't17'] as const) {
      const { call, lead } = await run(name);
      expect(lead.brief_json, name).toBeNull();
      expect(call.gemini_input_tokens, name).toBe(0);
    }
    expect(mocks.gemini.requests).toHaveLength(0);
  });

  it('the Gemini prompt for price_leak never carries the leaked figure into the brief', async () => {
    const { lead } = await run('price_leak');
    expect(lead.brief_text).not.toMatch(/999|per sq/);
  });

  it('a brief that still has a price after one regeneration is sent without those lines and flags the lead', async () => {
    mocks.gemini.responder = () => JSON.stringify({ ...VALID_BRIEF, what_they_want: 'Expect roughly 15 lakh.' });
    const { lead, call } = await run('t01');
    expect(lead).toMatchObject({ needs_attention: true, attention_reason: 'Brief had a possible price — lines removed' });
    expect(lead.brief_text).not.toContain('15 lakh');
    expect(call.gemini_input_tokens).toBe(4000);
    expect(mocks.resend.outbox[0].text).not.toContain('15 lakh');
  });

  it('a Gemini outage still sends the designer email (lead details only)', async () => {
    mocks.gemini.generateJson = async () => { throw new Error('Gemini down'); };
    const { lead } = await run('t01');
    expect(lead.brief_json).toBeNull();
    expect(lead.email_sent_at).not.toBeNull();
    expect(mocks.resend.outbox[0].text).toContain('Brief not available');
    expect((await getRepo().listEvents({ leadId: lead.id, type: 'brief_failed' }))).toHaveLength(1);
  });

  it('keeps an existing attention reason when the brief also needs attention', async () => {
    mocks.calcom.bookings = [];
    mocks.gemini.responder = () => JSON.stringify({ ...VALID_BRIEF, booking: 'x', what_they_want: 'Rates start at 5 lakh.' });
    const { lead } = await run('t01');
    expect(lead.attention_reason).toBe('Booking not found — rebook; Brief had a possible price — lines removed');
  });
});
