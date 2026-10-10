import { describe, expect, it } from 'vitest';
import { parseRange } from '@/lib/dashboard/range';
import { setNow } from '@/lib/clock';

describe('parseRange (IST dates, `to` inclusive)', () => {
  it('defaults to the current IST month', () => {
    setNow('2026-09-30T19:00:00.000Z'); // 1 Oct 00:30 IST
    const r = parseRange({});
    expect(r).toMatchObject({ fromStr: '2026-10-01', toStr: '2026-10-31', isCurrentMonth: true, label: 'October 2026' });
    expect(r.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it('accepts explicit dates', () => {
    setNow('2026-10-10T06:00:00.000Z');
    const r = parseRange({ from: '2026-09-01', to: '2026-09-07' });
    expect(r.from.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-07T18:30:00.000Z');
    expect(r.isCurrentMonth).toBe(false);
    expect(r.label).toBe('1 Sep 2026 – 7 Sep 2026');
  });

  it('a full month that is the current one counts as current', () => {
    setNow('2026-10-10T06:00:00.000Z');
    expect(parseRange({ from: '2026-10-01', to: '2026-10-31' }).isCurrentMonth).toBe(true);
  });

  it('falls back to the default for bad or reversed input', () => {
    setNow('2026-10-10T06:00:00.000Z');
    expect(parseRange({ from: 'nonsense', to: '2026-13-45' }).fromStr).toBe('2026-10-01');
    expect(parseRange({ from: '2026-09-10', to: '2026-09-01' }).fromStr).toBe('2026-10-01');
    expect(parseRange({ from: ['2026-09-01'] as unknown as string }).fromStr).toBe('2026-10-01');
  });
});
