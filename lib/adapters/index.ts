import { env } from '@/lib/env';
import { createCalcomAdapter } from './calcom';
import { createGeminiAdapter } from './gemini';
import { mocks } from './mocks';
import { createResendAdapter } from './resend';
import type { Adapters } from './types';
import { createVaaniAdapter } from './vaani';

export type * from './types';

let override: Adapters | null = null;
let real: Adapters | null = null;

/** Mocks when MOCK_EXTERNAL=1, otherwise the real services (built once from env). */
export function getAdapters(): Adapters {
  if (override) return override;
  if (process.env.MOCK_EXTERNAL === '1') return mocks;
  if (!real) {
    const e = env();
    real = {
      vaani: createVaaniAdapter({ apiKey: e.VAANI_API_KEY! }),
      calcom: createCalcomAdapter({ apiKey: e.CALCOM_API_KEY! }),
      gemini: createGeminiAdapter({ apiKey: e.GEMINI_API_KEY!, model: e.GEMINI_MODEL }),
      resend: createResendAdapter({ apiKey: e.RESEND_API_KEY!, from: e.EMAIL_FROM }),
    };
  }
  return real;
}

/** Tests can swap in custom adapters; null restores the default. */
export function setAdapters(a: Adapters | null): void {
  override = a;
}
