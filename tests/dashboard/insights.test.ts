import { describe, expect, it } from 'vitest';
import { BASELINE_RESPONSE_48H, callerAskedAboutPrice, isTestCall } from '@/lib/dashboard/insights';
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

/** Same story as metrics.test.ts: t01 accepted after 7 min, t13 after 20 with a proposal, price_leak never (escalated). */
async function seedSeptember() {
  setNow('2026-09-10T17:11:30.000Z');
  await processEvent(loadTransferEvent('t09_failed'), { lookupDelayMs: 0 });
  const ordered = [...FIXTURE_NAMES].sort((a, b) => loadFixture(a).timestamp.localeCompare(loadFixture(b).timestamp));
  for (const name of ordered) {
    const p = loadFixture(name);
    setNow(p.timestamp);
    await processEvent(p, { lookupDelayMs: 0 });
    const lead = async () => (await getRepo().getLeadByCallId(p.call_id))!.id;
    if (name === 't01') { advance(7 * MIN); await acceptLead(await lead(), ANANYA.id); }
    if (name === 'price_leak') { advance(30 * MIN); await runTick(); }
    if (name === 't13') { advance(20 * MIN); await acceptLead(await lead(), MEERA.id); await logOutcome(await lead(), 'proposal'); }
  }
  setNow('2026-09-30T12:00:00.000Z');
}

describe('isTestCall', () => {
  it('recognises simulate, stress and Vaani web-test ids, not real inbound calls', () => {
    expect(isTestCall('test-1791000000-t01')).toBe(true);
    expect(isTestCall('stress-1791000000-12')).toBe(true);
    expect(isTestCall('webrtc-1791657136-f9e7fe73')).toBe(true);
    expect(isTestCall('inbound-1788326860-3fa91c01')).toBe(false);
  });
});

describe('callerAskedAboutPrice', () => {
  const t = (user: string, agent = 'Hello.') => `[10:00:00] AGENT: ${agent}\n\n[10:00:05] USER: ${user}`;
  it.each([
    'What might it cost?', 'Roughly how much would something like that cost?', 'What are your rates?',
    'Can you give me a quote?', 'Kitna lagega?', 'इसका खर्च कितना होगा?',
  ])('caller asks: %s', (line) => expect(callerAskedAboutPrice(t(line))).toBe(true));
  it('ignores the agent\'s own lines and a volunteered budget', () => {
    expect(callerAskedAboutPrice(t('Sure.', 'Pricing depends on the site, the materials you choose, and the scope.'))).toBe(false);
    expect(callerAskedAboutPrice(t('My budget is fixed. Is that possible with you?'))).toBe(false);
    expect(callerAskedAboutPrice(null)).toBe(false);
  });
});

describe('founder insights over the fixture set', () => {
  it('has the leak stopped: every new enquiry answered within 48 hours, on the same footing as the baseline', async () => {
    await seedSeptember();
    const { insights } = await loadDashboard(parseRange(SEPT));
    // new = t01, t13 (accepted in minutes), t10 (declined honestly on the call), price_leak (never accepted), t17 (dropped)
    expect(insights.response48h).toEqual({
      within: 3, resolved: 5, pending: 0, share: 3 / 5, baseline: BASELINE_RESPONSE_48H,
      acceptedInTime: 2, declinedOnCall: 1, droppedUnanswered: 1,
    });
  });

  it('counts an unaccepted lead younger than 48 hours as pending, not lost', async () => {
    const p = loadFixture('price_leak');
    setNow(p.timestamp);
    await processEvent(p, { lookupDelayMs: 0 });
    advance(24 * 60 * MIN);
    const { insights } = await loadDashboard(parseRange(SEPT));
    expect(insights.response48h).toMatchObject({ within: 0, resolved: 0, pending: 1, share: null });
  });

  it('the enquiry funnel, with who dropped out at each step', async () => {
    await seedSeptember();
    const { insights } = await loadDashboard(parseRange(SEPT));
    expect(insights.funnel.map((s) => [s.key, s.count, s.lost?.count ?? null])).toEqual([
      ['calls', 7, null],
      ['new', 5, 2], // t09 and t09_failed are existing clients
      ['captured', 4, 1], // t17 dropped
      ['fit', 3, 1], // t10 declined (budget)
      ['handed', 3, 0],
      ['accepted', 2, 1], // price_leak
      ['held', 1, 1], // t01's outcome not logged yet
      ['proposal', 1, 0],
    ]);
    expect(insights.declineReasons).toEqual([{ reason: 'budget', count: 1 }]);
    expect(insights.outcomeLoggedShare).toBe(0.5);
  });

  it('after-hours coverage and the weekday × time-of-day grid (IST)', async () => {
    await seedSeptember();
    const { insights } = await loadDashboard(parseRange(SEPT));
    expect(insights.afterHours).toEqual({ calls: 1, newEnquiries: 0, handedOff: 0, booked: 0 }); // t09_failed, Thu 22:45
    expect(insights.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(7);
    expect(insights.heatmap[2][3]).toBe(1); // t01: Wed 2 Sep, 10:27 IST → Wed, 09–12
    expect(insights.heatmap[3][7]).toBe(1); // t09_failed: Thu 10 Sep, 22:45 IST → Thu, 21–24
  });

  it('price questions: callers who asked about price still booked', async () => {
    await seedSeptember();
    const { insights } = await loadDashboard(parseRange(SEPT));
    // t13 and price_leak asked (booked, callback); t01 booked, t10 declined, t17 dropped did not ask
    expect(insights.priceQuestions).toEqual({
      askers: { asked: 2, converted: 2, share: 1 },
      others: { asked: 3, converted: 1, share: 1 / 3 },
      askersBooked: 1,
      comparable: false, // 2 and 3 callers: too few to draw a comparison
    });
  });

  it('per-designer follow-through, attributing the reminder and escalation to Rohan', async () => {
    await seedSeptember();
    const { insights } = await loadDashboard(parseRange(SEPT));
    const by = Object.fromEntries(insights.designers.map((d) => [d.name, d]));
    expect(by[ANANYA.name]).toMatchObject({ leads: 1, accepted: 1, waiting: 0, medianWorkingMinutesToAccept: 7, reminders: 0, escalations: 0 });
    expect(by[ROHAN.name]).toMatchObject({ leads: 1, accepted: 0, waiting: 1, medianWorkingMinutesToAccept: null, reminders: 1, escalations: 1 });
    expect(by[MEERA.name]).toMatchObject({ leads: 1, accepted: 1, medianWorkingMinutesToAccept: 20, outcomesLogged: 1, proposals: 1 });
  });

  it('hides test calls by default and says how many', async () => {
    const p = loadFixture('t01');
    setNow(p.timestamp);
    await processEvent(p, { lookupDelayMs: 0 });
    await processEvent({ ...p, call_id: 'test-1-t01', data: { ...p.data, call_id: 'test-1-t01' } }, { lookupDelayMs: 0 });
    const hidden = await loadDashboard(parseRange(SEPT));
    expect(hidden.rc1.calls).toBe(1);
    expect(hidden.hiddenTestCalls).toBe(1);
    const shown = await loadDashboard(parseRange(SEPT), { includeTests: true });
    expect(shown.rc1.calls).toBe(2);
    expect(shown.hiddenTestCalls).toBe(0);
  });
});
