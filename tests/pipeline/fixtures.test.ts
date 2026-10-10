import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, loadFixture, loadTransferEvent } from '../helpers';
import { agentLines, parseTranscript } from '@/lib/transcript';
import { APPROVED_PRICE_RESPONSE, scanAgentLines } from '@/lib/priceScan';
import { mapEntities } from '@/lib/mapEntities';
import { FIXTURE_BOOKINGS } from '@/lib/adapters/mocks';

const EXPECTED_OUTCOME = {
  t01: 'booked', t13: 'booked', t10: 'declined', t09: 'existing_client_transferred',
  t09_failed: 'transfer_failed', t17: 'incomplete', price_leak: 'callback',
} as const;

describe('fixtures (SPEC §15)', () => {
  it('exist for every scenario', () => {
    const files = readdirSync('fixtures').filter((f) => f.endsWith('.json') && !f.includes('.transfer.')).map((f) => f.replace('.json', ''));
    expect(files.sort()).toEqual([...FIXTURE_NAMES].sort());
  });

  it.each(FIXTURE_NAMES)('%s is a well-formed call_postprocessing payload (shape per Vaani docs)', (name) => {
    const f = loadFixture(name);
    expect(f.event).toBe('call_postprocessing');
    expect(f.call_id).toBe(f.data.call_id);
    expect(f.data.room_name).toBe(f.call_id);
    expect(Number.isNaN(new Date(f.timestamp).getTime())).toBe(false);
    expect(f.data.call_duration).toBeGreaterThan(0);
    expect(f.data.recording_url).toContain(f.call_id);
    const lines = parseTranscript(f.data.transcript);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((l) => l.speaker !== 'OTHER' && l.time)).toBe(true);
  });

  it('all call ids are unique', () => {
    const ids = FIXTURE_NAMES.map((n) => loadFixture(n).call_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(FIXTURE_NAMES)('%s maps to the expected outcome', (name) => {
    expect(mapEntities(loadFixture(name).data.entities).outcome).toBe(EXPECTED_OUTCOME[name]);
  });

  it.each(FIXTURE_NAMES.filter((n) => n !== 'price_leak'))('%s: agent lines pass the price scanner', (name) => {
    expect(scanAgentLines(loadFixture(name).data.transcript)).toEqual({ flag: false, lines: [] });
  });

  it('price_leak: an agent line quotes a per-sq-ft figure and is flagged', () => {
    const r = scanAgentLines(loadFixture('price_leak').data.transcript);
    expect(r.flag).toBe(true);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/per sq ft/);
  });

  it('t13: the caller pushes for price twice and the agent deflects with the approved line', () => {
    const t = parseTranscript(loadFixture('t13').data.transcript);
    const priceAsks = t.filter((l) => l.speaker === 'USER' && /cost|range|ballpark/i.test(l.text));
    expect(priceAsks.length).toBeGreaterThanOrEqual(2);
    expect(agentLines(loadFixture('t13').data.transcript)).toContain(APPROVED_PRICE_RESPONSE);
  });

  it('t10: the caller states a budget but the agent never repeats a figure', () => {
    const f = loadFixture('t10');
    const userSaid = parseTranscript(f.data.transcript).filter((l) => l.speaker === 'USER').map((l) => l.text).join(' ');
    expect(userSaid).toMatch(/lakh/); // realistic: the caller's own words (decision D1)
    for (const line of agentLines(f.data.transcript)) {
      expect(line).not.toMatch(/\d/);
      expect(line).not.toMatch(/lakh/i);
    }
    expect(JSON.stringify(f.data.entities)).not.toMatch(/lakh|\d\.\d/);
    expect(f.data.summary).not.toMatch(/lakh|\d\.\d/);
  });

  it('t09_failed happens after hours and has a matching human_transfer_failed event', () => {
    const f = loadFixture('t09_failed');
    const t = loadTransferEvent('t09_failed');
    expect(t.event).toBe('human_transfer_failed');
    expect(t.room_name).toBe(f.call_id);
    expect(new Date(f.timestamp).toISOString()).toBe('2026-09-10T17:15:00.000Z'); // 22:45 IST
  });

  it('t01 and t13 slots match the mock Cal.com bookings', () => {
    for (const [name, uid] of [['t01', 'mock-cal-t01'], ['t13', 'mock-cal-t13']] as const) {
      const slot = mapEntities(loadFixture(name).data.entities).fields.booked_slot_start;
      expect(FIXTURE_BOOKINGS.find((b) => b.uid === uid)?.start).toBe(slot);
    }
  });

  it('contain no figure from Docs/pricing.md (CLAUDE.md rule)', () => {
    const pricing = readFileSync('Docs/pricing.md', 'utf8');
    const figures = [...new Set(pricing.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])]
      .filter((n) => Number(n.replace(/,/g, '')) >= 100); // amounts; small numbers checked with "lakh" below
    const lakhFigures = [...pricing.matchAll(/(\d+(?:\.\d+)?)\s*lakh/gi)].map((m) => m[1]);
    expect(figures.length).toBeGreaterThan(0);
    for (const name of FIXTURE_NAMES) {
      const text = readFileSync(`fixtures/${name}.json`, 'utf8');
      for (const fig of figures) {
        const digits = fig.replace(/,/g, '');
        const re = new RegExp(`(?<![\\d.,])${digits.split('').join(',?')}(?![\\d])`);
        expect(text, `${name} contains ${fig}`).not.toMatch(re);
      }
      for (const fig of lakhFigures) {
        expect(text, `${name} contains ${fig} lakh`).not.toMatch(new RegExp(`(?<![\\d.])${fig.replace('.', '\\.')}\\s*lakh`, 'i'));
      }
    }
  });
});
