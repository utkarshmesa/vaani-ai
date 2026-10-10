/**
 * SPEC §18 — end-to-end verification with MOCK_EXTERNAL=1, driven through the real webhook route, cron route
 * and click endpoints (only next/server's after() is captured so deferred work can be awaited).
 * Plus stress cases: concurrent duplicate deliveries, out-of-order events and malformed payloads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_NAMES, loadFixture, loadTransferEvent, type FixtureName } from './helpers';
import { getRepo } from '@/lib/db';
import { mocks } from '@/lib/adapters/mocks';
import { advance, now, setNow } from '@/lib/clock';
import { SEED_DESIGNERS } from '@/lib/db/seed';
import { loadDashboard } from '@/lib/dashboard/load';
import { parseRange } from '@/lib/dashboard/range';
import { agentLines } from '@/lib/transcript';
import { scanText } from '@/lib/priceScan';

const scheduled = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => unknown) => { scheduled.push(task); },
}));

const { POST: webhook } = await import('@/app/api/webhooks/vaani/route');
const { POST: tick } = await import('@/app/api/cron/tick/route');
const { GET: acceptGET } = await import('@/app/api/leads/[id]/accept/route');
const { GET: reassignGET } = await import('@/app/api/leads/[id]/reassign/route');

const [ANANYA, ROHAN] = SEED_DESIGNERS;
const FRONT_DESK = 'frontdesk@aangan-studio.test';
const MIN = 60_000;
const ist = (s: string) => new Date(`${s}:00+05:30`).toISOString();

const drain = async () => { while (scheduled.length) await scheduled.shift()!(); };
async function deliver(body: unknown) {
  const res = await webhook(new Request(`http://localhost:3000/api/webhooks/vaani?token=${process.env.VAANI_WEBHOOK_SECRET}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }));
  return res.status;
}
async function runTick() {
  const res = await tick(new Request('http://localhost:3000/api/cron/tick', { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  return res.json();
}
async function click(url: string, handler: typeof acceptGET) {
  const id = new URL(url).pathname.split('/')[3];
  return handler(new Request(url), { params: Promise.resolve({ id }) });
}
/** Post a fixture at its own timestamp (as Vaani would), transfer event first for t09_failed. */
async function simulate(name: FixtureName) {
  const p = loadFixture(name);
  setNow(p.timestamp);
  if (name === 't09_failed') expect(await deliver(loadTransferEvent('t09_failed'))).toBe(200);
  expect(await deliver(p)).toBe(200);
  await drain();
  return p;
}
const lead = async (name: FixtureName) => (await getRepo().getLeadByCallId(loadFixture(name).call_id))!;
const mail = (tag: string) => mocks.resend.outbox.filter((m) => m.tag === tag);
const linkFrom = (text: string, label: string) => text.match(new RegExp(`${label}: (\\S+)`))![1];

beforeEach(() => { scheduled.length = 0; });

describe('SPEC §18 end-to-end (MOCK_EXTERNAL=1)', () => {
  it('stores every fixture call with the §15 outcomes; booked/callback leads get a designer, a brief and one email', async () => {
    for (const name of FIXTURE_NAMES) await simulate(name);
    await simulate('t01'); // posted twice

    // §18 says "6 calls" but §15 lists 7 fixtures (t09_failed is its own call) — see NOTES.md.
    const calls = await getRepo().listCalls();
    expect(calls).toHaveLength(FIXTURE_NAMES.length);
    expect(calls.every((c) => c.processed_at && !c.processing_error)).toBe(true);

    const outcomes = Object.fromEntries(await Promise.all(FIXTURE_NAMES.map(async (n) => [n, (await lead(n)).outcome])));
    expect(outcomes).toEqual({
      t01: 'booked', t13: 'booked', t10: 'declined', t09: 'existing_client_transferred',
      t09_failed: 'transfer_failed', t17: 'incomplete', price_leak: 'callback',
    });

    for (const name of ['t01', 't13', 'price_leak'] as const) {
      const l = await lead(name);
      expect(l.designer_id, name).not.toBeNull();
      expect(l.brief_json, name).not.toBeNull();
      expect(mail('designer_brief').filter((m) => m.leadId === l.id), name).toHaveLength(1);
    }
    expect(mail('designer_brief')).toHaveLength(3); // t01 twice still one email
  });

  it('t10 has no budget figure in agent lines and no brief; price_leak is flagged; all others are not', async () => {
    for (const name of FIXTURE_NAMES) await simulate(name);
    const t10 = await getRepo().getCall(loadFixture('t10').call_id);
    for (const line of agentLines(t10!.transcript)) expect(line).not.toMatch(/\d|lakh/i);
    expect((await lead('t10')).brief_text).toBeNull();
    for (const name of FIXTURE_NAMES) {
      const c = (await getRepo().getCall(loadFixture(name).call_id))!;
      expect(c.price_flag, name).toBe(name === 'price_leak');
    }
    // No brief or email anywhere carries a money term.
    for (const l of await getRepo().listLeads()) expect(scanText(l.brief_text).flag).toBe(false);
    for (const m of mocks.resend.outbox) expect(scanText(m.text).flag, m.subject).toBe(false);
  });

  it('15 and 30 working minutes send one reminder and one escalation; a 23:00 lead starts its clock at 10:00', async () => {
    await simulate('t01'); // Wed 2 Sep 10:27 IST
    advance(15 * MIN);
    await runTick();
    advance(15 * MIN);
    await runTick();
    advance(60 * MIN);
    await runTick();
    expect(mail('reminder')).toHaveLength(1);
    expect(mail('escalation')).toHaveLength(1);
    expect(mail('escalation')[0].to).toBe(FRONT_DESK);

    const p = loadFixture('t13');
    p.timestamp = ist('2026-09-16T23:00');
    setNow(p.timestamp);
    await deliver(p);
    await drain();
    expect((await lead('t13')).clock_started_at).toBe(ist('2026-09-17T10:00'));
  });

  it('Accept sets accepted_at; Reassign moves the lead and restarts the clock', async () => {
    await simulate('t01');
    const l = await lead('t01');
    advance(30 * MIN);
    await runTick();

    const reassignUrl = linkFrom(mail('escalation')[0].text, 'Reassign to the next designer');
    advance(2 * MIN);
    expect((await click(reassignUrl, reassignGET)).status).toBe(200);
    const moved = await lead('t01');
    expect(moved).toMatchObject({ designer_id: ROHAN.id, reassign_count: 1, clock_started_at: now().toISOString(), reminder_sent_at: null, escalated_at: null });

    const acceptUrl = linkFrom(mail('designer_brief').at(-1)!.text, 'Accept this lead');
    advance(4 * MIN);
    expect((await click(acceptUrl, acceptGET)).status).toBe(200);
    expect((await getRepo().getLead(l.id))?.accepted_at).toBe(now().toISOString());

    // The original designer's link no longer accepts it.
    const oldAccept = linkFrom(mail('designer_brief')[0].text, 'Accept this lead');
    expect(mail('designer_brief')[0].to).toBe(ANANYA.email);
    expect((await click(oldAccept, acceptGET)).status).toBe(409);
  });

  it('t09_failed and t17 send urgent front-desk emails and appear under Needs attention', async () => {
    for (const name of FIXTURE_NAMES) await simulate(name);
    const urgent = mail('urgent');
    expect(urgent.map((m) => m.leadId).sort()).toEqual([(await lead('t09_failed')).id, (await lead('t17')).id].sort());
    expect(urgent.every((m) => m.to === FRONT_DESK)).toBe(true);
    const m = await loadDashboard(parseRange({ from: '2026-09-01', to: '2026-09-30' }));
    const ids = m.attention.map((a) => a.callId);
    expect(ids).toEqual(expect.arrayContaining([loadFixture('t09_failed').call_id, loadFixture('t17').call_id]));
  });

  it('the dashboard returns correct counts and cost totals for the fixture set', async () => {
    for (const name of FIXTURE_NAMES) await simulate(name);
    setNow('2026-10-05T06:00:00.000Z');
    const m = await loadDashboard(parseRange({ from: '2026-09-01', to: '2026-09-30' }));
    expect(m.rc1).toEqual({ calls: 7, afterHours: 1, afterHoursShare: 1 / 7 });
    expect(m.rc2.outcomes).toMatchObject({ booked: 2, callback: 1, declined: 1, existing_client_transferred: 1, transfer_failed: 1, incomplete: 1 });
    expect(m.cut.flagged.map((f) => f.callId)).toEqual([loadFixture('price_leak').call_id]);
    expect(m.cost.vaaniInr).toBeCloseTo(7 * 12.5, 6);
    expect(m.cost.geminiInr).toBeCloseTo(3 * 0.134, 6);
    expect(m.cost.totalInr).toBeCloseTo(87.5 + 0.402, 6);
    expect(m.cost.creditsRemaining).toBe(1000 - 87.5);
  });
});

describe('stress', () => {
  it('20 concurrent deliveries of the same call produce one call, one lead and one designer email', async () => {
    const p = loadFixture('t01');
    setNow(p.timestamp);
    const statuses = await Promise.all(Array.from({ length: 20 }, () => deliver(p)));
    expect(statuses.every((s) => s === 200)).toBe(true);
    await Promise.all(scheduled.splice(0).map((t) => t()));
    expect(await getRepo().listCalls()).toHaveLength(1);
    expect(await getRepo().listLeads()).toHaveLength(1);
    expect(mail('designer_brief')).toHaveLength(1);
    expect(await getRepo().listEvents({ type: 'webhook_received' })).toHaveLength(20); // every raw event kept
  });

  it('all seven fixtures delivered concurrently are all processed, with designers rotated without double-assignment', async () => {
    setNow('2026-09-16T06:55:30.000Z');
    await Promise.all(FIXTURE_NAMES.map((n) => deliver(loadFixture(n))));
    await Promise.all(scheduled.splice(0).map((t) => t()));
    const calls = await getRepo().listCalls();
    expect(calls).toHaveLength(7);
    expect(calls.every((c) => c.processed_at)).toBe(true);
    expect(mail('designer_brief')).toHaveLength(3);
  });

  it('malformed or hostile payloads never crash the endpoint or create leads', async () => {
    const junk: unknown[] = [
      {}, [], 'string', 42, null,
      { event: 'call_postprocessing' },
      { event: 'call_postprocessing', call_id: 'x1', data: null },
      { event: 'call_postprocessing', call_id: 'x2', data: { entities: 'not an object', transcript: 12345, call_duration: 'abc' } },
      { event: 'call_postprocessing', call_id: 'x3', data: { entities: { outcome: { nested: true } }, transcript: null } },
      { event: 'call_postprocessing', call_id: 'x4', data: { transcript: `AGENT: ${'A'.repeat(200_000)}`, entities: {} } },
      { event: 'human_transfer_failed' },
      { event: 'call_started', data: { room_name: 'x5', phone_number: { evil: 1 } } },
      { event: '<script>alert(1)</script>', call_id: '"; drop table calls; --' },
    ];
    setNow('2026-09-02T05:00:00.000Z');
    for (const body of junk) expect(await deliver(body), JSON.stringify(body)?.slice(0, 60)).toBe(200);
    await drain();
    const calls = await getRepo().listCalls();
    // x1–x4 are stored (never lose a call) and processed to "incomplete" or recorded with an error; none crash.
    expect(calls.map((c) => c.call_id).sort()).toEqual(['x1', 'x2', 'x3', 'x4']);
    for (const c of calls) expect(c.processed_at !== null || c.processing_error !== null).toBe(true);
    expect(mail('designer_brief')).toHaveLength(0);
  });

  it('webhook bodies that are not JSON return 400 and are recorded', async () => {
    const res = await webhook(new Request(`http://localhost:3000/api/webhooks/vaani?token=${process.env.VAANI_WEBHOOK_SECRET}`, { method: 'POST', body: '{"truncated":' }));
    expect(res.status).toBe(400);
    expect(await getRepo().listEvents({ type: 'webhook_invalid_json' })).toHaveLength(1);
  });

  it('a 200-call month keeps the dashboard and cron fast and correct', async () => {
    const base = loadFixture('t10'); // declined: no emails, so it isolates storage + metrics
    const start = Date.parse('2026-09-01T05:00:00.000Z');
    for (let i = 0; i < 200; i++) {
      const p = structuredClone(base);
      p.call_id = p.data.call_id = p.data.room_name = `bulk-${i}`;
      p.timestamp = new Date(start + i * 3 * 3_600_000).toISOString();
      setNow(p.timestamp);
      await deliver(p);
    }
    await drain();
    setNow('2026-10-01T06:00:00.000Z');
    const t0 = performance.now();
    const m = await loadDashboard(parseRange({ from: '2026-09-01', to: '2026-09-30' }));
    const r = await runTick();
    const ms = performance.now() - t0;
    expect(m.rc1.calls).toBe(200);
    expect(m.rc2.outcomes.declined).toBe(200);
    expect(r.errors).toEqual([]);
    expect(ms).toBeLessThan(2000);
  });
});
