import { describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/cron/tick/route';
import { runTick } from '@/lib/cron/tick';
import { processEvent } from '@/lib/pipeline/processEvent';
import { getRepo } from '@/lib/db';
import { mocks } from '@/lib/adapters/mocks';
import { advance, now, setNow } from '@/lib/clock';
import { SEED_DESIGNERS } from '@/lib/db/seed';
import { reassignLead, acceptLead } from '@/lib/leads/actions';
import { verifyLink } from '@/lib/links';
import { loadFixture, type FixtureName } from '../helpers';

const [ANANYA, ROHAN] = SEED_DESIGNERS;
const FRONT_DESK = 'frontdesk@aangan-studio.test';
const OWNER = 'owner@aangan-studio.test';
const MIN = 60_000;
/** IST wall-clock → ISO */
const ist = (s: string) => new Date(`${s}:00+05:30`).toISOString();

async function processFixture(name: FixtureName, at?: string, mutate?: (p: ReturnType<typeof loadFixture>) => void) {
  const p = loadFixture(name);
  if (at) p.timestamp = at;
  mutate?.(p);
  setNow(p.timestamp);
  await processEvent(p, { lookupDelayMs: 0 });
  return (await getRepo().getLeadByCallId(p.call_id))!;
}
const lead = async (id: string) => (await getRepo().getLead(id))!;
const mails = (tag: string) => mocks.resend.outbox.filter((m) => m.tag === tag);

describe('POST /api/cron/tick', () => {
  const call = (auth?: string) =>
    POST(new Request('http://localhost:3000/api/cron/tick', { method: 'POST', headers: auth ? { authorization: auth } : {} }));

  it('requires Authorization: Bearer CRON_SECRET', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    expect((await call(process.env.CRON_SECRET)).status).toBe(401); // missing "Bearer "
  });

  it('runs the jobs and returns a summary', async () => {
    const res = await call(`Bearer ${process.env.CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reminders: [], escalations: [], outcomeRequests: [], costsFilled: [], lowBalanceAlert: false, errors: [],
    });
  });
});

describe('reminder and escalation (SPEC §13, §18)', () => {
  it('sends one reminder at 15 working minutes and one escalation at 30', async () => {
    const l = await processFixture('t01'); // Wed 2 Sep 10:27:40 IST, inside hours
    mocks.resend.outbox = [];

    advance(14 * MIN);
    expect((await runTick()).reminders).toEqual([]);

    advance(1 * MIN);
    expect((await runTick()).reminders).toEqual([l.id]);
    expect(mails('reminder')).toHaveLength(1);
    expect(mails('reminder')[0]).toMatchObject({ to: ANANYA.email, leadId: l.id });
    expect(mails('reminder')[0].text).toMatch(/still waiting for you/i);
    expect((await lead(l.id)).reminder_sent_at).toBe(now().toISOString());

    advance(1 * MIN);
    await runTick();
    expect(mails('reminder')).toHaveLength(1);

    advance(13 * MIN); // 29 working minutes
    expect((await runTick()).escalations).toEqual([]);
    advance(1 * MIN); // 30
    expect((await runTick()).escalations).toEqual([l.id]);
    expect(mails('escalation')).toHaveLength(1);
    const esc = mails('escalation')[0];
    expect(esc.to).toBe(FRONT_DESK);
    expect(esc.text).toContain('Ananya Kulkarni');

    // The Reassign link is valid and bound to the current designer.
    const href = new URL(esc.text.match(/Reassign to the next designer: (\S+)/)![1]);
    expect(href.pathname).toBe(`/api/leads/${l.id}/reassign`);
    expect(verifyLink({ leadId: l.id, action: 'reassign', value: href.searchParams.get('value')!, exp: Number(href.searchParams.get('exp')), sig: href.searchParams.get('sig')! },
      process.env.LINK_SIGNING_SECRET!, now())).toEqual({ ok: true });
    expect(href.searchParams.get('value')).toBe(ANANYA.id);

    advance(60 * MIN);
    await runTick();
    expect(mails('reminder')).toHaveLength(1);
    expect(mails('escalation')).toHaveLength(1);
  });

  it('nothing is sent once the lead is accepted', async () => {
    const l = await processFixture('t01');
    advance(5 * MIN);
    await acceptLead(l.id, ANANYA.id);
    advance(120 * MIN);
    await runTick();
    expect(mails('reminder')).toHaveLength(0);
    expect(mails('escalation')).toHaveLength(0);
  });

  it('a lead created at 23:00 starts its clock at 10:00 the next working day', async () => {
    const l = await processFixture('t01', ist('2026-09-02T23:00'));
    expect(l.clock_started_at).toBe(ist('2026-09-03T10:00'));
    setNow(ist('2026-09-03T09:59'));
    await runTick();
    setNow(ist('2026-09-03T10:14'));
    await runTick();
    expect(mails('reminder')).toHaveLength(0);
    setNow(ist('2026-09-03T10:15'));
    await runTick();
    expect(mails('reminder')).toHaveLength(1);
  });

  it('counts only working minutes across the weekend (Fri 18:50 → reminder Mon 10:05)', async () => {
    await processFixture('t01', ist('2026-09-11T18:50'));
    setNow(ist('2026-09-12T12:00'));
    await runTick();
    setNow(ist('2026-09-14T10:04'));
    await runTick();
    expect(mails('reminder')).toHaveLength(0);
    setNow(ist('2026-09-14T10:05'));
    await runTick();
    expect(mails('reminder')).toHaveLength(1);
  });

  it('reassign restarts the clock and the reminder/escalation flags', async () => {
    const l = await processFixture('t01');
    advance(30 * MIN);
    await runTick(); // reminder + escalation for Ananya
    expect(mails('reminder')).toHaveLength(1);
    expect(mails('escalation')).toHaveLength(1);

    advance(2 * MIN);
    const r = await reassignLead(l.id, ANANYA.id);
    expect(r.status).toBe('reassigned');
    expect(await lead(l.id)).toMatchObject({ designer_id: ROHAN.id, reminder_sent_at: null, escalated_at: null, clock_started_at: now().toISOString() });

    advance(14 * MIN);
    await runTick();
    expect(mails('reminder')).toHaveLength(1);
    advance(1 * MIN);
    await runTick();
    expect(mails('reminder')).toHaveLength(2);
    expect(mails('reminder')[1].to).toBe(ROHAN.email);
    advance(15 * MIN);
    await runTick();
    expect(mails('escalation')).toHaveLength(2);
    expect(mails('escalation')[1].text).toContain('Rohan Joshi');
  });

  it('leads without a designer email (declined, urgent) are never reminded', async () => {
    await processFixture('t10');
    await processFixture('t17');
    advance(3 * 60 * MIN);
    await runTick();
    expect(mails('reminder')).toHaveLength(0);
    expect(mails('escalation')).toHaveLength(0);
  });

  it('a failed send is retried on the next tick, not lost', async () => {
    const l = await processFixture('t01');
    advance(15 * MIN);
    mocks.resend.failWith = 'Resend down';
    const r = await runTick();
    expect(r.errors).toEqual([expect.objectContaining({ job: 'reminders', error: expect.stringContaining('Resend down') })]);
    expect((await lead(l.id)).reminder_sent_at).toBeNull();
    mocks.resend.failWith = null;
    advance(1 * MIN);
    expect((await runTick()).reminders).toEqual([l.id]);
  });
});

describe('outcome requests (SPEC §12)', () => {
  it('booked: 10:00 the next working day after the slot, once, with four buttons', async () => {
    const l = await processFixture('t01'); // slot Mon 7 Sep 11:00 IST
    setNow(ist('2026-09-08T09:59'));
    expect((await runTick()).outcomeRequests).toEqual([]);
    setNow(ist('2026-09-08T10:00'));
    expect((await runTick()).outcomeRequests).toEqual([l.id]);
    const m = mails('outcome_request');
    expect(m).toHaveLength(1);
    expect(m[0].to).toBe(ANANYA.email);
    for (const v of ['site_visit', 'proposal', 'not_fit', 'no_show']) expect(m[0].text).toContain(`value=${v}`);
    expect((await lead(l.id)).outcome_requested_at).toBe(ist('2026-09-08T10:00'));
    setNow(ist('2026-09-09T10:00'));
    await runTick();
    expect(mails('outcome_request')).toHaveLength(1);
  });

  it('a Friday slot is followed up on Monday', async () => {
    const l = await processFixture('t13'); // slot Fri 18 Sep 16:00 IST
    setNow(ist('2026-09-19T10:00'));
    await runTick();
    expect(mails('outcome_request')).toHaveLength(0);
    setNow(ist('2026-09-21T10:00'));
    expect((await runTick()).outcomeRequests).toEqual([l.id]);
  });

  it('callback: only after Accept, at 10:00 the next working day', async () => {
    const l = await processFixture('price_leak'); // callback, Thu 3 Sep 14:47 IST
    setNow(ist('2026-09-10T10:00'));
    await runTick();
    expect(mails('outcome_request')).toHaveLength(0); // never accepted → nothing to follow up

    setNow(ist('2026-09-10T15:00'));
    await acceptLead(l.id, ANANYA.id);
    setNow(ist('2026-09-11T09:59'));
    await runTick();
    expect(mails('outcome_request')).toHaveLength(0);
    setNow(ist('2026-09-11T10:00'));
    expect((await runTick()).outcomeRequests).toEqual([l.id]);
  });

  it('not sent if the outcome was already logged', async () => {
    const l = await processFixture('t01');
    await getRepo().updateLead(l.id, { consultation_outcome: 'site_visit', outcome_logged_at: ist('2026-09-07T13:00') });
    setNow(ist('2026-09-08T10:00'));
    await runTick();
    expect(mails('outcome_request')).toHaveLength(0);
  });
});

describe('cost retry (SPEC §13)', () => {
  it('fills a missing call_cost once call-history lists the call', async () => {
    mocks.vaani.notListed.add('inbound-1788326860-3fa91c01');
    await processFixture('t01');
    const before = (await getRepo().getCall('inbound-1788326860-3fa91c01'))!;
    expect(before.vaani_credits).toBeNull();

    advance(MIN);
    expect((await runTick()).costsFilled).toEqual([]);

    mocks.vaani.notListed.clear();
    advance(MIN);
    expect((await runTick()).costsFilled).toEqual(['inbound-1788326860-3fa91c01']);
    const after = (await getRepo().getCall('inbound-1788326860-3fa91c01'))!;
    expect(after).toMatchObject({ vaani_credits: 12.5, vaani_inr: 12.5, from_number: '+919800000000' });
    expect(after.total_inr).toBeCloseTo(12.5 + before.gemini_inr, 6);
    expect(await getRepo().listEvents({ callId: after.call_id, type: 'cost_filled' })).toHaveLength(1);
  });

  it('looks up all missing calls in one batch and gives up after 7 days', async () => {
    const spy = vi.spyOn(mocks.vaani, 'findCalls');
    mocks.vaani.notListed.add('inbound-1788326860-3fa91c01');
    await processFixture('t01');
    setNow(new Date(Date.parse(loadFixture('t01').timestamp) + 8 * 86_400_000).toISOString());
    await runTick();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('low balance (SPEC §13)', () => {
  it('emails the owner when credits_loaded − used < threshold, at most once a day', async () => {
    await getRepo().updateSettings({ credits_loaded: 40, low_balance_threshold_credits: 20 });
    await processFixture('t01'); // 12.5 credits used → 27.5 left
    advance(MIN);
    expect((await runTick()).lowBalanceAlert).toBe(false);

    await processFixture('t13'); // 25 used → 15 left (< 20)
    advance(MIN);
    expect((await runTick()).lowBalanceAlert).toBe(true);
    expect(mails('low_balance')).toHaveLength(1);
    expect(mails('low_balance')[0]).toMatchObject({ to: OWNER, subject: 'Vaani credits low · 15 left' });
    const alertedAt = now().toISOString();
    expect((await getRepo().getSettings()).low_balance_alerted_at).toBe(alertedAt);

    advance(MIN);
    expect((await runTick()).lowBalanceAlert).toBe(false);
    advance(23 * 60 * MIN);
    expect((await runTick()).lowBalanceAlert).toBe(false);
    advance(60 * MIN);
    expect((await runTick()).lowBalanceAlert).toBe(true);
    expect(mails('low_balance')).toHaveLength(2);
  });

  it('calls without a known cost do not count as used', async () => {
    await getRepo().updateSettings({ credits_loaded: 20, low_balance_threshold_credits: 10 });
    mocks.vaani.notListed.add('inbound-1788326860-3fa91c01');
    mocks.vaani.notListed.add('inbound-1789541730-8b27d413');
    await processFixture('t01');
    await processFixture('t13');
    advance(MIN);
    expect((await runTick()).lowBalanceAlert).toBe(false);
  });
});

describe('job isolation', () => {
  it('one failing job does not stop the others', async () => {
    await getRepo().updateSettings({ credits_loaded: 10, low_balance_threshold_credits: 100 });
    await processFixture('t01');
    mocks.calcom.listBookings = async () => { throw new Error('unused'); };
    mocks.vaani.findCalls = async () => { throw new Error('Vaani 500'); };
    await getRepo().updateCall('inbound-1788326860-3fa91c01', { vaani_credits: null });
    advance(15 * MIN);
    const r = await runTick();
    expect(r.errors).toEqual([expect.objectContaining({ job: 'costRetry', error: expect.stringContaining('Vaani 500') })]);
    expect(r.reminders).toHaveLength(1);
    expect(r.lowBalanceAlert).toBe(true);
    expect(await getRepo().listEvents({ type: 'cron_error' })).toHaveLength(1);
  });
});
