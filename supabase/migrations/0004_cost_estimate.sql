-- Fallback for Vaani's call-history API returning 500 on this account (NOTES.md):
-- estimate a call's Vaani cost from its length until the real call_cost can be fetched.

alter table calls add column cost_estimated boolean not null default false;

-- ₹ per minute shown for the agent in the Vaani dashboard ("₹5.60/min (est.)", 2026-10-10).
alter table settings add column vaani_inr_per_minute_estimate numeric not null default 5.6;

drop index if exists calls_missing_cost_idx;
create index calls_cost_pending_idx on calls (call_id) where vaani_credits is null or cost_estimated;
