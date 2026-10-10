import { describe, expect, it } from 'vitest';
import { GET as acceptGET } from '@/app/api/leads/[id]/accept/route';
import { GET as outcomeGET } from '@/app/api/leads/[id]/outcome/route';
import { GET as reassignGET } from '@/app/api/leads/[id]/reassign/route';
import { acceptLink, outcomeLink, reassignLink } from '@/lib/leads/links';
import { processEvent } from '@/lib/pipeline/processEvent';
import { getRepo } from '@/lib/db';
import { mocks } from '@/lib/adapters/mocks';
import { advance, now, setNow } from '@/lib/clock';
import { SEED_DESIGNERS } from '@/lib/db/seed';
import { loadFixture } from '../helpers';

const [ANANYA, ROHAN, MEERA] = SEED_DESIGNERS;
type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

async function click(handler: Handler, url: string) {
  const id = new URL(url).pathname.split('/')[3];
  const res = await handler(new Request(url), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.text(), type: res.headers.get('content-type') };
}

/** t01 processed at Wed 2 Sep 10:27 IST → lead assigned to Ananya, designer email sent. */
async function setup() {
  const p = loadFixture('t01');
  setNow(p.timestamp);
  await processEvent(p, { lookupDelayMs: 0 });
  return (await getRepo().getLeadByCallId(p.call_id))!;
}
const lead = async (id: string) => (await getRepo().getLead(id))!;
const eventTypes = async (id: string) => (await getRepo().listEvents({ leadId: id })).map((e) => e.type);

describe('GET /api/leads/[id]/accept', () => {
  it('sets accepted_at, shows a confirmation page and writes an event', async () => {
    const l = await setup();
    advance(7 * 60_000);
    const r = await click(acceptGET, acceptLink(l.id, ANANYA.id));
    expect(r.status).toBe(200);
    expect(r.type).toContain('text/html');
    expect(r.body).toContain('Lead accepted');
    expect((await lead(l.id)).accepted_at).toBe(now().toISOString());
    expect(await eventTypes(l.id)).toContain('lead_accepted');
  });

  it('a second click changes nothing but is still recorded', async () => {
    const l = await setup();
    await click(acceptGET, acceptLink(l.id, ANANYA.id));
    const first = (await lead(l.id)).accepted_at;
    advance(60_000);
    const r = await click(acceptGET, acceptLink(l.id, ANANYA.id));
    expect(r.status).toBe(200);
    expect(r.body).toContain('already accepted');
    expect((await lead(l.id)).accepted_at).toBe(first);
    expect((await eventTypes(l.id)).filter((t) => t === 'click_ignored')).toHaveLength(1);
  });

  it('rejects a tampered or expired link with 403 and records it', async () => {
    const l = await setup();
    const good = new URL(acceptLink(l.id, ANANYA.id));
    good.searchParams.set('sig', `${good.searchParams.get('sig')}x`);
    expect((await click(acceptGET, good.toString())).status).toBe(403);

    const expired = acceptLink(l.id, ANANYA.id);
    advance(15 * 86_400_000);
    const r = await click(acceptGET, expired);
    expect(r.status).toBe(403);
    expect(r.body).toContain('expired');
    expect((await lead(l.id)).accepted_at).toBeNull();
    expect((await getRepo().listEvents({ type: 'link_rejected' }))).toHaveLength(2);
  });

  it('rejects a valid signature for another lead id', async () => {
    const l = await setup();
    const url = acceptLink(l.id, ANANYA.id).replace(`/leads/${l.id}/`, '/leads/00000000-0000-4000-8000-0000000000ff/');
    expect((await click(acceptGET, url)).status).toBe(403);
  });

  it('404s for a signed link to a lead that does not exist', async () => {
    await setup();
    const r = await click(acceptGET, acceptLink('00000000-0000-4000-8000-0000000000ff', ANANYA.id));
    expect(r.status).toBe(404);
  });
});

describe('GET /api/leads/[id]/outcome?value=…', () => {
  it.each(['site_visit', 'proposal', 'not_fit', 'no_show'] as const)('logs %s', async (value) => {
    const l = await setup();
    const r = await click(outcomeGET, outcomeLink(l.id, value));
    expect(r.status).toBe(200);
    expect(await lead(l.id)).toMatchObject({ consultation_outcome: value, outcome_logged_at: now().toISOString() });
    expect(await eventTypes(l.id)).toContain('outcome_logged');
  });

  it('a later click corrects the outcome and keeps the first logged time', async () => {
    const l = await setup();
    await click(outcomeGET, outcomeLink(l.id, 'site_visit'));
    const first = (await lead(l.id)).outcome_logged_at;
    advance(60_000);
    await click(outcomeGET, outcomeLink(l.id, 'proposal'));
    expect(await lead(l.id)).toMatchObject({ consultation_outcome: 'proposal', outcome_logged_at: first });
  });

  it('rejects an unknown value even if signed', async () => {
    const l = await setup();
    expect((await click(outcomeGET, outcomeLink(l.id, 'won_the_lottery' as never))).status).toBe(400);
  });

  it('rejects a value swapped into a signed link', async () => {
    const l = await setup();
    const u = new URL(outcomeLink(l.id, 'no_show'));
    u.searchParams.set('value', 'proposal');
    expect((await click(outcomeGET, u.toString())).status).toBe(403);
  });
});

describe('GET /api/leads/[id]/reassign', () => {
  it('moves the lead to the next designer, restarts the clock and emails them the brief', async () => {
    const l = await setup();
    await getRepo().updateLead(l.id, { reminder_sent_at: now().toISOString(), escalated_at: now().toISOString() });
    advance(45 * 60_000);
    mocks.resend.outbox = [];

    const r = await click(reassignGET, reassignLink(l.id, ANANYA.id));
    expect(r.status).toBe(200);
    expect(r.body).toContain('Rohan Joshi');

    const after = await lead(l.id);
    expect(after).toMatchObject({
      designer_id: ROHAN.id, reassign_count: 1, email_sent_at: now().toISOString(), clock_started_at: now().toISOString(),
      reminder_sent_at: null, escalated_at: null, accepted_at: null,
    });
    expect(mocks.resend.outbox).toHaveLength(1);
    expect(mocks.resend.outbox[0]).toMatchObject({ to: ROHAN.email, tag: 'designer_brief' });
    expect(mocks.resend.outbox[0].text).toContain('Reassigned to you from Ananya Kulkarni');
    expect(mocks.resend.outbox[0].text).toContain(after.brief_text!.split('\n')[0]);
    expect(await eventTypes(l.id)).toContain('lead_reassigned');
  });

  it('is a no-op the second time (the link is bound to the designer it was sent about)', async () => {
    const l = await setup();
    const link = reassignLink(l.id, ANANYA.id);
    await click(reassignGET, link);
    const r = await click(reassignGET, link);
    expect(r.body).toContain('already been reassigned');
    expect(await lead(l.id)).toMatchObject({ designer_id: ROHAN.id, reassign_count: 1 });
  });

  it("the old designer's Accept link no longer works after reassignment", async () => {
    const l = await setup();
    await click(reassignGET, reassignLink(l.id, ANANYA.id));
    const r = await click(acceptGET, acceptLink(l.id, ANANYA.id));
    expect(r.status).toBe(409);
    expect(r.body).toContain('reassigned to Rohan Joshi');
    expect((await lead(l.id)).accepted_at).toBeNull();
    expect((await click(acceptGET, acceptLink(l.id, ROHAN.id))).status).toBe(200);
  });

  it('does not reassign an accepted lead', async () => {
    const l = await setup();
    await click(acceptGET, acceptLink(l.id, ANANYA.id));
    const r = await click(reassignGET, reassignLink(l.id, ANANYA.id));
    expect(r.body).toContain('already accepted');
    expect((await lead(l.id)).designer_id).toBe(ANANYA.id);
  });

  it('reports when nobody else is available, and flags the lead', async () => {
    const l = await setup();
    for (const d of [ROHAN, MEERA]) await getRepo().updateDesigner(d.id, { active: false });
    const r = await click(reassignGET, reassignLink(l.id, ANANYA.id));
    expect(r.body).toContain('No other active designer');
    expect(await lead(l.id)).toMatchObject({ designer_id: ANANYA.id, needs_attention: true });
  });
});
