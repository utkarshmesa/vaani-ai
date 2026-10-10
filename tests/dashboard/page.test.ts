import { describe, expect, it, vi } from 'vitest';
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
}));

const { default: DashboardPage } = await import('@/app/dashboard/page');

async function render(params: Record<string, string>) {
  const jsx = await DashboardPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(jsx);
}

describe('/dashboard page', () => {
  it('redirects to /login without a session (defence in depth behind the proxy)', async () => {
    cookieValue.current = undefined;
    await expect(render({})).rejects.toThrow('NEXT_REDIRECT');
    expect(redirected.to).toBe('/login?next=%2Fdashboard');
  });

  it('renders every section for the fixture set', async () => {
    expect(SESSION_COOKIE).toBe('aangan_dashboard');
    cookieValue.current = await sessionToken();
    for (const name of FIXTURE_NAMES) {
      const p = loadFixture(name);
      setNow(p.timestamp);
      await processEvent(p, { lookupDelayMs: 0 });
    }
    setNow('2026-09-30T12:00:00.000Z');
    const html = await render({ from: '2026-09-01', to: '2026-09-30' });

    for (const heading of ['Calls answered', 'Lead records', 'Designer follow-through', 'Price check', 'Cost', 'Needs attention', 'All calls']) {
      expect(html).toContain(heading);
    }
    expect(html).toContain('value="2026-09-01"');
    expect(html).toContain('For a 2BHK like yours, it usually costs around 999 rupees per sq ft'); // the flagged line, for review
    expect(html).toContain('Transfer failed — call back urgently');
    expect(html).toContain('Sheetal Deshpande');
    expect(html).toContain('₹87.90'); // total cost
  });
});
