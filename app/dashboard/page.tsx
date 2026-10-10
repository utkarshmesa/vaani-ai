import { requireDashboardAccess, showPhone } from '@/lib/dashboard/access';
import { loadDashboard } from '@/lib/dashboard/load';
import type { Metrics } from '@/lib/dashboard/metrics';
import { parseRange } from '@/lib/dashboard/range';
import { humanise } from '@/lib/format';
import { formatIst } from '@/lib/time';
import { LEAD_OUTCOMES } from '@/lib/db/types';
import {
  Badge, Kpi, Meter, OUTCOMES, OutcomeBadge, Section, TopBar, callHref, inr, mins, num, pct,
} from './ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard · Aangan Leads' };

function reasonTone(r: string): 'bad' | 'warn' | 'info' {
  if (/price|transfer failed|error/i.test(r)) return 'bad';
  if (/not accepted|dropped|after hours/i.test(r)) return 'warn';
  return 'info';
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireDashboardAccess('/dashboard');

  const q = await searchParams;
  const m: Metrics = await loadDashboard(parseRange({ from: q.from, to: q.to }));
  const { rc1, rc2, rc3, cut, cost } = m;
  const totalOutcomes = LEAD_OUTCOMES.reduce((s, o) => s + rc2.outcomes[o], 0);
  const creditsShare = cost.creditsRemaining + cost.creditsUsedAllTime > 0
    ? cost.creditsRemaining / (cost.creditsRemaining + cost.creditsUsedAllTime) : null;

  return (
    <>
      <TopBar range active={{ from: m.range.fromStr, to: m.range.toStr }} />
      <main className="wrap">
        <div className="page-head">
          <h1>{m.range.label}</h1>
          <span className="sub">times in IST · working hours Mon–Fri 10:00–19:00</span>
        </div>

        {/* Headline numbers */}
        <div className="grid kpis">
          <Kpi label="Calls answered" tag="RC1" value={rc1.calls} foot={`${rc1.afterHours} after hours (${pct(rc1.afterHoursShare)})`} />
          <Kpi label="Consultations booked" tag="RC2" value={rc2.outcomes.booked} foot={`${rc2.outcomes.callback} callbacks`} />
          <Kpi label="Complete lead records" tag="RC2" value={pct(rc2.completeShare)} foot={`${rc2.complete} of ${rc1.calls} calls`} />
          <Kpi label="Accepted within 30 min" tag="RC3" value={pct(rc3.acceptedWithin30Share)}
            foot={`median ${mins(rc3.medianWorkingMinutesToAccept)} (working)`} />
          <Kpi label="Price quotes by Vaani" tag="CUT" value={cut.flagged.length} tone={cut.flagged.length ? 'bad' : 'good'}
            foot={cut.flagged.length ? 'review below' : 'target 0 — on track'} />
          <Kpi label="Cost of the tool" tag="Cost" value={inr(cost.totalInr)} foot={`${inr(cost.perCall)} per call`} />
        </div>

        <div className="stack">
          {/* Needs attention — the actionable list comes first */}
          <Section title="Needs attention" tag={`${m.attention.length}`} hint="Urgent call-backs, dropped calls, bookings to fix, price flags and leads nobody has accepted.">
            {m.attention.length ? (
              <div className="attention">
                {m.attention.map((a) => (
                  <a key={a.callId} className="att" href={callHref(a.callId)}>
                    <span>
                      <span className="who">{a.callerName ?? 'Unknown caller'}</span>
                      <span className="meta"> · {showPhone(a.number) ?? 'number pending'}</span>
                    </span>
                    <span className="meta">{formatIst(a.at)}</span>
                    <span className="reasons">
                      {a.reasons.map((r, i) => <Badge key={i} tone={reasonTone(r)}>{r}</Badge>)}
                    </span>
                  </a>
                ))}
              </div>
            ) : <div className="ok-banner">✓ Nothing needs attention.</div>}
          </Section>

          <div className="grid two">
            <Section title="Calls answered" tag="RC1 · coverage" hint="Vaani answers every call, any hour.">
              <div className="stats">
                <div className="stat"><div className="n">{rc1.calls}</div><div className="l">calls answered</div></div>
                <div className="stat"><div className="n">{rc1.calls - rc1.afterHours}</div><div className="l">in working hours</div></div>
                <div className="stat"><div className="n">{rc1.afterHours}</div><div className="l">after hours / weekends</div></div>
              </div>
              <Meter value={rc1.afterHoursShare} />
              <div className="public-note">{pct(rc1.afterHoursShare)} of calls arrived when the front desk is closed.</div>
            </Section>

            <Section title="Lead records" tag="RC2 · one record per call" hint="Outcome of every call, as one structured record.">
              {totalOutcomes ? (
                <>
                  <div className="stackbar" role="img" aria-label="Outcome breakdown">
                    {LEAD_OUTCOMES.filter((o) => rc2.outcomes[o]).map((o) => (
                      <span key={o} className={`fill-${OUTCOMES[o].tone}`} style={{ width: `${(rc2.outcomes[o] / totalOutcomes) * 100}%` }} title={`${OUTCOMES[o].label}: ${rc2.outcomes[o]}`} />
                    ))}
                  </div>
                  <div className="legend">
                    {LEAD_OUTCOMES.filter((o) => rc2.outcomes[o]).map((o) => (
                      <span key={o}><i className={`fill-${OUTCOMES[o].tone}`} />{OUTCOMES[o].label} <strong>{rc2.outcomes[o]}</strong></span>
                    ))}
                  </div>
                </>
              ) : <div className="public-note">No calls in this period.</div>}
              <div style={{ marginTop: 14 }}>
                <div className="public-note">Complete lead records: <strong>{rc2.complete} of {rc1.calls}</strong></div>
                <Meter value={rc2.completeShare} tone="good" />
              </div>
              {rc2.declineReasons.length ? (
                <p className="public-note" style={{ marginBottom: 0 }}>
                  Top decline reasons: {rc2.declineReasons.map((r) => `${humanise(r.reason)} (${r.count})`).join(' · ')}
                </p>
              ) : null}
            </Section>

            <Section title="Designer follow-through" tag="RC3 · chased until they act" hint="Named designer, Accept link, 15-min reminder, 30-min escalation.">
              <div className="stats">
                <div className="stat"><div className="n">{rc3.handedOff}</div><div className="l">sent to a designer</div></div>
                <div className="stat"><div className="n">{mins(rc3.medianWorkingMinutesToAccept)}</div><div className="l">median to Accept (working)</div></div>
                <div className="stat"><div className="n">{rc3.escalations}</div><div className="l">escalations</div></div>
                <div className="stat"><div className="n">{rc3.reassignments}</div><div className="l">reassignments</div></div>
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="public-note">Accepted within 30 working minutes: <strong>{rc3.acceptedWithin30} of {rc3.eligibleForWithin30}</strong></div>
                <Meter value={rc3.acceptedWithin30Share} tone="good" />
              </div>
              <p className="public-note" style={{ marginBottom: 0 }}>
                Outcomes logged: <strong>{rc3.outcomesLogged}</strong> ({rc3.outcomeRequests} requested)
                {rc3.outcomesLogged ? ` — ${Object.entries(rc3.consultationOutcomes).filter(([, n]) => n).map(([k, n]) => `${humanise(k)} ${n}`).join(' · ')}` : ''}
              </p>
            </Section>

            <Section title="Price check" tag="CUT · target 0" hint="Every agent line is scanned for prices; Vaani must never quote one.">
              {cut.flagged.length ? (
                cut.flagged.map((f) => (
                  <div key={f.callId} style={{ marginBottom: 10 }}>
                    <a href={callHref(f.callId)}><strong>{f.callerName ?? 'Unknown caller'}</strong></a>
                    <span className="public-note"> · {formatIst(f.at)}</span>
                    {f.lines.map((l, i) => <div key={i} className="quote">&ldquo;{l}&rdquo;</div>)}
                  </div>
                ))
              ) : <div className="ok-banner">✓ No price quoted on any call in this period.</div>}
            </Section>
          </div>

          <Section title="Cost" tag="what the tool costs to run" hint="Vaani call minutes plus Gemini briefs.">
            <div className="stats">
              <div className="stat"><div className="n">{inr(cost.totalInr)}</div><div className="l">total (Vaani {inr(cost.vaaniInr)} · Gemini {inr(cost.geminiInr)})</div></div>
              <div className="stat"><div className="n">{inr(cost.perCall)}</div><div className="l">per call</div></div>
              <div className="stat"><div className="n">{inr(cost.perMinute)}</div><div className="l">per minute ({num(cost.totalMinutes)} min)</div></div>
              <div className="stat"><div className="n">{inr(cost.perBooked)}</div><div className="l">per booked consultation ({cost.bookedConsultations})</div></div>
              <div className="stat"><div className="n">{inr(cost.perProposal)}</div><div className="l">per won proposal ({cost.proposals})</div></div>
              <div className="stat"><div className="n">{inr(cost.projectedMonthEnd)}</div><div className="l">projected month-end</div></div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="public-note">Vaani credits remaining: <strong>{num(cost.creditsRemaining)}</strong> ({num(cost.creditsUsedAllTime)} used)</div>
              <Meter value={creditsShare} tone="good" />
            </div>
            {cost.unknownCostCalls ? <p className="public-note">{cost.unknownCostCalls} call(s) have no Vaani cost yet; it is retried every minute.</p> : null}
            {cost.estimatedCostCalls ? (
              <p className="public-note" style={{ marginBottom: 0 }}>
                {cost.estimatedCostCalls} call(s) use an estimated Vaani cost (call length × the per-minute rate), because Vaani&apos;s
                call-history API is unavailable. Real costs replace the estimates automatically if it recovers.
              </p>
            ) : null}
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
