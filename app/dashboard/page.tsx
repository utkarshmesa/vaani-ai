import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadDashboard } from '@/lib/dashboard/load';
import type { Metrics } from '@/lib/dashboard/metrics';
import { parseRange } from '@/lib/dashboard/range';
import { isValidSession, SESSION_COOKIE } from '@/lib/dashboard/session';
import { humanise } from '@/lib/format';
import { formatIst } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard · Aangan Leads' };

const inr = (n: number | null) =>
  n === null ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
const mins = (n: number | null) => (n === null ? '—' : `${Math.round(n * 10) / 10} min`);
const num = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const CSS = `
.dash{font-size:14px}
.dash h1{font-size:22px;margin:0}
.dash h2{font-size:16px;margin:28px 0 8px;padding-bottom:4px;border-bottom:1px solid #ddd}
.dash h2 small{font-weight:400;color:#777;font-size:12px;margin-left:6px}
.tiles{display:flex;flex-wrap:wrap;gap:10px}
.tile{border:1px solid #e3e3e3;border-radius:8px;padding:10px 14px;min-width:140px}
.tile b{display:block;font-size:20px}
.tile span{color:#666;font-size:12px}
.dash table{border-collapse:collapse;width:100%;margin-top:6px}
.dash th,.dash td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}
.dash th{color:#555;font-weight:600;font-size:12px}
.ok{color:#1f6f4a}.bad{color:#c53030}.muted{color:#888}
.bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.dash form.filter{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin:12px 0}
.dash form.filter label{display:flex;flex-direction:column;font-size:12px;color:#555}
.dash input,.dash button{font-size:14px;padding:6px 8px}
`;

function Tile({ value, label }: { value: ReactNode; label: string }) {
  return <div className="tile"><b>{value}</b><span>{label}</span></div>;
}

function Section({ title, tag, children }: { title: string; tag: string; children: ReactNode }) {
  return <section><h2>{title}<small>{tag}</small></h2>{children}</section>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Checked again here: the proxy is only an optimistic gate.
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) redirect('/login?next=%2Fdashboard');

  const q = await searchParams;
  const m: Metrics = await loadDashboard(parseRange({ from: q.from, to: q.to }));
  const { rc1, rc2, rc3, cut, cost } = m;

  return (
    <main className="dash">
      <style>{CSS}</style>
      <div className="bar">
        <div>
          <h1>Aangan Leads</h1>
          <span className="muted">{m.range.label} · times in IST</span>
        </div>
        <form method="post" action="/api/logout"><button type="submit">Sign out</button></form>
      </div>

      <form className="filter" method="get">
        <label>From<input type="date" name="from" defaultValue={m.range.fromStr} /></label>
        <label>To<input type="date" name="to" defaultValue={m.range.toStr} /></label>
        <button type="submit">Show</button>
        <a href="/dashboard">This month</a>
      </form>

      <Section title="Calls answered" tag="RC1 · coverage">
        <div className="tiles">
          <Tile value={rc1.calls} label="calls answered by Vaani" />
          <Tile value={`${rc1.afterHours} (${pct(rc1.afterHoursShare)})`} label="outside 10:00–19:00 Mon–Fri" />
        </div>
      </Section>

      <Section title="Lead records" tag="RC2 · one structured record per call">
        <div className="tiles">
          <Tile value={pct(rc2.completeShare)} label={`complete lead records (${rc2.complete} of ${rc1.calls})`} />
          <Tile value={rc2.outcomes.booked} label="consultations booked" />
          <Tile value={rc2.outcomes.callback} label="callbacks" />
          <Tile value={rc2.outcomes.declined} label="declined" />
          <Tile value={rc2.outcomes.existing_client_transferred + rc2.outcomes.transfer_failed} label={`existing clients (${rc2.outcomes.transfer_failed} transfer failed)`} />
          <Tile value={rc2.outcomes.incomplete} label="incomplete (dropped)" />
          {rc2.outcomes.other ? <Tile value={rc2.outcomes.other} label="other" /> : null}
        </div>
        {rc2.declineReasons.length ? (
          <p>Top decline reasons: {rc2.declineReasons.map((r) => `${humanise(r.reason)} (${r.count})`).join(', ')}</p>
        ) : null}
      </Section>

      <Section title="Designer follow-through" tag="RC3 · named designer, chased until they act">
        <div className="tiles">
          <Tile value={rc3.handedOff} label="leads sent to a designer" />
          <Tile value={mins(rc3.medianWorkingMinutesToAccept)} label={`median working minutes email → Accept (wall clock ${mins(rc3.medianMinutesToAccept)})`} />
          <Tile value={pct(rc3.acceptedWithin30Share)} label={`accepted within 30 working min (${rc3.acceptedWithin30} of ${rc3.eligibleForWithin30})`} />
          <Tile value={rc3.escalations} label="escalations to the front desk" />
          <Tile value={rc3.reassignments} label="reassignments" />
          <Tile value={`${rc3.outcomesLogged}`} label={`consultation outcomes logged (${rc3.outcomeRequests} requested)`} />
        </div>
        {rc3.outcomesLogged ? (
          <p>Outcomes: {Object.entries(rc3.consultationOutcomes).filter(([, n]) => n).map(([k, n]) => `${humanise(k)} ${n}`).join(' · ')}</p>
        ) : null}
      </Section>

      <Section title="Price check" tag="CUT · Vaani never quotes prices (target 0)">
        <div className="tiles">
          <Tile value={<span className={cut.flagged.length ? 'bad' : 'ok'}>{cut.flagged.length}</span>} label="calls where the agent may have quoted a price" />
        </div>
        {cut.flagged.length ? (
          <table>
            <thead><tr><th>When</th><th>Caller</th><th>Flagged agent lines</th></tr></thead>
            <tbody>
              {cut.flagged.map((f) => (
                <tr key={f.callId}>
                  <td>{formatIst(f.at)}</td>
                  <td>{f.callerName ?? '—'}<br /><span className="muted">{f.callId}</span></td>
                  <td>{f.lines.map((l, i) => <div key={i}>&ldquo;{l}&rdquo;</div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>

      <Section title="Cost" tag="what the tool costs to run">
        <div className="tiles">
          <Tile value={inr(cost.totalInr)} label={`total (Vaani ${inr(cost.vaaniInr)} · Gemini ${inr(cost.geminiInr)})`} />
          <Tile value={inr(cost.perCall)} label="per call" />
          <Tile value={inr(cost.perMinute)} label={`per minute (${num(cost.totalMinutes)} min)`} />
          <Tile value={inr(cost.perBooked)} label={`per booked consultation (${cost.bookedConsultations})`} />
          <Tile value={inr(cost.perProposal)} label={`per won proposal (${cost.proposals})`} />
          <Tile value={inr(cost.projectedMonthEnd)} label="projected month-end" />
          <Tile value={num(cost.creditsRemaining)} label={`Vaani credits remaining (${num(cost.creditsUsedAllTime)} used)`} />
        </div>
        {cost.unknownCostCalls ? <p className="muted">{cost.unknownCostCalls} call(s) have no Vaani cost yet; it is retried every minute.</p> : null}
      </Section>

      <Section title="Needs attention" tag="urgent, incomplete, booking not found, price flags, unaccepted">
        {m.attention.length ? (
          <table>
            <thead><tr><th>When</th><th>Caller</th><th>Number</th><th>Why</th></tr></thead>
            <tbody>
              {m.attention.map((a) => (
                <tr key={a.callId}>
                  <td>{formatIst(a.at)}</td>
                  <td>{a.callerName ?? '—'}</td>
                  <td>{a.number ?? 'pending'}</td>
                  <td>{a.reasons.map((r, i) => <div key={i}>{r}</div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="ok">Nothing needs attention.</p>}
      </Section>

      <Section title="All calls" tag={`${m.calls.length} in range`}>
        <table>
          <thead><tr><th>When</th><th>Caller</th><th>Locality</th><th>Outcome</th><th>Designer</th><th>Accepted</th><th>Length</th><th>Cost</th></tr></thead>
          <tbody>
            {m.calls.map((c) => (
              <tr key={c.callId}>
                <td>{formatIst(c.at)}</td>
                <td>{c.callerName ?? '—'}<br /><span className="muted">{c.number ?? ''}</span></td>
                <td>{c.locality ?? '—'}</td>
                <td>{c.outcome ? humanise(c.outcome) : '—'}{c.priceFlag ? <span className="bad"> · price flag</span> : null}</td>
                <td>{c.designer ?? '—'}</td>
                <td>{c.designer ? (c.accepted ? <span className="ok">yes</span> : 'not yet') : '—'}</td>
                <td>{c.durationMin === null ? '—' : mins(c.durationMin)}</td>
                <td>{inr(c.costInr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </main>
  );
}
