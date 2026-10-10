import { now } from '@/lib/clock';
import { getRepo } from '@/lib/db';
import { isTestCall } from './insights';
import { computeMetrics, type Metrics } from './metrics';
import type { DateRange } from './range';

/** Read what the dashboard needs from the database and compute the metrics. */
export async function loadDashboard(range: DateRange, opts: { includeTests?: boolean } = {}): Promise<Metrics> {
  const repo = getRepo();
  const [rangeCalls, allCalls, allLeads, emailEvents, designers, settings] = await Promise.all([
    repo.listCalls({ from: range.from, to: range.to }),
    repo.listCalls(),
    repo.listLeads(),
    repo.listEvents({ type: 'email_sent' }),
    repo.listDesigners(),
    repo.getSettings(),
  ]);
  const calls = opts.includeTests ? rangeCalls : rangeCalls.filter((c) => !isTestCall(c.call_id));
  const callIds = new Set(calls.map((c) => c.call_id));
  const leads = allLeads.filter((l) => callIds.has(l.call_id));
  const leadIds = new Set(leads.map((l) => l.id));

  return computeMetrics({
    range,
    now: now(),
    calls,
    leads,
    emailEvents: emailEvents.filter((e) => e.lead_id && leadIds.has(e.lead_id)),
    designers,
    settings,
    creditsUsedAllTime: allCalls.reduce((s, c) => s + (c.vaani_credits ?? 0), 0),
    hiddenTestCalls: rangeCalls.length - calls.length,
  });
}
