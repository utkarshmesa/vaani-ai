import { describe, expect, it } from 'vitest';
import { loadDashboard } from '@/lib/dashboard/load';
import { parseRange } from '@/lib/dashboard/range';
import { processEvent } from '@/lib/pipeline/processEvent';
import { acceptLead, logOutcome } from '@/lib/leads/actions';
import { runTick } from '@/lib/cron/tick';
import { getRepo } from '@/lib/db';
import { advance, setNow } from '@/lib/clock';
import { SEED_DESIGNERS } from '@/lib/db/seed';
import { FIXTURE_NAMES, loadFixture, loadTransferEvent } from '../helpers';

const [ANANYA, ROHAN, MEERA] = SEED_DESIGNERS;
const MIN = 60_000;
const SEPT = { from: '2026-09-01', to: '2026-09-30' };

/**
 * All seven fixtures at their own timestamps (rotation by time: t01 → Ananya, price_leak → Rohan, t13 → Meera),
 * then t01 accepted after 7 min, t13 after 20 (and a proposal logged), price_leak never.
 */
async function seedSeptember() {
  setNow('2026-09-10T17:11:30.000Z');
  await processEvent(loadTransferEvent('t09_failed'), { lookupDelayMs: 0 });
  const ordered = [...FIXTURE_NAMES].sort((a, b) => loadFixture(a).timestamp.localeCompare(loadFixture(b).timestamp));
  for (const name of ordered) {
    const p = loadFixture(name);
    setNow(p.timestamp);
    await processEvent(p, { lookupDelayMs: 0 });
    if (name === 't01') {
      advance(7 * MIN);
      await acceptLead((await getRepo().getLeadByCallId(p.call_id))!.id, ANANYA.id);
    }
    if (name === 'price_leak') {
      advance(30 * MIN); // reminder + escalation for Rohan
      await runTick();
    }
    if (name === 't13') {
      advance(20 * MIN);
      await acceptLead((await getRepo().getLeadByCallId(p.call_id))!.id, MEERA.id);
      await logOutcome((await getRepo().getLeadByCallId(p.call_id))!.id, 'proposal');
    }
  }
  setNow('2026-09-30T12:00:00.000Z');
}

const totalDurationMin = FIXTURE_NAMES.reduce((s, n) => s + Math.round(loadFixture(n).data.call_duration), 0) / 60_000;

describe('dashboard metrics over the fixture set (SPEC §14, §18)', () => {
  it('RC1: calls answered and after-hours share', async () => {
    await seedSeptember();
    const m = await loadDashboard(parseRange(SEPT));
    expect(m.rc1).toEqual({ calls: 7, afterHours: 1, afterHoursShare: 1 / 7 });
  });

  it('RC2: complete lead records and the outcome breakdown', async () => {
    await seedSeptember();
    const m = await loadDashboard(parseRange(SEPT));
    // t10 has no deadline and t17 dropped; the rest are complete.
    expect(m.rc2.complete).toBe(5);
    expect(m.rc2.completeShare).toBeCloseTo(5 / 7, 10);
    expect(m.rc2.outcomes).toEqual({
      booked: 2, callback: 1, declined: 1, existing_client_transferred: 1, transfer_failed: 1, incomplete: 1, other: 0,
    });
    expect(m.rc2.declineReasons).toEqual([{ reason: 'budget', count: 1 }]);
  });

  it('RC3: acceptance speed, escalations and outcomes', async () => {
    await seedSeptember();
    const m = await loadDashboard(parseRange(SEPT));
    expect(m.rc3).toMatchObject({
      handedOff: 3,
      accepted: 2,
      medianWorkingMinutesToAccept: 13.5, // 7 and 20
      medianMinutesToAccept: 13.5,
      acceptedWithin30: 2,
      eligibleForWithin30: 3, // price_leak's 30 minutes have passed without an Accept
      escalations: 1,
      reassignments: 0,
      outcomeRequests: 0,
      outcomesLogged: 1,
    });
    expect(m.rc3.acceptedWithin30Share).toBeCloseTo(2 / 3, 10);
    expect(m.rc3.consultationOutcomes).toEqual({ site_visit: 0, proposal: 1, not_fit: 0, no_show: 0 });
  });

  it('CUT: only price_leak is flagged, with its line', async () => {
    await seedSeptember();
    const m = await loadDashboard(parseRange(SEPT));
    expect(m.cut.flagged).toHaveLength(1);
    expect(m.cut.flagged[0]).toMatchObject({
      callId: loadFixture('price_leak').call_id,
      callerName: 'Sanjay',
      lines: ['For a 2BHK like yours, it usually costs around 999 rupees per sq ft, depending on materials.'],
    });
  });

  it('cost: totals, unit costs and credits remaining', async () => {
    await seedSeptember();
    const m = await loadDashboard(parseRange(SEPT));
    const vaani = 7 * 12.5; // mock: 12.5 credits per call, 1 ₹ per credit (placeholder rate)
    const gemini = 3 * 0.134; // three briefs: t01, t13, price_leak
    const total = vaani + gemini;
    expect(m.cost.vaaniInr).toBeCloseTo(vaani, 6);
    expect(m.cost.geminiInr).toBeCloseTo(gemini, 6);
    expect(m.cost.totalInr).toBeCloseTo(total, 6);
    expect(m.cost.perCall).toBeCloseTo(total / 7, 6);
    expect(m.cost.totalMinutes).toBeCloseTo(totalDurationMin, 6);
    expect(m.cost.perMinute).toBeCloseTo(total / totalDurationMin, 6);
    expect(m.cost.bookedConsultations).toBe(2);
    expect(m.cost.perBooked).toBeCloseTo(total / 2, 6);
    expect(m.cost.proposals).toBe(1);
    expect(m.cost.perProposal).toBeCloseTo(total, 6);
    expect(m.cost.unknownCostCalls).toBe(0);
    expect(m.cost.creditsUsedAllTime).toBe(vaani);
    expect(m.cost.creditsRemaining).toBe(1000 - vaani);
    // The clock is pinned to 30 Sep 17:30 IST, so September is the current month: scale by month length / elapsed.
    const monthMs = 30 * 86_400_000;
    const elapsedMs = Date.parse('2026-09-30T12:00:00.000Z') - Date.parse('2026-08-31T18:30:00.000Z');
    expect(m.cost.projectedMonthEnd).toBeCloseTo(total * (monthMs / elapsedMs), 6);
    expect((await loadDashboard(parseRange({ from: '2026-09-01', to: '2026-09-15' }))).cost.projectedMonthEnd).toBeNull();
  });

  it('needs attention: urgent, incomplete, price flag and unaccepted', async () => {
    await seedSeptember();
    const m = await loadDashboard(parseRange(SEPT));
    const byCall = Object.fromEntries(m.attention.map((a) => [a.callId, a.reasons]));
    expect(Object.keys(byCall).sort()).toEqual([
      loadFixture('price_leak').call_id, loadFixture('t09_failed').call_id, loadFixture('t17').call_id,
    ].sort());
    expect(byCall[loadFixture('t09_failed').call_id]).toEqual(['Transfer failed — call back urgently']);
    expect(byCall[loadFixture('t17').call_id]).toEqual(['Call dropped — call back']);
    expect(byCall[loadFixture('price_leak').call_id]).toEqual([
      'Price flag: the agent may have quoted a price',
      `Not accepted after 30 working minutes (${ROHAN.name})`,
    ]);
    expect(m.attention.every((a) => a.number)).toBe(true);
  });

  it('lists every call in the range, newest first, with designer and status', async () => {
    await seedSeptember();
    const m = await loadDashboard(parseRange(SEPT));
    expect(m.calls).toHaveLength(7);
    expect(m.calls[0].callId).toBe(loadFixture('t17').call_id); // 22 Sep
    const t01 = m.calls.find((c) => c.callId === loadFixture('t01').call_id)!;
    expect(t01).toMatchObject({ callerName: 'Priya', outcome: 'booked', designer: ANANYA.name, accepted: true, priceFlag: false });
  });

  it('respects the date range', async () => {
    await seedSeptember();
    const firstWeek = await loadDashboard(parseRange({ from: '2026-09-01', to: '2026-09-07' }));
    expect(firstWeek.rc1.calls).toBe(2); // price_leak (3 Sep) and t01 (2 Sep)
    const october = await loadDashboard(parseRange({ from: '2026-10-01', to: '2026-10-31' }));
    expect(october.rc1.calls).toBe(0);
    expect(october.cost.perCall).toBeNull();
    expect(october.rc3.medianWorkingMinutesToAccept).toBeNull();
    expect(october.cost.creditsRemaining).toBe(1000 - 87.5); // credits are all-time
  });

  it('shows calls whose processing failed', async () => {
    const p = loadFixture('t01');
    setNow(p.timestamp);
    const { mocks } = await import('@/lib/adapters/mocks');
    mocks.resend.failWith = 'down';
    await processEvent(p, { lookupDelayMs: 0 });
    const m = await loadDashboard(parseRange(SEPT));
    expect(m.attention.find((a) => a.callId === p.call_id)?.reasons).toContain('Processing error — check the raw payload');
  });
});

describe('projected month-end', () => {
  it('extrapolates the current month from the share of the month elapsed', async () => {
    const p = loadFixture('t01');
    setNow('2026-10-02T04:57:40.000Z');
    await processEvent({ ...p, timestamp: '2026-10-02T04:57:40.000Z' }, { lookupDelayMs: 0 });
    setNow('2026-10-16T18:30:00.000Z'); // 17 Oct 00:00 IST: 16 of 31 days elapsed
    const m = await loadDashboard(parseRange({}));
    expect(m.range.isCurrentMonth).toBe(true);
    expect(m.cost.projectedMonthEnd).toBeCloseTo(m.cost.totalInr * (31 / 16), 6);
  });
});
