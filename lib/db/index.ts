import { createMemoryRepo } from './memoryRepo';
import type { Repo } from './repo';
import { createSupabaseRepo } from './supabaseRepo';

export type { Repo } from './repo';

/**
 * Stored on globalThis: in `next dev`, pages and route handlers can load separate module instances,
 * and the in-memory repo must be shared between them (webhook writes, dashboard reads).
 */
const g = globalThis as typeof globalThis & { __vaaniRepo?: Repo | null };

/**
 * Supabase when SUPABASE_URL is set; otherwise (mock mode only) an in-process repo,
 * which lets `npm run simulate` work against `npm run dev` with no database.
 */
export function getRepo(): Repo {
  if (g.__vaaniRepo) return g.__vaaniRepo;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    g.__vaaniRepo = createSupabaseRepo(url, key);
  } else if (process.env.MOCK_EXTERNAL === '1') {
    console.warn('[db] SUPABASE_URL not set — using the in-memory repo (data is lost on restart).');
    g.__vaaniRepo = createMemoryRepo();
  } else {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when MOCK_EXTERNAL is not 1');
  }
  return g.__vaaniRepo;
}

/** Tests inject a fresh repo per case; null resets to the env-based default. */
export function setRepo(repo: Repo | null): void {
  g.__vaaniRepo = repo;
}
