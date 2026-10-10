import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { processEvent } from '@/lib/pipeline/processEvent';
import { setNow } from '@/lib/clock';
import { sessionToken, SESSION_COOKIE } from '@/lib/dashboard/session';
import { loadFixture, FIXTURE_NAMES } from '../helpers';

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'aangan_dashboard' && cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
const redirected = vi.hoisted(() => ({ to: null as string | null }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { redirected.to = to; throw new Error('NEXT_REDIRECT'); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

const { default: DashboardPage } = await import('@/app/dashboard/page');

async function render(params: Record<string, string>) {
  const jsx = await DashboardPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(jsx);
}
async function seed() {
  for (const name of FIXTURE_NAMES) {
    const p = loadFixture(name);
    setNow(p.timestamp);
    await processEvent(p, { lookupDelayMs: 0 });
  }
  setNow('2026-09-30T12:00:00.000Z');
}
afterEach(() => { delete process.env.DASHBOARD_PUBLIC; });

describe('/dashboard page', () => {
  it('redirects to /login without a session (defence in depth behind the proxy)', async () => {
    cookieValue.current = undefined;
    await expect(render({})).rejects.toThrow('NEXT_REDIRECT');
    expect(redirected.to).toBe('/login?next=%2Fdashboard');
  });

  it('renders every section for the fixture set', async () => {
    expect(SESSION_COOKIE).toBe('aangan_dashboard');
    cookieValue.current = await sessionToken();
    await seed();
    const html = await render({ from: '2026-09-01', to: '2026-09-30' });

    for (const heading of [
      'Are we still losing enquiries?', 'Needs attention', 'Where enquiries go', 'Calls answered', 'Price check',
      'Designer follow-through', 'Cost', 'All calls',
    ]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain('value="2026-09-01"');
    expect(html).toContain('For a 2BHK like yours, it usually costs around 999 rupees per sq ft'); // the flagged line, for review
    expect(html).toContain('Transfer failed — call back urgently');
    expect(html).toContain('Sheetal Deshpande');
    expect(html).toContain('₹87.90'); // total cost
    expect(html).toContain('+919800000000'); // full numbers behind the password
    expect(html).toContain('Sign out');
    // founder views
    expect(html).toContain('Call these people back · 2'); // t09_failed and t17
    expect(html).toContain('Chase a designer'); // price_leak is unaccepted after 30 working minutes
    expect(html).toContain('Good fit for the studio');
    expect(html).toContain('callers asked about price');
    expect(html).toContain('Rohan Joshi');
  });

  it('hides test calls unless asked, and keeps the choice across period links', async () => {
    cookieValue.current = await sessionToken();
    const p = loadFixture('t01');
    setNow(p.timestamp);
    await processEvent({ ...p, call_id: 'stress-1-t01', data: { ...p.data, call_id: 'stress-1-t01' } }, { lookupDelayMs: 0 });
    const hidden = await render({ from: '2026-09-01', to: '2026-09-30' });
    expect(hidden).toContain('1 test call hidden');
    expect(hidden).not.toContain('stress-1-t01');
    const shown = await render({ from: '2026-09-01', to: '2026-09-30', tests: '1' });
    expect(shown).toContain('Including test calls');
    expect(shown).toContain('stress-1-t01');
    expect(shown).toMatch(/href="\/dashboard\?from=[\d-]+&amp;to=[\d-]+&amp;tests=1"/);
  });

  it('links every call to its detail page', async () => {
    cookieValue.current = await sessionToken();
    await seed();
    const html = await render({ from: '2026-09-01', to: '2026-09-30' });
    for (const name of FIXTURE_NAMES) {
      expect(html, name).toContain(`href="/dashboard/calls/${encodeURIComponent(loadFixture(name).call_id)}"`);
    }
  });

  it('offers quick period links', async () => {
    cookieValue.current = await sessionToken();
    setNow('2026-10-11T06:00:00.000Z');
    const html = await render({});
    expect(html).toContain('href="/dashboard?from=2026-09-01&amp;to=2026-09-30"'); // last month
    expect(html).toContain('href="/dashboard?from=2026-10-05&amp;to=2026-10-11"'); // last 7 days
    expect(html).toContain('No calls in this period');
  });

  it('public mode: opens without a session, masks phone numbers, no sign-out', async () => {
    process.env.DASHBOARD_PUBLIC = '1';
    cookieValue.current = undefined;
    await seed();
    const html = await render({ from: '2026-09-01', to: '2026-09-30' });
    expect(html).toContain('Calls answered');
    expect(html).not.toContain('+919800000000');
    expect(html).toContain('+91 98••••• 000');
    expect(html).not.toContain('Sign out');
  });
});
