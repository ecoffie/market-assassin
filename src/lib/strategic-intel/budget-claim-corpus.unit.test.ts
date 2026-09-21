/**
 * Corpus-integrity guard for the fabricated government-wide budget claim.
 *
 * These assert against the REAL shipped data files, not fixtures — so a future
 * regeneration, merge or hand-edit that reintroduces the claim fails the build
 * rather than reaching /agencies pages, proposals and the opportunity drawer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import painPoints from '@/data/agency-pain-points.json';
import { isUnsupportedBudgetClaim } from './unsupported-budget-claim';
import { getPrioritiesForAgency, getPainPointsForAgency } from '@/lib/utils/pain-points';

type Corpus = { agencies: Record<string, { painPoints?: string[]; priorities?: string[] }> };

describe('shipped static corpus carries no unsupported budget claim', () => {
  it('agency-pain-points.json is clean across every agency and both fields', () => {
    const offenders: string[] = [];
    for (const [agency, data] of Object.entries((painPoints as Corpus).agencies)) {
      for (const claim of [...(data.painPoints ?? []), ...(data.priorities ?? [])]) {
        if (isUnsupportedBudgetClaim(claim)) offenders.push(`${agency}: ${claim}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('agencies-seo.ts — the PUBLIC /agencies dataset — is clean', () => {
    const src = readFileSync(join(process.cwd(), 'src/data/agencies-seo.ts'), 'utf8');
    expect(src).not.toMatch(/congressional\s+justification\s+outlay/i);
    expect(src).not.toContain('13541.1B');
    expect(src).not.toContain('16047.1B');
  });

  it('NASA — the fixture agency — exposes no fabricated outlay on any read path', () => {
    const nasa = 'National Aeronautics and Space Administration';
    for (const claim of [...getPrioritiesForAgency(nasa), ...getPainPointsForAgency(nasa)]) {
      expect(isUnsupportedBudgetClaim(claim)).toBe(false);
    }
  });

  it('the raw-JSON accessor sanitizes at load, so a stale corpus still cannot leak', () => {
    // Guard is at the module boundary, not at each call site: every consumer of
    // lib/utils/pain-points (proposal drafting included) inherits it.
    for (const agency of ['Department of Defense', 'Department of Veterans Affairs']) {
      for (const p of getPrioritiesForAgency(agency)) {
        expect(p).not.toMatch(/congressional\s+justification\s+outlay/i);
      }
    }
  });

  it('legitimate priorities SURVIVED the repair — this was a deletion, not a purge', () => {
    const dod = getPrioritiesForAgency('Department of Defense');
    expect(dod.length).toBeGreaterThan(0);
    expect(dod.some((p) => /\$[\d.]+[BM]/.test(p))).toBe(true);
  });
});
