import { describe, expect, it } from 'vitest';
import { bookingSearchWindow, matchSlot } from '@/lib/slotMatch';
import type { CalBooking } from '@/lib/adapters/types';

const SLOT = new Date('2026-09-07T05:30:00.000Z'); // Mon 11:00 IST
const b = (uid: string, start: string, status = 'accepted', minutes = 45): CalBooking => ({
  uid, start, end: new Date(new Date(start).getTime() + minutes * 60_000).toISOString(), status, eventTypeId: 1001,
});

describe('matchSlot', () => {
  it('finds a booking at exactly the slot', () => {
    expect(matchSlot([b('x', '2026-09-07T05:30:00.000Z')], SLOT)?.uid).toBe('x');
  });

  it('accepts ±10 minutes inclusive, rejects beyond', () => {
    expect(matchSlot([b('early', '2026-09-07T05:20:00.000Z')], SLOT)?.uid).toBe('early');
    expect(matchSlot([b('late', '2026-09-07T05:40:00.000Z')], SLOT)?.uid).toBe('late');
    expect(matchSlot([b('too-early', '2026-09-07T05:19:59.000Z')], SLOT)).toBeNull();
    expect(matchSlot([b('too-late', '2026-09-07T05:40:01.000Z')], SLOT)).toBeNull();
  });

  it('prefers the closest booking', () => {
    const out = matchSlot([b('far', '2026-09-07T05:38:00.000Z'), b('near', '2026-09-07T05:31:00.000Z')], SLOT);
    expect(out?.uid).toBe('near');
  });

  it('ignores cancelled and rejected bookings, accepts pending ones', () => {
    expect(matchSlot([b('c', '2026-09-07T05:30:00.000Z', 'cancelled'), b('r', '2026-09-07T05:30:00.000Z', 'rejected')], SLOT)).toBeNull();
    expect(matchSlot([b('p', '2026-09-07T05:30:00.000Z', 'pending')], SLOT)?.uid).toBe('p');
    expect(matchSlot([b('a', '2026-09-07T05:30:00.000Z', 'ACCEPTED')], SLOT)?.uid).toBe('a');
  });

  it('supports a custom tolerance', () => {
    expect(matchSlot([b('x', '2026-09-07T05:35:00.000Z')], SLOT, { toleranceMin: 2 })).toBeNull();
  });
});

describe('bookingSearchWindow', () => {
  it('covers bookings starting within −10 min and ending well after the slot (Cal.com filters beforeEnd on the END time)', () => {
    const w = bookingSearchWindow(SLOT);
    expect(w.afterStart.toISOString()).toBe('2026-09-07T05:20:00.000Z');
    expect(w.beforeEnd.toISOString()).toBe('2026-09-07T09:40:00.000Z');
    // A 2-hour consultation starting 10 min late still fits the query window.
    const long = b('long', '2026-09-07T05:40:00.000Z', 'accepted', 120);
    expect(new Date(long.end) <= w.beforeEnd).toBe(true);
  });
});
