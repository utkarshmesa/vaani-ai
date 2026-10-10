# Vaani MVP — Aangan Studio enquiry handler

Full spec: @SPEC.md · Vaani agent config: @VAANI_AGENT.md · Source docs: /context

## Stack
Next.js (App Router, TypeScript) on Vercel · Supabase (Postgres + pg_cron + pg_net) · Resend · Gemini API (`@google/genai`) · Vaani REST API · Cal.com API

## Commands
- `npm run dev` — local app
- `npm test` — Vitest (unit + pipeline tests, all external services mocked)
- `npm run simulate -- <fixture>` — POST a fixture webhook (t01, t13, t10, t09, t17) to the local app
- `npm run vaani:configure -- --dry-run` — print the Vaani agent config; drop `--dry-run` to apply

## Rules
- IMPORTANT: Vaani must never state a price, range, per-sq-ft rate, or repeat a caller's budget figure. Never put pricing.md numbers anywhere in code, prompts, emails or fixtures.
- All external calls (Vaani, Cal.com, Gemini, Resend) go through adapters in `lib/adapters/`. `MOCK_EXTERNAL=1` swaps in mocks; tests always use mocks.
- Timezone is Asia/Kolkata everywhere. Store timestamps as `timestamptz`.
- Webhook handlers return 200 immediately and process after the response. Processing is idempotent by `call_id`.
- Secrets live in `.env.local` (git-ignored). Never commit keys. `.env.example` lists every variable.
- If an external API behaves differently from the spec, write it in NOTES.md and stop to ask before changing the architecture.
- After each checkpoint: run `npm test`, show the output, then commit with a descriptive message.
