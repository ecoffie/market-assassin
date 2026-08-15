import { describe, it, expect } from 'vitest';
import { renderMarketReportHtml } from './market-report-html';

/**
 * The measurement bridge must actually reach the page.
 *
 * A $46.3B hypersonics headline was indefensible not because the query was hard, but
 * because the report showed ONE unlabeled number — nobody could see which awards it
 * was built from. These assert the derivation is rendered, and that a market with
 * nothing to bridge doesn't grow a confusing empty section.
 */
const base = {
  subject: 'hypersonic',
  generated_at: '2026-08-15T00:00:00.000Z',
  sections: {
    market_size: null,
    top_agencies: [],
    competition: { contractors: [] },
    recompetes: { contracts: [] },
    forecasts: { forecasts: [] },
    contacts: null,
    agency_detail: null,
    set_aside_gap: null,
  },
  _meta: { degraded: false, sections_grounded: 1, sections_total: 6 },
} as unknown as Parameters<typeof renderMarketReportHtml>[0];

const summary = (over: Record<string, unknown> = {}) => ({
  subject: 'hypersonic', axis: 'keyword', total_market: 1_745_463_547,
  naics_count: 16, top_psc: null, buying_agencies: 5, top_contractors: 15,
  recompetes: 0, forecasts: 0, contacts: 0, size_tiers: null, undercount_note: null,
  ...over,
});

const TIERS = [
  { basis: 'named' as const, label: 'Awards that say "hypersonic"', amount: 1_634_727_624, method: 'Award text contains the word. A FLOOR.', inputs: ['hypersonic'] },
  { basis: 'term_of_art' as const, label: 'Plus the words this market is bought under', amount: 1_745_463_547, method: 'Adds 6 curated synonyms, live-verified.', inputs: ['hypersonic', 'scramjet', 'boost glide'] },
  { basis: 'code_total' as const, label: 'All of NAICS 332993', amount: 9_061_772_056, method: 'The surrounding industry. A CEILING, not the market.', inputs: ['332993'] },
];

describe('market report — the measurement bridge', () => {
  it('renders all three tiers with their derivations', () => {
    const html = renderMarketReportHtml({ ...base, summary: summary({ size_tiers: TIERS }) } as never);
    expect(html).toContain('How this market was measured');
    expect(html).toContain('Awards that say');
    expect(html).toContain('All of NAICS 332993');
    expect(html).toContain('A CEILING, not the market.');
    // The reported tier is marked so the reader knows WHICH number is the answer.
    expect(html).toContain('← reported');
    // The expansion terms are listed — that is the auditable part.
    expect(html).toContain('scramjet');
  });

  it('omits the section when there is nothing to bridge', () => {
    // A single-tier market (contracts say their own name) gets no confusing table.
    const html = renderMarketReportHtml({ ...base, summary: summary({ size_tiers: [TIERS[0]] }) } as never);
    expect(html).not.toContain('How this market was measured');
  });

  it('renders the undercount note as an honest floor warning', () => {
    const html = renderMarketReportHtml({
      ...base,
      summary: summary({ undercount_note: 'Contracts rarely use the word "quantum" — its vocabulary reads: battle management.' }),
    } as never);
    expect(html).toContain('Read this total as a floor');
    expect(html).toContain('battle management');
  });
});
