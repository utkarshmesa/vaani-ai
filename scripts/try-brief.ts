/**
 * npm run brief:try -- <fixture>
 *
 * Generates a designer brief for a fixture with the REAL Gemini API (GEMINI_API_KEY / GEMINI_MODEL from .env.local),
 * runs it through the same validation and price guard as production, and prints it. Nothing is stored or emailed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createGeminiAdapter } from '@/lib/adapters/gemini';
import { mocks } from '@/lib/adapters/mocks';
import { setAdapters } from '@/lib/adapters';
import { generateBrief } from '@/lib/brief/generate';
import { mapEntities } from '@/lib/mapEntities';
import type { CallRow, LeadRow } from '@/lib/db/types';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const name = process.argv[2];
if (!name || !existsSync(`fixtures/${name}.json`)) {
  console.error('Usage: npm run brief:try -- <fixture>');
  process.exit(1);
}
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;
if (!key || !model) {
  console.error('Set GEMINI_API_KEY and GEMINI_MODEL in .env.local');
  process.exit(1);
}

const payload = JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8'));
const { fields } = mapEntities(payload.data.entities);
const lead = {
  ...fields, id: 'try', call_id: payload.call_id, booking_confirmed: fields.outcome === 'booked', cal_booking_uid: null,
  designer_id: null, brief_json: null, brief_text: null, clock_started_at: null, email_sent_at: null, reminder_sent_at: null,
  escalated_at: null, accepted_at: null, reassign_count: 0, consultation_outcome: null, outcome_requested_at: null,
  outcome_logged_at: null, needs_attention: false, attention_reason: null, created_at: payload.timestamp,
} as LeadRow;
const call = { call_id: payload.call_id, transcript: payload.data.transcript } as CallRow;

setAdapters({ ...mocks, gemini: createGeminiAdapter({ apiKey: key, model }) });
const started = Date.now();
const r = await generateBrief(lead, call);
console.log(`model ${model} · ${Date.now() - started} ms · attempts ${r.attempts} · tokens in ${r.inputTokens} / out ${r.outputTokens}`);
if (r.failure) console.log(`failure: ${r.failure}`);
if (r.removedLines.length) console.log('removed (price):', r.removedLines);
console.log(`needs attention: ${r.needsAttention}\n`);
console.log(r.text ?? '(no brief)');
