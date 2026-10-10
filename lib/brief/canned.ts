import type { GeminiRequest } from '@/lib/adapters/types';
import { humanise } from '@/lib/format';
import { LEAD_JSON_MARKER } from './prompt';
import type { Brief } from './schema';

type Fields = Record<string, string | number | null>;

const statusFrom = (v: unknown, metValues: string[]): 'met' | 'unclear' | 'not_met' =>
  v === null || v === undefined || v === 'unclear' ? 'unclear' : metValues.includes(String(v)) ? 'met' : 'not_met';

/**
 * Mock Gemini's default response (SPEC §15: "Gemini returns a canned brief"). Deterministic, built only from the
 * lead fields embedded in the prompt — so it never contains a price.
 */
export function cannedBrief(req: GeminiRequest): string {
  const m = req.prompt.match(new RegExp(`## ${LEAD_JSON_MARKER}\\s*\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``));
  const f: Fields = m ? JSON.parse(m[1]) : {};
  const booking = req.prompt.match(/## Booking\n(.+)/)?.[1] ?? 'Call back: no preferred time given';
  const name = (f.caller_name as string) ?? 'Caller';
  const brief: Brief = {
    headline: [name, f.locality, humanise(f.property_type as string), f.scope].filter(Boolean).join(' · '),
    what_they_want: `${name} wants ${f.scope ?? 'an interior project'}${f.locality ? ` in ${f.locality}` : ''}${f.completion_deadline ? `, needed ${String(f.completion_deadline).toLowerCase()}` : ''}.`,
    criteria: [
      { criterion: 'real_project', status: f.scope ? 'met' : 'unclear', evidence: f.scope ? String(f.scope) : 'Not discussed.' },
      { criterion: 'service_area', status: statusFrom(f.in_service_area, ['yes']), evidence: f.locality ? String(f.locality) : 'Not discussed.' },
      { criterion: 'timeline', status: statusFrom(f.timeline_fit, ['yes']), evidence: f.completion_deadline ? String(f.completion_deadline) : 'Not discussed.' },
      { criterion: 'budget', status: f.budget_mentioned === 'clearly_too_low' ? 'not_met' : f.budget_mentioned === 'not_a_concern' ? 'met' : 'unclear', evidence: 'Not discussed.' },
      { criterion: 'decision_maker', status: statusFrom(f.decision_maker, ['yes', 'authorised_rep']), evidence: f.decision_maker ? humanise(String(f.decision_maker))! : 'Not discussed.' },
    ],
    uncertainties: [
      ...(f.budget_mentioned === 'none' || !f.budget_mentioned ? ['Budget not discussed — establish fit at the consultation.'] : []),
      ...(f.decision_maker !== 'yes' ? ['Confirm who makes the decision and whether they will attend.'] : []),
    ],
    suggested_opening: `What made you decide to start on ${f.scope ? 'this' : 'the project'} now?`,
    booking,
    caller_stated_budget: null,
  };
  return JSON.stringify(brief);
}
