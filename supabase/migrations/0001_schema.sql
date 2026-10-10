-- Vaani MVP for Aangan Studio — schema (SPEC §6). All timestamps are timestamptz (UTC instants).

create type lead_outcome as enum (
  'booked', 'callback', 'declined', 'existing_client_transferred', 'transfer_failed', 'incomplete', 'other'
);
create type consultation_outcome as enum ('site_visit', 'proposal', 'not_fit', 'no_show');

create table designers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  email            text not null,
  active           boolean not null default true,
  last_assigned_at timestamptz
);

-- One row per Vaani call.
create table calls (
  call_id               text primary key,
  received_at           timestamptz not null default now(),
  from_number           text,
  duration_ms           integer,
  transcript            text,
  summary               text,
  entities              jsonb,
  dispositions          jsonb,
  recording_url         text,
  raw_payload           jsonb not null,
  vaani_credits         numeric,
  vaani_inr             numeric,
  gemini_input_tokens   integer not null default 0,
  gemini_output_tokens  integer not null default 0,
  gemini_inr            numeric not null default 0,
  total_inr             numeric,
  price_flag            boolean not null default false,
  price_flag_lines      text[] not null default '{}',
  processing_started_at timestamptz,  -- idempotency claim (see Repo.claimCallProcessing)
  processed_at          timestamptz,
  processing_error      text
);
create index calls_received_at_idx on calls (received_at);
create index calls_missing_cost_idx on calls (call_id) where vaani_credits is null;

-- One row per processed call (declines and vendors get a status-only row with no designer).
create table leads (
  id                    uuid primary key default gen_random_uuid(),
  call_id               text not null unique references calls (call_id),
  -- Lead fields (lib/leadSchema.ts). Enum-like values are text, validated by the mapper,
  -- so an unexpected value from Vaani never makes the insert fail.
  caller_name           text,
  enquiry_type          text,
  locality              text,
  in_service_area       text,
  property_type         text,
  carpet_area_sqft      numeric,
  scope                 text,
  completion_deadline   text,
  timeline_fit          text,
  decision_maker        text,
  budget_mentioned      text,
  outcome               lead_outcome not null,
  decline_reason        text,
  callback_preference   text,
  notes_for_designer    text,
  -- booking
  booked_slot_start     timestamptz,
  booking_confirmed     boolean not null default false,
  cal_booking_uid       text,
  -- handoff
  designer_id           uuid references designers (id),
  brief_json            jsonb,
  brief_text            text,
  clock_started_at      timestamptz,
  email_sent_at         timestamptz,
  reminder_sent_at      timestamptz,
  escalated_at          timestamptz,
  accepted_at           timestamptz,
  reassign_count        integer not null default 0,
  consultation_outcome  consultation_outcome,
  outcome_requested_at  timestamptz,
  outcome_logged_at     timestamptz,
  needs_attention       boolean not null default false,
  attention_reason      text,
  created_at            timestamptz not null default now()
);
create index leads_created_at_idx on leads (created_at);
create index leads_active_idx on leads (designer_id) where outcome_logged_at is null;

-- Audit trail: every webhook, email, click and escalation. call_id has no FK because the raw
-- webhook event is saved before the calls row exists.
create table events (
  id       bigint generated always as identity primary key,
  lead_id  uuid references leads (id),
  call_id  text,
  type     text not null,
  at       timestamptz not null default now(),
  meta     jsonb not null default '{}'
);
create index events_call_id_idx on events (call_id);
create index events_lead_id_idx on events (lead_id);
create index events_type_at_idx on events (type, at);

-- Single-row configuration.
create table settings (
  id                            integer primary key default 1 check (id = 1),
  credit_to_inr                 numeric not null,
  gemini_input_inr_per_mtok     numeric not null,
  gemini_output_inr_per_mtok    numeric not null,
  credits_loaded                numeric not null default 0,
  low_balance_threshold_credits numeric not null default 0,
  working_days                  integer[] not null default '{1,2,3,4,5}',  -- ISO weekday, Monday = 1
  work_start                    time not null default '10:00',              -- IST
  work_end                      time not null default '19:00',              -- IST
  reminder_minutes              integer not null default 15,
  escalation_minutes            integer not null default 30,
  low_balance_alerted_at        timestamptz                                 -- low-balance email at most once a day
);

-- Only the service role (server) touches these tables: RLS on, no policies.
alter table designers enable row level security;
alter table calls     enable row level security;
alter table leads     enable row level security;
alter table events    enable row level security;
alter table settings  enable row level security;
