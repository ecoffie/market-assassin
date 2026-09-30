/**
 * No public contractor sub-page route can reach BigQuery.
 *
 * Behavioural: with a completely cold KV cache, the REAL readers the pages use return
 * 'unavailable' and never invoke the BigQuery client. Source: the pages, the sitemap tab gate and
 * the row-count probe never opt into live BigQuery.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { bqQuery } = vi.hoisted(() => ({ bqQuery: vi.fn(async () => { throw new Error('BigQuery must not be called'); }) }));
vi.mock('@vercel/kv', () => ({ kv: { get: vi.fn(async () => null), set: vi.fn(), evalRo: vi.fn(async (_s: string, k: string[]) => k.map(() => -1)) } }));
vi.mock('@/lib/bigquery/client', async (orig) => ({ ...(await orig<Record<string, unknown>>()), bqQuery }));

import {
  getRollupBySlug,
  getAllNaicsForRecipientWithState,
  getAllAgenciesForRecipientWithState,
} from '@/lib/bigquery/recipients';

describe('cold cache on a public request', () => {
  it('profile + NAICS + agency readers return nothing and never call BigQuery', async () => {
    expect(await getRollupBySlug('acme-defense-inc')).toBeNull();
    const n = await getAllNaicsForRecipientWithState(['UEI1'], 'UEI1');
    const a = await getAllAgenciesForRecipientWithState(['UEI1'], 'UEI1');
    expect(n).toEqual({ rows: [], state: 'unavailable' });
    expect(a).toEqual({ rows: [], state: 'unavailable' });
    expect(bqQuery).not.toHaveBeenCalled();
  });
});

describe('source: no live BigQuery opt-in on these public paths', () => {
  const code = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = [
    'src/app/contractors/[slug]/naics/page.tsx',
    'src/app/contractors/[slug]/agencies/page.tsx',
    'src/lib/seo/subpage-row-counts.ts',
    'src/lib/seo/subpage-contract.ts',
  ];
  for (const f of files) {
    it(`${f} never passes liveBq=true / cacheOnly:false or imports the BigQuery client`, () => {
      const src = code(f);
      expect(src).not.toMatch(/cacheOnly:\s*false|liveBq\s*[:=]\s*true|,\s*true\)/);
      expect(src).not.toMatch(/bigquery\/client|bqQuery\(/);
    });
  }
  it('the sitemap no longer gates NAICS/agency tabs on the stored aggregate count', () => {
    const src = code('src/app/sitemap.ts');
    expect(src).not.toMatch(/distinct_(naics|agency)_count[^\n]*SUBPAGE_MIN_ROWS/);
    expect(src).toMatch(/subpageSitemapEligible\(naicsRowCounts\.get/);
    expect(src).toMatch(/subpageSitemapEligible\(agencyRowCounts\.get/);
  });
});
