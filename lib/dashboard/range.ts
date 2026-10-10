import { formatInTimeZone } from 'date-fns-tz';
import { now } from '@/lib/clock';
import { TZ } from '@/lib/time';

export interface DateRange {
  /** Inclusive start (00:00 IST on fromStr) */
  from: Date;
  /** Exclusive end (00:00 IST on the day after toStr) */
  to: Date;
  fromStr: string;
  toStr: string;
  label: string;
  isCurrentMonth: boolean;
}

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const istDate = (d: Date) => formatInTimeZone(d, TZ, 'yyyy-MM-dd');
const startOfIstDay = (s: string) => new Date(`${s}T00:00:00+05:30`);

function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE.test(v)) return null;
  const d = startOfIstDay(v);
  return !Number.isNaN(d.getTime()) && istDate(d) === v ? v : null;
}

function currentMonth(): { fromStr: string; toStr: string } {
  const today = istDate(now());
  const [y, m] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { fromStr: `${y}-${mm}-01`, toStr: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}

/** Dashboard date filter (SPEC §14): IST calendar dates, `to` inclusive; default is the current month. */
export function parseRange(params: { from?: unknown; to?: unknown }): DateRange {
  const month = currentMonth();
  let fromStr = validDate(params.from);
  let toStr = validDate(params.to);
  if (!fromStr && !toStr) ({ fromStr, toStr } = month);
  fromStr ??= toStr!;
  toStr ??= fromStr;
  if (toStr < fromStr) ({ fromStr, toStr } = month);

  const isCurrentMonth = fromStr === month.fromStr && toStr === month.toStr;
  const from = startOfIstDay(fromStr);
  const to = new Date(startOfIstDay(toStr).getTime() + DAY_MS);
  const label = isCurrentMonth
    ? formatInTimeZone(from, TZ, 'MMMM yyyy')
    : `${formatInTimeZone(from, TZ, 'd MMM yyyy')} – ${formatInTimeZone(startOfIstDay(toStr), TZ, 'd MMM yyyy')}`;
  return { from, to, fromStr, toStr, label, isCurrentMonth };
}

/** Quick period links for the dashboard header (IST calendar dates). */
export function presetRanges(): { label: string; from: string; to: string }[] {
  const today = istDate(now());
  const [y, m] = today.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthEnd = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  const weekAgo = istDate(new Date(startOfIstDay(today).getTime() - 6 * DAY_MS));
  return [
    { label: 'This month', from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(monthEnd(y, m))}` },
    { label: 'Last month', from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(monthEnd(py, pm))}` },
    { label: 'Last 7 days', from: weekAgo, to: today },
  ];
}
