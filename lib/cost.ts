import type { SettingsRow } from '@/lib/db/types';

/** Running cost of the tool (Vaani credits + Gemini tokens), in ₹. Not related to Aangan's prices. */
type Rates = Pick<SettingsRow, 'credit_to_inr' | 'gemini_input_inr_per_mtok' | 'gemini_output_inr_per_mtok'>;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function vaaniInr(credits: number | null, rates: Pick<Rates, 'credit_to_inr'>): number | null {
  return credits === null ? null : round4(credits * rates.credit_to_inr);
}

export function geminiInr(inputTokens: number, outputTokens: number, rates: Rates): number {
  return round4((inputTokens * rates.gemini_input_inr_per_mtok + outputTokens * rates.gemini_output_inr_per_mtok) / 1_000_000);
}

/** Null until the Vaani cost is known (the cron tick retries the lookup). */
export function totalInr(vaani: number | null, gemini: number): number | null {
  return vaani === null ? null : round4(vaani + gemini);
}

/**
 * Vaani cost estimated from call length, for when call-history can't supply call_cost (NOTES.md: it returns 500
 * on this account). Uses the per-minute rate the Vaani dashboard shows for the agent.
 */
export function estimateVaaniCost(
  durationMs: number,
  rates: Pick<SettingsRow, 'vaani_inr_per_minute_estimate' | 'credit_to_inr'>,
): { inr: number; credits: number } {
  const inr = round4((durationMs / 60_000) * rates.vaani_inr_per_minute_estimate);
  return { inr, credits: round4(inr / rates.credit_to_inr) };
}
