/** `leads.attention_reason` values. Shown on the dashboard's Needs-attention list. */
export const ATTENTION = {
  bookingNotFound: 'Booking not found — rebook',
  bookingCheckFailed: 'Could not check Cal.com — verify the booking',
  transferFailed: 'Transfer failed — call back urgently',
  existingClientAfterHours: 'Existing client called after hours — call back',
  callDropped: 'Call dropped — call back',
  noDesigner: 'No active designer to assign',
} as const;
