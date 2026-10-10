# SPEC — Vaani MVP for Aangan Studio

## 1. Goal

Aangan Studio (interior design, Pune, 14 designers) loses enquiries: ~48% of ~200 monthly enquiries get no response within 48 hours. Build an MVP where **every phone call to Aangan's Vaani number is answered by an AI voice agent**, turned into **one structured lead record**, and handed to **a named designer who is chased until they act**. Show the founder what it produces and what it costs.

The MVP fixes three root causes. Every component must serve one of them:

| Tag | Root cause | Fixed by |
|---|---|---|
| RC1 | No coverage — nobody answers outside 10am–7pm | Vaani answers every call, any hour |
| RC2 | No shared record — nothing structured survives the call | One lead record per call, built from Vaani's webhook |
| RC3 | No designer follow-through | Named designer, Accept link, 15-min reminder, 30-min escalation to a human |
| CUT | The founder asked for price quotes on calls; we refuse | Vaani never quotes prices; every transcript is scanned to prove it |

## 2. Out of scope (do not build)

Exotel or any other telephony; front-desk call recording; SMS; WhatsApp; per-designer calendars; locality-based assignment; leave management beyond an `active` flag; user accounts (dashboard uses one password); multiple studios.

## 3. Architecture (matches the MVP components map)

```
Caller ─► Vaani (number + voice + Gemini brain, KB, guardrails, Cal.com booking, transfer)
             │  webhook: call_postprocessing / human_transfer_*        Cal.com (one shared event)
             ▼                                                             ▲ confirm booking at slot
          Vercel (Next.js) ── the hub ───────────────────────────────────┘
             ├─► Supabase  (lead record, events; pg_cron calls /api/cron/tick every minute)
             ├─► Gemini API (designer brief)
             ├─► Resend    (designer, front-desk and owner emails)
             └─► /dashboard (reads Supabase)
Designer clicks Accept / outcome links ─► Vercel
Front desk: receives live transfers (from Vaani), urgent/escalation emails (from Resend), reassign links
```

Only Vaani, Vercel and the pg_cron timer initiate actions. Supabase and Gemini never call anything.

## 4. Source material (in /context)

- `services.md` — what the studio does and doesn't do; service area
- `qualified.md` — the founder's five qualification criteria (the rubric)
- `pricing.md` — use ONLY its "only acceptable response" line. Never copy its numbers anywhere.
- `Aangan_Sep_2026_Enquiries.pdf` — 40 real transcripts. Phone calls T01–T20 are the basis for fixtures and live tests.
- `VAANI_AGENT.md` (repo root) — system prompt, FAQ, guardrails and extraction fields for the Vaani agent.

## 5. External APIs — read the docs before coding against them

- Vaani: https://docs.vaanivoice.ai/llms.txt — key pages: Webhook Setup, Get Call History, Get Call Details, Update Persona / Training / Analysis / Deployment. Auth header `X-API-Key`. Base URL `https://api.vaanivoice.ai`.
  - `call_postprocessing` webhook carries `call_id`, `call_duration` (ms), `summary`, `entities`, `dispositions`, `recording_url`, `transcript` (lines prefixed `AGENT:` / `USER:`). It does NOT carry cost.
  - Cost comes from `GET /api/call-history` → `call_cost` (credits) for the matching `call_id`. Retry later if the call isn't listed yet.
  - Transfer events: `human_transfer_initiated | _successful | _failed`.
- Cal.com API v2: https://cal.com/docs/api-reference/v2 — used only to list bookings for the shared event in a time window. Confirm the auth header and API version header from the docs.
- Gemini: `@google/genai` SDK. Model from env `GEMINI_MODEL` (a current Flash model). Read token counts from the response's usage metadata.
- Resend: official Node SDK. Note: without a verified domain, Resend only delivers to the account owner's address — for tests, all designer/front-desk emails can go to that address.

## 6. Data model (Supabase migration in `supabase/migrations/`)

`designers` — `id`, `name`, `email`, `active bool`, `last_assigned_at timestamptz null`

`calls` — one row per Vaani call
`call_id text pk`, `received_at`, `from_number`, `duration_ms`, `transcript`, `summary`, `entities jsonb`, `dispositions jsonb`, `recording_url`, `raw_payload jsonb`,
`vaani_credits numeric null`, `vaani_inr numeric null`, `gemini_input_tokens int`, `gemini_output_tokens int`, `gemini_inr numeric`, `total_inr numeric`,
`price_flag bool default false`, `price_flag_lines text[]`, `processed_at`, `processing_error text null`

`leads` — one row per call that needs a human (booked, callback, urgent, incomplete); declines and vendors get a row too (status only, no designer)
`id uuid pk`, `call_id fk unique`, lead fields (from §8), `outcome` enum (`booked`,`callback`,`declined`,`existing_client_transferred`,`transfer_failed`,`incomplete`,`other`), `decline_reason`,
`booked_slot_start timestamptz null`, `booking_confirmed bool`, `cal_booking_uid text null`,
`designer_id fk null`, `brief_json jsonb null`, `brief_text text null`,
`clock_started_at`, `email_sent_at`, `reminder_sent_at`, `escalated_at`, `accepted_at`, `reassign_count int default 0`,
`consultation_outcome` enum null (`site_visit`,`proposal`,`not_fit`,`no_show`), `outcome_requested_at`, `outcome_logged_at`,
`needs_attention bool`, `attention_reason text null`

`events` — `id`, `lead_id null`, `call_id null`, `type`, `at`, `meta jsonb` (audit trail of every email, click, escalation, webhook)

`settings` — single row: `credit_to_inr`, `gemini_input_inr_per_mtok`, `gemini_output_inr_per_mtok`, `credits_loaded`, `low_balance_threshold_credits`, `working_days` (default Mon–Fri), `work_start` (10:00), `work_end` (19:00), `reminder_minutes` (15), `escalation_minutes` (30)

Seed: 3 test designers, settings defaults.

## 7. Pipeline — `POST /api/webhooks/vaani?token=VAANI_WEBHOOK_SECRET`

1. Reject if token mismatches (constant-time compare). Save the raw event to `events`. Return 200 immediately; process after the response (Next.js `after()`).
2. `human_transfer_failed` → record event on the call; final handling happens in step 3 when post-processing arrives.
3. `call_postprocessing` (idempotent: if `calls.processed_at` is set, stop):
   a. Upsert `calls`. Map `entities` → lead fields (§8) with a pure, tested mapper. Missing essentials → `outcome = incomplete`.
   b. **Price scan** (pure function, §10) on AGENT lines only → `price_flag`, `price_flag_lines`.
   c. **Cost**: look up `call_cost` via call-history; compute `vaani_inr`. If not yet available, leave null; the cron tick retries.
   d. **Route by outcome:**
      - `booked` → **confirm with Cal.com**: list bookings for the shared event within ±10 minutes of `booked_slot_start`. Found → `booking_confirmed = true`, store uid. Not found → treat as `callback`, `needs_attention`, reason "Booking not found — rebook".
      - `booked` (confirmed) or `callback` → assign designer (§9), generate brief (§11), send designer email (§12), start the clock (§13).
      - `transfer_failed`, or `existing_client_transferred` outside working hours → urgent email to front desk with summary + caller number; `needs_attention`.
      - `incomplete` → front-desk email "call back — call dropped"; `needs_attention`.
      - `declined`, `other` → record only.
   e. Set `processed_at`. On any error: store `processing_error`, keep the raw payload, never lose the call.

## 8. Lead fields (single source of truth: `lib/leadSchema.ts`)

The same list is (a) pushed to Vaani as extraction data points by `npm run vaani:configure`, and (b) used by the mapper and the brief. Names ≤ 30 chars.

`caller_name` · `enquiry_type` [new_enquiry, existing_client, vendor_or_other] · `locality` · `in_service_area` [yes, no, unclear] · `property_type` [apartment, independent_house, villa, office, clinic, studio, other] · `carpet_area_sqft` · `scope` · `completion_deadline` · `timeline_fit` [yes, no, unclear] · `decision_maker` [yes, authorised_rep, no, unclear] · `budget_mentioned` [none, not_a_concern, clearly_too_low] · `outcome` [booked, callback, declined, existing_client_transferred, transfer_failed, incomplete, other] · `decline_reason` · `booked_slot_iso` · `callback_preference` · `notes_for_designer`

Extraction prompts for each field are in VAANI_AGENT.md.

## 9. Designer assignment

Rotation: pick the `active` designer with the oldest `last_assigned_at` (nulls first); update it. Reassign = next designer by the same rule, excluding the current one; increments `reassign_count`.

## 10. Price scanner (`lib/priceScan.ts`)

Scan only lines spoken by the agent. Flag a line if it contains any money term: `₹`, `rs`, `rupee(s)`, `lakh`, `lac`, `crore`, `per sq`, `per square`, `/sq`, `rate`, `costs around`, `starting at`, `starts at`, `ballpark`. Do not flag sizes ("your 1,400 sq ft flat"), dates, times, or the caller's own lines. Also scan the generated brief; if it flags, regenerate once, then send without the offending lines and set `needs_attention`.

## 11. Designer brief (Gemini)

Input: lead fields, transcript, qualified.md. Output JSON (validate with zod):
`headline` (one line: name · locality · property · scope) · `what_they_want` (2–3 sentences) · `criteria` (the five qualified.md criteria, each `met | unclear | not_met` with a short quote from the transcript) · `uncertainties` (required per qualified.md: anything unclear on budget or decision-maker) · `suggested_opening` (one question for the designer's first call) · `booking` (slot or callback preference).
System instruction: never include prices, ranges, rates or budget figures; never invent facts not in the transcript. Record token usage and compute `gemini_inr`.

## 12. Emails (Resend; templates in `lib/emails/`)

All links are HMAC-signed (`LINK_SIGNING_SECRET`, include lead id + action + expiry) and verified server-side.
- **Designer brief**: subject `New lead · {locality} · {property} · {booked slot or "call back"}`; brief; big **Accept** button.
- **Reminder** (+15 working minutes, not accepted): same lead, "still waiting for you".
- **Escalation** (+30, not accepted) → `FRONT_DESK_EMAIL`: lead summary, designer name, **Reassign** button.
- **Urgent** → front desk: transfer failed / after-hours existing client / incomplete call.
- **Outcome request** → designer, 10:00 next working day after the booked slot (callbacks: next working day after Accept): four one-click buttons.
- **Low balance** → `OWNER_EMAIL`.

Click endpoints (GET, show a simple confirmation page): `/api/leads/[id]/accept`, `/api/leads/[id]/outcome?value=…`, `/api/leads/[id]/reassign`. Every click writes an event.

## 13. Timers — `POST /api/cron/tick` (header `Authorization: Bearer CRON_SECRET`)

Called every minute by Supabase pg_cron via pg_net (write the SQL in a migration; the human enables the extensions).
- **Working-hours clock**: `clock_started_at` = email time if inside working hours, else the next working-period start. Minutes count only inside working hours (Mon–Fri 10:00–19:00 IST, from settings). Pure, tested function.
- Not accepted after 15 working minutes → reminder (once). After 30 → escalation (once).
- Reassign restarts the clock and the reminder/escalation flags.
- Send due outcome requests.
- Retry missing `call_cost` lookups.
- Low balance: if `credits_loaded − sum(vaani_credits)` < threshold → owner email (at most once a day).

## 14. Dashboard — `/dashboard` (password: `DASHBOARD_PASSWORD`, via middleware)

Date filter (default this month). Show:
- **RC1**: calls answered (total, after-hours share)
- **RC2**: share of calls with complete lead records; outcome breakdown (booked, callback, declined + top reasons, existing client, incomplete)
- **RC3**: median minutes email → Accept; % accepted within 30 working minutes; escalations; outcomes logged
- **CUT**: calls with `price_flag` (target 0), linked to the flagged lines
- **Cost**: total ₹, ₹ per call, ₹ per minute, ₹ per booked consultation, ₹ per won proposal; projected month-end; credits remaining
- **Needs attention** list: urgent, incomplete, booking-not-found, price flags, unaccepted

Plain server-rendered page, no chart library needed.

## 15. Fixtures and simulation

Create `fixtures/*.json` as realistic `call_postprocessing` payloads based on the transcripts (agent lines must follow VAANI_AGENT.md — no prices):
- `t01` qualified 3BHK Kothrud → `booked`
- `t13` caller pushes for price twice, agent deflects with the approved line → `booked`
- `t10` volunteered budget clearly too low → `declined`, agent does NOT repeat the figure
- `t09` angry existing client → `existing_client_transferred` (plus a `t09_failed` variant with `human_transfer_failed` after hours)
- `t17` drops after 1 minute → `incomplete`
- `price_leak` an agent line quoting a per-sq-ft figure (scanner must flag it)
`npm run simulate -- <name>` posts it to `localhost`. With `MOCK_EXTERNAL=1`, Cal.com returns a booking for t01/t13, call-history returns a fixed cost, Gemini returns a canned brief, Resend writes to an in-memory/DB outbox.

## 16. Environment variables (`.env.example`)

`VAANI_API_KEY`, `VAANI_AGENT_ID`, `VAANI_WEBHOOK_SECRET`, `CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `RESEND_API_KEY`, `EMAIL_FROM`, `FRONT_DESK_EMAIL`, `OWNER_EMAIL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `LINK_SIGNING_SECRET`, `DASHBOARD_PASSWORD`, `APP_BASE_URL`, `MOCK_EXTERNAL`

## 17. Build order — one checkpoint at a time

Each checkpoint ends with: `npm test` output shown, a short evidence note, and a commit. Start a fresh session (`/clear`) between checkpoints if context gets long.

0. **Verify** (no code): read the docs in §5; write NOTES.md answering — exact inbound `call_id` format; whether call-history returns `call_cost` for inbound calls; Cal.com v2 list-bookings endpoint, auth and version headers, and whether it works on a free account; Gemini usage-metadata field names; Resend sandbox restrictions. List anything that contradicts this spec.
1. **Scaffold**: Next.js + TypeScript + Vitest; Supabase migration + seed; adapters with mock implementations; `.env.example`.
2. **Pure logic + unit tests**: `leadSchema`/mapper, `priceScan`, rotation, working-hours clock, signed links, slot matching.
3. **Webhook pipeline**: endpoint, idempotency, routing; fixtures + simulate script.
4. **Brief + emails + click endpoints.**
5. **Cron tick** + pg_cron SQL.
6. **Dashboard.**
7. **Vaani configure script** (`scripts/configure-vaani.ts`): pushes persona system prompt + greeting, FAQ, guardrail custom rules, and analysis data points from VAANI_AGENT.md and `leadSchema.ts`; `--dry-run` prints the JSON.
8. **Deploy** to Vercel; list the manual steps for the human (see §19).

## 18. Done when (end-to-end verification)

With `MOCK_EXTERNAL=1`, a single test (`tests/e2e.test.ts`) simulates every fixture and asserts:
- 6 calls stored; lead outcomes match §15; every booked/callback lead has a designer, a brief and one designer email (posting t01 twice still sends one email)
- t10's transcript and brief contain no budget figure; `price_leak` is flagged; all other calls have `price_flag = false`
- advancing the clock 15 and 30 working minutes sends one reminder and one escalation; a lead created at 23:00 starts its clock at 10:00 the next working day
- Accept sets `accepted_at`; Reassign moves the lead and restarts the clock
- t09_failed and t17 produce urgent front-desk emails and appear under Needs attention
- dashboard query returns correct counts and cost totals for the fixture set

Then run a review subagent against this spec: report only gaps that break a requirement in §7–§18, not style.

## 19. Manual steps for the human (Claude Code lists these; does not do them)

In the Vaani dashboard: provision the inbound number and assign it to the agent; select Google/Gemini as the LLM and a speech provider that supports the needed languages; upload `services.md` and `qualified.md` to the knowledge base (not pricing.md); connect Cal.com (API key + the "Studio consultation" event type); add a transfer target (front desk / your phone); register the webhook URL. In Supabase: enable pg_cron and pg_net, run migrations. In Cal.com: create the "Studio consultation" event in Asia/Kolkata. Then make the four live test calls (T01, T13, T10, T09) and compare the dashboard with §18.
