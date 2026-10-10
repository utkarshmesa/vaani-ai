import { randomUUID } from 'node:crypto';
import { now } from '@/lib/clock';
import type { Repo } from './repo';
import { SEED_DESIGNERS, SEED_SETTINGS } from './seed';
import type { CallRow, DesignerRow, EventRow, LeadRow, SettingsRow } from './types';

const copy = <T>(v: T): T => structuredClone(v);
const inRange = (at: string, from?: Date, to?: Date) =>
  (!from || at >= from.toISOString()) && (!to || at < to.toISOString());

/** In-process implementation of Repo with the same defaults and constraints as the SQL schema. */
export function createMemoryRepo(): Repo {
  const designers = new Map<string, DesignerRow>(SEED_DESIGNERS.map((d) => [d.id, copy(d)]));
  const calls = new Map<string, CallRow>();
  const leads = new Map<string, LeadRow>();
  const events: EventRow[] = [];
  let settings: SettingsRow = copy(SEED_SETTINGS);
  let nextEventId = 1;

  const mustGet = <T>(m: Map<string, T>, id: string, what: string): T => {
    const v = m.get(id);
    if (!v) throw new Error(`${what} not found: ${id}`);
    return v;
  };

  return {
    async listDesigners() {
      return [...designers.values()].map(copy);
    },
    async getDesigner(id) {
      return copy(designers.get(id) ?? null);
    },
    async updateDesigner(id, patch) {
      const d = mustGet(designers, id, 'designer');
      Object.assign(d, copy(patch));
      return copy(d);
    },

    async getCall(callId) {
      return copy(calls.get(callId) ?? null);
    },
    async upsertCall(row) {
      const existing = calls.get(row.call_id);
      if (existing) {
        Object.assign(existing, copy(row));
        return copy(existing);
      }
      const created: CallRow = {
        received_at: now().toISOString(),
        from_number: null, duration_ms: null, transcript: null, summary: null, entities: null, dispositions: null,
        recording_url: null, vaani_credits: null, vaani_inr: null,
        gemini_input_tokens: 0, gemini_output_tokens: 0, gemini_inr: 0, total_inr: null,
        price_flag: false, price_flag_lines: [],
        processing_started_at: null, processed_at: null, processing_error: null,
        ...copy(row),
      };
      calls.set(row.call_id, created);
      return copy(created);
    },
    async updateCall(callId, patch) {
      const c = mustGet(calls, callId, 'call');
      Object.assign(c, copy(patch));
      return copy(c);
    },
    async claimCallProcessing(callId, staleBefore) {
      const c = calls.get(callId);
      if (!c || c.processed_at) return false;
      if (c.processing_started_at && c.processing_started_at >= staleBefore.toISOString()) return false;
      c.processing_started_at = now().toISOString();
      return true;
    },
    async listCalls(q = {}) {
      return [...calls.values()]
        .filter((c) => inRange(c.received_at, q.from, q.to))
        .filter((c) => !q.missingCost || c.vaani_credits === null)
        .map(copy);
    },

    async getLead(id) {
      return copy(leads.get(id) ?? null);
    },
    async getLeadByCallId(callId) {
      return copy([...leads.values()].find((l) => l.call_id === callId) ?? null);
    },
    async insertLead(row) {
      if (!calls.has(row.call_id)) throw new Error(`insert violates foreign key constraint: call ${row.call_id}`);
      if ([...leads.values()].some((l) => l.call_id === row.call_id)) {
        throw new Error(`duplicate key value violates unique constraint "leads_call_id_key"`);
      }
      const lead: LeadRow = {
        id: randomUUID(),
        caller_name: null, enquiry_type: null, locality: null, in_service_area: null, property_type: null,
        carpet_area_sqft: null, scope: null, completion_deadline: null, timeline_fit: null, decision_maker: null,
        budget_mentioned: null, decline_reason: null, callback_preference: null, notes_for_designer: null,
        booked_slot_start: null, booking_confirmed: false, cal_booking_uid: null,
        designer_id: null, brief_json: null, brief_text: null,
        clock_started_at: null, email_sent_at: null, reminder_sent_at: null, escalated_at: null, accepted_at: null,
        reassign_count: 0, consultation_outcome: null, outcome_requested_at: null, outcome_logged_at: null,
        needs_attention: false, attention_reason: null, created_at: now().toISOString(),
        ...copy(row),
      };
      leads.set(lead.id, lead);
      return copy(lead);
    },
    async updateLead(id, patch) {
      const l = mustGet(leads, id, 'lead');
      Object.assign(l, copy(patch));
      return copy(l);
    },
    async updateLeadIf(id, patch, whenNull) {
      const l = mustGet(leads, id, 'lead');
      if (whenNull.some((f) => l[f] !== null)) return null;
      Object.assign(l, copy(patch));
      return copy(l);
    },
    async listLeads(q = {}) {
      return [...leads.values()]
        .filter((l) => inRange(l.created_at, q.from, q.to))
        .filter((l) => !q.active || (l.designer_id !== null && l.outcome_logged_at === null))
        .map(copy);
    },

    async insertEvent(e) {
      const row: EventRow = {
        id: nextEventId++, lead_id: e.lead_id ?? null, call_id: e.call_id ?? null, type: e.type,
        at: e.at ?? now().toISOString(), meta: copy(e.meta ?? {}),
      };
      events.push(row);
      return copy(row);
    },
    async listEvents(q = {}) {
      return events
        .filter((e) => (q.callId === undefined || e.call_id === q.callId)
          && (q.leadId === undefined || e.lead_id === q.leadId)
          && (q.type === undefined || e.type === q.type)
          && inRange(e.at, q.from, q.to))
        .map(copy);
    },

    async getSettings() {
      return copy(settings);
    },
    async updateSettings(patch) {
      settings = { ...settings, ...copy(patch) };
      return copy(settings);
    },
  };
}
