/**
 * /research/small-business-participation-benchmark is a raw-HTML route (renderSbBenchmarkHtml),
 * not govPage(), so it needs the share image tags itself (verifier finding, 2026-11-22).
 */
import { describe, expect, it } from 'vitest';
import { renderSbBenchmarkHtml } from './sb-benchmark-html';
import { SITE_SHARE_IMAGE } from '@/lib/seo/share-image';
import type { Benchmark } from './sb-participation-benchmark';

describe('SB participation benchmark page', () => {
  it('carries the site share image in og and twitter tags', () => {
    const html = renderSbBenchmarkHtml({ rows: [], fleetPct: null, fleetActive: 0, fleetWithSetAside: 0, agenciesRanked: 0, agenciesExcluded: 0, minActive: 0 } as unknown as Benchmark, {
      edition: '2026-11',
      version: '1',
      generatedDate: '2026-11-22',
      canonical: 'https://getmindy.ai/research/small-business-participation-benchmark',
    });
    expect(html).toContain(`<meta property="og:image" content="${SITE_SHARE_IMAGE.url}">`);
    expect(html).toContain(`<meta name="twitter:image" content="${SITE_SHARE_IMAGE.url}">`);
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
  });
});
