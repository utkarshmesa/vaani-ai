import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENV_KEYS, parseEnv } from '@/lib/env';
import { getAdapters } from '@/lib/adapters';
import { mocks } from '@/lib/adapters/mocks';
import { advance, now, setNow } from '@/lib/clock';

const SPEC_VARS = [
  'VAANI_API_KEY', 'VAANI_AGENT_ID', 'VAANI_WEBHOOK_SECRET', 'CALCOM_API_KEY', 'CALCOM_EVENT_TYPE_ID',
  'GEMINI_API_KEY', 'GEMINI_MODEL', 'RESEND_API_KEY', 'EMAIL_FROM', 'FRONT_DESK_EMAIL', 'OWNER_EMAIL',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'LINK_SIGNING_SECRET', 'DASHBOARD_PASSWORD',
  'APP_BASE_URL', 'MOCK_EXTERNAL',
];

const base = {
  VAANI_WEBHOOK_SECRET: 'w', CRON_SECRET: 'c', LINK_SIGNING_SECRET: 'x'.repeat(32),
  DASHBOARD_PASSWORD: 'p', APP_BASE_URL: 'http://localhost:3000', EMAIL_FROM: 'onboarding@resend.dev',
  FRONT_DESK_EMAIL: 'fd@aangan-studio.test', OWNER_EMAIL: 'o@aangan-studio.test',
};
const external = {
  VAANI_API_KEY: 'vaani_k', VAANI_AGENT_ID: 'agent', CALCOM_API_KEY: 'cal_k', CALCOM_EVENT_TYPE_ID: '42',
  GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-flash', RESEND_API_KEY: 're_k',
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk',
};

describe('.env.example', () => {
  it('lists exactly the §16 variables, with no values filled in for secrets', () => {
    const lines = readFileSync('.env.example', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l));
    const keys = lines.map((l) => l.split('=')[0]);
    expect([...keys].sort()).toEqual([...SPEC_VARS].sort());
    expect([...ENV_KEYS].sort()).toEqual([...SPEC_VARS].sort());
    for (const l of lines) {
      const [k, v] = l.split('=');
      if (/KEY|SECRET|PASSWORD/.test(k)) expect(v, k).toBe('');
    }
  });
});

describe('parseEnv', () => {
  it('accepts the always-required vars in mock mode without external credentials', () => {
    const e = parseEnv({ ...base, MOCK_EXTERNAL: '1' });
    expect(e.MOCK_EXTERNAL).toBe(true);
    expect(e.CALCOM_EVENT_TYPE_ID).toBe(0);
  });

  it('rejects a missing always-required var', () => {
    const { CRON_SECRET: _omit, ...rest } = base;
    expect(() => parseEnv({ ...rest, MOCK_EXTERNAL: '1' })).toThrow(/CRON_SECRET/);
  });

  it('requires every external credential when not mocked', () => {
    expect(() => parseEnv({ ...base })).toThrow(/VAANI_API_KEY/);
    const e = parseEnv({ ...base, ...external });
    expect(e.MOCK_EXTERNAL).toBe(false);
    expect(e.CALCOM_EVENT_TYPE_ID).toBe(42);
  });

  it('rejects a short link-signing secret', () => {
    expect(() => parseEnv({ ...base, MOCK_EXTERNAL: '1', LINK_SIGNING_SECRET: 'short' })).toThrow(/LINK_SIGNING_SECRET/);
  });
});

describe('getAdapters', () => {
  it('returns the mock adapters when MOCK_EXTERNAL=1', () => {
    const a = getAdapters();
    expect(a.vaani).toBe(mocks.vaani);
    expect(a.calcom).toBe(mocks.calcom);
    expect(a.gemini).toBe(mocks.gemini);
    expect(a.resend).toBe(mocks.resend);
  });
});

describe('clock', () => {
  it('can be pinned and advanced in tests', () => {
    setNow('2026-09-02T04:53:00.000Z');
    expect(now().toISOString()).toBe('2026-09-02T04:53:00.000Z');
    advance(15 * 60_000);
    expect(now().toISOString()).toBe('2026-09-02T05:08:00.000Z');
    setNow(null);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
