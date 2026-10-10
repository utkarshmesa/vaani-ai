import { describe, expect, it } from 'vitest';
import { processEvent } from '@/lib/pipeline/processEvent';
import { acceptLead, reassignLead } from '@/lib/leads/actions';
import { fetchAllPages } from '@/lib/db/supabaseRepo';
import { getRepo } from '@/lib/db';
import { mocks } from '@/lib/adapters/mocks';
import { setNow } from '@/lib/clock';
import { SEED_DESIGNERS } from '@/lib/db/seed';
import { loadFixture, loadTransferEvent } from './helpers';

const [ANANYA, ROHAN, MEERA] = SEED_DESIGNERS;

async function t01Lead() {
  const p = loadFixture('t01');
  setNow(p.timestamp);
  await processEvent(p, { lookupDelayMs: 0 });
  return (await getRepo().getLeadByCallId(p.call_id))!;
}

describe('reassign and accept are atomic (review gap 5)', () => {
  it('two simultaneous reassign clicks move the lead once', async () => {
    const l = await t01Lead();
    mocks.resend.outbox = [];
    const results = await Promise.all([reassignLead(l.id, ANANYA.id), reassignLead(l.id, ANANYA.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(['already_reassigned', 'reassigned']);
    const after = (await getRepo().getLead(l.id))!;
    expect(after).toMatchObject({ designer_id: ROHAN.id, reassign_count: 1 });
    expect(mocks.resend.outbox.filter((m) => m.tag === 'designer_brief')).toHaveLength(1);
    // Meera was not touched by the losing click.
    expect((await getRepo().getDesigner(MEERA.id))?.last_assigned_at).toBeNull();
  });

  it('accept and reassign racing: exactly one wins', async () => {
    const l = await t01Lead();
    const [acc, re] = await Promise.all([acceptLead(l.id, ANANYA.id), reassignLead(l.id, ANANYA.id)]);
    const after = (await getRepo().getLead(l.id))!;
    if (acc.status === 'accepted') {
      expect(re.status).toBe('already_accepted');
      expect(after).toMatchObject({ designer_id: ANANYA.id, reassign_count: 0 });
    } else {
      expect(re.status).toBe('reassigned');
      expect(acc.status).toBe('reassigned_away');
      expect(after).toMatchObject({ designer_id: ROHAN.id, accepted_at: null });
    }
  });

  it("an accept from a designer who is no longer assigned doesn't set accepted_at", async () => {
    const l = await t01Lead();
    await reassignLead(l.id, ANANYA.id);
    expect((await acceptLead(l.id, ANANYA.id)).status).toBe('reassigned_away');
    expect((await getRepo().getLead(l.id))?.accepted_at).toBeNull();
  });
});

describe('transfer failure arriving mid-processing (review gap 4)', () => {
  it('is not lost: the lead becomes transfer_failed and the front desk is emailed once', async () => {
    const p = loadFixture('t09');
    setNow(p.timestamp);
    const transfer = { ...loadTransferEvent('t09_failed'), room_name: p.call_id };
    // Deliver the failure while processCall is running (during its call-history lookup),
    // after it has already decided the outcome is existing_client_transferred.
    const original = mocks.vaani.findCall;
    mocks.vaani.findCall = async (id, o) => {
      await processEvent(transfer, { lookupDelayMs: 0 });
      return original(id, o);
    };
    await processEvent(p, { lookupDelayMs: 0 });
    const lead = (await getRepo().getLeadByCallId(p.call_id))!;
    expect(lead).toMatchObject({ outcome: 'transfer_failed', needs_attention: true });
    expect(mocks.resend.outbox.filter((m) => m.tag === 'urgent')).toHaveLength(1);
  });
});

describe('Supabase paging past the 1000-row cap (review gap 1)', () => {
  it('fetchAllPages keeps requesting ranges until a short page', async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({ i }));
    const ranges: [number, number][] = [];
    const out = await fetchAllPages(async (from, to) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    }, 'test');
    expect(out).toHaveLength(2345);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops after one request when everything fits, and surfaces errors', async () => {
    let calls = 0;
    expect(await fetchAllPages(async () => { calls++; return { data: [{ a: 1 }], error: null }; }, 'x')).toHaveLength(1);
    expect(calls).toBe(1);
    await expect(fetchAllPages(async () => ({ data: null, error: { message: 'boom' } as never }), 'listCalls')).rejects.toThrow('listCalls: boom');
  });
});
