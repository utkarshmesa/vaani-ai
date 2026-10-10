/**
 * Normalised view of a Vaani webhook body. Documented payloads nest the call fields under `data`
 * (NOTES.md §1.2); SPEC §5 describes them at the top level — both are accepted.
 * Transfer events carry `room_name` instead of `call_id` (NOTES.md §1.3).
 */
export interface VaaniEvent {
  event: string;
  callId: string | null;
  /** ISO timestamp from the payload, if valid */
  timestamp: string | null;
  data: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function readEvent(body: unknown): VaaniEvent {
  const top = isObject(body) ? body : {};
  const data = isObject(top.data) ? top.data : top;
  const ts = str(top.timestamp) ?? str(data.timestamp);
  return {
    event: str(top.event) ?? '',
    callId: str(top.call_id) ?? str(data.call_id) ?? str(top.room_name) ?? str(data.room_name),
    timestamp: ts && !Number.isNaN(new Date(ts).getTime()) ? new Date(ts).toISOString() : null,
    data,
  };
}

export function textField(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === 'string' ? v : null;
}

export function numberField(data: Record<string, unknown>, key: string): number | null {
  const v = typeof data[key] === 'string' ? Number(data[key]) : data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Vaani dispositions come back as "Yes"/"No" strings or booleans. */
export function isYes(v: unknown): boolean {
  return v === true || (typeof v === 'string' && /^(yes|true|y)$/i.test(v.trim()));
}
