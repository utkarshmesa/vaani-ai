import { describe, expect, it } from 'vitest';
import { geminiInr, totalInr, vaaniInr } from '@/lib/cost';

const rates = { credit_to_inr: 1.5, gemini_input_inr_per_mtok: 25, gemini_output_inr_per_mtok: 210 };

describe('cost', () => {
  it('converts Vaani credits to ₹', () => {
    expect(vaaniInr(12.5, rates)).toBe(18.75);
    expect(vaaniInr(null, rates)).toBeNull();
  });

  it('prices Gemini tokens per million', () => {
    // 2,000 in × 25/1e6 + 400 out × 210/1e6 = 0.05 + 0.084
    expect(geminiInr(2000, 400, rates)).toBeCloseTo(0.134, 10);
    expect(geminiInr(0, 0, rates)).toBe(0);
  });

  it('totals only once the Vaani cost is known', () => {
    expect(totalInr(18.75, 0.134)).toBeCloseTo(18.884, 10);
    expect(totalInr(null, 0.134)).toBeNull();
    expect(totalInr(18.75, 0)).toBe(18.75);
  });

  it('rounds to 4 decimal places to avoid float noise', () => {
    expect(vaaniInr(0.1, { ...rates, credit_to_inr: 0.2 })).toBe(0.02);
    expect(totalInr(0.1, 0.2)).toBe(0.3);
  });
});
