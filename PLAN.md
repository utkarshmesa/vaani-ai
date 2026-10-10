# PLAN — Vaani MVP (checkpoints 1–8)

This plan follows SPEC.md and incorporates the findings in NOTES.md. Nothing here goes beyond SPEC §2's scope.

## 0. Cross-cutting design decisions

- **Adapters** (`lib/adapters/`): each external service has an interface, a real implementation and a mock. `lib/adapters/index.ts#getAdapters()` returns mocks when `MOCK_EXTERNAL=1`. Tests always call `setAdapters(mocks)`.
- **Database access** (`lib/db/`): a small `Repo` interface with two implementations:
  - `supabaseRepo`, using `@supabase/supabase-js` with the service-role key
  - `memoryRepo`, in-memory, used by the unit and e2e tests

  Supabase isn't in the CLAUDE.md adapter list, but the tests must run with no network access. A separate migration smoke test applies `supabase/migrations/*.sql` to **PGlite** (in-process Postgres) to prove the SQL is valid. (See Q5.)
- **Clock** (`lib/clock.ts`): `now()` can be overridden in tests (`setNow()`), so the e2e test can advance time and check reminders and escalations.
- **Time**: `lib/time.ts` wraps `date-fns-tz` for Asia/Kolkata. Everything is stored as `timestamptz` (UTC instants); IST is used only for working-hours maths and display.
- **Processing after the response**: the webhook route calls `after(() => processEvent(id))` from `next/server`. `processEvent` is a plain function that the tests call directly.
- **Price rule**: no pricing.md numbers anywhere. The canned mock brief and all fixtures pass `priceScan` (enforced by a test that scans every fixture's agent lines and every email template's output).

---

## 1. Files by checkpoint

### CP1 — Scaffold
```
package.json  tsconfig.json  next.config.ts  vitest.config.ts  .gitignore  .env.example
app/layout.tsx  app/page.tsx                    (minimal; links to /dashboard)
lib/env.ts                                      (zod-validated env; MOCK_EXTERNAL flag)
lib/clock.ts  lib/time.ts
lib/adapters/types.ts                           (interfaces below)
lib/adapters/{vaani,calcom,gemini,resend}.ts    (real; thin fetch/SDK wrappers)
lib/adapters/mocks/{vaani,calcom,gemini,resend}.ts
lib/adapters/index.ts                           (getAdapters / setAdapters)
lib/db/types.ts  lib/db/repo.ts  lib/db/supabaseRepo.ts  lib/db/memoryRepo.ts
supabase/migrations/0001_schema.sql
supabase/migrations/0002_seed.sql               (3 designers + settings row)
tests/setup.ts
tests/scaffold.test.ts
tests/migrations.test.ts                        (PGlite applies 0001+0002)
```
Dependencies: `next react react-dom @supabase/supabase-js @google/genai resend zod date-fns date-fns-tz`. Dev dependencies: `typescript vitest @electric-sql/pglite tsx @types/*`.

### CP2 — Pure logic + unit tests
```
lib/leadSchema.ts        (field list: name, values, nullable, prompt — single source for §8)
lib/mapEntities.ts       (payload.data.entities → LeadFields; normalises "N/A"/""/null; essentials check → incomplete)
lib/transcript.ts        (parse "[hh:mm:ss] AGENT: …" and " AGENT: …" into {speaker, text}[])
lib/priceScan.ts         (scanAgentLines(transcript), scanText(text) → {flag, lines})
lib/rotation.ts          (pickDesigner(designers, excludeId?))
lib/workingHours.ts      (clockStart(t, settings), workingMinutesBetween(a, b, settings), addWorkingMinutes, nextWorkingDayAt(t, "10:00"))
lib/links.ts             (signLink(leadId, action, expiresAt, extra?), verifyLink(...)) — HMAC-SHA256, timingSafeEqual
lib/slotMatch.ts         (matchSlot(bookings, slotStart, toleranceMin=10))
lib/cost.ts              (vaaniInr, geminiInr, totalInr)
tests/unit/{leadSchema,mapEntities,transcript,priceScan,rotation,workingHours,links,slotMatch,cost}.test.ts
```

### CP3 — Webhook pipeline
```
app/api/webhooks/vaani/route.ts   (token check, constant-time; save raw event; 200; after())
lib/pipeline/processEvent.ts      (dispatch by event type)
lib/pipeline/processCall.ts       (§7.3 a–e; idempotent on calls.processed_at)
lib/pipeline/route.ts             (outcome routing; returns actions to run)
lib/pipeline/lookupCost.ts        (call-history scan → credits, from_number)
lib/pipeline/confirmBooking.ts    (Cal.com list + matchSlot)
fixtures/{t01,t13,t10,t09,t09_failed,t17,price_leak}.json
fixtures/t09_failed.transfer.json (human_transfer_failed event, room_name = call_id)
scripts/simulate.ts               (npm run simulate -- <name>; posts transfer event first for t09_failed)
tests/pipeline/{webhookRoute,processCall,idempotency,routing,fixtures}.test.ts
```
In CP3, brief generation and email sending are stubbed behind functions that CP4 fills in. Routing tests assert the *intended* actions, for example `{assign, brief, email:'designer'}`.

### CP4 — Brief + emails + click endpoints
```
lib/brief/schema.ts        (zod Brief)
lib/brief/prompt.ts        (system instruction + user prompt; embeds qualified.md text from lib/brief/qualified.ts)
lib/brief/generate.ts      (Gemini call → zod → priceScan → regenerate once → strip lines + needs_attention)
lib/brief/render.ts        (brief_json → brief_text / HTML)
lib/emails/{layout,designerBrief,reminder,escalation,urgent,outcomeRequest,lowBalance}.ts  (pure: data → {subject, html, text})
lib/emails/send.ts         (via Resend adapter; writes events row 'email_sent' with type + to)
lib/leads/actions.ts       (accept, reassign, logOutcome — shared by endpoints and tests)
app/api/leads/[id]/accept/route.ts
app/api/leads/[id]/outcome/route.ts
app/api/leads/[id]/reassign/route.ts
lib/http/confirmPage.ts    (simple HTML confirmation / error page)
tests/brief/{schema,generate}.test.ts
tests/emails/templates.test.ts   (subjects per §12; signed links; no money terms)
tests/api/clicks.test.ts         (valid/expired/tampered signature; event written; idempotent second click)
```

### CP5 — Cron tick + pg_cron SQL
```
app/api/cron/tick/route.ts        (Bearer CRON_SECRET, constant-time)
lib/cron/tick.ts                  (runs every job; each job isolated with try/catch + event)
lib/cron/jobs/{reminders,escalations,outcomeRequests,costRetry,lowBalance}.ts
supabase/migrations/0003_cron.sql (cron.schedule('vaani-tick','* * * * *', net.http_post(...)) — URL/secret read from vault or settings; human enables extensions)
tests/cron/{tick,reminders,escalations,outcomeRequests,costRetry,lowBalance}.test.ts
```

### CP6 — Dashboard
```
middleware.ts                    (/dashboard*: password cookie check → /login)
app/login/page.tsx  app/api/login/route.ts   (sets HMAC cookie on correct DASHBOARD_PASSWORD)
lib/dashboard/metrics.ts         (pure: (calls, leads, events, settings, range, now) → Metrics)
app/dashboard/page.tsx           (server component; date filter via ?from=&to=, default this month IST)
tests/dashboard/{metrics,auth}.test.ts
```

### CP7 — Vaani configure script
```
lib/vaaniConfig/parseAgentMd.ts  (VAANI_AGENT.md → greeting, system prompt, FAQ map, guardrail rules, dispositions)
lib/vaaniConfig/build.ts         (→ {persona, training, experience, analysis} PATCH bodies; data points from leadSchema)
scripts/configure-vaani.ts       (--dry-run prints JSON; otherwise PATCHes via Vaani adapter)
tests/vaaniConfig.test.ts        (field names ≤30, mirror leadSchema exactly, FAQ verbatim, no money figures, greeting matches)
```

### CP8 — Deploy
```
vercel.json (if needed)  README.md (run/deploy)  DEPLOY.md (§19 manual checklist)
tests/e2e.test.ts               (§18 — written here if not already; see below)
```

---

## 2. Adapter interfaces (`lib/adapters/types.ts`)

```ts
// ---- Vaani ----
export interface VaaniCallHistoryItem {
  call_id: string; call_type: 'Inbound' | 'Outbound' | string;
  from_number: string | null; to_number: string | null;
  start_time: string | null;            // normalised from Start_time
  call_cost: number | null;             // credits
  post_processing_status: 'completed' | 'processing' | 'not_processed' | string;
}
export interface VaaniAdapter {
  /** Scans call-history pages (≤ maxPages × 200) for callId. null if not listed yet. */
  findCall(callId: string, opts?: { maxPages?: number }): Promise<VaaniCallHistoryItem | null>;
  updatePersona(agentId: string, body: unknown): Promise<unknown>;
  updateTraining(agentId: string, body: unknown): Promise<unknown>;
  updateExperience(agentId: string, body: unknown): Promise<unknown>;
  updateAnalysis(agentId: string, body: unknown): Promise<unknown>;
}

// ---- Cal.com ----
export interface CalBooking {
  uid: string; start: string; end: string;
  status: 'accepted' | 'pending' | 'cancelled' | 'rejected' | 'awaiting_host' | string;
  eventTypeId: number | null; attendeeName?: string; attendeeEmail?: string;
}
export interface CalcomAdapter {
  /** GET /v2/bookings?eventTypeId&afterStart&beforeEnd (cal-api-version 2026-05-01), follows cursor. */
  listBookings(q: { eventTypeId: number; afterStart: Date; beforeEnd: Date }): Promise<CalBooking[]>;
}

// ---- Gemini ----
export interface GeminiResult {
  text: string;                          // raw JSON text
  inputTokens: number;                   // promptTokenCount
  outputTokens: number;                  // candidatesTokenCount + thoughtsTokenCount
}
export interface GeminiAdapter {
  generateJson(req: { system: string; prompt: string; jsonSchema: object }): Promise<GeminiResult>;
}

// ---- Resend ----
export interface OutgoingEmail { to: string; subject: string; html: string; text: string; tag: EmailType; leadId?: string }
export type EmailType = 'designer_brief' | 'reminder' | 'escalation' | 'urgent' | 'outcome_request' | 'low_balance';
export interface ResendAdapter {
  send(email: OutgoingEmail): Promise<{ id: string }>;
}
```
Mocks:
- **Vaani**: fixed `call_cost` (e.g. 12.5 credits) and a fixture `from_number` for any known call_id. Can be set to "not listed yet" to test the cost retry.
- **Cal.com**: returns a booking at the slot for t01/t13 call slots, and nothing otherwise.
- **Gemini**: canned valid brief built from lead fields, fixed tokens (e.g. 2,000 in / 400 out), with a switch to return a price-leaking brief.
- **Resend**: appends to an in-memory `outbox[]` (exported for assertions).

---

## 3. Supabase schema (`0001_schema.sql`, summary)

```sql
create type lead_outcome as enum ('booked','callback','declined','existing_client_transferred','transfer_failed','incomplete','other');
create type consultation_outcome as enum ('site_visit','proposal','not_fit','no_show');

create table designers (
  id uuid primary key default gen_random_uuid(),
  name text not null, email text not null, active boolean not null default true,
  last_assigned_at timestamptz null);

create table calls (
  call_id text primary key, received_at timestamptz not null default now(),
  from_number text, duration_ms int, transcript text, summary text,
  entities jsonb, dispositions jsonb, recording_url text, raw_payload jsonb not null,
  vaani_credits numeric, vaani_inr numeric,
  gemini_input_tokens int not null default 0, gemini_output_tokens int not null default 0,
  gemini_inr numeric not null default 0, total_inr numeric,
  price_flag boolean not null default false, price_flag_lines text[] not null default '{}',
  processed_at timestamptz, processing_error text);

create table leads (
  id uuid primary key default gen_random_uuid(),
  call_id text not null unique references calls(call_id),
  -- §8 lead fields
  caller_name text, enquiry_type text, locality text, in_service_area text, property_type text,
  carpet_area_sqft numeric, scope text, completion_deadline text, timeline_fit text,
  decision_maker text, budget_mentioned text,
  outcome lead_outcome not null, decline_reason text,
  booked_slot_start timestamptz, booking_confirmed boolean not null default false, cal_booking_uid text,
  callback_preference text, notes_for_designer text,
  designer_id uuid references designers(id), brief_json jsonb, brief_text text,
  clock_started_at timestamptz, email_sent_at timestamptz, reminder_sent_at timestamptz,
  escalated_at timestamptz, accepted_at timestamptz, reassign_count int not null default 0,
  consultation_outcome consultation_outcome, outcome_requested_at timestamptz, outcome_logged_at timestamptz,
  needs_attention boolean not null default false, attention_reason text,
  created_at timestamptz not null default now());

create table events (
  id bigint generated always as identity primary key,
  lead_id uuid references leads(id), call_id text,      -- no FK: raw events can precede the calls row
  type text not null, at timestamptz not null default now(), meta jsonb not null default '{}');
create index on events (call_id); create index on events (lead_id); create index on events (type, at);

create table settings (
  id int primary key default 1 check (id = 1),
  credit_to_inr numeric not null, gemini_input_inr_per_mtok numeric not null, gemini_output_inr_per_mtok numeric not null,
  credits_loaded numeric not null default 0, low_balance_threshold_credits numeric not null default 0,
  working_days int[] not null default '{1,2,3,4,5}',      -- ISO weekday, Mon=1
  work_start time not null default '10:00', work_end time not null default '19:00',
  reminder_minutes int not null default 15, escalation_minutes int not null default 30,
  low_balance_alerted_at timestamptz);                     -- supports "at most once a day"
```
Enum-valued lead fields are `text`, checked by zod in the mapper rather than by Postgres enums, so a new value from Vaani never makes an insert fail. Only `outcome` and `consultation_outcome` are Postgres enums, as §6 requires. Row-level security is enabled with no policies: only the service role reads or writes.

`0002_seed.sql` adds 3 test designers and the settings row. Rate values come from Q4; there are no price figures from pricing.md.

---

## 4. Tests that prove each checkpoint

| CP | Tests (Vitest; all external services mocked) | Proves |
|---|---|---|
| 1 | `scaffold.test.ts`: `getAdapters()` returns mocks under MOCK_EXTERNAL; env schema rejects missing vars; `.env.example` lists exactly the 18 §16 vars. `migrations.test.ts`: PGlite applies 0001+0002; 3 designers, 1 settings row. | scaffold, adapters, schema compile |
| 2 | `mapEntities`: each fixture's entities map correctly; `"N/A"`/`""` → null; missing caller_name/enquiry_type/outcome → `incomplete`. `transcript`: both line formats. `priceScan`: flags `₹`, `rs` (word-boundary, so it doesn't match "hours"/"first"), lakh, lac, crore, per sq, per square, /sq, rate, costs around, starting at, starts at, ballpark; doesn't flag "your 1,400 sq ft flat", dates, times, USER lines. `rotation`: nulls first, oldest, excludes current, skips inactive. `workingHours`: 23:00 → 10:00 next working day; Fri 18:50 + 15 min → Mon 10:05; weekend; boundaries. `links`: round-trip, tamper, expiry, wrong action. `slotMatch`: ±10 min inclusive, cancelled ignored. `leadSchema`: names ≤30, unique. | §8 §9 §10 §12 §13 pure fns |
| 3 | `webhookRoute`: bad token → 401, nothing stored; good token → 200 + raw event row + `after` scheduled. `processCall`: calls upsert, lead row, price_flag, cost filled or null. `idempotency`: t01 posted twice → one lead, one designer email. `routing`: t01/t13 booked+confirmed; booked but Cal.com empty → callback + needs_attention "Booking not found — rebook"; t10 declined (no designer); t09 existing_client inside hours → record only; t09 outside hours → urgent; t09_failed → urgent; t17 → incomplete + urgent; error → `processing_error` set, raw kept. `fixtures`: every fixture's agent lines pass priceScan except price_leak. | §7 |
| 4 | `brief/schema`: zod accepts canned and rejects malformed. `brief/generate`: clean brief once; leaky brief → regenerate once; still leaky → offending lines stripped + needs_attention; tokens → gemini_inr. `emails/templates`: §12 subject format, Accept/Reassign/outcome links verify, rendered emails contain no money terms. `api/clicks`: accept sets accepted_at + event; second accept is a no-op; bad or expired signature → 403 page; outcome stores value; reassign moves designer, increments count, resets clock/reminder/escalation, emails the new designer. | §11 §12 |
| 5 | `tick`: bad bearer → 401. `reminders`: at 14 working min nothing, at 15 one reminder, never two. `escalations`: at 30 one escalation to FRONT_DESK_EMAIL. Accepted leads are skipped. `outcomeRequests`: 10:00 IST next working day after the slot (Fri slot → Mon); callbacks keyed off accepted_at. `costRetry`: null credits filled when call-history lists the call. `lowBalance`: below threshold → one owner email; second tick same day → none. | §13 |
| 6 | `metrics` over the fixture set: totals, after-hours share, complete-record share, outcome breakdown + top decline reasons, median Accept minutes, % ≤30 working min, escalations, outcomes logged, price flags, ₹ total/per call/per min/per booked/per proposal, projected month-end, credits remaining, needs-attention list. `auth`: /dashboard without cookie → redirect; wrong password rejected. | §14 |
| 7 | `vaaniConfig`: data_points === leadSchema (names, values, nullable, prompts); FAQ map has the 6 VAANI_AGENT.md entries verbatim; guardrails strict + 5 rules; disposition `price_mentioned` bool; max_call_duration 12; dry-run prints JSON and makes no HTTP calls. | §17.7 |
| 8 | `tests/e2e.test.ts`: every §18 bullet, against memoryRepo + mocks with a controlled clock. Then a review subagent against §7–§18. | §18 |

---

## 4a. Decisions log (answers from you, 2026-10-10)

| # | Decision | Effect on the spec / plan |
|---|---|---|
| D1 | **The caller's own stated budget goes in the brief.** Vaani still never quotes a price and never repeats the caller's figure on the call. | **Changes SPEC §11 and §18.** The brief schema gets `caller_stated_budget: string \| null`, taken from USER lines and attributed ("Caller said: …"). The Gemini system instruction becomes: never state Aangan's prices, ranges or rates; you may report the caller's own stated budget only in `caller_stated_budget`. The brief price-scan runs on every field **except** `caller_stated_budget`. No USER-line redaction before Gemini. §18's t10 assertion becomes "t10's **agent lines** contain no budget figure" (t10 is `declined`, so it has no brief anyway). The stored transcript is kept verbatim. Vaani extraction is unchanged: `budget_mentioned` stays an enum and Vaani's `notes_for_designer` still has no figures. |
| D2 | **Redacted qualified.md.** | `Docs/qualified.kb.md` (example figure replaced by words) is used for the KB upload (§19) and in `lib/brief/qualified.ts`. A test asserts it passes `priceScan`. |
| D3 | **Timeline:** decline under about 8 weeks; 8–10 weeks counts as `unclear`, so book and note it for the designer. | VAANI_AGENT.md timeline rule and the `timeline_fit` prompt are updated to match (done). |
| D4 | **Tests use an in-memory repo, plus PGlite to check the migrations.** | As in §0. |

Defaults I'll use unless you say otherwise: Q3 → (b) retry the call-history lookup inline for up to ~20 s, then send with "number pending". Q6 → yes. Q7 → yes. Q11 → `git init` at CP1. Q13 → yes, extend the scanner. Q4 → seed placeholder rates marked `TODO` until you give real ones.

## 5. Open questions for you

1. ~~`/context` is missing~~ **Resolved:** the files are in `Docs/` and `Problem Statement/`. I'll reference `Docs/` (and won't move your files). Findings are in NOTES.md §6.
2. **Live verification.** Can you make one short inbound test call (with the webhook pointed at a tunnel or webhook.site) so I can capture the real `call_postprocessing` payload, `call_id` format, transfer-event `room_name`, and a call-history row with `call_cost`? I'll save it as `fixtures/_live_sample.json` and make the fixtures match it.
3. **Caller number for urgent emails (C2).** The webhook doesn't include the caller's number; only call-history does, and it may lag. Options:
   - (a) Send the urgent email immediately, showing "number pending — see dashboard" if the lookup misses.
   - (b) Retry the lookup inline for up to ~20 s before sending.
   - (c) Send immediately, then have the cron send a follow-up with the number.

   I recommend (b), falling back to (a).
4. **Cost rates for `settings`.** What should `credit_to_inr`, Gemini ₹/Mtok (input and output), `credits_loaded` and `low_balance_threshold_credits` be? They aren't in any doc I have. Without them I'll seed placeholder values marked `-- TODO` and the dashboard ₹ figures will be illustrative.
5. **Test database.** OK to use an in-memory repo for unit and e2e tests, plus PGlite to prove the migrations compile, instead of a local Supabase (Docker)? This keeps `npm test` dependency-free.
6. **Existing client inside working hours, transfer successful (t09).** §7 says record only. Should the transferred call still get a lead row with no designer (status only)? I'll assume yes, matching "declines and vendors get a row too".
7. **Booked but not found in Cal.com → treated as callback.** Should the designer email still go out, with needs_attention set? I'll assume yes (§7d says "treat as callback").
8. **Resend recipients in live tests.** Should all three seed designers, `FRONT_DESK_EMAIL` and `OWNER_EMAIL` be your Resend account address? The designer emails will look identical apart from the designer name in the body.
9. **Cal.com free plan.** Please confirm you can create an API key on your account (curl in NOTES.md §2.2). If not, booking confirmation would always fail, and every booking would be downgraded to a callback.
10. **Webhook URL with `?token=`.** Please confirm the Vaani dashboard accepts a query string in the webhook URL. If not, I'd move the token into the path (`/api/webhooks/vaani/<token>`), which is a small deviation from §7.1.
11. **Git.** The folder isn't a git repository yet. OK for me to `git init` at checkpoint 1, with `.env.local` in `.gitignore`?
12. **t10 transcript vs §18 (NOTES P2).** In T10 the caller says their own budget figure. Which do you want?
    - (a) A realistic USER line with the figure. Assert that AGENT lines and the brief contain none, and redact USER money figures before the transcript goes to Gemini. *(recommended)*
    - (b) Write the caller line without a figure, so the whole transcript is figure-free and §18 holds literally.
13. **Price scanner extensions (NOTES P4–P6).** OK to add the Hindi and Devanagari money terms, skip "starting at <time>", and use word boundaries? These extend §10 but stay in its spirit.
14. **Timeline threshold (NOTES R1).** The docs say 6 weeks (services.md), 8–10 weeks (qualified.md) and about 10 weeks (VAANI_AGENT.md). T02, booked by the front desk, sits around 8–12 weeks. Should VAANI_AGENT.md stay at "under about 10 weeks", or change to "under about 8 weeks, with 8–10 unclear → book and note it"?
15. **Redacted qualified.md for the Vaani KB and Gemini (NOTES P1).** OK to create `Docs/qualified.kb.md`, with the example budget figure replaced by words, and change the §19 manual step to upload that file instead of the original?

### Additions to the file list from the source review
- CP2: ~~`lib/redact.ts`~~ dropped per D1 (the caller's own budget may reach the brief). `lib/crypto.ts` (`safeEqual`) added for webhook, cron and link secret comparisons.
- CP4: `lib/brief/qualified.ts` (redacted rubric text) and `Docs/qualified.kb.md` (same text, for the KB upload). A test asserts both pass `priceScan`.
- CP3 fixtures use the transcript details in NOTES §6.3 (names, localities, sizes, scopes). Agent lines follow VAANI_AGENT.md and contain no ratios or figures.
