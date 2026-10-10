import { describe, expect, it } from 'vitest';
import { createMemoryRepo } from '@/lib/db/memoryRepo';
import { SEED_DESIGNERS, SEED_SETTINGS } from '@/lib/db/seed';
import { setNow } from '@/lib/clock';

const rawCall = (call_id: string) => ({ call_id, raw_payload: { event: 'call_postprocessing', call_id } });

describe('memoryRepo', () => {
  it('starts with the seed designers and settings', async () => {
    const repo = createMemoryRepo();
    const designers = await repo.listDesigners();
    expect(designers.map((d) => d.id)).toEqual(SEED_DESIGNERS.map((d) => d.id));
    expect(designers.every((d) => d.active && d.last_assigned_at === null)).toBe(true);
    expect(await repo.getSettings()).toEqual(SEED_SETTINGS);
  });

  it('upserts calls, applying defaults on insert and merging on update', async () => {
    setNow('2026-09-02T04:57:30.000Z');
    const repo = createMemoryRepo();
    const c = await repo.upsertCall(rawCall('c1'));
    expect(c).toMatchObject({
      call_id: 'c1', received_at: '2026-09-02T04:57:30.000Z', price_flag: false, price_flag_lines: [],
      gemini_input_tokens: 0, gemini_output_tokens: 0, gemini_inr: 0, processed_at: null, vaani_credits: null,
    });
    await repo.upsertCall({ call_id: 'c1', summary: 'hello', raw_payload: { v: 2 } });
    const again = await repo.getCall('c1');
    expect(again?.summary).toBe('hello');
    expect(again?.received_at).toBe('2026-09-02T04:57:30.000Z'); // unchanged by the merge
  });

  it('claims a call for processing only once, unless the claim is stale', async () => {
    setNow('2026-09-02T05:00:00.000Z');
    const repo = createMemoryRepo();
    await repo.upsertCall(rawCall('c1'));
    const staleBefore = new Date('2026-09-02T04:55:00.000Z');
    expect(await repo.claimCallProcessing('c1', staleBefore)).toBe(true);
    expect(await repo.claimCallProcessing('c1', staleBefore)).toBe(false);
    // A claim older than staleBefore can be taken over (crashed worker).
    expect(await repo.claimCallProcessing('c1', new Date('2026-09-02T05:01:00.000Z'))).toBe(true);
    await repo.updateCall('c1', { processed_at: '2026-09-02T05:02:00.000Z' });
    expect(await repo.claimCallProcessing('c1', new Date('2026-09-02T06:00:00.000Z'))).toBe(false);
    expect(await repo.claimCallProcessing('missing', staleBefore)).toBe(false);
  });

  it('lists calls without a confirmed cost (missing or estimated)', async () => {
    const repo = createMemoryRepo();
    await repo.upsertCall(rawCall('a'));
    await repo.upsertCall({ ...rawCall('b'), vaani_credits: 3 });
    await repo.upsertCall({ ...rawCall('c'), vaani_credits: 2, cost_estimated: true });
    expect((await repo.listCalls({ costPending: true })).map((c) => c.call_id)).toEqual(['a', 'c']);
  });

  it('inserts leads with defaults and enforces one lead per call', async () => {
    const repo = createMemoryRepo();
    await repo.upsertCall(rawCall('c1'));
    const lead = await repo.insertLead({ call_id: 'c1', outcome: 'booked' });
    expect(lead).toMatchObject({ call_id: 'c1', outcome: 'booked', reassign_count: 0, booking_confirmed: false, needs_attention: false, designer_id: null });
    expect(lead.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await repo.getLeadByCallId('c1')).toEqual(lead);
    await expect(repo.insertLead({ call_id: 'c1', outcome: 'callback' })).rejects.toThrow(/unique/i);
    await expect(repo.insertLead({ call_id: 'no-such-call', outcome: 'callback' })).rejects.toThrow(/foreign key/i);
  });

  it('updateLeadIf only applies when the guard fields are still null', async () => {
    const repo = createMemoryRepo();
    await repo.upsertCall(rawCall('c1'));
    const lead = await repo.insertLead({ call_id: 'c1', outcome: 'callback' });
    const first = await repo.updateLeadIf(lead.id, { reminder_sent_at: '2026-09-02T05:15:00.000Z' }, ['reminder_sent_at']);
    expect(first?.reminder_sent_at).toBe('2026-09-02T05:15:00.000Z');
    expect(await repo.updateLeadIf(lead.id, { reminder_sent_at: '2026-09-02T05:16:00.000Z' }, ['reminder_sent_at'])).toBeNull();
    expect((await repo.getLead(lead.id))?.reminder_sent_at).toBe('2026-09-02T05:15:00.000Z');
  });

  it('lists active leads (designer assigned, outcome not yet logged)', async () => {
    const repo = createMemoryRepo();
    const [d] = await repo.listDesigners();
    for (const id of ['a', 'b', 'c']) await repo.upsertCall(rawCall(id));
    const a = await repo.insertLead({ call_id: 'a', outcome: 'booked', designer_id: d.id });
    await repo.insertLead({ call_id: 'b', outcome: 'declined' });
    await repo.insertLead({ call_id: 'c', outcome: 'callback', designer_id: d.id, outcome_logged_at: '2026-09-03T05:00:00.000Z' });
    expect((await repo.listLeads({ active: true })).map((l) => l.id)).toEqual([a.id]);
  });

  it('records and filters events', async () => {
    setNow('2026-09-02T05:00:00.000Z');
    const repo = createMemoryRepo();
    await repo.insertEvent({ type: 'webhook_received', call_id: 'c1', meta: { event: 'call_postprocessing' } });
    await repo.insertEvent({ type: 'email_sent', call_id: 'c1', meta: { tag: 'urgent' } });
    await repo.insertEvent({ type: 'email_sent', call_id: 'c2' });
    const ev = await repo.listEvents({ callId: 'c1', type: 'email_sent' });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'email_sent', call_id: 'c1', lead_id: null, at: '2026-09-02T05:00:00.000Z', meta: { tag: 'urgent' } });
    expect(ev[0].id).toBeGreaterThan(0);
  });

  it('updates designers and settings', async () => {
    const repo = createMemoryRepo();
    const [d] = await repo.listDesigners();
    await repo.updateDesigner(d.id, { last_assigned_at: '2026-09-02T05:00:00.000Z' });
    expect((await repo.getDesigner(d.id))?.last_assigned_at).toBe('2026-09-02T05:00:00.000Z');
    await repo.updateSettings({ credits_loaded: 5000 });
    expect((await repo.getSettings()).credits_loaded).toBe(5000);
  });

  it('returns copies so callers cannot mutate stored rows', async () => {
    const repo = createMemoryRepo();
    const [d] = await repo.listDesigners();
    d.name = 'changed';
    expect((await repo.listDesigners())[0].name).not.toBe('changed');
  });
});
