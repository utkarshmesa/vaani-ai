import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/0003_cron.sql', 'utf8');

describe('pg_cron migration (SPEC §13)', () => {
  it('schedules the tick every minute via pg_net', () => {
    expect(sql).toMatch(/cron\.schedule\(\s*'vaani-tick',\s*'\* \* \* \* \*'/);
    expect(sql).toMatch(/net\.http_post\(/);
    expect(sql).toContain("'/api/cron/tick'");
  });

  it('sends Authorization: Bearer <cron secret> read from Supabase Vault — no secret in the file', () => {
    expect(sql).toMatch(/'Authorization',\s*'Bearer ' \|\|/);
    expect(sql).toMatch(/vault\.decrypted_secrets where name = 'vaani_cron_secret'/);
    expect(sql).toMatch(/vault\.decrypted_secrets where name = 'vaani_app_base_url'/);
    expect(sql).not.toMatch(/Bearer [A-Za-z0-9_-]{12,}/);
  });

  it('documents the manual steps (extensions + vault secrets)', () => {
    expect(sql).toMatch(/pg_cron/);
    expect(sql).toMatch(/pg_net/);
    expect(sql).toMatch(/vault\.create_secret/);
  });
});
