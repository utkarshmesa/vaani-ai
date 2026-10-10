import type { LeadOutcome } from '@/lib/db/types';
import { DECLINE_REASONS, LEAD_FIELDS, type LeadFieldName } from '@/lib/leadSchema';

/** Lead columns produced from Vaani's extracted entities (booked_slot_iso becomes booked_slot_start). */
export interface LeadFields {
  caller_name: string | null;
  enquiry_type: string | null;
  locality: string | null;
  in_service_area: string | null;
  property_type: string | null;
  carpet_area_sqft: number | null;
  scope: string | null;
  completion_deadline: string | null;
  timeline_fit: string | null;
  decision_maker: string | null;
  budget_mentioned: string | null;
  outcome: LeadOutcome;
  decline_reason: string | null;
  booked_slot_start: string | null;
  callback_preference: string | null;
  notes_for_designer: string | null;
}

export interface MappedEntities {
  fields: LeadFields;
  outcome: LeadOutcome;
  /** Values that were present but unusable, e.g. an unknown enum value. */
  problems: string[];
}

/** Things extraction LLMs write when a value is absent. Not applied to enums ("none" is a real budget value). */
const PLACEHOLDERS = new Set([
  '', 'n/a', 'na', 'null', 'none', 'nil', 'unknown', '-', '--', 'not mentioned', 'not stated', 'not provided',
  'not specified', 'not available', 'transcript is not available for further evaluations.',
]);

const IST_OFFSET = '+05:30';

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
};

const enumKey = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Pure, tested mapping of Vaani `entities` → lead fields (SPEC §7.3a). */
export function mapEntities(entities: unknown): MappedEntities {
  const raw: Record<string, unknown> = {};
  if (entities && typeof entities === 'object' && !Array.isArray(entities)) {
    for (const [k, v] of Object.entries(entities)) raw[k.toLowerCase()] = v;
  }

  const problems: string[] = [];
  const out: Record<string, unknown> = {};

  for (const def of LEAD_FIELDS) {
    const name: LeadFieldName = def.name;
    const text = asText(raw[name]);

    if ('values' in def && def.values) {
      if (text === null || text === '' || text.toLowerCase() === 'null' || text.toLowerCase() === 'n/a') {
        out[name] = null;
        continue;
      }
      const key = enumKey(text);
      if ((def.values as readonly string[]).includes(key)) out[name] = key;
      else {
        out[name] = null;
        problems.push(`${name}: unexpected value "${text}"`);
      }
      continue;
    }

    const value = text === null || PLACEHOLDERS.has(text.toLowerCase()) ? null : text;

    if (name === 'carpet_area_sqft') {
      out[name] = value === null ? null : parseArea(value);
    } else if (name === 'booked_slot_iso') {
      const slot = value === null ? null : parseSlot(value);
      if (value !== null && slot === null) problems.push(`booked_slot_iso: not a date "${value}"`);
      out.booked_slot_start = slot;
    } else if (name === 'decline_reason') {
      out[name] = value === null ? null : normaliseDeclineReason(value);
    } else {
      out[name] = value;
    }
  }

  // Missing essentials (the two non-nullable fields) → incomplete.
  const outcome: LeadOutcome = out.outcome && out.enquiry_type ? (out.outcome as LeadOutcome) : 'incomplete';
  out.outcome = outcome;

  return { fields: out as unknown as LeadFields, outcome, problems };
}

function parseArea(s: string): number | null {
  const m = s.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ISO 8601; a value without an offset is read as IST (the prompt asks for +05:30). */
function parseSlot(s: string): string | null {
  let v = s.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) v += IST_OFFSET;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normaliseDeclineReason(s: string): string {
  const key = enumKey(s);
  return (DECLINE_REASONS as readonly string[]).includes(key) ? key : 'other';
}

/**
 * Whether the lead record holds what a designer needs (dashboard RC2 "complete lead records").
 * New enquiries need name, locality, property type, scope and deadline; others need a name.
 */
export function isCompleteRecord(f: LeadFields): boolean {
  if (f.outcome === 'incomplete' || !f.enquiry_type) return false;
  if (f.enquiry_type !== 'new_enquiry') return Boolean(f.caller_name);
  return Boolean(f.caller_name && f.locality && f.property_type && f.scope && f.completion_deadline);
}
