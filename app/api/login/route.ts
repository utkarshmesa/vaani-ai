import { safeEqual } from '@/lib/crypto';
import { SESSION_COOKIE, SESSION_MAX_AGE_S, sessionToken } from '@/lib/dashboard/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only ever send people back into the dashboard, never off-site. */
function safeNext(next: unknown): string {
  return typeof next === 'string' && /^\/dashboard(?:[/?]|$)/.test(next) ? next : '/dashboard';
}

/** POST /api/login (form: password, next) — sets the dashboard session cookie. */
export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const password = form.get('password');
  const next = safeNext(form.get('next'));

  if (typeof password !== 'string' || !safeEqual(password, process.env.DASHBOARD_PASSWORD)) {
    const back = new URL('/login', req.url);
    back.searchParams.set('error', '1');
    back.searchParams.set('next', next);
    return new Response(null, { status: 303, headers: { location: back.toString() } });
  }

  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(next, req.url).toString(),
      'set-cookie': `${SESSION_COOKIE}=${await sessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure}`,
    },
  });
}
