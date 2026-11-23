import { describe, it, expect } from 'vitest';
import { renderMarketReportHtml, provenanceRows } from './market-report-html';

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

  it('with ONE tier, still says what the agency and contractor tables are ranked on (its note, verbatim)', () => {
    const note = 'This literal-phrase reading is what the agency and contractor tables below are ranked on (FY23-25).';
    const html = renderMarketReportHtml({ ...base, summary: summary({ size_tiers: [{ ...TIERS[0], role: 'sections_basis', note }] }) } as never);
    expect(html).not.toContain('How this market was measured');
    expect(html).toContain(note);
  });

  it('does not repeat the note when the measurement table already shows it', () => {
    const note = 'Ranked on the synonym reading.';
    const html = renderMarketReportHtml({ ...base, summary: summary({ size_tiers: [TIERS[0], { ...TIERS[1], note }] }) } as never);
    expect(html.split(note).length - 1).toBe(1);
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
    // The embedded report font is base64 data, not text anyone reads; its alphabet can spell "XXX" by chance.
    const html = renderMarketReportHtml({ ...base, summary: summary({ size_tiers: TIERS }) } as never)
      .replace(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/g, 'url(data:font/woff2)');
    for (const sig of INTERNAL_SIGNATURES) {
      expect(html, `rendered HTML leaked internal signature "${sig}"`).not.toContain(sig);
    }
  });

  it('the rendered report contains no HTML comments at all', () => {
    const html = renderMarketReportHtml({ ...base, summary: summary({ size_tiers: TIERS }) } as never);
    expect(html.match(/<!--[\s\S]*?-->/g) ?? []).toHaveLength(0);
  });
});


/**
 * Track C3 (Design & Output, 2026-11-23): "Data and sources" is built ONLY from metadata the stored report carries.
 * A missing source or date is left out (or reads "Not stated"), never filled in.
 */
describe('market report — data and sources', () => {
  const withProvenance = {
    ...base,
    summary: summary({ size_tiers: [{ ...TIERS[1], method: 'Award text contains the terms (FY23-25, contract awards).' }] }),
    sections: {
      ...base.sections,
      market_size: { source: 'bigquery_usaspending_awards', windowLabel: 'FY2026 (1 complete fiscal year · description match)', sourceMaxActionDate: '2026-09-30' },
      recompetes: { contracts: [{ incumbent_name: 'A', last_synced_at: '2026-11-22T16:25:30Z' }, { incumbent_name: 'B', last_synced_at: '2026-11-20T01:00:00Z' }] },
      forecasts: { forecasts: [{ title: 'X', as_of: '2026-08-01T20:06:17Z', source_url: 'https://www.acquisitiongateway.gov/forecast' }, { title: 'Y', as_of: '2026-07-15T00:00:00Z', source_url: 'https://osdbu.hhs.gov/x' }] },
    },
  } as never;

  it('lists each section with the source and window its own data states', () => {
    expect(provenanceRows(withProvenance)).toEqual([
      { section: 'Total market and market composition', source: 'USASpending.gov award records', window: 'FY2026 (1 complete fiscal year · description match); awards through September 30, 2026' },
      { section: 'Who is buying · Competitive landscape', source: '', window: 'Award text contains the terms (FY23-25, contract awards).' },
      { section: 'Recompetes on the horizon', source: '', window: 'records last synced November 20, 2026 to November 22, 2026' },
      { section: 'Upcoming forecasts', source: 'acquisitiongateway.gov, osdbu.hhs.gov', window: 'records as of July 15, 2026 to August 1, 2026' },
    ]);
    const html = renderMarketReportHtml(withProvenance);
    expect(html).toContain('Data and sources');
    expect(html).toContain('Award data through September 30, 2026');
    expect(html).not.toMatch(/<td class="txt">USASpending\.gov award records<\/td><td class="txt">Award text/); // a source the row's data does not name is left blank, not guessed
  });

  it('invents nothing: no metadata, no section and no header date', () => {
    expect(provenanceRows({ ...base, summary: summary() } as never)).toEqual([]);
    const html = renderMarketReportHtml({ ...base, summary: summary() } as never);
    expect(html).not.toContain('Data and sources');
    expect(html).not.toContain('Award data through');
  });

  it('hides an unknown source key and ignores dates that are not dates', () => {
    const odd = { ...base, summary: summary(), sections: { ...base.sections, market_size: { source: 'some_internal_table', windowLabel: '', sourceMaxActionDate: 'n/a' } } } as never;
    expect(provenanceRows(odd)).toEqual([]);
    expect(renderMarketReportHtml(odd)).not.toContain('some_internal_table');
  });
});
