import { describe, expect, it } from 'vitest';
import { computeMetrics, type Metrics } from '@/lib/dashboard/metrics';
import { parseRange } from '@/lib/dashboard/range';
import { LEAD_OUTCOMES, CONSULTATION_OUTCOMES, type CallRow, type DesignerRow, type EventRow, type LeadRow, type SettingsRow } from '@/lib/db/types';
import { isWorkingTime } from '@/lib/workingHours';

/**
 * First-principles stress test of the dashboard maths. Random (seeded) months of calls — including inconsistent,
 * half-processed and hostile rows — must always satisfy the invariants that follow from each metric's definition,
 * agree with an independent naive recomputation, ignore input order, never produce NaN, and stay fast.
 */

const SETTINGS: SettingsRow = {
  credit_to_inr: 1, vaani_inr_per_minute_estimate: 5.6, gemini_input_inr_per_mtok: 10, gemini_output_inr_per_mtok: 40,
  credits_loaded: 1000, low_balance_threshold_credits: 100, working_days: [1, 2, 3, 4, 5], work_start: '10:00', work_end: '19:00',
  reminder_minutes: 15, escalation_minutes: 30, low_balance_alerted_at: null,
};
const DESIGNERS: DesignerRow[] = [
  { id: 'd1', name: 'A', email: 'a@x.test', active: true, last_assigned_at: null },
  { id: 'd2', name: 'B', email: 'b@x.test', active: true, last_assigned_at: null },
  { id: 'd3', name: 'C', email: 'same@x.test', active: false, last_assigned_at: null },
  { id: 'd4', name: 'D', email: 'same@x.test', active: true, last_assigned_at: null }, // shared sandbox address
];
const OCT = parseRange({ from: '2026-10-01', to: '2026-10-31' });
const H = 3_600_000;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface World { calls: CallRow[]; leads: LeadRow[]; emailEvents: EventRow[]; now: Date }

function world(seed: number, n: number): World {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const maybe = <T,>(p: number, v: T) => (r() < p ? v : null);
  const start = OCT.from.getTime();
  const now = new Date(start + r() * 35 * 24 * H); // sometimes after the month ends
  const calls: CallRow[] = []; const leads: LeadRow[] = []; const emailEvents: EventRow[] = [];
  let ev = 1;
  for (let i = 0; i < n; i++) {
    const at = start + Math.floor(r() * 31 * 24 * H);
    const id = `inbound-${seed}-${i}`;
    const asks = r() < 0.3;
    const vaaniKnown = r() < 0.85;
    calls.push({
      call_id: id, received_at: new Date(at).toISOString(), from_number: maybe(0.9, `+9198${String(i).padStart(8, '0')}`),
      duration_ms: maybe(0.95, Math.floor(r() * 600_000)),
      transcript: r() < 0.9 ? `[10:00:00] AGENT: Namaste.\n\n[10:00:05] USER: ${asks ? 'How much would it cost?' : 'I want my kitchen done.'}` : null,
      summary: null, entities: null, dispositions: null, recording_url: null, raw_payload: {},
      vaani_credits: vaaniKnown ? r() * 20 : null, vaani_inr: vaaniKnown ? r() * 20 : null,
      gemini_input_tokens: 0, gemini_output_tokens: 0, gemini_inr: r() < 0.4 ? r() : 0, total_inr: null,
      price_flag: r() < 0.05, price_flag_lines: [], cost_estimated: r() < 0.5,
      processing_started_at: null, processed_at: null, processing_error: maybe(0.03, 'boom'),
    });
    if (r() < 0.05) continue; // unprocessed call: no lead
    const outcome = pick(LEAD_OUTCOMES);
    const handed = (outcome === 'booked' || outcome === 'callback' || r() < 0.03) && r() < 0.9; // a few inconsistent ones
    const designer = handed ? pick([...DESIGNERS.map((d) => d.id), 'deleted-designer']) : null;
    const emailAt = at + r() * 2 * H;
    const accepted = handed && r() < 0.7 ? new Date(emailAt + r() * 96 * H).toISOString() : null;
    const leadId = `lead-${seed}-${i}`;
    leads.push({
      id: leadId, call_id: id, caller_name: maybe(0.8, 'X'), enquiry_type: pick(['new_enquiry', 'new_enquiry', 'new_enquiry', 'existing_client', 'vendor_or_other', null]),
      locality: maybe(0.8, 'Kothrud'), in_service_area: null, property_type: maybe(0.8, 'apartment'), carpet_area_sqft: null, scope: maybe(0.8, 'kitchen'),
      completion_deadline: maybe(0.7, 'March'), timeline_fit: null, decision_maker: null, budget_mentioned: null,
      outcome, decline_reason: outcome === 'declined' ? pick(['budget', 'out_of_area', 'timeline', null]) : null, callback_preference: null, notes_for_designer: null,
      booked_slot_start: null, booking_confirmed: outcome === 'booked' && r() < 0.9, cal_booking_uid: null,
      designer_id: designer, brief_json: null, brief_text: null,
      clock_started_at: handed ? maybe(0.9, new Date(emailAt).toISOString()) : null, email_sent_at: handed ? new Date(emailAt).toISOString() : null,
      reminder_sent_at: null, escalated_at: null, accepted_at: accepted, reassign_count: Math.floor(r() * 2),
      consultation_outcome: accepted && r() < 0.5 ? pick(CONSULTATION_OUTCOMES) : null, outcome_requested_at: null, outcome_logged_at: null,
      needs_attention: r() < 0.1, attention_reason: maybe(0.1, 'Call dropped — call back'), created_at: new Date(at + 5000).toISOString(),
    });
    if (handed) {
      const to = DESIGNERS.find((d) => d.id === designer)?.email ?? 'gone@x.test';
      emailEvents.push({ id: ev++, lead_id: leadId, call_id: id, type: 'email_sent', at: new Date(emailAt).toISOString(), meta: { tag: 'designer_brief', to } });
      if (r() < 0.3) emailEvents.push({ id: ev++, lead_id: leadId, call_id: id, type: 'email_sent', at: new Date(emailAt + H).toISOString(), meta: { tag: 'reminder', to } });
      if (r() < 0.15) emailEvents.push({ id: ev++, lead_id: leadId, call_id: id, type: 'email_sent', at: new Date(emailAt + 2 * H).toISOString(), meta: { tag: 'escalation', to: 'desk@x.test' } });
    }
  }
  return { calls, leads, emailEvents, now };
}

const run = (w: World) => computeMetrics({ range: OCT, now: w.now, calls: w.calls, leads: w.leads, emailEvents: w.emailEvents, designers: DESIGNERS, settings: SETTINGS, creditsUsedAllTime: 0 });

function shuffle<T>(xs: T[], seed: number): T[] {
  const r = rng(seed); const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function badNumbers(x: unknown, path = '$'): string[] {
  if (typeof x === 'number') return Number.isFinite(x) ? [] : [path];
  if (Array.isArray(x)) return x.flatMap((v, i) => badNumbers(v, `${path}[${i}]`));
  if (x && typeof x === 'object' && !(x instanceof Date)) return Object.entries(x).flatMap(([k, v]) => badNumbers(v, `${path}.${k}`));
  return [];
}

function checkInvariants(m: Metrics, w: World) {
  const ins = m.insights;
  const step = Object.fromEntries(ins.funnel.map((f) => [f.key, f.count]));
  // Funnel: never grows, and each step's "lost" is exactly the difference.
  for (let i = 1; i < ins.funnel.length; i++) {
    expect(ins.funnel[i].count).toBeLessThanOrEqual(ins.funnel[i - 1].count);
    expect(ins.funnel[i].count + ins.funnel[i].lost!.count).toBe(ins.funnel[i - 1].count);
  }
  expect(step.calls).toBe(w.calls.length);
  // Every call lands in exactly one heatmap cell; after-hours counts agree with RC1.
  expect(ins.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(w.calls.length);
  expect(ins.afterHours.calls).toBe(m.rc1.afterHours);
  expect(ins.afterHours.newEnquiries).toBeLessThanOrEqual(step.new);
  expect(ins.afterHours.handedOff).toBeLessThanOrEqual(step.handed);
  expect(ins.afterHours.booked).toBeLessThanOrEqual(ins.afterHours.handedOff);
  // 48 h: every new enquiry is either resolved or pending, never both; the breakdown adds up.
  expect(ins.response48h.resolved + ins.response48h.pending).toBe(step.new);
  expect(ins.response48h.acceptedInTime + ins.response48h.declinedOnCall).toBe(ins.response48h.within);
  expect(ins.response48h.droppedUnanswered).toBeLessThanOrEqual(ins.response48h.resolved - ins.response48h.within);
  expect(ins.priceQuestions.comparable).toBe(ins.priceQuestions.askers.asked >= 10 && ins.priceQuestions.others.asked >= 10);
  expect(ins.response48h.within).toBeLessThanOrEqual(ins.response48h.resolved);
  // Price questions partition the new enquiries.
  expect(ins.priceQuestions.askers.asked + ins.priceQuestions.others.asked).toBe(step.new);
  expect(ins.priceQuestions.askers.converted).toBeLessThanOrEqual(ins.priceQuestions.askers.asked);
  expect(ins.priceQuestions.askersBooked).toBeLessThanOrEqual(ins.priceQuestions.askers.converted);
  // Designers: their leads add up to every handed-off lead whose designer still exists.
  const known = new Set(DESIGNERS.map((d) => d.id));
  expect(ins.designers.reduce((s, d) => s + d.leads, 0)).toBe(w.leads.filter((l) => l.email_sent_at && l.designer_id && known.has(l.designer_id)).length);
  for (const d of ins.designers) expect(d.accepted + d.waiting).toBe(d.leads);
  expect(ins.designers.reduce((s, d) => s + d.escalations, 0)).toBeLessThanOrEqual(m.rc3.escalations);
  // Records and money.
  expect(Object.values(m.rc2.outcomes).reduce((a, b) => a + b, 0)).toBe(w.leads.length);
  expect(m.calls).toHaveLength(w.calls.length);
  expect(new Set(m.attention.map((a) => a.callId)).size).toBe(m.attention.length);
  expect(m.cost.totalInr).toBeCloseTo(w.calls.reduce((s, c) => s + (c.vaani_inr ?? 0) + c.gemini_inr, 0), 6);
  for (const share of [ins.response48h.share, ins.outcomeLoggedShare, ins.priceQuestions.askers.share, ins.priceQuestions.others.share, m.rc1.afterHoursShare, m.rc2.completeShare, m.rc3.acceptedWithin30Share]) {
    if (share !== null) { expect(share).toBeGreaterThanOrEqual(0); expect(share).toBeLessThanOrEqual(1); }
  }
  expect(badNumbers(m)).toEqual([]);
}

/** The 48-hour headline, recomputed the slow, obvious way. */
function naive48h(w: World) {
  const byId = new Map(w.calls.map((c) => [c.call_id, c]));
  let within = 0; let resolved = 0; let pending = 0;
  for (const l of w.leads) {
    const existing = l.enquiry_type === 'existing_client' || l.outcome === 'existing_client_transferred' || l.outcome === 'transfer_failed';
    const other = !existing && (l.enquiry_type === 'vendor_or_other' || l.outcome === 'other');
    if (existing || other) continue;
    const t0 = Date.parse(byId.get(l.call_id)!.received_at);
    const ok = l.outcome === 'declined' || (l.outcome !== 'incomplete' && l.accepted_at !== null && Date.parse(l.accepted_at) - t0 <= 48 * H);
    if (ok) { within++; resolved++; } else if (w.now.getTime() - t0 >= 48 * H) resolved++; else pending++;
  }
  return { within, resolved, pending };
}

describe('dashboard stress: invariants over random months', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))('seed %i', (seed) => {
    const w = world(seed, 20 + seed * 7);
    const m = run(w);
    checkInvariants(m, w);
    expect(m.insights.response48h).toMatchObject(naive48h(w));
    expect(m.rc1.afterHours).toBe(w.calls.filter((c) => !isWorkingTime(new Date(c.received_at), SETTINGS)).length);
  });

  it('input order does not change any number', () => {
    for (const seed of [3, 17, 29]) {
      const w = world(seed, 150);
      const a = run(w);
      const b = run({ ...w, calls: shuffle(w.calls, seed), leads: shuffle(w.leads, seed + 1), emailEvents: shuffle(w.emailEvents, seed + 2) });
      expect(b.insights).toEqual(a.insights);
      expect({ ...b.rc1, ...b.rc2, ...b.rc3, ...b.cost }).toEqual({ ...a.rc1, ...a.rc2, ...a.rc3, ...a.cost });
      expect(b.calls.map((c) => c.callId).sort()).toEqual(a.calls.map((c) => c.callId).sort());
    }
  });

  it('an empty month: no NaN, every share is null, nothing to attend to', () => {
    const m = run({ calls: [], leads: [], emailEvents: [], now: new Date('2026-10-15T06:00:00Z') });
    expect(badNumbers(m)).toEqual([]);
    expect(m.insights.response48h.share).toBeNull();
    expect(m.insights.priceQuestions.askers.share).toBeNull();
    expect(m.insights.funnel.every((f) => f.count === 0)).toBe(true);
    expect(m.attention).toEqual([]);
  });

  it('10,000 calls in a month compute in well under a second and a half', () => {
    const w = world(99, 10_000);
    const t0 = performance.now();
    const m = run(w);
    const ms = performance.now() - t0;
    checkInvariants(m, w);
    expect(ms).toBeLessThan(1500);
  });
});

describe('dashboard stress: boundaries', () => {
  it('no month-end projection until a week of the month has passed', () => {
    const w = world(11, 50);
    const at = (now: string, isCurrentMonth: boolean) => computeMetrics({
      range: { ...OCT, isCurrentMonth }, now: new Date(now), calls: w.calls, leads: w.leads, emailEvents: w.emailEvents,
      designers: DESIGNERS, settings: SETTINGS, creditsUsedAllTime: 0,
    }).cost.projectedMonthEnd;
    expect(at('2026-10-20T00:00:00Z', false)).toBeNull(); // not the current month
    expect(at('2026-10-07T18:29:59Z', true)).toBeNull(); // 6 days 23:59:59 into the month (IST)
    expect(at('2026-10-07T18:30:00Z', true)).not.toBeNull(); // exactly 7 days in
  });

  const base = world(1, 0);
  const call = (id: string, at: string, transcript = '[10:00:00] USER: hi'): CallRow => ({ ...world(5, 1).calls[0], call_id: id, received_at: at, transcript });
  const fitLead = (callId: string, accepted: string | null): LeadRow => ({
    ...world(5, 1).leads[0] ?? ({} as LeadRow), id: `l-${callId}`, call_id: callId, enquiry_type: 'new_enquiry', outcome: 'callback',
    designer_id: 'd1', email_sent_at: '2026-10-05T05:00:00.000Z', clock_started_at: '2026-10-05T05:00:00.000Z', accepted_at: accepted,
    consultation_outcome: null, booking_confirmed: false, created_at: '2026-10-05T04:30:00.000Z',
  });
  const t0 = '2026-10-05T04:30:00.000Z'; // Mon 10:00 IST
  const plus = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();

  it('48 hours exactly counts as within; one millisecond more does not; a window closes at exactly 48 h', () => {
    const calls = [call('a', t0), call('b', t0), call('c', t0)];
    const leads = [fitLead('a', plus(48 * H)), fitLead('b', plus(48 * H + 1)), fitLead('c', null)];
    const at = (now: string) => run({ ...base, calls, leads, emailEvents: [], now: new Date(now) }).insights.response48h;
    expect(at(plus(48 * H - 1))).toMatchObject({ within: 1, resolved: 1, pending: 2 }); // b (accepted 1 ms too late) and c are still open
    expect(at(plus(48 * H))).toMatchObject({ within: 1, resolved: 3, pending: 0 });
  });

  it('heatmap and after-hours edges in IST', () => {
    const calls = [
      call('sun2359', '2026-10-11T18:29:59.000Z'), // Sun 23:59:59 IST
      call('mon0000', '2026-10-11T18:30:00.000Z'), // Mon 00:00 IST
      call('mon1000', '2026-10-12T04:30:00.000Z'), // Mon 10:00 — open
      call('mon1859', '2026-10-12T13:29:59.000Z'), // Mon 18:59:59 — open
      call('mon1900', '2026-10-12T13:30:00.000Z'), // Mon 19:00 — closed
    ];
    const m = run({ ...base, calls, leads: [], emailEvents: [], now: new Date('2026-10-20T00:00:00Z') });
    expect(m.insights.heatmap[6][7]).toBe(1);
    expect(m.insights.heatmap[0][0]).toBe(1);
    expect(m.insights.heatmap[0][3]).toBe(1);
    expect(m.insights.heatmap[0][6]).toBe(2); // 18:59 and 19:00 share the 18–21 slot
    expect(m.rc1.afterHours).toBe(3); // Sun 23:59, Mon 00:00, Mon 19:00
  });

  it('survives leads whose designer was deleted, leads without a call row, and junk event meta', () => {
    const w = world(7, 30);
    w.leads.push({ ...w.leads[0], id: 'orphan', call_id: 'no-such-call', designer_id: 'ghost', email_sent_at: t0 });
    w.emailEvents.push({ id: 999, lead_id: 'orphan', call_id: null, type: 'email_sent', at: t0, meta: null });
    w.emailEvents.push({ id: 1000, lead_id: null, call_id: null, type: 'email_sent', at: t0, meta: 'weird' as unknown as null });
    expect(() => run(w)).not.toThrow();
    expect(badNumbers(run(w))).toEqual([]);
  });
});
