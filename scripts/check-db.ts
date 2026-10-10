/**
 * npm run db:check — read-only smoke test of the Supabase repo against the real project in .env.local
 * (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY): designers, settings and table access.
 */
import { existsSync } from 'node:fs';
import { createSupabaseRepo } from '@/lib/db/supabaseRepo';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const repo = createSupabaseRepo(url, key);
const designers = await repo.listDesigners();
const settings = await repo.getSettings();
const calls = await repo.listCalls();
const leads = await repo.listLeads();
const events = await repo.listEvents({ type: 'webhook_received' });
console.log(`designers: ${designers.map((d) => d.name).join(', ')}`);
console.log(`settings: working days ${settings.working_days.join(',')} ${settings.work_start}–${settings.work_end}, reminder ${settings.reminder_minutes} / escalation ${settings.escalation_minutes} min, ₹${settings.vaani_inr_per_minute_estimate}/min estimate`);
console.log(`calls: ${calls.length} · leads: ${leads.length} · webhook events: ${events.length}`);
