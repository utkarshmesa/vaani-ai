# NOTES — Checkpoint 0: external API verification

Researched 2026-10-10. Each answer links the doc it comes from. Anything marked **UNVERIFIED** needs a live call or account check before we rely on it. **⚠ CONTRADICTS SPEC** marks a place where the docs disagree with SPEC.md.

---

## 1. Vaani

Docs index: https://docs.vaanivoice.ai/llms.txt · Auth `X-API-Key: vaani_<key>`, base `https://api.vaanivoice.ai`, all paths under `/api/` (https://docs.vaanivoice.ai/api-reference/introduction.md). This matches the spec.

### 1.1 Exact inbound `call_id` format: **UNVERIFIED (not documented)**

- Every documented example is outbound: `outbound-1784899978-36cec598`, i.e. `outbound-<unix-epoch>-<8 hex>` (https://docs.vaanivoice.ai/guides/webhook-setup.md, https://docs.vaanivoice.ai/api-reference/call-history.md).
- The Concepts page gives a different example, `room-f5237622` (https://docs.vaanivoice.ai/concepts.md).
- No page shows an inbound id. My guess is `inbound-<epoch>-<hex>`, but nothing confirms it.
- **Decision:** treat `call_id` as an opaque `text` primary key and never parse it. The first live test call will show the real format; record it here.

### 1.2 `call_postprocessing` payload shape: **⚠ CONTRADICTS SPEC §5/§7**

Source: https://docs.vaanivoice.ai/guides/webhook-setup.md

```json
{
  "event": "call_postprocessing",
  "call_id": "outbound-1784899978-36cec598",
  "timestamp": "2026-07-24T13:34:22.278854+00:00",
  "data": {
    "room_name": "...", "call_id": "...",
    "call_duration": 55150.02,        // milliseconds (float)
    "end_reason": "Call ended",
    "summary": "...", "entities": { "name": "..." }, "dispositions": { "acas": "Name Collected" },
    "recording_url": "https://.../api/stream/<call_id>",
    "transcript": "[13:33:14] AGENT: Hi! ...\n\n[13:33:19] USER: ..."
  }
}
```

Where this differs from the spec:
1. **The fields are nested under `data`**, not at the top level. Only `event`, `call_id` and `timestamp` are top-level. The mapper reads `payload.data.*` and falls back to `payload.call_id`.
2. **Transcript lines have a `[HH:MM:SS] ` prefix** before `AGENT:` / `USER:`, and turns are separated by `\n\n`. The Get Call Details endpoint returns the same transcript *without* timestamps and with a leading space (`"\n\n USER: ..."`). The transcript parser must handle both forms. The digits in the timestamps must never trip the price scanner, which is fine because §10 flags money terms, not digits.
3. **There is no caller number.** The payload has no `from_number`. The only documented source is `GET /api/call-history` → `from_number`. The urgent front-desk email needs "summary + caller number" (§7d), so it depends on a call-history lookup that may not be ready yet. → Open question Q3 in PLAN.md.
4. `call_duration` is a float (ms). Store `round()` in `duration_ms int`.
5. Entity and disposition value types aren't specified. Call Details shows strings such as `"Yes"`/`"No"`, `"N/A"` and `null`. The mapper normalises `"N/A"`, `"null"`, `""` and `"none"`-ish placeholders to `null`, and validates enums case-insensitively.

### 1.3 Transfer events: **⚠ PARTLY CONTRADICTS SPEC**

Source: https://docs.vaanivoice.ai/guides/webhook-setup.md. `human_transfer_initiated | _successful | _failed` fire for inbound calls, which matches the spec. However:
- They carry **`room_name`, not `call_id`**: `{"event":"human_transfer_failed","room_name":"room_123abc","transfer_type":"warm","phone_number":"+91…","reason":"busy","sip_status":"busy"}`.
- In the postprocessing example `room_name === call_id`, so we join on that. **UNVERIFIED for inbound calls**; confirm on the T09 live call.
- `phone_number` here is the **transfer target**, not the caller.

### 1.4 Does call-history return `call_cost` for inbound calls? **Probably yes, UNVERIFIED**

Source: https://docs.vaanivoice.ai/api-reference/call-history.md
- `GET /api/call-history?page=&page_size=` (max 200). Each call object includes `call_cost` ("Call cost in credits"), `call_type` (`Outbound` | `Inbound`), `direction` (`Outbound` | `Incoming`), `from_number`, `to_number`, `Start_time`, `End_time`, `duration_ms`, `post_processing_status`.
- Nothing says `call_cost` is missing or null for inbound calls, but every example is outbound. Confirm on the first live call.
- **Gaps that affect our design:**
  - **There is no filter by `call_id` or date.** The only query params are `page` and `page_size` (also in https://docs.vaanivoice.ai/api-reference/openapi.json). To find a call we page through results. Sort order isn't documented; I'll assume newest first and cap the scan at 3 pages × 200. If the call isn't found, leave cost null and let the cron retry, as the spec already says.
  - `Start_time` / `End_time` have **no timezone offset** (`"2026-04-21T12:27:23.335803"`). Assume UTC. **UNVERIFIED.**
  - The example `duration_ms: 742.269` doesn't match its own 34 s start/end gap, so the field isn't trustworthy. **Use the webhook's `call_duration` for duration.** Use call-history only for `call_cost` and `from_number`.
  - `call_cost` may be 0 or still changing while `post_processing_status != "completed"`. Accept a cost only when that status is `completed`.

### 1.5 Other Vaani findings

- **Doc vs OpenAPI mismatch on Call Details:** the page says `GET /api/call_details/{call_id}`, the OpenAPI spec says `/api/call_details/{client}/{call_id}`. We don't need this endpoint in the MVP, so it doesn't matter.
- **No webhook signing.** Vaani documents no signature or secret. Our `?token=` query secret is the only protection, which is fine as long as the dashboard (Settings → Webhooks) accepts a URL with a query string. **UNVERIFIED.** The agent object also has a `"webhook": null` field (seen in the Update Persona response), so a per-agent webhook may be settable through the API. That's undocumented and we won't use it.
- **No documented retries or delivery guarantees.** Our idempotency by `call_id` covers duplicates.
- **Agent config endpoints** are all `PATCH` with deep-merge: `/api/agent/{id}/persona | training | experience | analysis | deployment`.
  - Persona → `identity.system_prompt`, `identity.greeting_message.agent_message` (https://docs.vaanivoice.ai/api-reference/update-persona.md). The default LLM in the example is `google` / `gemini-3.5-flash`, and `persona.timezone` is `Asia/Kolkata`.
  - Training → `know_how.faq` is a **map `{question: answer}`**, not a list. `know_how.guardrails = {level: "strict", custom_rules: [{rule: "..."}]}` (https://docs.vaanivoice.ai/api-reference/update-training.md).
  - Analysis → `extraction.data_collection = {enabled, data_points: [{name ≤30, prompt, values?, nullable}]}`. Dispositions use **`evaluations.dispositions = {enabled, prompt_based: [{name, type: "bool"|"string"|"number", prompt, list_of_tags?}]}`** (https://docs.vaanivoice.ai/api-reference/update-analysis.md).
  - Experience → `settings.call_settings.max_call_duration` (minutes) + `max_duration_enabled`. Idle settings use `idle_call_warning_timeout` and `idle_call_hangup_timeout` (5–60 s), and `end_call.enabled` (https://docs.vaanivoice.ai/api-reference/update-experience.md). The **wrap-up message field** (`max_duration_hangup_message`) shows up only in responses, not in the request schema. We'll send it anyway and report if it's ignored.
- **The Cal.com booking tool and the transfer tool can't be configured through the documented API.** `persona.actions` is "provider-specific shape". Both stay manual dashboard steps, which matches §19 (https://docs.vaanivoice.ai/guides/integrations.md).

---

## 2. Cal.com API v2

### 2.1 List-bookings endpoint, auth and version headers

Source: https://cal.com/docs/api-reference/v2/bookings/get-all-bookings
- `GET https://api.cal.com/v2/bookings`
- `Authorization: Bearer <API key>`. Keys look like `cal_…` (test) or `cal_live_…` (live) (https://cal.com/docs/api-reference/v2/introduction).
- **`cal-api-version: 2026-05-01`** (required for this endpoint; the version is per-endpoint).
- Useful query params: `eventTypeId` (single), `afterStart`, `beforeEnd` (ISO), `status` (`upcoming|recurring|past|cancelled|unconfirmed`, one per request; omit for all), `sortStart`, `limit` (1–100, default 50), `cursor`. Pagination is **cursor-based** (`pagination.nextCursor`, `hasMore`), not take/skip.
- Response: `data[]` with `uid`, `start`, `end`, `status` (`accepted|pending|cancelled|rejected|awaiting_host`), `eventType: {id, slug}`. The `eventTypeId` field is deprecated in the response. `attendees[]` has `name`, `email`, `timeZone`.
- Rate limit is 120 req/min per API key, which is plenty.

**⚠ Detail that affects §7d's "±10 minutes" window:** `beforeEnd` filters on the booking's **end**, not its start. A 45-min consultation starting exactly at the slot would fail `beforeEnd = slot+10m`. The adapter should therefore query `afterStart = slot − 10m` and `beforeEnd = slot + 10m + 4h` (generous). The pure `matchSlot()` function then keeps bookings whose `start` is within ±10 min and whose `status` is `accepted` or `pending`, and drops cancelled or rejected ones.

### 2.2 Does it work on a free account? **UNVERIFIED**

- The v2 intro lists plan restrictions only for the Platform, Teams and Orgs endpoint families. `/v2/bookings` isn't in those, which suggests individual (free) accounts can use it with a personal API key (https://cal.com/docs/api-reference/v2/introduction).
- No official page states that free accounts get API keys. Third-party sources contradict each other ([costbench](https://costbench.com/software/scheduling/cal-com/free-plan/), [Cal.com blog](https://cal.com/blog/where-is-my-api-key-and-what-can-it-do)).
- **Action for you:** in a free Cal.com account, check Settings → Developer → API Keys, create a key, and run:
  `curl -H "Authorization: Bearer $KEY" -H "cal-api-version: 2026-05-01" "https://api.cal.com/v2/bookings?limit=1"`

---

## 3. Gemini (`@google/genai`)

Source: https://ai.google.dev/api/generate-content (UsageMetadata, GenerationConfig)
- Usage fields on `response.usageMetadata`: **`promptTokenCount`**, **`candidatesTokenCount`**, **`thoughtsTokenCount`**, `cachedContentTokenCount`, `toolUsePromptTokenCount`, **`totalTokenCount`** (= prompt + thoughts + candidates).
- **⚠ Spec gap:** §6 has only `gemini_input_tokens` / `gemini_output_tokens`. Current Flash models are thinking models, and thinking tokens are billed as output. **Decision:** `gemini_output_tokens = candidatesTokenCount + (thoughtsTokenCount ?? 0)`, `gemini_input_tokens = promptTokenCount`. We'll also set a low `thinkingConfig.thinkingBudget` to keep cost down.
- JSON output: `config: { systemInstruction, responseMimeType: "application/json", responseJsonSchema | responseSchema }`. We still validate with zod, as the spec says.

---

## 4. Resend

- **Sandbox restriction:** without a verified domain, you can send only from `onboarding@resend.dev`, and only **to the email address of the Resend account owner**. Any other recipient returns 403 (https://resend.com/docs/knowledge-base/403-error-resend-dev-domain). This matches the spec.
  - So for live tests, `EMAIL_FROM=onboarding@resend.dev`, and every designer, front-desk and owner address must be the account owner's address. **UNVERIFIED:** whether `owner+alias@…` counts as the owner address. Assume it doesn't.
  - Test sinks `delivered@resend.dev` (and `+label` variants) simulate delivery (https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing). It's unclear whether they're exempt from the sandbox restriction, so they aren't relied on.
  - `@example.com` recipients return 422, so **seed designers must not use example.com** if live sends are ever on.
- **Rate limit:** 10 requests/second per team (https://resend.com/docs/api-reference/rate-limit). Free plans also have daily and monthly quotas (429 `daily_quota_exceeded` / `monthly_quota_exceeded`). The cron tick can send several emails at once, so the adapter sends them one after another.

---

## 5. Summary: what contradicts or is missing from the spec

| # | Item | Spec says | Docs say | Proposed handling (no architecture change) |
|---|---|---|---|---|
| C1 | Payload shape | `call_id`, `summary`, … in the webhook | nested under `data`; only `call_id`/`event`/`timestamp` top-level | mapper reads `data.*` |
| C2 | Caller number | `calls.from_number` from the webhook | not in the webhook; only in call-history | fill from the call-history lookup (see Q3) |
| C3 | Transfer events | joined to the call | carry `room_name`, no `call_id` | join on `room_name`; verify live |
| C4 | Transcript lines | `AGENT:` / `USER:` prefix | `[HH:MM:SS] AGENT:` (webhook) or ` AGENT:` (details) | parser strips optional timestamp and whitespace |
| C5 | Call-history lookup | "matching call_id" | no filter params; page through results | scan ≤3 pages × 200; cron retries |
| C6 | Cal.com ±10 min | ±10 min window | `beforeEnd` filters on end time | wide query + pure ±10 min match on `start` |
| C7 | Gemini tokens | input/output only | thinking tokens billed separately | output = candidates + thoughts |
| C8 | Inbound call_id format | "exact format" | not documented | opaque text; capture from the first live call |
| C9 | Vaani `max_duration_hangup_message` | wrap-up message | response-only field | send it; report if ignored |
| C10 | Repo `/context` folder | services.md, qualified.md, pricing.md, PDF | **not present in the repo** | blocks fixtures and the brief prompt (Q1) |

None of these requires changing the architecture in §3. They are all handled inside the adapters and mappers.

C10 is resolved: the source files are in `Docs/` (not `/context`) and `Problem Statement/`. See §6.

---

## 6. Source material review (Docs/, Problem Statement/)

I read all of: `Docs/services.md`, `Docs/qualified.md`, `Docs/pricing.md`, `Docs/Aangan_Sep 2026_Enquiries.pdf` (T01–T20, W01–W10, F01–F10), and `Problem Statement/Problem Statement Vaani.pdf`.

### 6.1 Price-leak risks the spec doesn't cover

| # | Finding | Risk | Proposal |
|---|---|---|---|
| P1 | **qualified.md contains a budget figure.** Criterion 4 gives an example rupee range for a full-flat redesign. §19 says to upload qualified.md to the Vaani knowledge base, and §11 says to feed it to Gemini. | Vaani's RAG or the brief could repeat that figure, which breaks the price rule. | Use a **redacted copy**: `Docs/qualified.kb.md` and `lib/brief/qualified.ts` keep the criterion text but replace the example with "a figure clearly below what the described scope would cost". A test asserts the copy passes `priceScan`. Upload the redacted file to the KB, not the original. |
| P2 | **Transcript figures in caller lines.** In T10 the caller says their budget figure (the front desk even repeated it). A realistic t10 fixture has that figure in a USER line. | §18 says "t10's *transcript* … contain[s] no budget figure", but the caller's own words will contain it. Gemini also sees the transcript, so the brief could repeat it. | Keep the raw transcript as the record. Assert that **AGENT lines** have no figure. **Redact money figures from USER lines before sending the transcript to Gemini**, and scan the brief. Alternatively, write the t10 caller line without a figure. → Q12 |
| P3 | **Problem statement figure.** The problem statement quotes an average project value in rupees. | Same rule applies. | Never used in code, prompts, emails or fixtures. Dashboard "₹ per won proposal" is only cost ÷ count, with no project value. |
| P4 | **Hindi and Marathi calls.** VAANI_AGENT.md lets the agent reply in Hindi, and W03 is in romanised Hindi. The §10 term list is English only: `rupaye` doesn't match `rupee`, and Devanagari `लाख` / `करोड़` / `रुपये` don't match anything. | A price quoted in Hindi would get past the scanner. | Add `rupaye|rupaiye|rupay`, `लाख`, `करोड़`, `रुपय`, `₹`, `प्रति वर्ग` and `per sq` to the term list. This extends §10. → Q13 |
| P5 | **"starting at" / "starts at" catch times.** The agent reads booking times back ("a slot starting at 11 am"). §10 says not to flag times. | Every booked call would be flagged. | Skip `starting at` / `starts at` when it's directly followed by a time (`\d{1,2}(:\d{2})?\s*(am|pm)` or `\d{1,2}:\d{2}`). |
| P6 | **Short terms match inside words.** `rs`, `lac` and `rate` appear inside "hours", "place" and "accurate". | False flags. | Match on word boundaries: `\brs\.?\b`, `\blacs?\b`, `\brates?\b`. Tests cover "hours", "first", "yours", "place", "accurate", "separate", "corporate", "Mrs". |

### 6.2 Rule contradictions between the docs

| # | Topic | services.md | qualified.md | VAANI_AGENT.md | What the transcripts show | Proposal |
|---|---|---|---|---|---|---|
| R1 | **Timeline threshold** | "cannot begin execution on a project that needs to be ready in under **6 weeks**" | "site must be available for execution within **8–10 weeks** of the consultation"; a 3-week deadline fails | decline if completion is needed in under **about 10 weeks** | T07 (3 weeks to Diwali) declined. T02 (call 3 Sep, move-in November, about 8–12 weeks) was **booked**. Under VAANI_AGENT's 10-week rule T02 is borderline and might be declined. | → Q14. My recommendation: keep VAANI_AGENT.md's wording but say "under about **8** weeks", and treat 8–10 weeks as `unclear` and book. |
| R2 | **Far-future projects** | — | criterion 3 can be read as "the site must be available *soon*" | not covered | F06 starts Feb 2027 (5 months out) and is a serious lead | Don't decline far-future projects; add them to `notes_for_designer`. This matches VAANI_AGENT.md. |
| R3 | **How many failures decline** | — | the opening says "fails one → close"; the boundary section says "**two or more** fail → decline" | any one clear fail → close | T03 (area only) and T10 (budget only) were both declined after one fail | Follow VAANI_AGENT.md (one clear fail), which matches the transcripts. Noted only. |
| R4 | **Commercial minimum** | not stated | not stated | under about 500 sq ft is below scale | T18: front desk says commercial is "500 sq ft or more" | Consistent with practice. Use `too_small`. |
| R5 | **Budget decline** | — | "note it and **do not forward**" | close the call politely | T10 declined | `declined` / `budget`, no designer. Consistent. |

### 6.3 Data quirks that affect fixtures

- **Weekdays in the PDF follow the 2025 calendar.** W05 calls 20 Sept a Saturday and W03 calls 4 Oct a Saturday, but in 2026 both are Sundays. The working-hours logic uses real 2026 weekdays. Fixture timestamps are picked so their in-hours / after-hours status is what each test needs, and the weekday is stated in a comment.
- **T09 (10 Sep 11:32, Thursday) is inside working hours.** `t09` keeps that time, so the transfer succeeds and the call is record-only. `t09_failed` moves it to **22:40 the same day**, after hours, with `human_transfer_failed`. The agent takes name, project and best callback time, per VAANI_AGENT.md.
- **T17 is two calls.** The spec fixture is only the first, dropped call (about 72 s). The callback becomes a separate call, so a separate lead, and **the front desk could chase a caller who has already rebooked**. Matching repeat callers by `from_number` isn't in the spec, so I won't build it. The dashboard's Needs-attention list shows the caller number, so the front desk can see the overlap.
- **T13: in the real call the front desk gave a cost ratio** ("…can be 3× the cost"). The fixture uses the approved line, then VAANI_AGENT.md's "press again" wording (any number now could be far off, the consultation is free, the designer gives a proper figure). No ratios.
- **T01 and T13 need `booked_slot_iso`.** The slots are on working days after the call, at a time such as 11:00 +05:30. The mock Cal.com returns bookings at exactly those slots.
- **Front-desk hours**: the problem statement says 10am–7pm; W05 says "closed over the weekend". This matches the `settings` default of Mon–Fri 10:00–19:00.
- **Persona says "14 designers"**: that matches the problem statement. The seed has 3 test designers, per §6.
- **Handoff channel**: the problem statement asks us to pick Telegram or email; the spec picks email (Resend). No change.

---

## 7. Live verification log

- **2026-10-10 · Cal.com free account: works.** `GET /v2/bookings?limit=1` with `cal-api-version: 2026-05-01` returned 200 `{"status":"success","data":[],...}`. `GET /v2/event-types` returned 200 with only the default types (15 min, 30 min, secret). **The "Studio consultation" event type isn't created yet** (§19 manual step); its id goes in `CALCOM_EVENT_TYPE_ID`.
- **2026-10-10 · Local simulation (`npm run dev` with MOCK_EXTERNAL=1, `npm run simulate -- all`):** every fixture returned 200. The mock outbox showed designer emails in rotation for t01, t13 and price_leak; urgent emails for t09_failed (transfer failed) and t17 (call dropped); nothing for t10; and no second email when t01 was posted again. t09 produced an "existing client after hours" email because simulate stamps payloads with the current time (a Saturday evening). Use `--keep-time` to replay the fixture's in-hours timestamp.
- **⚠ Webhook token shows up in request logs.** Next.js (and Vercel's request logs) print the full URL, including `?token=…`. SPEC §7.1 puts the secret in the query string, and Vaani documents no header or signature option. Mitigations: treat Vercel logs as sensitive, and rotate `VAANI_WEBHOOK_SECRET` if logs are shared. Moving the token into the path wouldn't help, because the path is logged too.
- **2026-10-10 · Gemini keys:** 3 keys supplied. Key 1 returns 401 UNAUTHENTICATED (pasted incompletely, or revoked); keys 2 and 3 work. `.env.local` lists them as 2,3,1 and the adapter falls back on 401/403/429/5xx. `gemini-2.5-flash` returns 404 ("no longer available to new users"). **`GEMINI_MODEL=gemini-3.8-flash`** works with `responseJsonSchema`, `systemInstruction` and `thinkingConfig`. Real `usageMetadata` had `promptTokenCount`, `candidatesTokenCount` and `totalTokenCount`, with no `thoughtsTokenCount` (no thinking used).
- **2026-10-10 · Real Gemini briefs (`npm run brief:try`):** t01, t13 and price_leak each produced a schema-valid brief on the first attempt (~1,600–2,000 input and ~400 output tokens, 4–7 s). None contained a price; for price_leak, Gemini did not carry the agent's leaked figure into the brief.
- **⚠ Click links are GETs (per SPEC §12).** Some corporate mail scanners (e.g. Outlook Safe Links) open links before a person does, which could auto-accept a lead and distort the RC3 timings. Gmail does not. If the studio uses Outlook, switch to "GET shows a confirm button; POST does the action" (one extra click). Not built, to keep the one-click design in the spec.
- **2026-10-10 · Cron tick live check (`next dev`, mock mode):** `POST /api/cron/tick` returned 401 without or with a wrong bearer token. With the right token, the first tick sent t01's outcome request (its slot was in September), the second sent nothing, and the emailed "Site visit booked" link recorded the outcome. pg_cron reads the app URL and `CRON_SECRET` from Supabase Vault (`supabase/migrations/0003_cron.sql`), so no secret is committed.
- **2026-10-10 · Dashboard live check:** `/dashboard` without a session redirected to `/login` and kept the requested range. After signing in, the September fixture set (`npm run simulate -- all --keep-time`) showed 7 calls, 1 after-hours (14%), 5/7 complete records, the outcome breakdown, 1 price-flagged call with its line, ₹87.90 total (Vaani ₹87.50 + Gemini ₹0.40), 912.5 credits left, and 3 needing attention (t17 dropped, t09_failed transfer, price_leak price flag).
- **Next.js 16 renamed middleware to "proxy"** (`proxy.ts`, same feature). Next recommends proxy only for optimistic checks, so `/dashboard` also verifies the session itself. There is no rate limit on `/api/login`; use a long `DASHBOARD_PASSWORD`.
- **2026-10-10 · Vaani agent created** via the dashboard's Design → Agents → New Agent → **Import from JSON**, with JSON from `npm run vaani:configure -- --import-json <file>`. The agent is "Aangan Studio enquiries", id **`ee5284b3-0ec5-4789-ba85-9b9b68eaa381`**. Findings:
  - The import format is the API config shape (`persona`, `training`, `experience`, `analysis`, `deployment_config`, `frontend_features`). The dashboard validates providers per account: **AWS TTS is disallowed**, and **primary and fallback TTS must be different providers**, so the fallback voice is ElevenLabs. **`google` / `gemini-3.5-flash` is accepted as the LLM** (SPEC §19).
  - Stored config (read back from the dashboard's own API): prompt, greeting, 6 FAQ, strict guardrails plus the 5 custom rules, the 16 extraction data points and the `price_mentioned` disposition, all exact. Vaani set `use_rag: true` itself and dropped `word_pronunciation_pairs`.
  - The dashboard's **Training → Guardrails → Custom Rules tab crashes** ("Something went wrong") with rules stored as `[{ "rule": "…" }]`, the shape in the Update Training API docs. The rules are stored, but the tab can't display them. Report to Vaani, or re-add the rules through the UI if the crash matters.
  - The agent page shows **"Running · ₹5.60/min (est.)"**. That's a better basis for the `settings` cost rates than the placeholders (Q4); confirm how credits map to ₹ on the billing page.
- **2026-10-10 · Vaani API key works** for `GET /api/list-agents` (200, returns our agent) and for `npm run vaani:configure`, which PATCHed persona, training, experience and analysis.
- **⚠ CONTRADICTS SPEC §5/§7.3c — `GET /api/call-history` returns 500 on this account:** `"Error fetching call history: 400: Invalid client_id format"`. The error path shows Vaani rewrites the request to `/api/call-history/<user_id>/Mesa School Business ` — the **organisation name, with a trailing space**, where a client UUID (`7a1513dd-…`) belongs. Adding `client_id` or `agent_id` query params, or a trailing slash, doesn't help. Call-history is the only documented source of `call_cost` and the caller's `from_number`, so until this is fixed the pipeline stores calls with **cost unknown** and urgent emails say **"number pending"**. Nothing is lost; the cron keeps retrying for 7 days. Raised with the user; fix options in PLAN.md Q16.
- **Decision (user, 2026-10-10): fallback only for the call-history bug.**
  - **Cost:** when call-history can't supply `call_cost`, the call gets an estimate: length × `settings.vaani_inr_per_minute_estimate` (₹5.60, from the agent page), converted to credits with `credit_to_inr`, with `calls.cost_estimated = true` (migration 0004). The cron keeps retrying for 7 days and swaps in the real cost if call-history recovers. A failing lookup is logged once an hour (`cost_lookup_failed`), not as a cron error every minute. The dashboard counts estimates in totals and credits, and says how many are estimates.
  - **Caller number:** taken from Vaani's `call_started` webhook `phone_number` (recorded as a `caller_number` event), and also backfilled if `call_started` arrives after processing. **Unverified** whether that is the caller for inbound calls; check on the first live call.
  - Lookups that error are no longer retried inline, so urgent emails aren't delayed about 20 s by a broken endpoint.
- **2026-10-10 · Deployed (checkpoint 8).** Production: **https://vaani-ai-sandy.vercel.app** (Vercel project `vaani-ai`, team `utkarshmesaai`; `vaani-ai.vercel.app` was taken). Supabase project `vaani-ai` (`djovzjfnirwumjkrzlhy`, ap-south-1): migrations 0001–0004 applied; pg_cron + pg_net enabled; Vault secrets `vaani_app_base_url` and `vaani_cron_secret` set; job `vaani-tick` runs every minute (first run 200, no errors). The 3 test designers' emails were set to the Resend account owner's address (sandbox). Production secrets are in the git-ignored `.env.production.local`. Cal.com event type intentionally unset (deferred).
- **Live end-to-end test** (`npm run simulate -- <fixture> --env .env.production.local --test-id`):
  - `test-…-t01`: processed. Call-history 500 → estimated cost 23.55 credits; real Gemini brief (1,899 in / 446 out tokens); booked → callback flagged "Cal.com event not set up — verify the booking"; designer Ananya; designer email "New lead · Kothrud, Dahanukar Colony · apartment · call back" sent via Resend.
  - `test-…-t17`: processed; incomplete → urgent "Call back — call dropped · number pending" email sent (no `call_started`, so no caller number).
  - Both test rows remain in the database, prefixed `test-`. t01's lead is unaccepted, so the cron will send its reminder and escalation after 15/30 working minutes (Monday 10:15 / 10:30 IST) unless it is accepted or the test rows are removed.
