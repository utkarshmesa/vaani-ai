import { z } from 'zod';

/** Every environment variable the app reads (SPEC §16). `.env.example` must list exactly these. */
export const ENV_KEYS = [
  'VAANI_API_KEY', 'VAANI_AGENT_ID', 'VAANI_WEBHOOK_SECRET',
  'CALCOM_API_KEY', 'CALCOM_EVENT_TYPE_ID',
  'GEMINI_API_KEY', 'GEMINI_MODEL',
  'RESEND_API_KEY', 'EMAIL_FROM', 'FRONT_DESK_EMAIL', 'OWNER_EMAIL',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET', 'LINK_SIGNING_SECRET', 'DASHBOARD_PASSWORD', 'APP_BASE_URL',
  'MOCK_EXTERNAL',
] as const;

/** Needed only when talking to real services (MOCK_EXTERNAL unset). */
const EXTERNAL_KEYS = [
  'VAANI_API_KEY', 'VAANI_AGENT_ID', 'CALCOM_API_KEY', 'CALCOM_EVENT_TYPE_ID',
  'GEMINI_API_KEY', 'GEMINI_MODEL', 'RESEND_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const optional = z.string().trim().min(1).optional();
const required = z.string().trim().min(1);

const schema = z
  .object({
    VAANI_API_KEY: optional,
    VAANI_AGENT_ID: optional,
    VAANI_WEBHOOK_SECRET: required,
    CALCOM_API_KEY: optional,
    CALCOM_EVENT_TYPE_ID: z.string().trim().regex(/^\d+$/, 'must be a numeric event type id').optional(),
    GEMINI_API_KEY: optional,
    GEMINI_MODEL: optional,
    RESEND_API_KEY: optional,
    EMAIL_FROM: required,
    FRONT_DESK_EMAIL: z.string().trim().email(),
    OWNER_EMAIL: z.string().trim().email(),
    SUPABASE_URL: z.string().trim().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: optional,
    CRON_SECRET: required,
    LINK_SIGNING_SECRET: z.string().min(16, 'must be at least 16 characters'),
    DASHBOARD_PASSWORD: required,
    APP_BASE_URL: z.string().trim().url(),
    MOCK_EXTERNAL: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.MOCK_EXTERNAL === '1') return;
    for (const k of EXTERNAL_KEYS) {
      if (!v[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'required when MOCK_EXTERNAL is not 1' });
    }
  })
  .transform((v) => ({
    ...v,
    MOCK_EXTERNAL: v.MOCK_EXTERNAL === '1',
    CALCOM_EVENT_TYPE_ID: v.CALCOM_EVENT_TYPE_ID ? Number(v.CALCOM_EVENT_TYPE_ID) : 0,
    GEMINI_MODEL: v.GEMINI_MODEL ?? 'mock-gemini',
    APP_BASE_URL: v.APP_BASE_URL.replace(/\/+$/, ''),
  }));

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings (as in a copied .env.example) as unset.
  const cleaned = Object.fromEntries(
    ENV_KEYS.map((k) => [k, source[k] === '' ? undefined : source[k]]),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment — ${problems}`);
  }
  return result.data;
}

/** Parsed process.env. Not cached, so tests can change process.env between cases. */
export function env(): Env {
  return parseEnv(process.env);
}

export function isMockExternal(): boolean {
  return process.env.MOCK_EXTERNAL === '1';
}
