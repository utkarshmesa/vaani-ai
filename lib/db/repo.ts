import type {
  CallInsert, CallPatch, CallRow, DesignerRow, EventInsert, EventRow, LeadInsert, LeadPatch, LeadRow, SettingsRow,
} from './types';

export interface ListCallsQuery {
  /** received_at >= from */
  from?: Date;
  /** received_at < to */
  to?: Date;
  /** no confirmed Vaani cost yet: vaani_credits is null, or only an estimate */
  costPending?: boolean;
}

export interface ListLeadsQuery {
  /** created_at >= from */
  from?: Date;
  /** created_at < to */
  to?: Date;
  /** designer assigned and consultation outcome not yet logged — what the cron tick works on */
  active?: boolean;
}

export interface ListEventsQuery {
  callId?: string;
  leadId?: string;
  type?: string;
  from?: Date;
  to?: Date;
}

/**
 * Data access used by the pipeline, cron, click endpoints and dashboard.
 * Implemented by supabaseRepo (production) and memoryRepo (tests, local mock runs).
 * Results are ordered by insertion/creation time.
 */
export interface Repo {
  listDesigners(): Promise<DesignerRow[]>;
  getDesigner(id: string): Promise<DesignerRow | null>;
  updateDesigner(id: string, patch: Partial<Omit<DesignerRow, 'id'>>): Promise<DesignerRow>;

  getCall(callId: string): Promise<CallRow | null>;
  /** Insert, or merge the given fields into the existing row. */
  upsertCall(row: CallInsert): Promise<CallRow>;
  updateCall(callId: string, patch: CallPatch): Promise<CallRow>;
  /**
   * Atomically mark the call as being processed. Succeeds only if it is not processed yet and nobody holds a
   * claim newer than `staleBefore`. This is what makes duplicate webhooks safe.
   */
  claimCallProcessing(callId: string, staleBefore: Date): Promise<boolean>;
  listCalls(q?: ListCallsQuery): Promise<CallRow[]>;

  getLead(id: string): Promise<LeadRow | null>;
  getLeadByCallId(callId: string): Promise<LeadRow | null>;
  insertLead(row: LeadInsert): Promise<LeadRow>;
  updateLead(id: string, patch: LeadPatch): Promise<LeadRow>;
  /**
   * Apply the patch only if every field in `whenNull` is still null and every field in `whenEquals` still has that
   * value (an atomic compare-and-set). Returns the updated row, or null if not applied.
   */
  updateLeadIf(id: string, patch: LeadPatch, whenNull: (keyof LeadRow)[], whenEquals?: Partial<LeadRow>): Promise<LeadRow | null>;
  listLeads(q?: ListLeadsQuery): Promise<LeadRow[]>;

  insertEvent(e: EventInsert): Promise<EventRow>;
  listEvents(q?: ListEventsQuery): Promise<EventRow[]>;

  getSettings(): Promise<SettingsRow>;
  updateSettings(patch: Partial<SettingsRow>): Promise<SettingsRow>;
}
