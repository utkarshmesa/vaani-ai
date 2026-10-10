import { getAdapters } from '@/lib/adapters';
import { getRepo } from '@/lib/db';
import type { LeadRow } from '@/lib/db/types';
import { env } from '@/lib/env';
import { bookingSearchWindow, matchSlot } from '@/lib/slotMatch';
import { ATTENTION } from './attention';

/**
 * SPEC §7.3d: a "booked" outcome must exist in Cal.com within ±10 minutes of the slot.
 * Not found → treat as a callback that needs attention. If Cal.com can't be reached, the lead
 * still goes to a designer, flagged to verify the booking by hand.
 */
export async function confirmBooking(lead: LeadRow): Promise<LeadRow> {
  const repo = getRepo();
  if (lead.outcome !== 'booked' || lead.booking_confirmed) return lead;

  const downgrade = async (reason: string, meta: Record<string, string | null>) => {
    await repo.insertEvent({ type: 'booking_not_found', lead_id: lead.id, call_id: lead.call_id, meta: { reason, ...meta } });
    return repo.updateLead(lead.id, { outcome: 'callback', needs_attention: true, attention_reason: reason });
  };

  if (!lead.booked_slot_start) return downgrade(ATTENTION.bookingNotFound, { slot: null });

  const eventTypeId = env().CALCOM_EVENT_TYPE_ID;
  if (!eventTypeId) return downgrade(ATTENTION.calcomNotConfigured, { slot: lead.booked_slot_start });

  const slot = new Date(lead.booked_slot_start);
  let bookings;
  try {
    bookings = await getAdapters().calcom.listBookings({ eventTypeId, ...bookingSearchWindow(slot) });
  } catch (err) {
    return downgrade(ATTENTION.bookingCheckFailed, { slot: lead.booked_slot_start, error: String((err as Error)?.message ?? err) });
  }

  const match = matchSlot(bookings, slot);
  if (!match) return downgrade(ATTENTION.bookingNotFound, { slot: lead.booked_slot_start });

  await repo.insertEvent({ type: 'booking_confirmed', lead_id: lead.id, call_id: lead.call_id, meta: { uid: match.uid, start: match.start } });
  return repo.updateLead(lead.id, { booking_confirmed: true, cal_booking_uid: match.uid });
}
