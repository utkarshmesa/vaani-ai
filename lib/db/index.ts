import { createMemoryRepo } from './memoryRepo';
import type { Repo } from './repo';
import { createSupabaseRepo } from './supabaseRepo';

export type { Repo } from './repo';

let current: Repo | null = null;

/**
 * Supabase when SUPABASE_URL is set; otherwise (mock mode only) an in-process repo,
 * which lets `npm run simulate` work against `npm run dev` with no database.
 */
export function getRepo(): Repo {
  if (current) return current;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    current = createSupabaseRepo(url, key);
  } else if (process.env.MOCK_EXTERNAL === '1') {
    console.warn('[db] SUPABASE_URL not set — using the in-memory repo (data is lost on restart).');
    current = createMemoryRepo();
  } else {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when MOCK_EXTERNAL is not 1');
  }
  return current;
}

/** Tests inject a fresh repo per case; null resets to the env-based default. */
export function setRepo(repo: Repo | null): void {
  current = repo;
}
