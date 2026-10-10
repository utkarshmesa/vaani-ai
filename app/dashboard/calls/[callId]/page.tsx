import { notFound } from 'next/navigation';
import { CRITERION_LABELS, type Brief } from '@/lib/brief/schema';
import { requireDashboardAccess, showPhone, showText } from '@/lib/dashboard/access';
import { loadCallDetail } from '@/lib/dashboard/callDetail';
import { humanise } from '@/lib/format';
import { formatIst } from '@/lib/time';
import { parseTranscript } from '@/lib/transcript';
import { Badge, OutcomeBadge, Section, TopBar, inr, mins } from '../../ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Call · Aangan Leads' };

const STATUS_TONE = { met: 'good', unclear: 'warn', not_met: 'bad' } as const;

function BriefView({ brief }: { brief: Brief }) {
  return (
    <div className="brief">
      <h3>{brief.headline}</h3>
      <p style={{ marginTop: 0 }}>{brief.what_they_want}</p>
      <ul>
        {brief.criteria.map((c) => (
          <li key={c.criterion}>
            <strong>{CRITERION_LABELS[c.criterion]}</strong>{' '}
            <Badge tone={STATUS_TONE[c.status]}>{humanise(c.status)}</Badge>
            {c.evidence ? <span className="public-note"> — &ldquo;{c.evidence}&rdquo;</span> : null}
          </li>
        ))}
      </ul>
      {brief.uncertainties.length ? (
        <>
          <strong>Uncertainties</strong>
          <ul>{brief.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </>
      ) : null}
      {brief.caller_stated_budget ? <p><strong>Caller-stated budget (their words):</strong> {brief.caller_stated_budget}</p> : null}
      <p><strong>Suggested opening:</strong> {brief.suggested_opening}</p>
      <p style={{ marginBottom: 0 }}><strong>{brief.booking}</strong></p>
    </div>
  );
}

export default async function CallPage({ params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  await requireDashboardAccess(`/dashboard/calls/${encodeURIComponent(callId)}`);
  const d = await loadCallDetail(callId);
  if (!d) notFound();
  const { call, lead, designer, timeline } = d;
  const lines = parseTranscript(call.transcript);
  const flagged = new Set(call.price_flag_lines);
  const brief = (lead?.brief_json ?? null) as Brief | null;

  const fields: [string, string | number | null | undefined][] = lead ? [
    ['Enquiry', humanise(lead.enquiry_type)],
    ['Locality', lead.locality],
    ['In service area', humanise(lead.in_service_area)],
    ['Property', humanise(lead.property_type)],
    ['Carpet area', lead.carpet_area_sqft ? `${lead.carpet_area_sqft} sq ft` : null],
    ['Scope', lead.scope],
    ['Needs it by', lead.completion_deadline],
    ['Timeline fit', humanise(lead.timeline_fit)],
    ['Decision-maker', humanise(lead.decision_maker)],
    ['Budget mentioned', humanise(lead.budget_mentioned)],
    ['Decline reason', humanise(lead.decline_reason)],
    ['Consultation', lead.booked_slot_start ? `${formatIst(lead.booked_slot_start)}${lead.booking_confirmed ? ' · confirmed in Cal.com' : ' · not found in Cal.com'}` : null],
    ['Call back', lead.callback_preference],
    ['Notes for designer', showText(lead.notes_for_designer)],
    ['Consultation outcome', humanise(lead.consultation_outcome)],
  ] : [];

  return (
    <>
      <TopBar />
      <main className="wrap">
        <a className="back" href="/dashboard">← All calls</a>
        <div className="page-head" style={{ marginTop: 10 }}>
          <h1>{lead?.caller_name ?? 'Unknown caller'}</h1>
          <span className="call-head">
            <OutcomeBadge outcome={lead?.outcome ?? null} />
            {call.price_flag ? <Badge tone="bad">price flag</Badge> : null}
            {lead?.needs_attention && lead.attention_reason ? <Badge tone="warn">{lead.attention_reason}</Badge> : null}
          </span>
        </div>
        <p className="public-note" style={{ marginTop: -8 }}>
          {formatIst(call.received_at)} · {showPhone(call.from_number) ?? 'number pending'} ·{' '}
          {call.duration_ms === null ? 'length unknown' : mins(call.duration_ms / 60_000)} ·{' '}
          {designer ? <>designer <strong>{designer.name}</strong>{lead?.accepted_at ? ' (accepted)' : ' (not accepted yet)'}</> : 'no designer'} ·{' '}
          cost {inr(call.vaani_inr === null ? null : call.vaani_inr + call.gemini_inr)}{call.cost_estimated ? ' (estimated)' : ''}
        </p>

        <div className="grid two" style={{ alignItems: 'start' }}>
          <div className="stack">
            <Section title="Designer brief" tag="Gemini">
              {brief ? <BriefView brief={brief} />
                : <p className="public-note" style={{ margin: 0 }}>No brief — briefs are written only for booked and callback leads.</p>}
            </Section>

            <Section title="Lead record" tag="RC2">
              {lead ? (
                <dl className="fields">
                  {fields.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
                  ))}
                </dl>
              ) : <p className="public-note" style={{ margin: 0 }}>This call has not been processed into a lead.</p>}
              {call.summary ? <p className="public-note" style={{ marginBottom: 0 }}><strong>Vaani summary:</strong> {showText(call.summary)}</p> : null}
            </Section>

            <Section title="Timeline" tag="audit trail">
              {timeline.length ? (
                <ol className="timeline">
                  {timeline.map((t, i) => (
                    <li key={i}>
                      <span className={`dot ${t.tone}`} />
                      <span>
                        <span className="when">{formatIst(t.at, 'EEE d MMM, h:mm:ss aaa')}</span>
                        <div>{showText(t.label)}</div>
                        {t.detail ? <div className="detail">{showText(t.detail)}</div> : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : <p className="public-note" style={{ margin: 0 }}>No events recorded.</p>}
            </Section>
          </div>

          <Section title="Transcript" tag={`${lines.length} turns`} hint={call.price_flag ? 'Lines outlined in red were flagged by the price scanner.' : undefined}>
            {lines.length ? (
              <div className="transcript">
                {lines.map((l, i) => {
                  const who = l.speaker === 'AGENT' ? 'agent' : 'user';
                  const isFlagged = who === 'agent' && flagged.has(l.text);
                  return (
                    <div key={i} className={`bubble ${who}${isFlagged ? ' flagged' : ''}`}>
                      <span className="who">{who === 'agent' ? 'Vaani' : 'Caller'}{l.time ? ` · ${l.time}` : ''}</span>
                      {l.text}
                    </div>
                  );
                })}
              </div>
            ) : <p className="public-note" style={{ margin: 0 }}>No transcript.</p>}
          </Section>
        </div>
      </main>
    </>
  );
}
