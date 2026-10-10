import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison for secrets (webhook token, cron bearer, link signatures).
 * Both sides are hashed first so differing lengths don't short-circuit. An empty or missing value never matches.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
