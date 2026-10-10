import { getAdapters } from '@/lib/adapters';
import type { CallRow, LeadRow } from '@/lib/db/types';
import { lineHasMoneyTerm } from '@/lib/priceScan';
import { parseTranscript } from '@/lib/transcript';
import { bookingLine, buildBriefPrompt } from './prompt';
import { briefToText } from './render';
import { BRIEF_JSON_SCHEMA, parseBrief, type Brief } from './schema';

export interface BriefResult {
  brief: Brief | null;
  text: string | null;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  /** Lines removed because they still contained a money term after one regeneration. */
  removedLines: string[];
  needsAttention: boolean;
  failure?: string;
}

const REMOVED = '[removed: may have contained a price]';
const MAX_ATTEMPTS = 2; // the first try + one regeneration (SPEC §10)

/** Every field a designer reads, except caller_stated_budget (allowed to hold the caller's own figure, D1). */
function offendingLines(b: Brief): string[] {
  const fields = [b.headline, b.what_they_want, ...b.criteria.map((c) => c.evidence), ...b.uncertainties, b.suggested_opening, b.booking];
  return fields.flatMap((f) => f.split(/\r?\n/)).map((l) => l.trim()).filter((l) => l && lineHasMoneyTerm(l));
}

/** Drop array entries and blank out strings that contain a money term (SPEC §10: "send without the offending lines"). */
function stripPrices(b: Brief): Brief {
  const clean = (s: string) => (lineHasMoneyTerm(s) ? REMOVED : s);
  return {
    ...b,
    headline: clean(b.headline),
    what_they_want: clean(b.what_they_want),
    criteria: b.criteria.map((c) => ({ ...c, evidence: clean(c.evidence) })),
    uncertainties: b.uncertainties.filter((u) => !lineHasMoneyTerm(u)),
    suggested_opening: clean(b.suggested_opening),
    booking: clean(b.booking),
  };
}

/** Keep caller_stated_budget only if every number in it was said by the caller (not the agent, not invented). */
function verifyCallerBudget(b: Brief, transcript: string | null): Brief {
  if (!b.caller_stated_budget) return b;
  const userText = parseTranscript(transcript).filter((l) => l.speaker === 'USER').map((l) => l.text).join(' ').replace(/,/g, '');
  const numbers = b.caller_stated_budget.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) ?? [];
  const said = numbers.every((n) => new RegExp(`(?<![\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(userText));
  return said ? b : { ...b, caller_stated_budget: null };
}

/** SPEC §11: designer brief from Gemini, validated with zod, price-scanned, regenerated once if needed. */
export async function generateBrief(lead: LeadRow, call: CallRow): Promise<BriefResult> {
  const { system, prompt } = buildBriefPrompt(lead, call);
  const result: BriefResult = { brief: null, text: null, inputTokens: 0, outputTokens: 0, attempts: 0, removedLines: [], needsAttention: false };
  let flagged: Brief | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result.attempts = attempt;
    let raw;
    try {
      raw = await getAdapters().gemini.generateJson({ system, prompt, jsonSchema: BRIEF_JSON_SCHEMA });
    } catch (err) {
      result.failure = String((err as Error)?.message ?? err);
      break;
    }
    result.inputTokens += raw.inputTokens;
    result.outputTokens += raw.outputTokens;

    const parsed = parseBrief(raw.text);
    if (!parsed.ok) {
      result.failure = parsed.error;
      continue;
    }
    // The booking line comes from our own record, never from the model.
    const brief = verifyCallerBudget({ ...parsed.brief, booking: bookingLine(lead) }, call.transcript);
    if (offendingLines(brief).length === 0) {
      return { ...result, brief, text: briefToText(brief), failure: undefined };
    }
    flagged = brief;
  }

  if (flagged) {
    const removedLines = offendingLines(flagged);
    const brief = stripPrices(flagged);
    return { ...result, brief, text: briefToText(brief), removedLines, needsAttention: true, failure: undefined };
  }
  return result;
}
