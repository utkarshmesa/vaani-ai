import { requireDashboardAccess, showPhone } from '@/lib/dashboard/access';
import { MIN_GROUP_TO_COMPARE, type Insights } from '@/lib/dashboard/insights';
import { loadDashboard } from '@/lib/dashboard/load';
import type { AttentionItem, Metrics } from '@/lib/dashboard/metrics';
import { parseRange } from '@/lib/dashboard/range';
import { humanise } from '@/lib/format';
import { formatIst } from '@/lib/time';
import { Badge, Meter, OutcomeBadge, Section, TopBar, callHref, inr, mins, num, pct } from './ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard · Aangan Leads' };

/**
 * Organised around the founder's questions (has the leak stopped? where do enquiries go? who isn't following up?
 * did refusing to quote cost bookings? is it worth it?), with the SPEC §14 root-cause tags kept as small labels.
 */

function reasonTone(r: string): 'bad' | 'warn' | 'info' {
  if (/price|transfer failed|error/i.test(r)) return 'bad';
  if (/not accepted|dropped|after hours/i.test(r)) return 'warn';
  return 'info';
}

const ATTENTION_GROUPS = [
  { key: 'call', title: 'Call these people back', test: /transfer failed|dropped|call back|after hours/i },
  { key: 'booking', title: 'Fix a booking', test: /booking not found|rebook/i },
  { key: 'designer', title: 'Chase a designer', test: /not accepted/i },
  { key: 'review', title: 'Review the call', test: /./ },
] as const;

function groupAttention(items: AttentionItem[]) {
  const groups = ATTENTION_GROUPS.map((g) => ({ ...g, items: [] as AttentionItem[] }));
  for (const a of items) groups.find((g) => a.reasons.some((r) => g.test.test(r)))!.items.push(a);
  return groups.filter((g) => g.items.length);
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'];
/** A 3-hour slot entirely outside Mon–Fri 10:00–19:00 */
const closedSlot = (day: number, slot: number) => day >= 5 || slot <= 2 || slot === 7;

function Heatmap({ grid }: { grid: Insights['heatmap'] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="table-wrap">
      <table className="heat" aria-label="Calls by weekday and time of day (IST)">
        <thead><tr><th />{SLOTS.map((s) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <th className="day">{DAYS[d]}</th>
              {row.map((n, s) => (
                <td key={s} className={closedSlot(d, s) ? 'closed' : undefined} title={`${DAYS[d]} ${SLOTS[s]}: ${n} call(s)`}
                  style={n ? { background: `color-mix(in srgb, var(--accent) ${Math.round(18 + (n / max) * 72)}%, var(--surface-2))`, color: 'var(--accent-ink)' } : undefined}>
                  {n || ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareBar({ label, value, now }: { label: string; value: number | null; now?: boolean }) {
  return (
    <div className="row">
      <span>{label}</span>
      <div className={`bar${now ? ' now' : ''}`}><span style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }} /></div>
      <span className="val">{pct(value)}</span>
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireDashboardAccess('/dashboard');

  const q = await searchParams;
  const includeTests = q.tests === '1';
  const m: Metrics = await loadDashboard(parseRange({ from: q.from, to: q.to }), { includeTests });
  const { rc1, rc2, rc3, cut, cost, insights: ins } = m;
  const r48 = ins.response48h;
  const pq = ins.priceQuestions;
  const funnelMax = Math.max(1, ...ins.funnel.map((f) => f.count));
  const rangeQuery = `from=${m.range.fromStr}&to=${m.range.toStr}`;

  return (
    <>
      <TopBar range active={{ from: m.range.fromStr, to: m.range.toStr }} includeTests={includeTests} />
      <main className="wrap">
        <div className="page-head">
          <h1>{m.range.label}</h1>
          <span className="sub">times in IST · working hours Mon–Fri 10:00–19:00</span>
        </div>
        {includeTests ? (
          <div className="data-note"><Badge tone="warn">Including test calls</Badge><a href={`/dashboard?${rangeQuery}`}>Show real calls only</a></div>
        ) : m.hiddenTestCalls ? (
          <div className="data-note">
            <span>{m.hiddenTestCalls} test call{m.hiddenTestCalls === 1 ? '' : 's'} hidden from these numbers.</span>
            <a href={`/dashboard?${rangeQuery}&tests=1`}>Include them</a>
          </div>
        ) : null}

        <div className="stack">
          {/* 1. Has the leak stopped? */}
          <section className="card">
            <h2 className="section-title">Are we still losing enquiries?<span className="tag">the headline</span></h2>
            <div className="hero">
              <div>
                {r48.share === null ? (
                  <>
                    <div className="big pending">Too early to tell</div>
                    <p className="lede">
                      {r48.pending
                        ? <>{r48.pending} new {r48.pending === 1 ? 'enquiry is' : 'enquiries are'} still inside the 48 hours. The first result shows once a 48-hour window closes.</>
                        : <>No new enquiries in this period yet.</>}
                    </p>
                  </>
                ) : (
                  <>
                    <div className={`big${r48.share < r48.baseline ? ' bad' : ''}`}>{pct(r48.share)}</div>
                    <p className="lede">
                      of new enquiries got a real answer within 48 hours ({r48.within} of {r48.resolved}).
                      {r48.pending ? <> {r48.pending} more {r48.pending === 1 ? 'is' : 'are'} still inside the 48 hours.</> : null}
                    </p>
                    <p className="public-note" style={{ margin: '6px 0 0' }}>
                      {r48.acceptedInTime} accepted by their designer in time · {r48.declinedOnCall} told honestly on the call it isn&apos;t a fit
                      {r48.droppedUnanswered ? <> · {r48.droppedUnanswered} dropped call{r48.droppedUnanswered === 1 ? '' : 's'} counted as unanswered (front-desk call-backs aren&apos;t recorded)</> : null}
                    </p>
                  </>
                )}
                <p className="summary">
                  <strong>{rc1.calls}</strong> calls answered, every one, at any hour · <strong>{rc2.outcomes.booked}</strong> consultations booked ·{' '}
                  <strong>{rc2.outcomes.callback}</strong> callbacks · <strong>{cut.flagged.length}</strong> price quotes by Vaani · <strong>{inr(cost.totalInr)}</strong> spent
                </p>
              </div>
              <div className="compare">
                <CompareBar label="With Vaani" value={r48.share} now />
                <CompareBar label="Before" value={r48.baseline} />
                <div className="public-note">Before: about 48% of ~200 monthly enquiries got no response within 48 hours. Both figures count every new enquiry.</div>
              </div>
            </div>
          </section>

          {/* What needs doing today */}
          <Section title="Needs attention" tag={`${m.attention.length}`} hint="What someone should do today, grouped by the action.">
            {m.attention.length ? (
              groupAttention(m.attention).map((g) => (
                <div key={g.key} className="att-group">
                  <h3>{g.title} · {g.items.length}</h3>
                  <div className="attention">
                    {g.items.map((a) => (
                      <a key={a.callId} className="att" href={callHref(a.callId)}>
                        <span>
                          <span className="who">{a.callerName ?? 'Unknown caller'}</span>
                          <span className="meta"> · {showPhone(a.number) ?? 'number pending'}</span>
                        </span>
                        <span className="meta">{formatIst(a.at)}</span>
                        <span className="reasons">{a.reasons.map((r, i) => <Badge key={i} tone={reasonTone(r)}>{r}</Badge>)}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ))
            ) : <div className="ok-banner">✓ Nothing needs attention.</div>}
          </Section>

          {/* 2. Where do enquiries go? */}
          <Section title="Where enquiries go" tag="RC2 · one record per call" hint="Every call becomes one lead record; this is how many make it to each step, and why the rest stop.">
            {rc1.calls ? (
              <div className="funnel">
                {ins.funnel.map((f) => (
                  <div key={f.key} style={{ display: 'contents' }}>
                    {f.lost && f.lost.count > 0 ? <div className="lost">↳ {f.lost.count} {f.lost.label}</div> : null}
                    <div className="step">
                      <span>{f.label}</span>
                      <div className="bar"><span style={{ width: `${(f.count / funnelMax) * 100}%` }}>{f.count}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="empty">No calls in this period.</div>}
            {ins.declineReasons.length ? (
              <p className="public-note">
                Why enquiries were declined: <strong>{ins.declineReasons.map((r) => `${humanise(r.reason)} (${r.count})`).join(' · ')}</strong>
                {' '}— a guide to where marketing brings in the wrong enquiries.
              </p>
            ) : null}
            <p className="public-note" style={{ marginBottom: 0 }}>
              Complete lead records: <strong>{rc2.complete} of {rc1.calls}</strong> ({pct(rc2.completeShare)}).
              {ins.outcomeLoggedShare !== null && ins.outcomeLoggedShare < 1
                ? <> Designers have logged the consultation outcome for {pct(ins.outcomeLoggedShare)} of accepted leads, so the last two steps may undercount.</> : null}
            </p>
          </Section>

          <div className="grid two">
            {/* 3. Calls the studio would have missed */}
            <Section title="Calls answered" tag="RC1 · coverage" hint="Calls that arrived while the studio was closed — the ones that used to go unanswered.">
              <div className="stats">
                <div className="stat"><div className="n">{ins.afterHours.calls}</div><div className="l">calls while closed ({pct(rc1.afterHoursShare)})</div></div>
                <div className="stat"><div className="n">{ins.afterHours.newEnquiries}</div><div className="l">new enquiries while closed</div></div>
                <div className="stat"><div className="n">{ins.afterHours.handedOff}</div><div className="l">sent to a designer</div></div>
                <div className="stat"><div className="n">{ins.afterHours.booked}</div><div className="l">consultations booked</div></div>
              </div>
              <Heatmap grid={ins.heatmap} />
              <div className="public-note">When calls arrive (IST). Outlined cells are entirely outside working hours.</div>
            </Section>

            {/* 4. Did refusing to quote cost bookings? */}
            <Section title="Price check" tag="CUT · target 0" hint="Vaani never quotes a price. Did callers who asked still book?">
              {pq.askers.asked ? (
                <>
                  <p style={{ marginTop: 0 }}>
                    <strong>{pq.askers.asked}</strong> caller{pq.askers.asked === 1 ? '' : 's'} asked about price.{' '}
                    <strong>{pq.askers.converted}</strong> still booked a consultation or asked for a callback ({pq.askersBooked} booked).
                  </p>
                  {pq.comparable ? (
                    <>
                      <div className="compare">
                        <CompareBar label={`Asked (${pq.askers.asked})`} value={pq.askers.share} now />
                        <CompareBar label={`Didn't (${pq.others.asked})`} value={pq.others.share} />
                      </div>
                      <div className="public-note" style={{ marginTop: 6 }}>
                        Share of new enquiries that became a booking or callback. Callers who ask about price may simply be keener, so read this
                        as &ldquo;refusing to quote did not put them off&rdquo;, not as cause and effect.
                      </div>
                    </>
                  ) : (
                    <div className="public-note">
                      Too few calls to compare booking rates yet ({pq.askers.asked} asked, {pq.others.asked} didn&apos;t; needs {MIN_GROUP_TO_COMPARE} in each).
                    </div>
                  )}
                </>
              ) : <p className="public-note" style={{ marginTop: 0 }}>No caller asked about price in this period.</p>}
              <div style={{ marginTop: 14 }}>
                {cut.flagged.length ? (
                  cut.flagged.map((f) => (
                    <div key={f.callId} style={{ marginBottom: 10 }}>
                      <Badge tone="bad">Vaani may have quoted a price</Badge>{' '}
                      <a href={callHref(f.callId)}><strong>{f.callerName ?? 'Unknown caller'}</strong></a>
                      <span className="public-note"> · {formatIst(f.at)}</span>
                      {f.lines.map((l, i) => <div key={i} className="quote">&ldquo;{l}&rdquo;</div>)}
                    </div>
                  ))
                ) : <div className="ok-banner">✓ Vaani quoted no price on any call (every agent line is scanned).</div>}
              </div>
            </Section>
          </div>

          {/* 5. Are designers following through? */}
          <Section title="Designer follow-through" tag="RC3 · chased until they act"
            hint="Each lead goes to a named designer with an Accept link; a reminder at 15 and escalation to the front desk at 30 working minutes.">
            <div className="stats">
              <div className="stat"><div className="n">{pct(rc3.acceptedWithin30Share)}</div><div className="l">accepted within 30 working min ({rc3.acceptedWithin30} of {rc3.eligibleForWithin30})</div></div>
              <div className="stat"><div className="n">{mins(rc3.medianWorkingMinutesToAccept)}</div><div className="l">median time to Accept (working)</div></div>
              <div className="stat"><div className="n">{rc3.escalations}</div><div className="l">escalations</div></div>
              <div className="stat"><div className="n">{rc3.outcomesLogged}</div><div className="l">consultation outcomes logged</div></div>
            </div>
            {ins.designers.some((d) => d.leads || d.reminders) ? (
              <div className="table-wrap" style={{ marginTop: 14 }}>
                <table className="calls">
                  <thead>
                    <tr>
                      <th>Designer</th><th className="num">Leads</th><th className="num">Accepted</th><th className="num">Waiting</th>
                      <th className="num">Median to Accept</th><th className="num">Reminders</th><th className="num">Escalations</th>
                      <th className="num">Outcomes logged</th><th className="num">Proposals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ins.designers.map((d) => (
                      <tr key={d.id}>
                        <td><strong>{d.name}</strong>{d.active ? null : <> <Badge tone="muted">inactive</Badge></>}</td>
                        <td className="num">{d.leads}</td>
                        <td className="num">{d.accepted}</td>
                        <td className="num">{d.waiting ? <Badge tone="warn">{d.waiting}</Badge> : 0}</td>
                        <td className="num">{mins(d.medianWorkingMinutesToAccept)}</td>
                        <td className="num">{d.reminders}</td>
                        <td className="num">{d.escalations ? <Badge tone="bad">{d.escalations}</Badge> : 0}</td>
                        <td className="num">{d.outcomesLogged}</td>
                        <td className="num">{d.proposals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="public-note" style={{ marginTop: 12 }}>No leads sent to designers in this period.</div>}
          </Section>

          {/* 6. Is it worth it? */}
          <Section title="Cost" tag="is it worth it?" hint="What the tool costs per result: Vaani call minutes plus Gemini briefs.">
            <div className="stats">
              <div className="stat"><div className="n">{inr(cost.perBooked)}</div><div className="l">per booked consultation ({cost.bookedConsultations})</div></div>
              <div className="stat"><div className="n">{inr(cost.perProposal)}</div><div className="l">per proposal sent ({cost.proposals})</div></div>
              <div className="stat"><div className="n">{inr(cost.totalInr)}</div><div className="l">spent in this period</div></div>
              <div className="stat"><div className="n">{inr(cost.projectedMonthEnd)}</div><div className="l">{m.range.isCurrentMonth && cost.projectedMonthEnd === null ? 'projected for the month (after the first week)' : 'projected for the month'}</div></div>
            </div>
            {cost.estimatedCostCalls ? (
              <p className="public-note">
                {cost.estimatedCostCalls} call(s) use an estimated Vaani cost (call length × the per-minute rate), because Vaani&apos;s
                call-history API is unavailable. Real costs replace the estimates automatically if it recovers.
              </p>
            ) : null}
            <details className="more">
              <summary>More cost detail</summary>
              <div className="stats">
                <div className="stat"><div className="n">{inr(cost.perCall)}</div><div className="l">per call</div></div>
                <div className="stat"><div className="n">{inr(cost.perMinute)}</div><div className="l">per minute ({num(cost.totalMinutes)} min)</div></div>
                <div className="stat"><div className="n">{inr(cost.vaaniInr)}</div><div className="l">Vaani</div></div>
                <div className="stat"><div className="n">{inr(cost.geminiInr)}</div><div className="l">Gemini briefs</div></div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div className="public-note">Vaani credits remaining: <strong>{num(cost.creditsRemaining)}</strong> ({num(cost.creditsUsedAllTime)} used)</div>
                <Meter value={cost.creditsRemaining + cost.creditsUsedAllTime > 0 ? cost.creditsRemaining / (cost.creditsRemaining + cost.creditsUsedAllTime) : null} tone="good" />
              </div>
              {cost.unknownCostCalls ? <p className="public-note">{cost.unknownCostCalls} call(s) have no Vaani cost yet; it is retried every minute.</p> : null}
            </details>
          </Section>

          <Section title="All calls" tag={`${m.calls.length} in range`}>
            {m.calls.length ? (
              <div className="table-wrap">
                <table className="calls">
                  <thead>
                    <tr><th>When</th><th>Caller</th><th>Locality</th><th>Outcome</th><th>Designer</th><th>Accepted</th><th className="num">Length</th><th className="num">Cost</th></tr>
                  </thead>
                  <tbody>
                    {m.calls.map((c) => (
                      <tr key={c.callId}>
                        <td>{formatIst(c.at)}</td>
                        <td>
                          <a href={callHref(c.callId)}><strong>{c.callerName ?? 'Unknown caller'}</strong></a>
                          <div className="sub">{showPhone(c.number) ?? 'number pending'}</div>
                        </td>
                        <td>{c.locality ?? '—'}</td>
                        <td><OutcomeBadge outcome={c.outcome} />{c.priceFlag ? <> <Badge tone="bad">price flag</Badge></> : null}</td>
                        <td>{c.designer ?? '—'}</td>
                        <td>{c.designer ? (c.accepted ? <Badge tone="good">yes</Badge> : <Badge tone="warn">not yet</Badge>) : '—'}</td>
                        <td className="num">{c.durationMin === null ? '—' : mins(c.durationMin)}</td>
                        <td className="num">{inr(c.costInr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">No calls in this period.</div>}
          </Section>
        </div>
      </main>
    </>
  );
}
