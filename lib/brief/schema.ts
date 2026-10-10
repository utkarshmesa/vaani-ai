import { z } from 'zod';

/** The five criteria in Docs/qualified.md, in order. */
export const CRITERIA = ['real_project', 'service_area', 'timeline', 'budget', 'decision_maker'] as const;
export const CRITERION_LABELS: Record<(typeof CRITERIA)[number], string> = {
  real_project: 'Real project',
  service_area: 'Service area',
  timeline: 'Timeline',
  budget: 'Budget',
  decision_maker: 'Decision-maker',
};
export const CRITERION_STATUSES = ['met', 'unclear', 'not_met'] as const;

/** SPEC §11 designer brief, plus caller_stated_budget (decision D1). */
export const BriefSchema = z.object({
  headline: z.string().min(1),
  what_they_want: z.string().min(1),
  criteria: z
    .array(z.object({
      criterion: z.enum(CRITERIA),
      status: z.enum(CRITERION_STATUSES),
      evidence: z.string(),
    }))
    .length(5)
    .refine((cs) => new Set(cs.map((c) => c.criterion)).size === 5, 'each criterion exactly once'),
  uncertainties: z.array(z.string()),
  suggested_opening: z.string().min(1),
  booking: z.string().min(1),
  caller_stated_budget: z.string().nullable(),
});

export type Brief = z.infer<typeof BriefSchema>;

/** Hand-written JSON Schema for Gemini's responseJsonSchema (kept to the widely supported subset). */
export const BRIEF_JSON_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One line: name · locality · property · scope' },
    what_they_want: { type: 'string', description: '2–3 sentences in plain English' },
    criteria: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string', enum: [...CRITERIA] },
          status: { type: 'string', enum: [...CRITERION_STATUSES] },
          evidence: { type: 'string', description: 'A short quote from the transcript, or "Not discussed."' },
        },
        required: ['criterion', 'status', 'evidence'],
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
    suggested_opening: { type: 'string', description: "One question for the designer's first call" },
    booking: { type: 'string' },
    caller_stated_budget: { type: ['string', 'null'], description: "The caller's own budget in their words, or null" },
  },
  required: ['headline', 'what_they_want', 'criteria', 'uncertainties', 'suggested_opening', 'booking', 'caller_stated_budget'],
} as const;

export type ParsedBrief = { ok: true; brief: Brief } | { ok: false; error: string };

export function parseBrief(text: string): ParsedBrief {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${(err as Error).message}` };
  }
  const r = BriefSchema.safeParse(json);
  return r.success
    ? { ok: true, brief: r.data }
    : { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}
