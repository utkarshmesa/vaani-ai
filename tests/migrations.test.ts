import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SEED_DESIGNERS, SEED_SETTINGS } from '@/lib/db/seed';
import { CONSULTATION_OUTCOMES, LEAD_OUTCOMES } from '@/lib/db/types';

const DIR = 'supabase/migrations';
// pg_cron / pg_net migrations need Supabase extensions that PGlite doesn't have.
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql') && !f.includes('cron')).sort();

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  for (const f of files) await db.exec(readFileSync(join(DIR, f), 'utf8'));
});

describe('Supabase migrations (applied to PGlite)', () => {
  it('apply cleanly, in order', () => {
    expect(files.slice(0, 2)).toEqual(['0001_schema.sql', '0002_seed.sql']);
  });

  it('create the §6 tables', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    expect(rows.map((r) => r.table_name)).toEqual(['calls', 'designers', 'events', 'leads', 'settings']);
  });

  it('define the outcome enums exactly as in lib/db/types', async () => {
    const enumValues = async (t: string) =>
      (await db.query<{ v: string }>(`select unnest(enum_range(null::${t}))::text as v`)).rows.map((r) => r.v);
    expect(await enumValues('lead_outcome')).toEqual([...LEAD_OUTCOMES]);
    expect(await enumValues('consultation_outcome')).toEqual([...CONSULTATION_OUTCOMES]);
  });

  it('seed matches lib/db/seed (the in-memory repo uses the same data)', async () => {
    const d = await db.query<{ id: string; name: string; email: string; active: boolean; last_assigned_at: string | null }>(
      `select id::text, name, email, active, last_assigned_at from designers order by name`);
    expect(d.rows).toEqual([...SEED_DESIGNERS].sort((a, b) => a.name.localeCompare(b.name)));

    const s = await db.query<Record<string, unknown>>(`
      select credit_to_inr::float8, gemini_input_inr_per_mtok::float8, gemini_output_inr_per_mtok::float8,
             credits_loaded::float8, low_balance_threshold_credits::float8, working_days,
             to_char(work_start, 'HH24:MI') as work_start, to_char(work_end, 'HH24:MI') as work_end,
             reminder_minutes, escalation_minutes, low_balance_alerted_at
      from settings`);
    expect(s.rows).toEqual([SEED_SETTINGS]);
  });

  it('allows only one settings row', async () => {
    await expect(db.exec(`insert into settings (id, credit_to_inr, gemini_input_inr_per_mtok, gemini_output_inr_per_mtok) values (2, 1, 1, 1)`))
      .rejects.toThrow();
  });

  it('enforces one lead per call and a valid call reference', async () => {
    await db.exec(`insert into calls (call_id, raw_payload) values ('m1', '{}')`);
    await db.exec(`insert into leads (call_id, outcome) values ('m1', 'booked')`);
    await expect(db.exec(`insert into leads (call_id, outcome) values ('m1', 'callback')`)).rejects.toThrow(/unique/i);
    await expect(db.exec(`insert into leads (call_id, outcome) values ('nope', 'callback')`)).rejects.toThrow(/foreign key/i);
    await expect(db.exec(`insert into calls (call_id, raw_payload) values ('m2', '{}');
                          insert into leads (call_id, outcome) values ('m2', 'not_an_outcome')`)).rejects.toThrow();
  });

  it('applies column defaults matching the in-memory repo', async () => {
    const { rows } = await db.query<Record<string, unknown>>(`
      select c.price_flag, c.price_flag_lines, c.gemini_input_tokens, c.gemini_output_tokens, c.gemini_inr::float8,
             l.reassign_count, l.booking_confirmed, l.needs_attention
      from calls c join leads l using (call_id) where call_id = 'm1'`);
    expect(rows[0]).toEqual({
      price_flag: false, price_flag_lines: [], gemini_input_tokens: 0, gemini_output_tokens: 0, gemini_inr: 0,
      reassign_count: 0, booking_confirmed: false, needs_attention: false,
    });
  });

  it('enables row-level security on every table (service role only)', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select relname, relrowsecurity from pg_class
      where relname in ('calls','designers','events','leads','settings') order by relname`);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});
