import { SESSION_COOKIE } from '@/lib/dashboard/session';

export const runtime = 'nodejs';

/** POST /api/logout — clears the dashboard session. */
export async function POST(req: Request): Promise<Response> {
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL('/login', req.url).toString(),
      'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}
