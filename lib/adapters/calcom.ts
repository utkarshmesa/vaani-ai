import { requestJson } from './http';
import type { CalBooking, CalcomAdapter, FetchLike } from './types';

const BASE_URL = 'https://api.cal.com';
/** Required for GET /v2/bookings (verified live 2026-10-10, NOTES.md §7). */
const BOOKINGS_API_VERSION = '2026-05-01';

interface RawBooking {
  uid: string;
  start: string;
  end: string;
  status: string;
  eventType?: { id?: number } | null;
  eventTypeId?: number | null;
  attendees?: { name?: string; email?: string }[];
}

interface RawPage {
  data?: RawBooking[];
  pagination?: { nextCursor?: string | null; hasMore?: boolean };
}

export function createCalcomAdapter(opts: { apiKey: string; baseUrl?: string; fetch?: FetchLike }): CalcomAdapter {
  const base = (opts.baseUrl ?? BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetch ?? fetch;
  const headers = { Authorization: `Bearer ${opts.apiKey}`, 'cal-api-version': BOOKINGS_API_VERSION };

  return {
    async listBookings({ eventTypeId, afterStart, beforeEnd }) {
      const out: CalBooking[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const params = new URLSearchParams({
          eventTypeId: String(eventTypeId),
          afterStart: afterStart.toISOString(),
          beforeEnd: beforeEnd.toISOString(),
          sortStart: 'asc',
          limit: '100',
        });
        if (cursor) params.set('cursor', cursor);
        const res: RawPage = await requestJson<RawPage>('Cal.com', fetchImpl, `${base}/v2/bookings?${params}`, { method: 'GET', headers });
        for (const b of res?.data ?? []) out.push(normalise(b));
        cursor = res?.pagination?.nextCursor ?? null;
        if (!res?.pagination?.hasMore || !cursor) break;
      }
      return out;
    },
  };
}

function normalise(b: RawBooking): CalBooking {
  return {
    uid: b.uid,
    start: b.start,
    end: b.end,
    status: b.status,
    eventTypeId: b.eventType?.id ?? b.eventTypeId ?? null,
    attendeeName: b.attendees?.[0]?.name,
    attendeeEmail: b.attendees?.[0]?.email,
  };
}
