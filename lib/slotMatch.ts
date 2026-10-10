import type { CalBooking } from '@/lib/adapters/types';

const LIVE_STATUSES = new Set(['accepted', 'pending', 'awaiting_host']);
/** Longest consultation we expect; only widens the query, the match itself is on start time. */
const MAX_BOOKING_MS = 4 * 60 * 60_000;

/**
 * Query window for Cal.com. `beforeEnd` filters on the booking's END, so a strict "slot + 10 min" would miss a
 * normal consultation (NOTES.md §2.1). Query wide, then matchSlot() applies ±10 min on the start.
 */
export function bookingSearchWindow(slotStart: Date, toleranceMin = 10): { afterStart: Date; beforeEnd: Date } {
  const tol = toleranceMin * 60_000;
  return {
    afterStart: new Date(slotStart.getTime() - tol),
    beforeEnd: new Date(slotStart.getTime() + tol + MAX_BOOKING_MS),
  };
}

/** SPEC §7.3d: a live booking whose start is within ±tolerance of the slot; the closest wins. */
export function matchSlot(bookings: CalBooking[], slotStart: Date, opts: { toleranceMin?: number } = {}): CalBooking | null {
  const tol = (opts.toleranceMin ?? 10) * 60_000;
  let best: CalBooking | null = null;
  let bestDiff = Infinity;
  for (const b of bookings) {
    if (!LIVE_STATUSES.has(b.status.toLowerCase())) continue;
    const diff = Math.abs(new Date(b.start).getTime() - slotStart.getTime());
    if (diff <= tol && diff < bestDiff) {
      best = b;
      bestDiff = diff;
    }
  }
  return best;
}
