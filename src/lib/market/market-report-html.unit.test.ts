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
  { basis: 'term_of_art' as const, role: 'sections_basis' as const, label: 'Plus the words this market is bought under', amount: 1_745_463_547, method: 'Adds 6 curated synonyms, live-verified.', inputs: ['hypersonic', 'scramjet', 'boost glide'] },
  // POTETO 2026-09-22: a `code_total` tier used to sit here. generate_market_report no
  // longer produces one (it was removed when coverage.allNaics[0] stopped being treated
  // as the surrounding industry), so the fixture now matches what production emits.
];

describe('market report — the measurement bridge', () => {
  it('renders all three readings — headline, literal floor, synonym basis — with their derivations', () => {
    const html = renderMarketReportHtml({ ...base, summary: summary({ size_tiers: TIERS }) } as never);
    expect(html).toContain('How this market was measured');
    // Three rows: the headline measurement plus the two tiers production produces.
    const sec = html.slice(html.indexOf('How this market was measured'));
    expect((sec.slice(0, sec.indexOf('</section>')).match(/<tr>/g) || []).length - 1 /* header row */).toBe(3);
    expect(html).toContain('Awards that say');
    expect(html).toContain('Plus the words this market is bought under');
    // Each derivation is rendered so the reader can audit it.
    expect(html).toContain('Award text contains the word. A FLOOR.');
    expect(html).toContain('Adds 6 curated synonyms, live-verified.');
    // POTETO 2026-09-22 (was: expect '← reported'). That tag named the synonym tier
    // "the market" while the headline showed a different, 1-FY figure (drones: $11.0B
    // "← reported" beside a $90.0M headline). The rule is now: the tier the sections are
    // ranked on SAYS so, and the headline is its own labelled row — so the reader can
    // see which number answers which question.
    expect(html).toContain('← basis of the agency &amp; contractor tables');
    expect(html).toContain('Total market (headline)');
    expect(html).not.toContain('← reported');
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

/**
 * RC-5 (2026-09-22) — engineering comments must not ship in customer HTML.
 *
 * Two CSS comments inside the <style> block reached every rendered report:
 *   "Print = the PDF path (server-side HTML→PDF needs Chromium, which isn't in
 *    the lambda)."
 *   "align-items:start so one tall card … (Eric 2026-08-02)."
 * A client opening a Mindy-branded report and finding our lambda constraints and
 * a developer's name in the source is an internal detail we published by accident.
 *
 * ⚠️ TS comments ABOVE the template are fine — only what lands inside the emitted
 * string matters, which is why this asserts against RENDERED output.
 */
describe('RC-5: no internal implementation detail in rendered HTML', () => {
  const INTERNAL_SIGNATURES = [
    'Chromium', 'lambda', 'puppeteer', 'devDependency',
    'Eric 2026', 'TODO', 'FIXME', 'HACK', 'XXX',
    '@/lib/', 'src/lib/', 'node_modules',
  ];

  it('the rendered report contains no internal-comment signature', () => {
    const html = renderMarketReportHtml({ ...base, summary: summary({ size_tiers: TIERS }) } as never);
    for (const sig of INTERNAL_SIGNATURES) {
      expect(html, `rendered HTML leaked internal signature "${sig}"`).not.toContain(sig);
    }
  });

  it('the rendered report contains no HTML comments at all', () => {
    const html = renderMarketReportHtml({ ...base, summary: summary({ size_tiers: TIERS }) } as never);
    expect(html.match(/<!--[\s\S]*?-->/g) ?? []).toHaveLength(0);
  });
});

