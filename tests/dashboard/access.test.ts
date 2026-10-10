import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { isPublicDashboard, maskPhone, showPhone } from '@/lib/dashboard/access';
import { parseEnv } from '@/lib/env';

const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);
afterEach(() => { delete process.env.DASHBOARD_PUBLIC; });

describe('public dashboard mode (DASHBOARD_PUBLIC=1)', () => {
  it('is off by default: the proxy asks for the password', async () => {
    expect(isPublicDashboard()).toBe(false);
    expect((await proxy(req('/dashboard'))).status).toBe(307);
  });

  it('when on, /dashboard and call pages open without a password', async () => {
    process.env.DASHBOARD_PUBLIC = '1';
    expect(isPublicDashboard()).toBe(true);
    for (const path of ['/dashboard', '/dashboard/calls/abc']) {
      expect((await proxy(req(path))).headers.get('x-middleware-next'), path).toBe('1');
    }
  });

  it('only exactly "1" turns it on', () => {
    for (const v of ['0', 'true', 'yes', '']) {
      process.env.DASHBOARD_PUBLIC = v;
      expect(isPublicDashboard(), v).toBe(false);
    }
  });

  it('DASHBOARD_PASSWORD is optional when the dashboard is public, required otherwise', () => {
    const base = {
      VAANI_WEBHOOK_SECRET: 'w', CRON_SECRET: 'c', LINK_SIGNING_SECRET: 'x'.repeat(32), APP_BASE_URL: 'http://localhost:3000',
      EMAIL_FROM: 'onboarding@resend.dev', FRONT_DESK_EMAIL: 'fd@aangan-studio.test', OWNER_EMAIL: 'o@aangan-studio.test', MOCK_EXTERNAL: '1',
    };
    expect(() => parseEnv(base)).toThrow(/DASHBOARD_PASSWORD/);
    expect(parseEnv({ ...base, DASHBOARD_PUBLIC: '1' }).DASHBOARD_PUBLIC).toBe(true);
  });
});

describe('phone masking', () => {
  it('keeps the country/operator prefix and last 3 digits', () => {
    expect(maskPhone('+919800000101')).toBe('+91 98••••• 101');
    expect(maskPhone('+91 98123 45678')).toBe('+91 98••••• 678');
    expect(maskPhone('9812345678')).toBe('98••••• 678');
  });

  it('leaves non-numbers and empty values alone', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('web-user')).toBe('web-user');
  });

  it('showPhone masks only in public mode', () => {
    expect(showPhone('+919800000101')).toBe('+919800000101');
    process.env.DASHBOARD_PUBLIC = '1';
    expect(showPhone('+919800000101')).toBe('+91 98••••• 101');
  });
});
