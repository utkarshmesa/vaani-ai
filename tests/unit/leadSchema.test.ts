import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEAD_FIELDS, LEAD_FIELD_NAMES, type LeadFieldDef } from '@/lib/leadSchema';
import { LEAD_OUTCOMES } from '@/lib/db/types';

const field = (name: string): LeadFieldDef => (LEAD_FIELDS as readonly LeadFieldDef[]).find((f) => f.name === name)!;

/** Parse the extraction table in VAANI_AGENT.md: | name | values | prompt | */
function agentMdDataPoints() {
  const md = readFileSync('VAANI_AGENT.md', 'utf8');
  const section = md.split('## Analysis — extraction data points')[1].split('\n## ')[0];
  return section
    .split(/\r?\n/)
    .filter((l) => /^\| [a-z_]+ \|/.test(l) && !l.startsWith('| name |')) // skip the header row
    .map((l) => {
      const [name, values, prompt] = l.split('|').slice(1, 4).map((c) => c.trim());
      return { name, values: values === '—' ? undefined : values.split(',').map((v) => v.trim()), prompt };
    });
}

describe('leadSchema', () => {
  it('lists the SPEC §8 fields in order', () => {
    expect(LEAD_FIELD_NAMES).toEqual([
      'caller_name', 'enquiry_type', 'locality', 'in_service_area', 'property_type', 'carpet_area_sqft', 'scope',
      'completion_deadline', 'timeline_fit', 'decision_maker', 'budget_mentioned', 'outcome', 'decline_reason',
      'booked_slot_iso', 'callback_preference', 'notes_for_designer',
    ]);
  });

  it('keeps names unique and within Vaani’s 30-character limit', () => {
    expect(new Set(LEAD_FIELD_NAMES).size).toBe(LEAD_FIELD_NAMES.length);
    for (const n of LEAD_FIELD_NAMES) expect(n.length, n).toBeLessThanOrEqual(30);
  });

  it('mirrors VAANI_AGENT.md exactly (names, values, prompts)', () => {
    const md = agentMdDataPoints();
    expect(md.map((d) => d.name)).toEqual(LEAD_FIELD_NAMES);
    for (const d of md) {
      const f = field(d.name);
      expect(f.values ? [...f.values] : undefined, d.name).toEqual(d.values);
      // The table marks non-nullable fields with "(not nullable)" after the prompt.
      expect(f.nullable, d.name).toBe(!d.prompt.includes('(not nullable)'));
      expect(d.prompt.replace(/\s*\(not nullable\)$/, ''), d.name).toBe(f.prompt);
    }
  });

  it('uses the same outcome values as the database enum', () => {
    expect(field('outcome').values).toEqual(LEAD_OUTCOMES);
  });
});
