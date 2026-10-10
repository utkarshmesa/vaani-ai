import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { now } from '@/lib/clock';
import type { Repo } from './repo';
import type { CallRow, DesignerRow, EventRow, LeadRow, SettingsRow } from './types';

const TIMESTAMP_COLUMNS = new Set([
  'last_assigned_at', 'received_at', 'processing_started_at', 'processed_at', 'booked_slot_start',
  'clock_started_at', 'email_sent_at', 'reminder_sent_at', 'escalated_at', 'accepted_at',
  'outcome_requested_at', 'outcome_logged_at', 'created_at', 'at', 'low_balance_alerted_at',
]);
const NUMERIC_COLUMNS = new Set([
  'vaani_credits', 'vaani_inr', 'gemini_inr', 'total_inr', 'carpet_area_sqft', 'credit_to_inr',
  'gemini_input_inr_per_mtok', 'gemini_output_inr_per_mtok', 'credits_loaded', 'low_balance_threshold_credits',
]);

/** Make PostgREST output match memoryRepo: ISO-Z timestamps, numbers for numeric, "HH:MM" times. */
function normalise<T>(row: Record<string, unknown> | null): T | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && TIMESTAMP_COLUMNS.has(k)) out[k] = new Date(v as string).toISOString();
    else if (v !== null && NUMERIC_COLUMNS.has(k)) out[k] = Number(v);
    else if (v !== null && (k === 'work_start' || k === 'work_end')) out[k] = String(v).slice(0, 5);
    else out[k] = v;
  }
  return out as T;
}

function check<T>(res: { data: T; error: PostgrestError | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function createSupabaseRepo(url: string, serviceRoleKey: string, client?: SupabaseClient): Repo {
  const db = client ?? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const one = <T>(data: unknown) => normalise<T>(data as Record<string, unknown> | null);
  const many = <T>(data: unknown) => ((data as Record<string, unknown>[] | null) ?? []).map((r) => normalise<T>(r) as T);

  return {
    async listDesigners() {
      return many<DesignerRow>(check(await db.from('designers').select('*').order('id'), 'listDesigners'));
    },
    async getDesigner(id) {
      return one<DesignerRow>(check(await db.from('designers').select('*').eq('id', id).maybeSingle(), 'getDesigner'));
    },
    async updateDesigner(id, patch) {
      return one<DesignerRow>(check(await db.from('designers').update(patch).eq('id', id).select().single(), 'updateDesigner'))!;
    },

    async getCall(callId) {
      return one<CallRow>(check(await db.from('calls').select('*').eq('call_id', callId).maybeSingle(), 'getCall'));
    },
    async upsertCall(row) {
      return one<CallRow>(check(await db.from('calls').upsert(row, { onConflict: 'call_id' }).select().single(), 'upsertCall'))!;
    },
    async updateCall(callId, patch) {
      return one<CallRow>(check(await db.from('calls').update(patch).eq('call_id', callId).select().single(), 'updateCall'))!;
    },
    async claimCallProcessing(callId, staleBefore) {
      const data = check(
        await db.from('calls')
          .update({ processing_started_at: now().toISOString() })
          .eq('call_id', callId)
          .is('processed_at', null)
          .or(`processing_started_at.is.null,processing_started_at.lt.${staleBefore.toISOString()}`)
          .select('call_id'),
        'claimCallProcessing',
      );
      return (data?.length ?? 0) > 0;
    },
    async listCalls(q = {}) {
      let query = db.from('calls').select('*').order('received_at');
      if (q.from) query = query.gte('received_at', q.from.toISOString());
      if (q.to) query = query.lt('received_at', q.to.toISOString());
      if (q.missingCost) query = query.is('vaani_credits', null);
      return many<CallRow>(check(await query, 'listCalls'));
    },

    async getLead(id) {
      return one<LeadRow>(check(await db.from('leads').select('*').eq('id', id).maybeSingle(), 'getLead'));
    },
    async getLeadByCallId(callId) {
      return one<LeadRow>(check(await db.from('leads').select('*').eq('call_id', callId).maybeSingle(), 'getLeadByCallId'));
    },
    async insertLead(row) {
      return one<LeadRow>(check(await db.from('leads').insert(row).select().single(), 'insertLead'))!;
    },
    async updateLead(id, patch) {
      return one<LeadRow>(check(await db.from('leads').update(patch).eq('id', id).select().single(), 'updateLead'))!;
    },
    async updateLeadIf(id, patch, whenNull) {
      let query = db.from('leads').update(patch).eq('id', id);
      for (const f of whenNull) query = query.is(f, null);
      const data = check(await query.select(), 'updateLeadIf');
      return data && data.length ? one<LeadRow>(data[0]) : null;
    },
    async listLeads(q = {}) {
      let query = db.from('leads').select('*').order('created_at');
      if (q.from) query = query.gte('created_at', q.from.toISOString());
      if (q.to) query = query.lt('created_at', q.to.toISOString());
      if (q.active) query = query.not('designer_id', 'is', null).is('outcome_logged_at', null);
      return many<LeadRow>(check(await query, 'listLeads'));
    },

    async insertEvent(e) {
      const row = { lead_id: e.lead_id ?? null, call_id: e.call_id ?? null, type: e.type, meta: e.meta ?? {}, at: e.at ?? now().toISOString() };
      return one<EventRow>(check(await db.from('events').insert(row).select().single(), 'insertEvent'))!;
    },
    async listEvents(q = {}) {
      let query = db.from('events').select('*').order('id');
      if (q.callId !== undefined) query = query.eq('call_id', q.callId);
      if (q.leadId !== undefined) query = query.eq('lead_id', q.leadId);
      if (q.type !== undefined) query = query.eq('type', q.type);
      if (q.from) query = query.gte('at', q.from.toISOString());
      if (q.to) query = query.lt('at', q.to.toISOString());
      return many<EventRow>(check(await query, 'listEvents'));
    },

    async getSettings() {
      const data = check(await db.from('settings').select('*').eq('id', 1).single(), 'getSettings') as Record<string, unknown>;
      const { id: _id, ...rest } = normalise<Record<string, unknown>>(data)!;
      return rest as unknown as SettingsRow;
    },
    async updateSettings(patch) {
      const data = check(await db.from('settings').update(patch).eq('id', 1).select().single(), 'updateSettings') as Record<string, unknown>;
      const { id: _id, ...rest } = normalise<Record<string, unknown>>(data)!;
      return rest as unknown as SettingsRow;
    },
  };
}
