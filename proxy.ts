import { NextResponse, type NextRequest } from 'next/server';
import { isValidSession, SESSION_COOKIE } from '@/lib/dashboard/session';

/**
 * Password gate for /dashboard (SPEC §14 "via middleware" — Next.js 16 calls middleware "proxy").
 * The dashboard page checks the session again itself (Next.js recommends proxy only for optimistic checks).
 */
export async function proxy(req: NextRequest) {
  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const login = new URL('/login', req.url);
  login.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
