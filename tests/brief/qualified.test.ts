import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUALIFIED_RUBRIC } from '@/lib/brief/qualified';
import { scanText } from '@/lib/priceScan';

const kb = readFileSync('Docs/qualified.kb.md', 'utf8').replace(/^<!--[\s\S]*?-->\n/, '');
const original = readFileSync('Docs/qualified.md', 'utf8');

describe('redacted rubric (decision D2)', () => {
  it('lib/brief/qualified.ts matches Docs/qualified.kb.md', () => {
    expect(QUALIFIED_RUBRIC).toBe(kb);
  });

  it('passes the price scanner — the original does not', () => {
    expect(scanText(QUALIFIED_RUBRIC)).toEqual({ flag: false, lines: [] });
    expect(scanText(original).flag).toBe(true);
  });

  it('differs from qualified.md only in the redacted example', () => {
    const a = original.split('\n');
    const b = kb.split('\n');
    expect(b).toHaveLength(a.length);
    const changed = a.map((line, i) => (line === b[i] ? null : i)).filter((i) => i !== null);
    expect(changed).toHaveLength(1);
    expect(b[changed[0]!]).toContain('a figure far below what a full flat redesign would need');
  });

  it('keeps all five criteria', () => {
    for (const c of ['1. Real project', '2. In our service area', '3. Realistic timeline', '4. Right budget band', '5. Decision-maker']) {
      expect(QUALIFIED_RUBRIC).toContain(c);
    }
  });
});
