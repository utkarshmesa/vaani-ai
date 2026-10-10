import type { ReactNode } from 'react';
import type { LeadOutcome } from '@/lib/db/types';
import { isPublicDashboard } from '@/lib/dashboard/access';
import { presetRanges } from '@/lib/dashboard/range';

/** Shared, server-rendered building blocks for the dashboard pages (no client JS, no chart library). */

export const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
export const mins = (n: number | null) => (n === null ? '—' : `${Math.round(n * 10) / 10} min`);
export const num = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const callHref = (callId: string) => `/dashboard/calls/${encodeURIComponent(callId)}`;

type Tone = 'good' | 'info' | 'muted' | 'violet' | 'bad' | 'warn';

export const OUTCOMES: Record<LeadOutcome, { label: string; tone: Tone }> = {
  booked: { label: 'Booked', tone: 'good' },
  callback: { label: 'Callback', tone: 'info' },
  declined: { label: 'Declined', tone: 'muted' },
  existing_client_transferred: { label: 'Existing client', tone: 'violet' },
  transfer_failed: { label: 'Transfer failed', tone: 'bad' },
  incomplete: { label: 'Dropped', tone: 'warn' },
  other: { label: 'Other', tone: 'muted' },
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge b-${tone}`}>{children}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: LeadOutcome | null }) {
  if (!outcome) return <Badge tone="muted">Not processed</Badge>;
  const o = OUTCOMES[outcome];
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

export function Kpi({ label, tag, value, foot, tone }: { label: string; tag: string; value: ReactNode; foot?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className={`card kpi${tone ? ` ${tone}` : ''}`}>
      <div className="label"><span>{label}</span><span className="tag">{tag}</span></div>
      <div className="value">{value}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}

export function Meter({ value, tone }: { value: number | null; tone?: 'good' }) {
  const w = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return <div className={`meter${tone ? ` ${tone}` : ''}`} role="img" aria-label={pct(value)}><span style={{ width: `${w}%` }} /></div>;
}

export function Section({ title, tag, hint, children }: { title: string; tag?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="section-title">{title}{tag ? <span className="tag">{tag}</span> : null}</h2>
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </section>
  );
}

export function TopBar({ active, range, showSignOut = true, includeTests = false }: {
  active?: { from: string; to: string };
  range?: boolean;
  showSignOut?: boolean;
  /** Carry the "include test calls" choice across period changes */
  includeTests?: boolean;
}) {
  const presets = presetRanges();
  const isPublic = isPublicDashboard();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="/dashboard">
          <span className="brand-mark">A</span>
          <span>Aangan Leads<small>Every call answered · every lead chased</small></span>
        </a>
        <div className="spacer" />
        {range ? (
          <>
            <nav className="chips" aria-label="Period">
              {presets.map((p) => (
                <a key={p.label} className={`chip${active && active.from === p.from && active.to === p.to ? ' on' : ''}`}
                  href={`/dashboard?from=${p.from}&to=${p.to}${includeTests ? '&tests=1' : ''}`}>{p.label}</a>
              ))}
            </nav>
            <form className="range-form" method="get" action="/dashboard">
              <input type="date" name="from" defaultValue={active?.from} aria-label="From" />
              <span className="public-note">–</span>
              <input type="date" name="to" defaultValue={active?.to} aria-label="To" />
              {includeTests ? <input type="hidden" name="tests" value="1" /> : null}
              <button type="submit" className="btn">Show</button>
            </form>
          </>
        ) : null}
        {isPublic ? <span className="public-note">Public view · phone numbers masked</span>
          : showSignOut ? <form method="post" action="/api/logout"><button type="submit" className="btn">Sign out</button></form> : null}
      </div>
    </header>
  );
}
