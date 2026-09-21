/**
 * capability_market_match — no company-name keyword competitor queries.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  filterCompetitorsFabricatedRelevance,
  competitorNameMatchesForbiddenAnchorToken,
} from '@/lib/market/capability-competitors';

const matchSrc = readFileSync(join(__dirname, 'capability-market-match.ts'), 'utf8');

describe('competitor sourcing contract', () => {
  it('does not call searchContractors with keyword for the primary competitor path', () => {
    expect(matchSrc).not.toMatch(/searchContractors\(\{\s*keyword:\s*lead/);
  });

  it('uses NAICS-scoped competitor search when lead NAICS exists', () => {
    expect(matchSrc).toMatch(/searchContractors\(\{\s*naics:\s*leadNaics/);
  });

  it('filters fabricated name-substring relevance in production', () => {
    expect(matchSrc).toContain('filterCompetitorsFabricatedRelevance');
  });

  it('gates competitors, lead NAICS and recompetes on one verified flag', () => {
    // ONE flag, not a confidence check repeated at each call site — a second copy is how
    // competitors kept being fetched for an anchor the market section had already withheld.
    expect(matchSrc).toMatch(
      /const marketVerified\s*=\s*\n?\s*validation\.anchor_confidence === 'high' \|\| validation\.anchor_confidence === 'medium'/,
    );
    expect(matchSrc).toMatch(/const fetchCompetitors = marketVerified && Boolean\(leadNaics\)/);
    expect(matchSrc).toMatch(/lead_naics: marketVerified \? \(leadNaics \?\? null\) : null/);
  });

  it('an unverified market is returned as candidate_naics, never as top_naics', () => {
    expect(matchSrc).toMatch(/top_naics: marketVerified \? allNaics\.slice\(0, NAICS_CAP\) : \[\]/);
    expect(matchSrc).toMatch(/candidate_naics: marketVerified \? null : allNaics\.slice\(0, NAICS_CAP\)/);
    expect(matchSrc).toMatch(/naics_status: marketVerified \?/);
  });

  it('exports selected anchor + anchor_confidence + tam_verified in _meta', () => {
    expect(matchSrc).toContain('selected_anchor');
    expect(matchSrc).toContain('anchor_confidence');
    expect(matchSrc).toContain('tam_verified');
    expect(matchSrc).toContain('competitor_derivation');
  });

  it('suppresses confident TAM when not tam_verified', () => {
    expect(matchSrc).toMatch(/total_market:\s*tamVerified\s*\?\s*coverage\.totalMarket\s*:\s*null/);
  });
});

describe('Anadria / TPJ competitor false-positive guard', () => {
  it('Anadria: Outcomes in company name does not count as relevance', () => {
    expect(competitorNameMatchesForbiddenAnchorToken('Outcomes LLC', 'outcomes')).toBe(true);
    const kept = filterCompetitorsFabricatedRelevance(
      [{ recipient_name: 'Outcomes LLC', uei: 'X', total_obligated: 1, state: 'DC', city: 'DC' } as never],
      'organizational development',
    );
    expect(kept).toHaveLength(0);
  });

  it('TPJ: Customized in company name does not count as relevance', () => {
    expect(competitorNameMatchesForbiddenAnchorToken('Customized Training Co', 'customized')).toBe(true);
    const kept = filterCompetitorsFabricatedRelevance(
      [{ recipient_name: 'Customized Training Co', uei: 'Y', total_obligated: 1, state: 'MD', city: 'MD' } as never],
      'instructional design',
    );
    expect(kept).toHaveLength(0);
  });
});

describe('pickLeadKeyword (re-export)', () => {
  it('prefers multi-word capability over generic unigram', async () => {
    const { pickLeadKeyword } = await import('./capability-market-match');
    expect(pickLeadKeyword(['small', 'precision machining'])).toBe('precision machining');
  });
});
