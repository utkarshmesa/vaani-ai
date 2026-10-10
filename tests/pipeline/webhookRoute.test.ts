import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFixture } from '../helpers';
import { getRepo } from '@/lib/db';
import { mocks } from '@/lib/adapters/mocks';
import { setNow } from '@/lib/clock';

// Capture work scheduled with next/server's after() so tests can run it explicitly.
const scheduled = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => { scheduled.push(task); },
}));

const { POST } = await import('@/app/api/webhooks/vaani/route');

/** null = no token in the URL at all */
const url = (token: string | null) =>
  `http://localhost:3000/api/webhooks/vaani${token === null ? '' : `?token=${encodeURIComponent(token)}`}`;
const post = (body: unknown, token: string | null = process.env.VAANI_WEBHOOK_SECRET!) =>
  POST(new Request(url(token), { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
const runScheduled = async () => { while (scheduled.length) await scheduled.shift()!(); };

beforeEach(() => { scheduled.length = 0; });

describe('POST /api/webhooks/vaani', () => {
  it('rejects a missing or wrong token and stores nothing', async () => {
    for (const token of [null, '', 'wrong', `${process.env.VAANI_WEBHOOK_SECRET}x`]) {
      const res = await post(loadFixture('t01'), token);
      expect(res.status, String(token)).toBe(401);
    }
    expect(await getRepo().listEvents()).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
  });

  it('saves the raw event, returns 200 immediately and processes after the response', async () => {
    const p = loadFixture('t01');
    setNow(p.timestamp);
    const res = await post(p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const raw = await getRepo().listEvents({ type: 'webhook_received' });
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ call_id: p.call_id, meta: { event: 'call_postprocessing', payload: p } });

    // Nothing processed yet — the work is deferred.
    expect(await getRepo().getCall(p.call_id)).toBeNull();
    expect(scheduled).toHaveLength(1);

    await runScheduled();
    expect((await getRepo().getCall(p.call_id))?.processed_at).not.toBeNull();
    expect(mocks.resend.outbox).toHaveLength(1);
  });

  it('keys transfer events by room_name', async () => {
    const res = await post({ event: 'human_transfer_failed', room_name: 'room-abc', reason: 'busy' });
    expect(res.status).toBe(200);
    expect((await getRepo().listEvents({ type: 'webhook_received' }))[0].call_id).toBe('room-abc');
  });

  it('returns 400 for a body that is not JSON, and records it', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(await getRepo().listEvents({ type: 'webhook_invalid_json' })).toHaveLength(1);
    expect(scheduled).toHaveLength(0);
  });

  it('a processing failure inside after() does not throw out of the scheduled task', async () => {
    mocks.resend.failWith = 'down';
    const p = loadFixture('t01');
    setNow(p.timestamp);
    await post(p);
    await expect(runScheduled()).resolves.toBeUndefined();
    expect((await getRepo().getCall(p.call_id))?.processing_error).toContain('down');
  });
});
