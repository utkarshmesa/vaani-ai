import { describe, expect, it } from 'vitest';
import { loadFixture, loadTransferEvent, type FixtureName } from '../helpers';
import { processEvent as processAny } from '@/lib/pipeline/processEvent';
import type { CallResult, ProcessOptions } from '@/lib/pipeline/processCall';
import { ATTENTION } from '@/lib/pipeline/attention';
import { getRepo } from '@/lib/db';
import { mocks } from '@/lib/adapters/mocks';
import { setNow } from '@/lib/clock';
import { SEED_DESIGNERS } from '@/lib/db/seed';
import { verifyLink } from '@/lib/links';

const FAST = { lookupDelayMs: 0 };
/** processEvent narrowed to call results, for postprocessing payloads. */
const processEvent = async (body: unknown, opts?: ProcessOptions) => (await processAny(body, opts)) as CallResult;
const FRONT_DESK = 'frontdesk@aangan-studio.test';
const [ANANYA, ROHAN] = SEED_DESIGNERS;

/** Pin the clock at the fixture's postprocessing time and process it. */
async function run(name: FixtureName, mutate?: (p: ReturnType<typeof loadFixture>) => void) {
  const p = loadFixture(name);
  mutate?.(p);
  setNow(p.timestamp);
  const result = await processEvent(p, FAST);
  const repo = getRepo();
  return {
    result,
    payload: p,
    call: (await repo.getCall(p.call_id))!,
    lead: (await repo.getLeadByCallId(p.call_id))!,
  };
}

const outbox = () => mocks.resend.outbox;

describe('call_postprocessing — booked (t01)', () => {
  it('stores the call, confirms the booking, assigns a designer, emails them and starts the clock', async () => {
    mocks.vaani.fromNumbers.set('inbound-1788326860-3fa91c01', '+919800000101');
    const { result, call, lead } = await run('t01');

    expect(result).toMatchObject({ kind: 'call', status: 'processed', outcome: 'booked' });
    expect(call).toMatchObject({
      received_at: '2026-09-02T04:57:40.000Z',
      from_number: '+919800000101',
      duration_ms: 252318,
      summary: expect.stringContaining('Priya'),
      vaani_credits: 12.5,
      vaani_inr: 12.5,
      total_inr: 12.634, // Vaani 12.5 + Gemini brief 0.134 (placeholder rates)
      gemini_input_tokens: 2000,
      gemini_output_tokens: 400,
      price_flag: false,
      price_flag_lines: [],
      processed_at: '2026-09-02T04:57:40.000Z',
      processing_error: null,
    });
    expect(call.raw_payload).toMatchObject({ event: 'call_postprocessing', call_id: call.call_id });
    expect(call.transcript).toContain('AGENT:');

    expect(lead).toMatchObject({
      outcome: 'booked',
      caller_name: 'Priya',
      locality: 'Kothrud, Dahanukar Colony',
      carpet_area_sqft: 1400,
      booked_slot_start: '2026-09-07T05:30:00.000Z',
      booking_confirmed: true,
      cal_booking_uid: 'mock-cal-t01',
      designer_id: ANANYA.id,
      email_sent_at: '2026-09-02T04:57:40.000Z',
      clock_started_at: '2026-09-02T04:57:40.000Z', // Wed 10:27 IST — inside working hours
      needs_attention: false,
    });

    expect(outbox()).toHaveLength(1);
    const mail = outbox()[0];
    expect(mail).toMatchObject({ tag: 'designer_brief', to: ANANYA.email, leadId: lead.id });
    expect(mail.subject).toBe('New lead · Kothrud, Dahanukar Colony · apartment · Mon 7 Sep, 11:00 am');

    const href = mail.html.match(/href="([^"]+\/accept[^"]*)"/)![1].replace(/&amp;/g, '&');
    const u = new URL(href);
    expect(u.pathname).toBe(`/api/leads/${lead.id}/accept`);
    expect(u.searchParams.get('value')).toBe(ANANYA.id); // bound to the assigned designer
    expect(verifyLink({ leadId: lead.id, action: 'accept', value: ANANYA.id, exp: Number(u.searchParams.get('exp')), sig: u.searchParams.get('sig')! },
      process.env.LINK_SIGNING_SECRET!, new Date('2026-09-02T05:00:00Z'))).toEqual({ ok: true });

    expect((await getRepo().getDesigner(ANANYA.id))?.last_assigned_at).toBe('2026-09-02T04:57:40.000Z');
    const types = (await getRepo().listEvents({ leadId: lead.id })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['booking_confirmed', 'designer_assigned', 'email_sent']));
  });

  it('a lead emailed outside working hours starts its clock at 10:00 the next working day', async () => {
    const { lead } = await run('t01', (p) => { p.timestamp = '2026-09-02T17:30:00.000Z'; }); // Wed 23:00 IST
    expect(lead.email_sent_at).toBe('2026-09-02T17:30:00.000Z');
    expect(lead.clock_started_at).toBe('2026-09-03T04:30:00.000Z'); // Thu 10:00 IST
  });

  it('rotates designers across leads', async () => {
    await run('t01');
    const { lead } = await run('t13');
    expect(lead.designer_id).toBe(ROHAN.id);
    expect(outbox().map((m) => m.to)).toEqual([ANANYA.email, ROHAN.email]);
  });
});

describe('idempotency by call_id', () => {
  it('posting t01 twice stores one lead and sends one designer email', async () => {
    const first = await run('t01');
    const second = await processEvent(loadFixture('t01'), FAST);
    expect(first.result.status).toBe('processed');
    expect(second).toMatchObject({ kind: 'call', status: 'duplicate' });
    expect(await getRepo().listLeads()).toHaveLength(1);
    expect(outbox()).toHaveLength(1);
  });

  it('two concurrent deliveries still send one email', async () => {
    const p = loadFixture('t01');
    setNow(p.timestamp);
    const results = await Promise.all([processEvent(p, FAST), processEvent(loadFixture('t01'), FAST)]);
    expect(results.map((r) => r.status).sort()).toEqual(['duplicate', 'processed']);
    expect(outbox()).toHaveLength(1);
  });
});

describe('booked but not in Cal.com', () => {
  it('is treated as a callback that needs attention, and the designer is still emailed', async () => {
    mocks.calcom.bookings = [];
    const { lead, result } = await run('t01');
    expect(result.outcome).toBe('callback');
    expect(lead).toMatchObject({
      outcome: 'callback', booking_confirmed: false, cal_booking_uid: null,
      needs_attention: true, attention_reason: ATTENTION.bookingNotFound,
    });
    expect(ATTENTION.bookingNotFound).toBe('Booking not found — rebook');
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0].subject).toBe('New lead · Kothrud, Dahanukar Colony · apartment · call back');
  });

  it('a booking that is only cancelled in Cal.com does not count', async () => {
    mocks.calcom.bookings = mocks.calcom.bookings.map((b) => ({ ...b, status: 'cancelled' }));
    const { lead } = await run('t01');
    expect(lead.attention_reason).toBe(ATTENTION.bookingNotFound);
  });

  it('a booked outcome with no slot is treated the same way', async () => {
    const { lead } = await run('t01', (p) => { p.data.entities.booked_slot_iso = null; });
    expect(lead).toMatchObject({ outcome: 'callback', needs_attention: true, attention_reason: ATTENTION.bookingNotFound });
  });

  it('if Cal.com errors, the lead still goes to a designer, flagged to verify', async () => {
    mocks.calcom.listBookings = async () => { throw new Error('Cal.com 503'); };
    const { lead } = await run('t01');
    expect(lead).toMatchObject({ outcome: 'callback', needs_attention: true, attention_reason: ATTENTION.bookingCheckFailed });
    expect(outbox()).toHaveLength(1);
  });
});

describe('callback (price_leak) and the price scanner', () => {
  it('flags the agent line, still hands the callback to a designer', async () => {
    const { call, lead } = await run('price_leak');
    expect(call.price_flag).toBe(true);
    expect(call.price_flag_lines).toEqual(['For a 2BHK like yours, it usually costs around 999 rupees per sq ft, depending on materials.']);
    expect(lead).toMatchObject({ outcome: 'callback', callback_preference: 'Saturday morning', designer_id: ANANYA.id });
    expect(outbox()[0].subject).toBe('New lead · Wakad · apartment · call back');
  });

  it('other fixtures are not flagged', async () => {
    for (const name of ['t01', 't13', 't10', 't09', 't17'] as const) {
      expect((await run(name)).call.price_flag, name).toBe(false);
    }
  });
});

describe('declined (t10)', () => {
  it('records the lead with no designer and no email', async () => {
    const { lead } = await run('t10');
    expect(lead).toMatchObject({
      outcome: 'declined', decline_reason: 'budget', budget_mentioned: 'clearly_too_low',
      designer_id: null, email_sent_at: null, needs_attention: false,
    });
    expect(outbox()).toHaveLength(0);
  });
});

describe('existing clients (t09)', () => {
  it('transferred inside working hours is recorded only', async () => {
    const { lead } = await run('t09'); // Thu 11:38 IST
    expect(lead).toMatchObject({ outcome: 'existing_client_transferred', designer_id: null, needs_attention: false });
    expect(outbox()).toHaveLength(0);
  });

  it('transferred outside working hours sends an urgent front-desk email', async () => {
    mocks.vaani.fromNumbers.set('inbound-1788832090-9d51e209', '+919800000909');
    const { lead } = await run('t09', (p) => { p.timestamp = '2026-09-10T16:30:00.000Z'; }); // 22:00 IST
    expect(lead).toMatchObject({ needs_attention: true, attention_reason: ATTENTION.existingClientAfterHours });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ tag: 'urgent', to: FRONT_DESK });
    expect(outbox()[0].text).toContain('+919800000909');
  });
});

describe('transfer failed (t09_failed)', () => {
  it('sends an urgent front-desk email with the summary and caller number', async () => {
    mocks.vaani.fromNumbers.set('inbound-1788860100-e7a2f909', '+919800000910');
    setNow('2026-09-10T17:11:30.000Z');
    await processEvent(loadTransferEvent('t09_failed'), FAST);
    const { lead, payload } = await run('t09_failed');

    expect(lead).toMatchObject({ outcome: 'transfer_failed', needs_attention: true, attention_reason: ATTENTION.transferFailed });
    expect(outbox()).toHaveLength(1);
    const mail = outbox()[0];
    expect(mail).toMatchObject({ tag: 'urgent', to: FRONT_DESK, leadId: lead.id });
    expect(mail.subject).toMatch(/^URGENT · Transfer failed · Sheetal Deshpande/);
    expect(mail.text).toContain('+919800000910');
    expect(mail.text).toContain(payload.data.summary);
    expect(mail.text).toContain('Tomorrow morning before 11 am');
    expect(await getRepo().listEvents({ callId: payload.call_id, type: 'transfer_failed' })).toHaveLength(1);
  });

  it('a transfer failure reported before post-processing overrides an "existing_client_transferred" outcome', async () => {
    const t = { ...loadTransferEvent('t09_failed'), room_name: 'inbound-1788832090-9d51e209' };
    setNow('2026-09-10T06:07:00.000Z');
    await processEvent(t, FAST);
    const { lead } = await run('t09');
    expect(lead).toMatchObject({ outcome: 'transfer_failed', attention_reason: ATTENTION.transferFailed });
    expect(outbox()).toHaveLength(1);
  });

  it('a transfer failure reported after post-processing upgrades the lead and sends one urgent email', async () => {
    await run('t09');
    const t = { ...loadTransferEvent('t09_failed'), room_name: 'inbound-1788832090-9d51e209' };
    await processEvent(t, FAST);
    await processEvent(t, FAST); // re-delivery
    const lead = (await getRepo().getLeadByCallId('inbound-1788832090-9d51e209'))!;
    expect(lead).toMatchObject({ outcome: 'transfer_failed', needs_attention: true });
    expect(outbox().filter((m) => m.tag === 'urgent')).toHaveLength(1);
  });

  it('a later successful transfer cancels an earlier failure', async () => {
    const room = 'inbound-1788832090-9d51e209';
    setNow('2026-09-10T06:06:00.000Z');
    await processEvent({ ...loadTransferEvent('t09_failed'), room_name: room }, FAST);
    setNow('2026-09-10T06:07:00.000Z');
    await processEvent({ event: 'human_transfer_successful', room_name: room, transfer_type: 'warm', phone_number: '+919800000999' }, FAST);
    const { lead } = await run('t09');
    expect(lead.outcome).toBe('existing_client_transferred');
    expect(outbox()).toHaveLength(0);
  });
});

describe('incomplete (t17)', () => {
  it('sends a "call back — call dropped" email to the front desk and needs attention', async () => {
    mocks.vaani.fromNumbers.set('inbound-1789665330-2b6c0f17', '+919800000117');
    const { lead } = await run('t17');
    expect(lead).toMatchObject({ outcome: 'incomplete', designer_id: null, needs_attention: true, attention_reason: ATTENTION.callDropped });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ tag: 'urgent', to: FRONT_DESK });
    expect(outbox()[0].subject).toMatch(/^Call back — call dropped · \+919800000117/);
  });

  it('missing essentials from Vaani also count as incomplete', async () => {
    const { lead } = await run('t01', (p) => { p.data.entities = {}; });
    expect(lead.outcome).toBe('incomplete');
    expect(outbox()[0].tag).toBe('urgent');
  });
});

describe('cost and caller number lookups', () => {
  it('leaves cost null when the call is not in call-history yet (cron retries later)', async () => {
    mocks.vaani.notListed.add('inbound-1788326860-3fa91c01');
    const { call } = await run('t01');
    expect(call).toMatchObject({ vaani_credits: null, vaani_inr: null, total_inr: null, from_number: null, processed_at: expect.any(String) });
  });

  it('retries the lookup for urgent calls, then sends with "number pending"', async () => {
    mocks.vaani.notListed.add('inbound-1789665330-2b6c0f17');
    let calls = 0;
    const original = mocks.vaani.findCall;
    mocks.vaani.findCall = async (id, o) => { calls++; return original(id, o); };
    await run('t17');
    expect(calls).toBe(4);
    expect(outbox()[0].text).toContain('number pending');
  });

  it('a lookup error does not fail processing', async () => {
    mocks.vaani.findCall = async () => { throw new Error('Vaani 500'); };
    const { call, lead } = await run('t01');
    expect(call.processed_at).not.toBeNull();
    expect(call.vaani_credits).toBeNull();
    expect(lead.email_sent_at).not.toBeNull();
  });
});

describe('errors never lose the call', () => {
  it('stores processing_error and the raw payload; a re-delivery finishes the job without duplicates', async () => {
    mocks.resend.failWith = 'Resend is down';
    const first = await run('t01');
    expect(first.result.status).toBe('error');
    expect(first.call).toMatchObject({ processed_at: null, processing_error: expect.stringContaining('Resend is down') });
    expect(first.call.raw_payload).toMatchObject({ call_id: first.payload.call_id });
    expect((await getRepo().listEvents({ callId: first.payload.call_id, type: 'processing_error' }))).toHaveLength(1);

    mocks.resend.failWith = null;
    const second = await processEvent(loadFixture('t01'), FAST);
    expect(second.status).toBe('processed');
    const call = (await getRepo().getCall(first.payload.call_id))!;
    expect(call).toMatchObject({ processing_error: null, processed_at: expect.any(String) });
    expect(await getRepo().listLeads()).toHaveLength(1);
    expect(outbox()).toHaveLength(1);
    // The same designer keeps the lead on retry.
    expect((await getRepo().getLeadByCallId(first.payload.call_id))?.designer_id).toBe(ANANYA.id);
  });
});

describe('other events and shapes', () => {
  it('ignores lifecycle events', async () => {
    expect(await processAny({ event: 'call_started', room_name: 'r1', status: 'dialing' }, FAST)).toEqual({ kind: 'ignored', event: 'call_started' });
  });

  it('rejects a postprocessing payload with no call id', async () => {
    expect(await processAny({ event: 'call_postprocessing', data: {} }, FAST)).toMatchObject({ kind: 'invalid' });
    expect(await processAny('nonsense', FAST)).toMatchObject({ kind: 'invalid' });
  });

  it('accepts the flat shape described in SPEC §5 (fields at top level)', async () => {
    const p = loadFixture('t10');
    const flat = { ...p.data, event: p.event, call_id: p.call_id, timestamp: p.timestamp };
    setNow(p.timestamp);
    const r = await processEvent(flat, FAST);
    expect(r).toMatchObject({ status: 'processed', outcome: 'declined' });
  });
});

describe('no active designer', () => {
  it('flags the lead for attention instead of failing', async () => {
    for (const d of SEED_DESIGNERS) await getRepo().updateDesigner(d.id, { active: false });
    const { lead, call } = await run('t01');
    expect(lead).toMatchObject({ designer_id: null, needs_attention: true, attention_reason: ATTENTION.noDesigner });
    expect(call.processed_at).not.toBeNull();
    expect(outbox()).toHaveLength(0);
  });
});
