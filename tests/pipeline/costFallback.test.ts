import { describe, expect, it } from 'vitest';
import { processEvent } from '@/lib/pipeline/processEvent';
import { runTick } from '@/lib/cron/tick';
import { loadDashboard } from '@/lib/dashboard/load';
import { parseRange } from '@/lib/dashboard/range';
import { estimateVaaniCost } from '@/lib/cost';
import { getRepo } from '@/lib/db';
import { mocks } from '@/lib/adapters/mocks';
import { advance, setNow } from '@/lib/clock';
import { SEED_SETTINGS } from '@/lib/db/seed';
import { loadFixture } from '../helpers';

/**
 * Vaani's call-history API returns 500 on this account (NOTES.md). Fallbacks (decision: "fallback only"):
 *  - cost estimated from call length × settings.vaani_inr_per_minute_estimate, flagged cost_estimated
 *  - caller number from the call_started webhook's phone_number
 */
const callHistoryDown = () => {
  mocks.vaani.findCall = async () => { throw new Error('Vaani call-history 500: Invalid client_id format'); };
  mocks.vaani.findCalls = async () => { throw new Error('Vaani call-history 500: Invalid client_id format'); };
};
const T01 = loadFixture('t01');
const T17 = loadFixture('t17');

describe('estimateVaaniCost', () => {
  it('prices the call length at the per-minute estimate and converts to credits', () => {
    expect(SEED_SETTINGS.vaani_inr_per_minute_estimate).toBe(5.6);
    expect(estimateVaaniCost(60_000, SEED_SETTINGS)).toEqual({ inr: 5.6, credits: 5.6 });
    expect(estimateVaaniCost(90_000, { ...SEED_SETTINGS, credit_to_inr: 2 })).toEqual({ inr: 8.4, credits: 4.2 });
  });
});

describe('when Vaani call-history is unavailable', () => {
  it('stores an estimated cost, flagged, and still processes the call', async () => {
    callHistoryDown();
    setNow(T01.timestamp);
    await processEvent(T01, { lookupDelayMs: 0 });
    const call = (await getRepo().getCall(T01.call_id))!;
    const est = estimateVaaniCost(252318, SEED_SETTINGS);
    expect(call).toMatchObject({ cost_estimated: true, vaani_credits: est.credits, vaani_inr: est.inr, processed_at: expect.any(String) });
    expect(call.total_inr).toBeCloseTo(est.inr + call.gemini_inr, 6);
    expect(await getRepo().listEvents({ callId: T01.call_id, type: 'call_lookup_failed' })).toHaveLength(1);
  });

  it('does not retry a lookup that errors, even for urgent calls (no 20-second wait)', async () => {
    let calls = 0;
    mocks.vaani.findCall = async () => { calls++; throw new Error('500'); };
    setNow(T17.timestamp);
    await processEvent(T17, { lookupDelayMs: 0 });
    expect(calls).toBe(1);
  });

  it("takes the caller's number from the call_started webhook", async () => {
    callHistoryDown();
    setNow('2026-09-22T08:44:18.000Z');
    await processEvent({ event: 'call_started', room_name: T17.call_id, status: 'active', phone_number: '+919812345017' }, { lookupDelayMs: 0 });
    setNow(T17.timestamp);
    await processEvent(T17, { lookupDelayMs: 0 });
    expect((await getRepo().getCall(T17.call_id))?.from_number).toBe('+919812345017');
    const urgent = mocks.resend.outbox.find((m) => m.tag === 'urgent')!;
    expect(urgent.subject).toBe('Call back — call dropped · +919812345017');
    expect(urgent.text).not.toContain('number pending');
  });

  it('a call_started that arrives after processing fills a missing number', async () => {
    callHistoryDown();
    setNow(T01.timestamp);
    await processEvent(T01, { lookupDelayMs: 0 });
    expect((await getRepo().getCall(T01.call_id))?.from_number).toBeNull();
    await processEvent({ event: 'call_started', room_name: T01.call_id, phone_number: '+919812345001' }, { lookupDelayMs: 0 });
    expect((await getRepo().getCall(T01.call_id))?.from_number).toBe('+919812345001');
  });

  it('call-history wins over call_started when both are available', async () => {
    mocks.vaani.fromNumbers.set(T01.call_id, '+919800000101');
    setNow(T01.timestamp);
    await processEvent({ event: 'call_started', room_name: T01.call_id, phone_number: '+919812345001' }, { lookupDelayMs: 0 });
    await processEvent(T01, { lookupDelayMs: 0 });
    expect((await getRepo().getCall(T01.call_id))?.from_number).toBe('+919800000101');
  });

  it('the cron does not log an error every minute — one cost_lookup_failed event per hour', async () => {
    callHistoryDown();
    setNow(T01.timestamp);
    await processEvent(T01, { lookupDelayMs: 0 });
    for (let i = 0; i < 90; i++) {
      advance(60_000);
      const r = await runTick();
      expect(r.errors.filter((e) => e.job === 'costRetry')).toEqual([]);
    }
    expect(await getRepo().listEvents({ type: 'cron_error' })).toHaveLength(0);
    expect(await getRepo().listEvents({ type: 'cost_lookup_failed' })).toHaveLength(2); // t+1 min and t+61 min
  });

  it('replaces the estimate with the real cost once call-history works again', async () => {
    callHistoryDown();
    setNow(T01.timestamp);
    await processEvent(T01, { lookupDelayMs: 0 });
    mocks.vaani.findCalls = async (ids) => new Map(ids.map((id) => [id, {
      call_id: id, call_type: 'Inbound', from_number: '+919800000101', to_number: null, start_time: null,
      call_cost: 9, post_processing_status: 'completed',
    }]));
    advance(60_000);
    expect((await runTick()).costsFilled).toEqual([T01.call_id]);
    expect(await getRepo().getCall(T01.call_id)).toMatchObject({ vaani_credits: 9, vaani_inr: 9, cost_estimated: false, from_number: '+919800000101' });
  });

  it('the dashboard counts estimated costs in totals and says how many are estimates', async () => {
    callHistoryDown();
    setNow(T01.timestamp);
    await processEvent(T01, { lookupDelayMs: 0 });
    const m = await loadDashboard(parseRange({ from: '2026-09-01', to: '2026-09-30' }));
    const est = estimateVaaniCost(252318, SEED_SETTINGS);
    expect(m.cost.estimatedCostCalls).toBe(1);
    expect(m.cost.unknownCostCalls).toBe(0);
    expect(m.cost.vaaniInr).toBeCloseTo(est.inr, 6);
    expect(m.cost.creditsUsedAllTime).toBeCloseTo(est.credits, 6);
  });
});
