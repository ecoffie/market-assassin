import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURATED_EXACT_CODES, normalizeNAICSForPersist } from './utils/naics-expansion';

/**
 * WHEN MINDY SAYS "YOUR MARKET", THE QUERY MUST ACTUALLY REPRESENT THE USER'S MARKET.
 *
 * Two ways that was false, both measured on 2026-08-23:
 *
 * C3 — curated specificity was widened back out one layer down. The industry picker offers
 *      broad buckets; normalizeNAICSForPersist maps each to a hand-chosen, deliberately
 *      NON-CONTIGUOUS set ('238' skips 238130/238140/238150). The alert query then sliced
 *      every 6-digit code to 4 digits, re-adding exactly what a human excluded.
 *      Measured on the 541 set: 3 curated codes match 71 active opps; the 4-digit slice
 *      matches 139, of which 25 come from codes the curation drops.
 *
 * C5 — scope=profile promised a profile-scoped result and executed nationwide. parseMapFilters
 *      reads the profile from OPTS, never from the saved filters, and the alert cron passed
 *      none — so the search ran against the entire active corpus with no NAICS filter, and the
 *      result was emailed as the user's saved market.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('C3 — curated codes stay exact', () => {
  it('exposes every curated code as a flat lookup', () => {
    expect(CURATED_EXACT_CODES.size).toBeGreaterThan(50);
  });

  it('the curated sets really are non-contiguous — this is why widening breaks them', () => {
    // If '238' were simply "all of 2381xx", a 4-digit widen would be harmless and this whole
    // fix would be unnecessary. It is not: these three are excluded on purpose.
    expect(CURATED_EXACT_CODES.has('238110')).toBe(true);
    expect(CURATED_EXACT_CODES.has('238130')).toBe(false);
    expect(CURATED_EXACT_CODES.has('238140')).toBe(false);
    expect(CURATED_EXACT_CODES.has('238150')).toBe(false);
  });

  it('what the picker stores is what the query must honour', () => {
    // One click on a broad bucket -> a curated set, every member of which must survive as an
    // exact match rather than being re-widened.
    const stored = normalizeNAICSForPersist(['238']);
    expect(stored.length).toBeGreaterThan(1);
    for (const c of stored) expect(CURATED_EXACT_CODES.has(c)).toBe(true);
  });

  it('the alert query matches curated codes exactly and widens everything else', () => {
    const SRC = strip(read('src/lib/briefings/pipelines/sam-gov.ts'));
    expect(SRC).toContain('CURATED_EXACT_CODES.has(digits)');
    expect(SRC).toMatch(/naics_code\.eq\.\$\{code\}/);
    // The 4-digit widen must SURVIVE for hand-typed codes — it is a real improvement over the
    // 3-digit subsector it replaced (561 lumped security guards in with pest control).
    expect(SRC).toMatch(/digits\.slice\(0, 4\)/);
  });
});

describe('C5 — scope=profile is honoured or skipped, never silently widened', () => {
  const SRC = strip(read('src/app/api/cron/saved-search-alerts/route.ts'));

  it('loads the profile when the saved search asks for profile scope', () => {
    expect(SRC).toMatch(/savedFilters\.scope === 'profile'/);
    expect(SRC).toContain('naics_codes, location_states');
  });

  it('passes the profile into parseMapFilters, which is the only way it applies', () => {
    expect(SRC).toContain('profileOpts);');
    expect(SRC).toMatch(/parseMapFilters\(/);
  });

  it('SKIPS rather than running unscoped when the profile has no codes', () => {
    // The dangerous default: no profile codes + profile scope = the whole corpus, emailed as
    // "your market". Skipping is the honest outcome.
    expect(SRC).toContain('results.skippedNoProfile++');
    expect(SRC).toMatch(/skipping[\s\S]{0,60}scope=profile but no profile NAICS/);
  });
});
