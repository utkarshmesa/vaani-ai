-- Seed: 3 test designers and the settings row. Must match lib/db/seed.ts (checked by tests/migrations.test.ts).
-- Designer emails use the reserved .test TLD. For live Resend sandbox tests, set them to the Resend account owner's address.

insert into designers (id, name, email, active) values
  ('00000000-0000-4000-8000-000000000001', 'Ananya Kulkarni', 'ananya@aangan-studio.test', true),
  ('00000000-0000-4000-8000-000000000002', 'Rohan Joshi',     'rohan@aangan-studio.test',  true),
  ('00000000-0000-4000-8000-000000000003', 'Meera Iyer',      'meera@aangan-studio.test',  true);

-- TODO(rates): placeholder running-cost rates until confirmed (PLAN.md Q4). These are not Aangan's prices.
insert into settings (
  id, credit_to_inr, gemini_input_inr_per_mtok, gemini_output_inr_per_mtok,
  credits_loaded, low_balance_threshold_credits,
  working_days, work_start, work_end, reminder_minutes, escalation_minutes
) values (1, 1, 25, 210, 1000, 100, '{1,2,3,4,5}', '10:00', '19:00', 15, 30);
