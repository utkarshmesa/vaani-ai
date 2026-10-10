import type { DesignerRow, SettingsRow } from './types';

/**
 * Seed data. supabase/migrations/0002_seed.sql inserts exactly this (a migration test checks they match),
 * and the in-memory repo starts from it.
 *
 * Designer emails use the reserved .test TLD. For live Resend sandbox tests, update them to the Resend
 * account owner's address (SPEC §5).
 */
export const SEED_DESIGNERS: DesignerRow[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Ananya Kulkarni', email: 'ananya@aangan-studio.test', active: true, last_assigned_at: null },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Rohan Joshi', email: 'rohan@aangan-studio.test', active: true, last_assigned_at: null },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Meera Iyer', email: 'meera@aangan-studio.test', active: true, last_assigned_at: null },
];

/**
 * TODO(rates): placeholder cost rates until real values are confirmed (PLAN.md Q4). These are the tool's
 * running costs, not Aangan's prices.
 */
export const SEED_SETTINGS: SettingsRow = {
  credit_to_inr: 1,
  gemini_input_inr_per_mtok: 25,
  gemini_output_inr_per_mtok: 210,
  credits_loaded: 1000,
  low_balance_threshold_credits: 100,
  working_days: [1, 2, 3, 4, 5],
  work_start: '10:00',
  work_end: '19:00',
  reminder_minutes: 15,
  escalation_minutes: 30,
  low_balance_alerted_at: null,
};
