-- Every minute, pg_cron calls POST /api/cron/tick via pg_net (SPEC §13).
--
-- Manual steps first (Claude Code does not do these):
--   1. Supabase dashboard → Database → Extensions: enable pg_cron and pg_net.
--   2. Store the app URL and CRON_SECRET in Supabase Vault (SQL editor), so no secret lives in this file:
--        select vault.create_secret('https://<your-app>.vercel.app', 'vaani_app_base_url');
--        select vault.create_secret('<same value as CRON_SECRET in Vercel>', 'vaani_cron_secret');
--      To change one later: select vault.update_secret(id, '<new value>') using the id from vault.secrets.
--   3. Run this migration. Check runs with:
--        select * from cron.job_run_details order by start_time desc limit 10;
--        select id, status_code, content from net._http_response order by id desc limit 10;
--
-- Re-running is safe: cron.schedule with an existing job name updates that job.

select cron.schedule(
  'vaani-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'vaani_app_base_url') || '/api/cron/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'vaani_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
