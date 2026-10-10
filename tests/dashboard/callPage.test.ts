import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { processEvent } from '@/lib/pipeline/processEvent';
import { setNow } from '@/lib/clock';
import { sessionToken } from '@/lib/dashboard/session';
import { loadCallDetail } from '@/lib/dashboard/callDetail';
import { acceptLink } from '@/lib/leads/links';
import { GET as acceptGET } from '@/app/api/leads/[id]/accept/route';
import { SEED_DESIGNERS } from '@/lib/db/seed';
import { loadFixture, type FixtureName } from '../helpers';

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'aangan_dashboard' && cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

const { default: CallPage } = await import('@/app/dashboard/calls/[callId]/page');

async function seed(name: FixtureName) {
  const p = loadFixture(name);
  setNow(p.timestamp);
  await processEvent(p, { lookupDelayMs: 0 });
  return p;
}
const render = async (callId: string) => renderToStaticMarkup(await CallPage({ params: Promise.resolve({ callId }) }));
afterEach(() => { delete process.env.DASHBOARD_PUBLIC; });

describe('loadCallDetail', () => {
  it('returns the call, lead, designer and an ordered timeline', async () => {
    const p = await seed('t01');
    const lead = (await (await import('@/lib/db')).getRepo().getLeadByCallId(p.call_id))!;
    const url = acceptLink(lead.id, SEED_DESIGNERS[0].id);
    await acceptGET(new Request(url), { params: Promise.resolve({ id: lead.id }) });
    const d = (await loadCallDetail(p.call_id))!;
    expect(d.call.call_id).toBe(p.call_id);
    expect(d.lead?.caller_name).toBe('Priya');
    expect(d.designer?.name).toBe('Ananya Kulkarni');
    expect(d.timeline.map((t) => t.label)).toEqual(expect.arrayContaining([
      'Booking confirmed in Cal.com', 'Assigned to Ananya Kulkarni', 'Designer brief generated', 'Designer email sent', 'Accepted by designer',
    ]));
    const times = d.timeline.map((t) => t.at);
    expect([...times].sort()).toEqual(times);
  });

  it('returns null for an unknown call', async () => {
    expect(await loadCallDetail('nope')).toBeNull();
  });
});

describe('/dashboard/calls/[callId]', () => {
  it('shows the brief, lead fields, transcript bubbles and timeline', async () => {
    cookieValue.current = await sessionToken();
    const p = await seed('t01');
    const html = await render(p.call_id);
    expect(html).toContain('Priya');
    expect(html).toContain('Designer brief');
    expect(html).toContain('Suggested opening');
    expect(html).toContain('Kothrud, Dahanukar Colony');
    expect(html).toContain('class="bubble agent"');
    expect(html).toContain('class="bubble user"');
    expect(html).toContain('Designer email sent');
    expect(html).toContain('href="/dashboard"');
  });

  it('highlights the price-flagged agent line', async () => {
    cookieValue.current = await sessionToken();
    const p = await seed('price_leak');
    const html = await render(p.call_id);
    expect(html).toMatch(/class="bubble agent flagged"[^>]*>[\s\S]*?999 rupees per sq ft/);
  });

  it('404s for an unknown call and requires the session unless public', async () => {
    cookieValue.current = await sessionToken();
    await expect(render('nope')).rejects.toThrow('NEXT_NOT_FOUND');
    cookieValue.current = undefined;
    const p = await seed('t10');
    await expect(render(p.call_id)).rejects.toThrow('NEXT_REDIRECT');
    process.env.DASHBOARD_PUBLIC = '1';
    expect(await render(p.call_id)).toContain('Amit');
  });

  it('masks phone numbers in public mode, including inside email subjects in the timeline', async () => {
    process.env.DASHBOARD_PUBLIC = '1';
    const p = await seed('t17');
    const html = await render(p.call_id);
    expect(html).not.toContain('+919800000000');
    expect(html).toContain('+91 98••••• 000');
  });
});
