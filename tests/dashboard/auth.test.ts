import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, config } from '@/proxy';
import { POST as login } from '@/app/api/login/route';
import { POST as logout } from '@/app/api/logout/route';
import { SESSION_COOKIE, sessionToken, isValidSession } from '@/lib/dashboard/session';

const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} });

const form = (fields: Record<string, string>) => {
  const body = new URLSearchParams(fields);
  return new Request('http://localhost:3000/api/login', {
    method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
};

describe('dashboard auth (SPEC §14: one password, via middleware/proxy)', () => {
  it('protects /dashboard only', () => {
    expect(config.matcher).toEqual(['/dashboard/:path*']);
  });

  it('redirects to /login without a valid session', async () => {
    for (const cookie of [undefined, 'garbage']) {
      const res = await proxy(req('/dashboard?from=2026-09-01', cookie));
      expect(res.status).toBe(307);
      const loc = new URL(res.headers.get('location')!);
      expect(loc.pathname).toBe('/login');
      expect(loc.searchParams.get('next')).toBe('/dashboard?from=2026-09-01');
    }
  });

  it('lets a valid session through', async () => {
    const res = await proxy(req('/dashboard', await sessionToken()));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('a session stops working when the password changes', async () => {
    const token = await sessionToken();
    expect(await isValidSession(token)).toBe(true);
    const old = process.env.DASHBOARD_PASSWORD;
    process.env.DASHBOARD_PASSWORD = 'a-new-password';
    try {
      expect(await isValidSession(token)).toBe(false);
    } finally {
      process.env.DASHBOARD_PASSWORD = old;
    }
  });

  it('login: wrong password → back to /login with an error, no cookie', async () => {
    const res = await login(form({ password: 'wrong', next: '/dashboard' }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).search).toContain('error=1');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('login: right password → session cookie and redirect to next', async () => {
    const res = await login(form({ password: process.env.DASHBOARD_PASSWORD!, next: '/dashboard?from=2026-09-01' }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe('/dashboard?from=2026-09-01');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(`${SESSION_COOKIE}=${await sessionToken()}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('login never redirects off-site', async () => {
    for (const next of ['https://evil.example', '//evil.example', '/api/cron/tick']) {
      const res = await login(form({ password: process.env.DASHBOARD_PASSWORD!, next }));
      expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard');
      expect(new URL(res.headers.get('location')!).host).toBe('localhost:3000');
    }
  });

  it('logout clears the cookie', async () => {
    const res = await logout(new Request('http://localhost:3000/api/logout', { method: 'POST' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`, 'i'));
  });
});
