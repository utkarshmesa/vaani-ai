import { agentLines } from '@/lib/transcript';

/** The only acceptable response to a pricing question (Docs/pricing.md, VAANI_AGENT.md). */
export const APPROVED_PRICE_RESPONSE =
  'Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you\'d like.';

/** A time right after "starting at"/"starts at" is a booking time, not a price (NOTES.md P5). */
const TIME_AFTER = String.raw`(?!\s*(?:\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|a\.m\.|p\.m\.|o'?clock))?(?![\d,]|\.\d)|noon|midnight))`;

/**
 * Money terms from SPEC §10, plus Hindi/Devanagari equivalents (NOTES.md P4).
 * Word boundaries stop "rs"/"lac"/"rate" matching inside "hours", "place", "accurate" (NOTES.md P6).
 */
const MONEY_TERMS: RegExp[] = [
  /₹/,
  /\brs\b/i,
  /\brupees?\b/i,
  /\brupa(?:ye|iye|y|ya)\b/i,
  /\blakhs?\b/i,
  /\blacs?\b/i,
  /\bcrores?\b/i,
  /\bper\s*sq/i, // "per sq ft", "per sqft", "per sq.ft", "persqft"
  /\bper\s+square\b/i,
  /\/\s*sq/i,
  /\brates?\b/i,
  /\bcosts?\s+around\b/i,
  new RegExp(String.raw`\bstart(?:ing|s)\s+at\b${TIME_AFTER}`, 'i'),
  /\bballpark\b/i,
  /रुपय|रुपए|रुपये/,
  /लाख/,
  /करोड़|करोड/,
  /प्रति\s*वर्ग/,
];

export interface PriceScanResult {
  flag: boolean;
  /** Offending lines, verbatim, each once. */
  lines: string[];
}

export function lineHasMoneyTerm(line: string): boolean {
  return MONEY_TERMS.some((re) => re.test(line));
}

function scanLines(lines: string[]): PriceScanResult {
  const hits = [...new Set(lines.map((l) => l.trim()).filter((l) => l && lineHasMoneyTerm(l)))];
  return { flag: hits.length > 0, lines: hits };
}

/** Scan only what the agent said (SPEC §10). The caller's own lines are never flagged. */
export function scanAgentLines(transcript: string | null | undefined): PriceScanResult {
  return scanLines(agentLines(transcript));
}

/** Scan arbitrary text line by line (used for generated briefs and emails). */
export function scanText(text: string | null | undefined): PriceScanResult {
  return scanLines((text ?? '').split(/\r?\n/));
}
