/**
 * Subcontract targets tier UP when exact NAICS+state is empty (Eric 2026-07-27): the drawer showed
 * "no primes" beside a full "Similar opportunities" list and read as broken. Root cause was an
 * honest miss (NAICS 711130 "Musical Groups/Artists" has ZERO federal *contracts* — grant-funded),
 * but the rigid exact-match made a valid-but-sparse NAICS look broken. Tiering widens recall to the
 * 3-digit NAICS prefix + border states — but STOPS there (the 2-digit sector mixes unrelated work,
 * e.g. 711 music → 712 museums). These tests pin the tier LADDER + STOP, not live DB counts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lib = readFileSync(join(__dirname, 'cross-sell.ts'), 'utf8');
const route = readFileSync(join(__dirname, '../../app/api/app/related-awards/route.ts'), 'utf8');

describe('findSubcontractTargetsTiered — tiered widen with an honest stop', () => {
  it('runs 4 tiers: exact → 3-digit+state → exact+nearby → 3-digit+nearby', () => {
    for (const s of ['exact', 'naics3-state', 'exact-nearby', 'naics3-nearby']) {
      expect(lib).toContain(`scope: '${s}'`);
    }
  });
  it('widens NAICS only to the 3-DIGIT prefix (never the 2-digit sector that mixes unrelated work)', () => {
    expect(lib).toContain('key.naics.slice(0, 3)'); // 3-digit prefix
    expect(lib).not.toContain('key.naics.slice(0, 2)'); // never the 2-digit sector
  });
  it('uses border-state expansion for the "nearby" tiers', () => {
    expect(lib).toContain('expandStateToBorders(key.state)');
  });
  it('first non-empty tier wins; scope=null only when EVERY tier misses', () => {
    expect(lib).toContain('if (targets.length) return { targets, scope: t.scope');
    expect(lib).toContain('return { targets: [], scope: null');
  });
  it('the route returns scope/states/widenedNaics so the drawer can label honestly', () => {
    expect(route).toContain('findSubcontractTargetsTiered');
    expect(route).toContain('scope, states, widenedNaics: naics3');
  });
});
