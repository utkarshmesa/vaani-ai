import type { DesignerRow } from '@/lib/db/types';

/**
 * SPEC §9: the active designer with the oldest last_assigned_at (never-assigned first).
 * Ties break by id so the order is deterministic. Reassign passes excludeId (the current designer).
 */
export function pickDesigner(designers: DesignerRow[], opts: { excludeId?: string | null } = {}): DesignerRow | null {
  const candidates = designers.filter((d) => d.active && d.id !== opts.excludeId);
  candidates.sort((a, b) => {
    if (a.last_assigned_at === b.last_assigned_at) return a.id.localeCompare(b.id);
    if (a.last_assigned_at === null) return -1;
    if (b.last_assigned_at === null) return 1;
    return new Date(a.last_assigned_at).getTime() - new Date(b.last_assigned_at).getTime();
  });
  return candidates[0] ?? null;
}
