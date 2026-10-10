import { describe, expect, it } from 'vitest';
import {
  addWorkingMinutes, clockStart, isWorkingTime, nextWorkingDayAt, workingMinutesBetween, type WorkingHours,
} from '@/lib/workingHours';

const S: WorkingHours = { working_days: [1, 2, 3, 4, 5], work_start: '10:00', work_end: '19:00' };
/** IST wall-clock time → Date. 2026-09-07 is a Monday; 09-11 Friday; 09-12 Saturday. */
const ist = (s: string) => new Date(`${s}:00+05:30`);
const iso = (d: Date) => d.toISOString();

describe('isWorkingTime', () => {
  it('is true inside Mon–Fri 10:00–19:00 IST only', () => {
    expect(isWorkingTime(ist('2026-09-07T10:00'), S)).toBe(true);
    expect(isWorkingTime(ist('2026-09-07T18:59'), S)).toBe(true);
    expect(isWorkingTime(ist('2026-09-07T19:00'), S)).toBe(false);
    expect(isWorkingTime(ist('2026-09-07T09:59'), S)).toBe(false);
    expect(isWorkingTime(ist('2026-09-12T12:00'), S)).toBe(false); // Saturday
  });

  it('uses IST, not the server timezone (04:30Z is 10:00 IST)', () => {
    expect(isWorkingTime(new Date('2026-09-07T04:30:00Z'), S)).toBe(true);
    expect(isWorkingTime(new Date('2026-09-07T04:29:00Z'), S)).toBe(false);
  });
});

describe('clockStart', () => {
  it('starts immediately inside working hours', () => {
    expect(iso(clockStart(ist('2026-09-07T11:32'), S))).toBe(iso(ist('2026-09-07T11:32')));
  });

  it('a lead created at 23:00 starts at 10:00 the next working day (SPEC §18)', () => {
    expect(iso(clockStart(ist('2026-09-07T23:00'), S))).toBe(iso(ist('2026-09-08T10:00')));
  });

  it('early morning starts at 10:00 the same day', () => {
    expect(iso(clockStart(ist('2026-09-08T06:15'), S))).toBe(iso(ist('2026-09-08T10:00')));
  });

  it('Friday evening and the weekend roll to Monday 10:00', () => {
    expect(iso(clockStart(ist('2026-09-11T19:30'), S))).toBe(iso(ist('2026-09-14T10:00')));
    expect(iso(clockStart(ist('2026-09-12T12:00'), S))).toBe(iso(ist('2026-09-14T10:00')));
    expect(iso(clockStart(ist('2026-09-13T23:59'), S))).toBe(iso(ist('2026-09-14T10:00')));
  });

  it('exactly 19:00 is outside hours', () => {
    expect(iso(clockStart(ist('2026-09-07T19:00'), S))).toBe(iso(ist('2026-09-08T10:00')));
  });
});

describe('workingMinutesBetween', () => {
  it('counts plain minutes within one working period', () => {
    expect(workingMinutesBetween(ist('2026-09-07T11:00'), ist('2026-09-07T11:15'), S)).toBe(15);
  });

  it('skips nights', () => {
    expect(workingMinutesBetween(ist('2026-09-07T18:50'), ist('2026-09-08T10:05'), S)).toBe(15);
  });

  it('skips weekends', () => {
    expect(workingMinutesBetween(ist('2026-09-11T18:50'), ist('2026-09-14T10:05'), S)).toBe(15);
  });

  it('is 0 when both ends are outside hours on the same night, or b <= a', () => {
    expect(workingMinutesBetween(ist('2026-09-07T20:00'), ist('2026-09-08T09:00'), S)).toBe(0);
    expect(workingMinutesBetween(ist('2026-09-07T12:00'), ist('2026-09-07T11:00'), S)).toBe(0);
  });

  it('counts a full working day as 540 minutes', () => {
    expect(workingMinutesBetween(ist('2026-09-07T00:00'), ist('2026-09-08T00:00'), S)).toBe(540);
  });
});

describe('addWorkingMinutes', () => {
  it('adds within the day', () => {
    expect(iso(addWorkingMinutes(ist('2026-09-07T11:00'), 30, S))).toBe(iso(ist('2026-09-07T11:30')));
  });

  it('Friday 18:50 + 15 working minutes is Monday 10:05', () => {
    expect(iso(addWorkingMinutes(ist('2026-09-11T18:50'), 15, S))).toBe(iso(ist('2026-09-14T10:05')));
  });

  it('starting outside hours counts from the next period', () => {
    expect(iso(addWorkingMinutes(ist('2026-09-07T23:00'), 30, S))).toBe(iso(ist('2026-09-08T10:30')));
  });

  it('is the inverse of workingMinutesBetween', () => {
    const a = ist('2026-09-10T17:20');
    for (const m of [0, 1, 15, 30, 100, 540, 1000]) {
      expect(workingMinutesBetween(a, addWorkingMinutes(a, m, S), S)).toBe(m);
    }
  });
});

describe('nextWorkingDayAt', () => {
  it('returns 10:00 on the next working day after the given time', () => {
    expect(iso(nextWorkingDayAt(ist('2026-09-07T11:00'), '10:00', S))).toBe(iso(ist('2026-09-08T10:00')));
  });

  it('skips the weekend (Friday slot → Monday)', () => {
    expect(iso(nextWorkingDayAt(ist('2026-09-11T16:00'), '10:00', S))).toBe(iso(ist('2026-09-14T10:00')));
  });

  it('a Saturday slot → Monday', () => {
    expect(iso(nextWorkingDayAt(ist('2026-09-12T11:00'), '10:00', S))).toBe(iso(ist('2026-09-14T10:00')));
  });

  it('works for a late-night IST time that is still the previous day in UTC', () => {
    // 2026-09-08 01:00 IST = 2026-09-07 19:30Z → next working day after Tue 8th is Wed 9th
    expect(iso(nextWorkingDayAt(ist('2026-09-08T01:00'), '10:00', S))).toBe(iso(ist('2026-09-09T10:00')));
  });
});

describe('custom settings', () => {
  it('respects other working days and hours', () => {
    const six: WorkingHours = { working_days: [1, 2, 3, 4, 5, 6], work_start: '09:30', work_end: '18:00' };
    expect(isWorkingTime(ist('2026-09-12T12:00'), six)).toBe(true);
    expect(iso(clockStart(ist('2026-09-12T18:00'), six))).toBe(iso(ist('2026-09-14T09:30')));
  });
});
