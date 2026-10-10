import { describe, expect, it } from 'vitest';
import { pickDesigner } from '@/lib/rotation';
import type { DesignerRow } from '@/lib/db/types';

const d = (id: string, last: string | null, active = true): DesignerRow =>
  ({ id, name: id.toUpperCase(), email: `${id}@aangan-studio.test`, active, last_assigned_at: last });

describe('pickDesigner', () => {
  it('picks never-assigned designers first', () => {
    expect(pickDesigner([d('a', '2026-09-01T05:00:00Z'), d('b', null)])?.id).toBe('b');
  });

  it('otherwise picks the oldest last_assigned_at', () => {
    expect(pickDesigner([d('a', '2026-09-02T05:00:00Z'), d('b', '2026-09-01T05:00:00Z'), d('c', '2026-09-03T05:00:00Z')])?.id).toBe('b');
  });

  it('breaks ties deterministically by id', () => {
    expect(pickDesigner([d('c', null), d('a', null), d('b', null)])?.id).toBe('a');
  });

  it('skips inactive designers', () => {
    expect(pickDesigner([d('a', null, false), d('b', '2026-09-01T05:00:00Z')])?.id).toBe('b');
  });

  it('excludes the current designer on reassign', () => {
    expect(pickDesigner([d('a', null), d('b', '2026-09-01T05:00:00Z')], { excludeId: 'a' })?.id).toBe('b');
  });

  it('returns null when nobody is available', () => {
    expect(pickDesigner([])).toBeNull();
    expect(pickDesigner([d('a', null, false)])).toBeNull();
    expect(pickDesigner([d('a', null)], { excludeId: 'a' })).toBeNull();
  });

  it('rotates through everyone when assignments are recorded', () => {
    let team = [d('a', null), d('b', null), d('c', null)];
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      const at = new Date(Date.UTC(2026, 8, 2, 5, i)).toISOString();
      const pick = pickDesigner(team)!;
      order.push(pick.id);
      team = team.map((x) => (x.id === pick.id ? { ...x, last_assigned_at: at } : x));
    }
    expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });
});
