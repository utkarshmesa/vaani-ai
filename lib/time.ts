import { formatInTimeZone } from 'date-fns-tz';

/** Aangan works in IST. Timestamps are stored as UTC instants; IST is for display and working-hours maths. */
export const TZ = 'Asia/Kolkata';

/** e.g. "Mon 7 Sep, 11:00 am" */
export function formatIst(at: Date | string, pattern = 'EEE d MMM, h:mm aaa'): string {
  return formatInTimeZone(new Date(at), TZ, pattern);
}

export function toIso(at: Date): string {
  return at.toISOString();
}
