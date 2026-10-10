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
  'gemini_input_inr_per_mtok', 'vaani_inr_per_minute_estimate', 'gemini_output_inr_per_mtok', 'credits_loaded', 'low_balance_threshold_credits',
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

/** PostgREST returns at most 1000 rows per request (Supabase default max-rows). */
export const PAGE_SIZE = 1000;

type PageResult = { data: unknown[] | null; error: PostgrestError | null };

/**
 * Fetch every row of a list query by requesting consecutive ranges until a short page comes back.
 * Without this, lists silently stop at 1000 rows — and, ordered oldest first, it is the newest that go missing.
 */
export async function fetchAllPages(page: (from: number, to: number) => PromiseLike<PageResult>, what: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return out;
  }
}

export function createSupabaseRepo(url: string, serviceRoleKey: string, client?: SupabaseClient): Repo {
  const db = client ?? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const one = <T>(data: unknown) => normalise<T>(data as Record<string, unknown> | null);
  const many = <T>(data: unknown) => ((data as Record<string, unknown>[] | null) ?? []).map((r) => normalise<T>(r) as T);

  return {
    async listDesigners() {
      return many<DesignerRow>(await fetchAllPages((a, b) => db.from('designers').select('*').order('id').range(a, b), 'listDesigners'));
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
      const query = (a: number, b: number) => {
        let qb = db.from('calls').select('*').order('received_at').order('call_id');
        if (q.from) qb = qb.gte('received_at', q.from.toISOString());
        if (q.to) qb = qb.lt('received_at', q.to.toISOString());
        if (q.costPending) qb = qb.or('vaani_credits.is.null,cost_estimated.eq.true');
        return qb.range(a, b);
      };
      return many<CallRow>(await fetchAllPages(query, 'listCalls'));
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
    async updateLeadIf(id, patch, whenNull, whenEquals = {}) {
      let query = db.from('leads').update(patch).eq('id', id);
      for (const f of whenNull) query = query.is(f, null);
      for (const [f, v] of Object.entries(whenEquals)) query = query.eq(f, v as string);
      const data = check(await query.select(), 'updateLeadIf');
      return data && data.length ? one<LeadRow>(data[0]) : null;
    },
    async listLeads(q = {}) {
      const query = (a: number, b: number) => {
        let qb = db.from('leads').select('*').order('created_at').order('id');
        if (q.from) qb = qb.gte('created_at', q.from.toISOString());
        if (q.to) qb = qb.lt('created_at', q.to.toISOString());
        if (q.active) qb = qb.not('designer_id', 'is', null).is('outcome_logged_at', null);
        return qb.range(a, b);
      };
      return many<LeadRow>(await fetchAllPages(query, 'listLeads'));
    },

    async insertEvent(e) {
      const row = { lead_id: e.lead_id ?? null, call_id: e.call_id ?? null, type: e.type, meta: e.meta ?? {}, at: e.at ?? now().toISOString() };
      return one<EventRow>(check(await db.from('events').insert(row).select().single(), 'insertEvent'))!;
    },
    async listEvents(q = {}) {
      const query = (a: number, b: number) => {
        let qb = db.from('events').select('*').order('id');
        if (q.callId !== undefined) qb = qb.eq('call_id', q.callId);
        if (q.leadId !== undefined) qb = qb.eq('lead_id', q.leadId);
        if (q.type !== undefined) qb = qb.eq('type', q.type);
        if (q.from) qb = qb.gte('at', q.from.toISOString());
        if (q.to) qb = qb.lt('at', q.to.toISOString());
        return qb.range(a, b);
      };
      return many<EventRow>(await fetchAllPages(query, 'listEvents'));
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
