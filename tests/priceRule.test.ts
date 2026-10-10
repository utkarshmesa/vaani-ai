import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md: "Never put pricing.md numbers anywhere in code, prompts, emails or fixtures."
 * Scans every source, test, fixture and prompt file for a pricing.md figure used as money
 * (next to ₹ / Rs / rupees / lakh / per sq …). Docs/pricing.md and the original Docs/qualified.md are the only exceptions.
 */
const ROOTS = ['app', 'lib', 'scripts', 'tests', 'fixtures', 'supabase', 'VAANI_AGENT.md', 'Docs/qualified.kb.md', 'proxy.ts'];
const TEXT = /\.(ts|tsx|json|sql|md)$/;

function files(p: string): string[] {
  const s = statSync(p);
  if (s.isFile()) return TEXT.test(p) ? [p] : [];
  return readdirSync(p).flatMap((f) => files(join(p, f)));
}

const pricing = readFileSync('Docs/pricing.md', 'utf8');
const figures = [...new Set(pricing.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])].filter((n) => n !== '1' && n !== '2');
const money = String.raw`(?:₹|rs\.?|rupees?|rupaye|lakhs?|lacs?|crores?|per\s*sq|/\s*sq)`;

describe('price rule across the repo', () => {
  it('found the pricing.md figures to look for', () => {
    expect(figures.length).toBeGreaterThan(5);
  });

  it.each(ROOTS.flatMap(files))('%s uses no pricing.md figure as money', (file) => {
    const text = readFileSync(file, 'utf8');
    for (const fig of figures) {
      const num = fig.replace(/,/g, '').split('').map((c) => (c === '.' ? '\.' : c)).join(',?');
      const re = new RegExp(String.raw`(${money}\s*(?<![\d.])${num}(?![\d])|(?<![\d.,])${num}(?![\d])\s*(?:\+\s*)?${money})`, 'i');
      expect(text, `${file}: ${fig}`).not.toMatch(re);
    }
  });
});
