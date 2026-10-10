import { after } from 'next/server';
import { safeEqual } from '@/lib/crypto';
import { getRepo } from '@/lib/db';
import type { Json } from '@/lib/db/types';
import { readEvent } from '@/lib/pipeline/payload';
import { processEvent } from '@/lib/pipeline/processEvent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Urgent calls may wait ~20 s for call-history to list the caller's number.
export const maxDuration = 60;

/**
 * POST /api/webhooks/vaani?token=VAANI_WEBHOOK_SECRET (SPEC §7.1)
 * Check the token, store the raw event, answer 200 at once, process after the response.
 */
export async function POST(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token');
  if (!safeEqual(token, process.env.VAANI_WEBHOOK_SECRET)) {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }

  const repo = getRepo();
  const text = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    await repo.insertEvent({ type: 'webhook_invalid_json', meta: { body: text.slice(0, 2000) } });
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const ev = readEvent(body);
  // If this fails (database down) we answer 500 so Vaani can retry, rather than lose the event.
  await repo.insertEvent({ type: 'webhook_received', call_id: ev.callId, meta: { event: ev.event, payload: body as Json } });

  after(async () => {
    try {
      await processEvent(body);
    } catch (err) {
      console.error('[webhook] processing failed', ev.event, ev.callId, err);
    }
  });

  return Response.json({ ok: true });
}
