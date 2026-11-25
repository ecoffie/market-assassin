/**
 * Confirmed aliases of a single registration (Eric, 2026-11-25): resolve the identity, 308 a confirmed alias to
 * the family's page with the section preserved, and never merge distinct entities.
 *
 * Class (c) of the 11-23/24 contractor 500s: a subsidiary's slug matched its OWN recipient row first, so it served
 * a one-UEI page whose contracts were never built, even though the alias resolver already knew its family.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BqResultState } from '@/lib/bigquery/cache';
import type { RollupProfile } from '@/lib/bigquery/recipients';
import { resolveContractor, confirmedFamilyOf, type ContractorResolveDeps } from './contractor-resolve';

const CHILD_UEI = 'CHILD0000001';
const PARENT_UEI = 'PARENT000001';
const single = (parent: string | null, uei = CHILD_UEI): RollupProfile => ({
  rollup_uei: uei, rollup_name: 'ACME FEDERAL SERVICES LLC', canonical_slug: 'acme-federal-services-llc',
  child_ueis: [uei], child_count: 1, single: { parent_uei: parent },
} as RollupProfile);
const family = (rollupUei: string, children: string[], slug = 'acme-corporation'): RollupProfile => ({
  rollup_uei: rollupUei, rollup_name: 'ACME CORPORATION', canonical_slug: slug, child_ueis: children, child_count: children.length,
} as RollupProfile);

describe('confirmedFamilyOf — identity by UEI, never by name', () => {
  it('confirmed: the family contains this UEI and is keyed by its own SAM parent', () => {
    expect(confirmedFamilyOf(single(PARENT_UEI), family(PARENT_UEI, [PARENT_UEI, CHILD_UEI]))).toBe('acme-corporation');
  });
  it('confirmed: a name variant of the registration\'s own family (no parent, family keyed by the UEI itself)', () => {
    expect(confirmedFamilyOf(single(null), family(CHILD_UEI, [CHILD_UEI], 'acme-federal-services'))).toBe('acme-federal-services');
  });
  it('DISTINCT: the target family does not contain this UEI (another company with the same name)', () => {
    expect(confirmedFamilyOf(single(PARENT_UEI), family(PARENT_UEI, [PARENT_UEI, 'OTHER0000001']))).toBeNull();
  });
  it('DISTINCT: the family holds the UEI only through the same-name merge (keyed by a different parent)', () => {
    expect(confirmedFamilyOf(single(PARENT_UEI), family('OTHERPARENT1', ['OTHERPARENT1', PARENT_UEI, CHILD_UEI]))).toBeNull();
  });
  it('a real family hit (not a synthesized single) is never re-pointed', () => {
    const real = family(PARENT_UEI, [PARENT_UEI, CHILD_UEI], 'acme-federal-services-llc');
    expect(confirmedFamilyOf(real, family(PARENT_UEI, [PARENT_UEI, CHILD_UEI]))).toBeNull();
  });
  it('no target family, or the target is the same page → no redirect', () => {
    expect(confirmedFamilyOf(single(PARENT_UEI), null)).toBeNull();
    expect(confirmedFamilyOf(single(PARENT_UEI), family(PARENT_UEI, [CHILD_UEI], 'acme-federal-services-llc'))).toBeNull();
  });
});

type W = {
  hit: RollupProfile | null; hitLive?: boolean; canonical: 'value' | 'empty' | 'cold' | 'live-only';
  target?: RollupProfile | null; serveable?: boolean; budget?: boolean;
};
function harness(w: W) {
  const states: Record<string, BqResultState> = { rollup: 'empty', recipient: 'empty', canonical: 'empty' };
  const deps: ContractorResolveDeps = {
    rollupOrSingle: vi.fn(async (_s: string, live: boolean) => {
      states.rollup = 'empty'; states.recipient = w.hit ? 'hit' : 'unavailable';
      return w.hitLive && !live ? null : w.hit;
    }),
    canonicalOf: vi.fn(async (_s: string, live: boolean) => {
      const has = w.canonical === 'value' || (w.canonical === 'live-only' && live);
      states.canonical = has ? 'hit' : w.canonical === 'empty' ? 'empty' : live ? 'empty' : 'unavailable';
      return has ? (w.target?.canonical_slug ?? 'acme-corporation') : null;
    }),
    serveable: vi.fn(async (c: string | null) => (c && w.serveable !== false ? c : null)),
    family: vi.fn(async () => w.target ?? null),
    state: (k) => states[k],
    takeBudget: vi.fn(async () => w.budget ?? true),
    recordWarmMiss: vi.fn(async () => {}),
  };
  return deps;
}

describe('resolveContractor — single-registration aliases', () => {
  it('a subsidiary slug with a confirmed family 308s to it, from cache, with no budget', async () => {
    const deps = harness({ hit: single(PARENT_UEI), canonical: 'value', target: family(PARENT_UEI, [PARENT_UEI, CHILD_UEI]) });
    expect(await resolveContractor('acme-federal-services-llc', deps)).toEqual({ kind: 'redirect', slug: 'acme-corporation' });
    expect(deps.takeBudget).not.toHaveBeenCalled();
  });
  it('a same-name DIFFERENT company keeps its own page (no merge)', async () => {
    const deps = harness({ hit: single(PARENT_UEI), canonical: 'value', target: family(PARENT_UEI, [PARENT_UEI, 'OTHER0000001']) });
    expect((await resolveContractor('acme-federal-services-llc', deps)).kind).toBe('found');
  });
  it('a family held only through the name merge keeps the registration\'s own page', async () => {
    const deps = harness({ hit: single(PARENT_UEI), canonical: 'value', target: family('OTHERPARENT1', ['OTHERPARENT1', PARENT_UEI, CHILD_UEI]) });
    expect((await resolveContractor('acme-federal-services-llc', deps)).kind).toBe('found');
  });
  it('a target family page that does not serve yet is never redirected to', async () => {
    const deps = harness({ hit: single(PARENT_UEI), canonical: 'value', target: family(PARENT_UEI, [PARENT_UEI, CHILD_UEI]), serveable: false });
    expect((await resolveContractor('acme-federal-services-llc', deps)).kind).toBe('found');
  });
  it('alias key cold: serve the registration now (no budget, no 5xx) and queue a warm for the slug', async () => {
    const deps = harness({ hit: single(PARENT_UEI), canonical: 'cold' });
    expect((await resolveContractor('acme-federal-services-llc', deps)).kind).toBe('found');
    expect(deps.takeBudget).not.toHaveBeenCalled();
    expect(deps.recordWarmMiss).toHaveBeenCalledWith('acme-federal-services-llc');
  });
  it('a registration with no separate parent does not queue warms for an alias it cannot have', async () => {
    const deps = harness({ hit: single(null), canonical: 'cold' });
    expect((await resolveContractor('acme-federal-services-llc', deps)).kind).toBe('found');
    expect(deps.recordWarmMiss).not.toHaveBeenCalled();
  });
  it('inside an already-paid live pass, the alias is checked live and a confirmed one redirects (one budget unit)', async () => {
    const deps = harness({ hit: single(PARENT_UEI), hitLive: true, canonical: 'live-only', target: family(PARENT_UEI, [PARENT_UEI, CHILD_UEI]) });
    expect(await resolveContractor('acme-federal-services-llc', deps)).toEqual({ kind: 'redirect', slug: 'acme-corporation' });
    expect(deps.takeBudget).toHaveBeenCalledTimes(1);
  });
});

describe('every section keeps its place on redirect', () => {
  const page = (p: string) => readFileSync(join(__dirname, '..', '..', 'app', 'contractors', '[slug]', p), 'utf8');
  it('profile, contracts (with page number), agencies and naics each 308 to the same section', () => {
    expect(page('page.tsx')).toMatch(/kind === 'redirect'\) permanentRedirect\(`\/contractors\/\$\{resolution\.slug\}`\)/);
    expect(page('contracts/[[...page]]/page.tsx')).toMatch(/kind === 'redirect'\) permanentRedirect\(`\/contractors\/\$\{resolution\.slug\}\$\{tail\}`\)/);
    expect(page('contracts/[[...page]]/page.tsx')).toMatch(/const tail = pageNum > 1 \? `\/contracts\/\$\{pageNum\}` : '\/contracts'/);
    expect(page('agencies/page.tsx')).toMatch(/kind === 'redirect'\) permanentRedirect\(`\/contractors\/\$\{resolution\.slug\}\/agencies`\)/);
    expect(page('naics/page.tsx')).toMatch(/kind === 'redirect'\) permanentRedirect\(`\/contractors\/\$\{resolution\.slug\}\/naics`\)/);
  });
});
