import { runTick } from '@/lib/cron/tick';
import { safeEqual } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/cron/tick — `Authorization: Bearer CRON_SECRET`, called every minute by pg_cron (SPEC §13). */
export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (!safeEqual(token, process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorised' }, { status: 401 });
  }
  return Response.json(await runTick());
}
