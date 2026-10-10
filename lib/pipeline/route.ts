import type { CallRow, LeadRow, SettingsRow } from '@/lib/db/types';
import { isWorkingTime } from '@/lib/workingHours';
import { confirmBooking } from './confirmBooking';
import { handoff } from './handoff';
import { sendUrgent } from './urgent';

/** SPEC §7.3d — route a processed call by its outcome. Returns the updated lead. */
export async function routeLead(lead: LeadRow, call: CallRow, settings: SettingsRow): Promise<LeadRow> {
  if (lead.outcome === 'booked') lead = await confirmBooking(lead);

  switch (lead.outcome) {
    case 'booked':
    case 'callback':
      return handoff(lead, call, settings);
    case 'transfer_failed':
      return sendUrgent('transfer_failed', lead, call);
    case 'existing_client_transferred':
      return isWorkingTime(new Date(call.received_at), settings) ? lead : sendUrgent('existing_client_after_hours', lead, call);
    case 'incomplete':
      return sendUrgent('call_dropped', lead, call);
    case 'declined':
    case 'other':
      return lead; // record only
  }
}
