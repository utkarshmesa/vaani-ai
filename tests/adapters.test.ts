import { describe, expect, it, vi } from 'vitest';
import { createVaaniAdapter } from '@/lib/adapters/vaani';
import { createCalcomAdapter } from '@/lib/adapters/calcom';
import { createGeminiAdapter } from '@/lib/adapters/gemini';
import { createResendAdapter } from '@/lib/adapters/resend';
import { mocks } from '@/lib/adapters/mocks';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function historyRow(call_id: string, extra: Record<string, unknown> = {}) {
  return {
    call_id, call_type: 'Inbound', direction: 'Incoming', from_number: '+919800000001', to_number: '+912000000000',
    Start_time: '2026-09-02T04:53:00.123456', End_time: '2026-09-02T04:57:12.000000', duration_ms: 252000,
    call_cost: 7.25, post_processing_status: 'completed', ...extra,
  };
}

describe('Vaani adapter (real, fetch stubbed)', () => {
  it('pages call-history with X-API-Key until it finds the call', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const page = Number(new URL(String(url)).searchParams.get('page'));
      const data = page === 1 ? [historyRow('other-1')] : [historyRow('other-2'), historyRow('inbound-123-abc')];
      return jsonResponse({ data, pagination: { page, has_next: page < 3 } });
    });
    const vaani = createVaaniAdapter({ apiKey: 'vaani_k', fetch });
    const found = await vaani.findCall('inbound-123-abc');

    expect(found).toEqual({
      call_id: 'inbound-123-abc', call_type: 'Inbound', from_number: '+919800000001', to_number: '+912000000000',
      start_time: '2026-09-02T04:53:00.123456', call_cost: 7.25, post_processing_status: 'completed',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://api.vaanivoice.ai/api/call-history?page=1&page_size=200');
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('vaani_k');
  });

  it('returns null when the call is not listed within maxPages or pages run out', async () => {
    const fetch = vi.fn(async () => jsonResponse({ data: [historyRow('x')], pagination: { has_next: true } }));
    const vaani = createVaaniAdapter({ apiKey: 'k', fetch });
    expect(await vaani.findCall('missing', { maxPages: 3 })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);

    const fetch2 = vi.fn(async () => jsonResponse({ data: [], pagination: { has_next: false } }));
    expect(await createVaaniAdapter({ apiKey: 'k', fetch: fetch2 }).findCall('missing')).toBeNull();
    expect(fetch2).toHaveBeenCalledTimes(1);
  });

  it('treats a missing call_cost as null', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ data: [historyRow('c1', { call_cost: undefined })], pagination: { has_next: false } }));
    const found = await createVaaniAdapter({ apiKey: 'k', fetch }).findCall('c1');
    expect(found?.call_cost).toBeNull();
  });

  it('PATCHes agent sections to /api/agent/{id}/{section}', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const vaani = createVaaniAdapter({ apiKey: 'k', fetch });
    await vaani.updatePersona('agent-1', { identity: { system_prompt: 'x' } });
    await vaani.updateTraining('agent-1', {});
    await vaani.updateExperience('agent-1', {});
    await vaani.updateAnalysis('agent-1', {});
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u]) => u)).toEqual([
      'https://api.vaanivoice.ai/api/agent/agent-1/persona',
      'https://api.vaanivoice.ai/api/agent/agent-1/training',
      'https://api.vaanivoice.ai/api/agent/agent-1/experience',
      'https://api.vaanivoice.ai/api/agent/agent-1/analysis',
    ]);
    expect(calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ identity: { system_prompt: 'x' } });
  });

  it('throws with the status on a non-2xx response', async () => {
    const fetch = vi.fn(async () => jsonResponse({ detail: 'bad' }, 422));
    await expect(createVaaniAdapter({ apiKey: 'k', fetch }).updatePersona('a', {})).rejects.toThrow(/422/);
  });
});

describe('Cal.com adapter (real, fetch stubbed)', () => {
  it('lists bookings with Bearer auth, cal-api-version 2026-05-01, filters, and follows the cursor', async () => {
    const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const cursor = new URL(String(url)).searchParams.get('cursor');
      return cursor
        ? jsonResponse({ status: 'success', data: [
            { uid: 'b2', start: '2026-09-07T05:30:00.000Z', end: '2026-09-07T06:15:00.000Z', status: 'cancelled', eventType: { id: 42, slug: 'studio' }, attendees: [] },
          ], pagination: { nextCursor: null, hasMore: false } })
        : jsonResponse({ status: 'success', data: [
            { uid: 'b1', start: '2026-09-07T05:30:00.000Z', end: '2026-09-07T06:15:00.000Z', status: 'accepted', eventType: { id: 42, slug: 'studio' }, attendees: [{ name: 'Priya', email: 'p@x.test' }] },
          ], pagination: { nextCursor: 'abc', hasMore: true } });
    });
    const cal = createCalcomAdapter({ apiKey: 'cal_k', fetch });
    const out = await cal.listBookings({
      eventTypeId: 42, afterStart: new Date('2026-09-07T05:20:00Z'), beforeEnd: new Date('2026-09-07T09:40:00Z'),
    });

    expect(out).toEqual([
      { uid: 'b1', start: '2026-09-07T05:30:00.000Z', end: '2026-09-07T06:15:00.000Z', status: 'accepted', eventTypeId: 42, attendeeName: 'Priya', attendeeEmail: 'p@x.test' },
      { uid: 'b2', start: '2026-09-07T05:30:00.000Z', end: '2026-09-07T06:15:00.000Z', status: 'cancelled', eventTypeId: 42, attendeeName: undefined, attendeeEmail: undefined },
    ]);
    const [url, init] = fetch.mock.calls[0];
    const u = new URL(String(url));
    expect(u.origin + u.pathname).toBe('https://api.cal.com/v2/bookings');
    expect(u.searchParams.get('eventTypeId')).toBe('42');
    expect(u.searchParams.get('afterStart')).toBe('2026-09-07T05:20:00.000Z');
    expect(u.searchParams.get('beforeEnd')).toBe('2026-09-07T09:40:00.000Z');
    const h = init?.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer cal_k');
    expect(h['cal-api-version']).toBe('2026-05-01');
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('cursor')).toBe('abc');
  });
});

describe('Gemini adapter (real, SDK client stubbed)', () => {
  it('requests JSON with a system instruction and counts thinking tokens as output', async () => {
    const generateContent = vi.fn(async (_req: unknown) => ({
      text: '{"ok":true}',
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 150, totalTokenCount: 1650 },
    }));
    const gemini = createGeminiAdapter({ apiKey: 'g', model: 'gemini-flash', client: { models: { generateContent } } });
    const res = await gemini.generateJson({ system: 'SYS', prompt: 'PROMPT', jsonSchema: { type: 'object' } });

    expect(res).toEqual({ text: '{"ok":true}', inputTokens: 1200, outputTokens: 450 });
    const req = generateContent.mock.calls[0][0] as { model: string; contents: string; config: Record<string, unknown> };
    expect(req.model).toBe('gemini-flash');
    expect(req.contents).toBe('PROMPT');
    expect(req.config.systemInstruction).toBe('SYS');
    expect(req.config.responseMimeType).toBe('application/json');
    expect(req.config.responseJsonSchema).toEqual({ type: 'object' });
  });

  it('treats missing usage metadata as zero tokens', async () => {
    const generateContent = vi.fn(async () => ({ text: '{}', usageMetadata: undefined }));
    const gemini = createGeminiAdapter({ apiKey: 'g', model: 'm', client: { models: { generateContent } } });
    expect(await gemini.generateJson({ system: '', prompt: '', jsonSchema: {} })).toEqual({ text: '{}', inputTokens: 0, outputTokens: 0 });
  });
});

describe('Resend adapter (real, SDK client stubbed)', () => {
  const email = { to: 'a@aangan-studio.test', subject: 'S', html: '<p>H</p>', text: 'H', tag: 'urgent' as const };

  it('sends from EMAIL_FROM and returns the message id', async () => {
    const send = vi.fn(async (_p: unknown) => ({ data: { id: 'msg_1' }, error: null }));
    const resend = createResendAdapter({ apiKey: 're', from: 'onboarding@resend.dev', client: { emails: { send } } });
    expect(await resend.send(email)).toEqual({ id: 'msg_1' });
    expect(send.mock.calls[0][0]).toEqual({
      from: 'onboarding@resend.dev', to: 'a@aangan-studio.test', subject: 'S', html: '<p>H</p>', text: 'H',
      tags: [{ name: 'type', value: 'urgent' }],
    });
  });

  it('throws when Resend returns an error', async () => {
    const send = vi.fn(async () => ({ data: null, error: { name: 'validation_error', message: 'nope' } }));
    const resend = createResendAdapter({ apiKey: 're', from: 'x', client: { emails: { send } } });
    await expect(resend.send(email)).rejects.toThrow(/nope/);
  });
});

describe('mock adapters', () => {
  it('Resend mock writes to an in-memory outbox', async () => {
    await mocks.resend.send({ to: 'x@aangan-studio.test', subject: 's', html: 'h', text: 't', tag: 'reminder', leadId: 'L1' });
    expect(mocks.resend.outbox).toHaveLength(1);
    expect(mocks.resend.outbox[0]).toMatchObject({ to: 'x@aangan-studio.test', tag: 'reminder', leadId: 'L1' });
  });

  it('Vaani mock returns a fixed cost unless the call is marked not-listed', async () => {
    const hit = await mocks.vaani.findCall('any-call');
    expect(hit).toMatchObject({ call_id: 'any-call', call_cost: mocks.vaani.fixedCost, post_processing_status: 'completed' });
    mocks.vaani.notListed.add('late-call');
    expect(await mocks.vaani.findCall('late-call')).toBeNull();
    mocks.vaani.fromNumbers.set('t01', '+919800000101');
    expect((await mocks.vaani.findCall('t01'))?.from_number).toBe('+919800000101');
  });

  it('Vaani mock records configure PATCHes', async () => {
    await mocks.vaani.updatePersona('agent', { a: 1 });
    expect(mocks.vaani.patches).toEqual([{ section: 'persona', agentId: 'agent', body: { a: 1 } }]);
  });

  it('Cal.com mock holds the t01 and t13 fixture bookings by default', async () => {
    expect(mocks.calcom.bookings.map((b) => b.uid)).toEqual(['mock-cal-t01', 'mock-cal-t13']);
  });

  it('Cal.com mock filters its bookings by event type and window', async () => {
    mocks.calcom.bookings = [];
    mocks.calcom.bookings.push(
      { uid: 'in', start: '2026-09-07T05:30:00.000Z', end: '2026-09-07T06:15:00.000Z', status: 'accepted', eventTypeId: 1001 },
      { uid: 'other-type', start: '2026-09-07T05:30:00.000Z', end: '2026-09-07T06:15:00.000Z', status: 'accepted', eventTypeId: 7 },
      { uid: 'too-late', start: '2026-09-08T05:30:00.000Z', end: '2026-09-08T06:15:00.000Z', status: 'accepted', eventTypeId: 1001 },
    );
    const out = await mocks.calcom.listBookings({
      eventTypeId: 1001, afterStart: new Date('2026-09-07T05:20:00Z'), beforeEnd: new Date('2026-09-07T09:40:00Z'),
    });
    expect(out.map((b) => b.uid)).toEqual(['in']);
  });

  it('Gemini mock returns its responder output with fixed token counts and records requests', async () => {
    mocks.gemini.responder = () => '{"headline":"x"}';
    const res = await mocks.gemini.generateJson({ system: 's', prompt: 'p', jsonSchema: {} });
    expect(res).toEqual({ text: '{"headline":"x"}', inputTokens: mocks.gemini.fixedInputTokens, outputTokens: mocks.gemini.fixedOutputTokens });
    expect(mocks.gemini.requests).toHaveLength(1);
  });
});
