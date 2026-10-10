import type { SettingsRow } from '@/lib/db/types';

/**
 * Working-hours clock (SPEC §13). Reminder and escalation minutes count only inside working hours
 * (default Mon–Fri 10:00–19:00 IST, from settings). IST has no DST, so a fixed +05:30 offset is exact.
 * Public holidays are out of scope.
 */
export type WorkingHours = Pick<SettingsRow, 'working_days' | 'work_start' | 'work_end'>;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
/** Safety bound for loops: no realistic gap between working periods exceeds this. */
const MAX_DAYS = 400;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** UTC instant of 00:00 IST on the IST calendar day containing t. */
function istDayStart(t: number): number {
  return Math.floor((t + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

/** ISO weekday (Mon = 1 … Sun = 7) of the IST day starting at dayStart. */
function isoWeekday(dayStart: number): number {
  const d = new Date(dayStart + IST_OFFSET_MS).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The working period [start, end) on the IST day starting at dayStart, or null if not a working day. */
function periodOn(dayStart: number, s: WorkingHours): [number, number] | null {
  if (!s.working_days.includes(isoWeekday(dayStart))) return null;
  return [dayStart + minutesOf(s.work_start) * 60_000, dayStart + minutesOf(s.work_end) * 60_000];
}

export function isWorkingTime(at: Date, s: WorkingHours): boolean {
  const t = at.getTime();
  const p = periodOn(istDayStart(t), s);
  return p !== null && t >= p[0] && t < p[1];
}

/** SPEC §13: the email time if inside working hours, else the start of the next working period. */
export function clockStart(at: Date, s: WorkingHours): Date {
  return addWorkingMinutes(at, 0, s);
}

/** Minutes between a and b that fall inside working hours (0 if b <= a). */
export function workingMinutesBetween(a: Date, b: Date, s: WorkingHours): number {
  const from = a.getTime();
  const to = b.getTime();
  if (to <= from) return 0;
  let total = 0;
  for (let day = istDayStart(from), i = 0; day < to && i < MAX_DAYS * 10; day += DAY_MS, i++) {
    const p = periodOn(day, s);
    if (!p) continue;
    const start = Math.max(p[0], from);
    const end = Math.min(p[1], to);
    if (end > start) total += end - start;
  }
  return total / 60_000;
}

/** The instant at which `minutes` working minutes have elapsed since `at`. */
export function addWorkingMinutes(at: Date, minutes: number, s: WorkingHours): Date {
  let remaining = minutes * 60_000;
  let cursor = at.getTime();
  for (let i = 0; i < MAX_DAYS; i++) {
    const day = istDayStart(cursor);
    const p = periodOn(day, s);
    if (p && cursor < p[1]) {
      if (cursor < p[0]) cursor = p[0];
      const available = p[1] - cursor;
      if (remaining <= available) return new Date(cursor + remaining);
      remaining -= available;
    }
    cursor = day + DAY_MS;
  }
  throw new Error('addWorkingMinutes: no working period found — check settings.working_days');
}

/** `hhmm` IST on the first working day strictly after the IST day of `at` (e.g. outcome requests at 10:00). */
export function nextWorkingDayAt(at: Date, hhmm: string, s: WorkingHours): Date {
  let day = istDayStart(at.getTime());
  for (let i = 0; i < MAX_DAYS; i++) {
    day += DAY_MS;
    if (s.working_days.includes(isoWeekday(day))) return new Date(day + minutesOf(hhmm) * 60_000);
  }
  throw new Error('nextWorkingDayAt: no working day found — check settings.working_days');
}
