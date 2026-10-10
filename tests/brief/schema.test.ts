import { describe, expect, it } from 'vitest';
import { BRIEF_JSON_SCHEMA, CRITERIA, parseBrief } from '@/lib/brief/schema';
import { briefToText } from '@/lib/brief/render';
import { VALID_BRIEF } from './validBrief';

describe('Brief schema (SPEC §11)', () => {
  it('accepts a valid brief', () => {
    expect(parseBrief(JSON.stringify(VALID_BRIEF))).toEqual({ ok: true, brief: VALID_BRIEF });
  });

  it('rejects non-JSON and missing fields', () => {
    expect(parseBrief('not json').ok).toBe(false);
    const { suggested_opening: _s, ...missing } = VALID_BRIEF;
    expect(parseBrief(JSON.stringify(missing)).ok).toBe(false);
  });

  it('requires exactly the five rubric criteria, once each', () => {
    expect(CRITERIA).toEqual(['real_project', 'service_area', 'timeline', 'budget', 'decision_maker']);
    const four = { ...VALID_BRIEF, criteria: VALID_BRIEF.criteria.slice(0, 4) };
    expect(parseBrief(JSON.stringify(four)).ok).toBe(false);
    const dup = { ...VALID_BRIEF, criteria: [...VALID_BRIEF.criteria.slice(0, 4), { ...VALID_BRIEF.criteria[0] }] };
    expect(parseBrief(JSON.stringify(dup)).ok).toBe(false);
  });

  it('only allows met | unclear | not_met', () => {
    const bad = { ...VALID_BRIEF, criteria: VALID_BRIEF.criteria.map((c, i) => (i === 0 ? { ...c, status: 'maybe' } : c)) };
    expect(parseBrief(JSON.stringify(bad)).ok).toBe(false);
  });

  it('accepts a brief wrapped in a ```json fence', () => {
    expect(parseBrief('```json\n' + JSON.stringify(VALID_BRIEF) + '\n```').ok).toBe(true);
  });

  it('exposes a plain JSON schema for Gemini covering every field', () => {
    expect(BRIEF_JSON_SCHEMA.type).toBe('object');
    expect(Object.keys(BRIEF_JSON_SCHEMA.properties).sort()).toEqual(Object.keys(VALID_BRIEF).sort());
    expect([...BRIEF_JSON_SCHEMA.required].sort()).toEqual(Object.keys(VALID_BRIEF).sort());
  });
});

describe('briefToText', () => {
  it('renders every section, labelled', () => {
    const t = briefToText(VALID_BRIEF);
    expect(t).toContain('Priya · Kothrud · apartment');
    expect(t).toContain('Real project: met — "We want to redo the whole thing."');
    expect(t).toContain('Uncertainties:\n- Budget not discussed');
    expect(t).toContain('Suggested opening: What do you like least');
    expect(t).toContain('Consultation booked: Mon 7 Sep, 11:00 am');
    expect(t).not.toContain('Caller-stated budget');
  });

  it("shows the caller's own budget clearly attributed (decision D1)", () => {
    expect(briefToText({ ...VALID_BRIEF, caller_stated_budget: '18 to 22 lakh for the full scope' }))
      .toContain('Caller-stated budget (their words): 18 to 22 lakh for the full scope');
  });
});
