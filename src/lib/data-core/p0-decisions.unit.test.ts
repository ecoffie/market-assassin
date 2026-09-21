import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CONTRACTOR_STORES, mayClaimCorpusSize, corpusRole,
  CANONICAL_POPULATION_LABEL,
} from './contractor-corpus';
import { getSatBadgeForAgency } from '@/lib/briefings/delivery/sam-green-email-template';

describe('P0 Decision 1 — SAT friendliness is an EDITORIAL signal', () => {
  it('the accessor never returns a percentage', () => {
    const signal = getSatBadgeForAgency('DEPT OF DEFENSE');
    expect(signal).not.toHaveProperty('satPercent');
    expect(signal).not.toHaveProperty('microPercent');
  });

  it('a covered agency returns a LABEL, not a number', () => {
    const signal = getSatBadgeForAgency('GENERAL SERVICES ADMINISTRATION');
    expect(signal.coverage).toBe('covered');
    expect(typeof signal.badge).toBe('string');
    expect(signal.badge).not.toMatch(/\d/);   // no fake precision in the label
  });

  it('an UNCOVERED agency is "uncovered", never a zero or a negative label', () => {
    const signal = getSatBadgeForAgency('DEPARTMENT OF MADE UP THINGS XYZZY');
    expect(signal.coverage).toBe('uncovered');
    expect(signal.badge).toBeNull();          // renders nothing
    expect(signal.level).toBe('unknown');     // NOT 'low'
  });

  it('REGRESSION: a generic word like DEPARTMENT must not inherit another agency label', () => {
    // Pre-existing bug found by this test: matchingWords.length >= 1 meant ANY
    // agency containing "DEPARTMENT" inherited the first DEPARTMENT entry's badge
    // — an uncovered Dept of Commerce rendered Veterans Affairs' "Easy Entry".
    // NOTE: the first draft of this test used Commerce/Education as negatives.
    // They are ACTUALLY in the covered 19, so the test was wrong, not the code.
    // These are genuinely absent from the editorial set.
    for (const uncovered of [
      'NUCLEAR REGULATORY COMMISSION, DEPARTMENT OF',
      'DEPARTMENT OF MADE UP THINGS XYZZY',
      'OFFICE OF PERSONNEL MANAGEMENT',
    ]) {
      const signal = getSatBadgeForAgency(uncovered);
      expect(signal.coverage).toBe('uncovered');
      expect(signal.badge).toBeNull();
    }
  });

  it('real covered agencies still resolve after the stopword fix', () => {
    for (const covered of [
      'DEPT OF DEFENSE',
      'GENERAL SERVICES ADMINISTRATION',
      'VETERANS AFFAIRS, DEPARTMENT OF',
    ]) {
      expect(getSatBadgeForAgency(covered).coverage).toBe('covered');
    }
  });

  it('an empty agency name is uncovered, not zero (Rule #11: unknown is not zero)', () => {
    const signal = getSatBadgeForAgency('');
    expect(signal.coverage).toBe('uncovered');
    expect(signal.badge).toBeNull();
  });

  it('customer output renders the badge only when present — absence is not negative evidence', () => {
    const src = readFileSync('src/lib/briefings/delivery/sam-green-email-template.ts', 'utf8');
    // the render site is guarded: null badge -> empty string, never a "low" chip
    expect(src).toContain("satInfo.badge ? renderBadge(satInfo.badge");
    expect(src).not.toMatch(/renderBadge\(\s*`\$\{[^}]*satPercent/);
  });
});

describe('P0 Decision 2 — contractor corpus roles', () => {
  it('exactly ONE store may make a corpus-size claim', () => {
    const claimers = CONTRACTOR_STORES.filter((s) => s.maySupportCorpusSizeClaim);
    expect(claimers).toHaveLength(1);
    expect(claimers[0].id).toBe('recipients_rollup_merged');
  });

  it('BigQuery is the canonical population', () => {
    expect(corpusRole('recipients_rollup_merged')).toBe('canonical_population');
    expect(mayClaimCorpusSize('recipients_rollup_merged')).toBe(true);
  });

  it('contractors.json is an enrichment overlay and may NOT claim corpus size', () => {
    expect(corpusRole('contractors.json')).toBe('enrichment_overlay');
    expect(mayClaimCorpusSize('contractors.json')).toBe(false);
  });

  it('the SBLO roster stays a separate contact layer, not merged into the population', () => {
    expect(corpusRole('sblo-roster-2026-06.json')).toBe('contact_layer');
    expect(mayClaimCorpusSize('sblo-roster-2026-06.json')).toBe(false);
  });

  it('tier2-contractors-database stays UNRESOLVED — no role assigned by guess', () => {
    expect(corpusRole('tier2-contractors-database.json')).toBe('unresolved');
    expect(mayClaimCorpusSize('tier2-contractors-database.json')).toBe(false);
  });

  it('an unknown store may not claim corpus size (default deny)', () => {
    expect(mayClaimCorpusSize('some-new-store.json')).toBe(false);
  });

  it('the canonical label is imported, never typed (marketing Rule 9)', () => {
    const src = readFileSync('src/lib/data-core/contractor-corpus.ts', 'utf8');
    expect(src).toContain("from '@/lib/marketing-stats'");
    expect(CANONICAL_POPULATION_LABEL).toMatch(/^\d{3},\d{3}\+$/);
  });
});

describe('P0 Decision 2 — /contractors index does not claim to BE the universe', () => {
  const page = readFileSync('src/app/contractors/page.tsx', 'utf8');

  it('the body distinguishes curated profiles from the searchable universe', () => {
    expect(page).toContain('curated profiles in this index');
    expect(page).toContain('contractors searchable');
  });

  it('the corpus-size figure comes from the canonical label, not the static file', () => {
    expect(page).toContain('CANONICAL_POPULATION_LABEL');
  });

  it('the static row count is never presented as the total universe', () => {
    expect(page).not.toContain('contractors profiled');   // the old ambiguous label
  });

  it('the file header records the overlay role so the next reader is not misled', () => {
    expect(page).toContain('CURATED ENRICHMENT OVERLAY');
    expect(page).toContain('NOT the canonical population');
  });
});
