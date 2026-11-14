/**
 * /contractors/[slug]/naics and /agencies — page-level regression tests for the empty-sub-page
 * defect (12,985 sitemap-listed pages rendered an empty table under a stored count, 2026-09-30).
 * Renders the real page components to static HTML (what a no-JavaScript crawler receives).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSeoTemporarilyUnavailable } from '@/lib/seo/seo-unavailable';

const state = vi.hoisted(() => ({
  recipient: null as Record<string, unknown> | null,
  /** Overrides the resolver verdict; null ⇒ 'found' with state.recipient. */
  resolution: null as Record<string, unknown> | null,
  naics: { rows: [] as unknown[], state: 'unavailable' as string },
  agencies: { rows: [] as unknown[], state: 'unavailable' as string },
}));

const { resolveContractorForPage } = vi.hoisted(() => ({
  resolveContractorForPage: vi.fn(async (slug: string) => {
    void slug; // asserted via toHaveBeenCalledWith
    return state.resolution ?? { kind: 'found', recipient: state.recipient, liveBq: false };
  }),
}));
vi.mock('@/lib/bigquery/recipients', () => ({
  SUBPAGE_MIN_ROWS: 5,
  getAllNaicsForRecipientWithState: vi.fn(async () => state.naics),
  getAllAgenciesForRecipientWithState: vi.fn(async () => state.agencies),
}));
// The tabs resolve the contractor exactly as the profile and /contracts pages do.
vi.mock('@/lib/seo/contractor-page-data', () => ({ resolveContractorForPage }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  permanentRedirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...rest }, children),
}));
// The shared layout's header pills are company-level profile facts (tested elsewhere); stub it to
// isolate the sub-page's own claims and table.
vi.mock('@/components/contractors/SubpageLayout', () => ({
  SubpageLayout: ({ children }: { children: React.ReactNode }) => React.createElement('main', null, children),
}));

import * as NaicsPage from '@/app/contractors/[slug]/naics/page';
import * as AgenciesPage from '@/app/contractors/[slug]/agencies/page';

const RECIPIENT = {
  rollup_name: 'ACME DEFENSE INC', canonical_slug: 'acme-defense-inc', rollup_uei: 'UEI1', child_ueis: ['UEI1'],
  total_obligated: 49_000_000, award_count: 13357, distinct_naics_count: 227, distinct_agency_count: 31,
};
const params = (slug = 'acme-defense-inc') => ({ params: Promise.resolve({ slug }) });
const html = async (mod: { default: (p: ReturnType<typeof params>) => Promise<React.ReactElement> }) => renderToStaticMarkup(await mod.default(params()));
const naicsRows = (n: number) => Array.from({ length: n }, (_, i) => ({ naics_code: `54151${i % 10}`, naics_description: `Industry ${i}`, award_count: 3, total_amount: 1000 * (n - i) }));
const agencyRows = (n: number) => Array.from({ length: n }, (_, i) => ({ awarding_agency: `Agency ${i}`, total_amount: 1000 * (n - i), pct_of_total: 1 / n }));

beforeEach(() => {
  resolveContractorForPage.mockClear();
  state.resolution = null;
  state.recipient = { ...RECIPIENT };
  state.naics = { rows: [], state: 'unavailable' };
  state.agencies = { rows: [], state: 'unavailable' };
});

const PAGES = [
  { name: 'naics', mod: NaicsPage, set: (rows: unknown[], s: string) => { state.naics = { rows, state: s }; }, rows: naicsRows, storedClaim: /227 NAICS codes/ },
  { name: 'agencies', mod: AgenciesPage, set: (rows: unknown[], s: string) => { state.agencies = { rows, state: s }; }, rows: agencyRows, storedClaim: /31 federal agencies/ },
] as const;

for (const P of PAGES) {
  describe(`/contractors/[slug]/${P.name}`, () => {
    it('stored count > 0 + unavailable rows ⇒ noindex, honest refreshing copy, no table, no stored count', async () => {
      P.set([], 'unavailable');
      const meta = await P.mod.generateMetadata(params());
      expect(meta.robots).toEqual({ index: false, follow: true });
      expect(meta.alternates?.canonical).toBe(`https://getmindy.ai/contractors/acme-defense-inc/${P.name}`);
      expect(String(meta.description)).not.toMatch(/\b(227|31)\b/);
      const out = await html(P.mod);
      expect(out).toContain('data-subpage-state="unavailable"');
      expect(out).toMatch(/being refreshed/);
      expect(out).not.toContain('<table');
      expect(out).not.toMatch(P.storedClaim);
      expect(out).toContain('href="/contractors/acme-defense-inc"'); // points to the substantive parent profile
    });

    it('stored count > 0 + genuinely zero rows ⇒ noindex, honest "none" copy, no table, no stored count', async () => {
      P.set([], 'empty');
      const meta = await P.mod.generateMetadata(params());
      expect(meta.robots).toEqual({ index: false, follow: true });
      expect(meta.alternates?.canonical).toBe(`https://getmindy.ai/contractors/acme-defense-inc/${P.name}`);
      const out = await html(P.mod);
      expect(out).toContain('data-subpage-state="none"');
      expect(out).not.toContain('<table');
      expect(out).not.toMatch(P.storedClaim);
    });

    it('5+ real rows ⇒ indexable, self-canonical, headline count equals rendered rows (not the stored 227/31)', async () => {
      for (const n of [5, 12]) {
        P.set(P.rows(n), 'hit');
        const meta = await P.mod.generateMetadata(params());
        expect(meta.robots).toBeUndefined();
        expect(meta.alternates?.canonical).toBe(`https://getmindy.ai/contractors/acme-defense-inc/${P.name}`);
        expect(String(meta.description)).toContain(String(n));
        const out = await html(P.mod);
        expect((out.match(/<tbody[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g) ?? []).length).toBe(n);
        expect(out).toMatch(new RegExp(`>${n} (NAICS codes|federal agencies have)`));
        expect(out).not.toMatch(P.storedClaim);
        expect(out).not.toContain('data-subpage-state');
      }
    });

    it('1–4 real rows ⇒ real rows rendered with their true count, self-canonical, noindex,follow', async () => {
      for (const n of [1, 4]) {
        P.set(P.rows(n), 'hit');
        const meta = await P.mod.generateMetadata(params());
        expect(meta.robots).toEqual({ index: false, follow: true });
        expect(meta.alternates?.canonical).toBe(`https://getmindy.ai/contractors/acme-defense-inc/${P.name}`);
        const out = await html(P.mod);
        expect((out.match(/<tbody[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g) ?? []).length).toBe(n);
        expect(out).toMatch(new RegExp(`>${n} (NAICS codes? |federal agenc(y has|ies have))`));
        expect(out).not.toMatch(P.storedClaim);
        expect(out).not.toContain('data-subpage-state');
      }
    });
  });
}

/**
 * Resolution on the tabs (2026-11-13). The Search Console "Not found (404)" export held tab
 * URLs that 404'd although the contractor exists under a canonical slug: the tabs read the
 * rollup cache only and fell back to a cache-only alias lookup, so every alias and every cold
 * contractor answered 404. These are the three found in the 1,000-URL classification, with
 * the canonical slugs BigQuery's alias resolver returns for them.
 */
const FALSE_404S = [
  { tab: 'naics', mod: NaicsPage, from: 'valkyrie-enterprises-inc', to: 'valkyrie-enterprises-llc' },
  { tab: 'agencies', mod: AgenciesPage, from: 'the-university-of-dayton', to: 'university-of-dayton' },
  { tab: 'agencies', mod: AgenciesPage, from: 'general-dynamics-corporation', to: 'general-dynamics-corp' },
] as const;

describe('tab resolution: the three false 404s from the 2026-11-13 Search Console export', () => {
  for (const c of FALSE_404S) {
    it(`/contractors/${c.from}/${c.tab} → 308 /contractors/${c.to}/${c.tab}`, async () => {
      state.resolution = { kind: 'redirect', slug: c.to };
      await expect(c.mod.default(params(c.from))).rejects.toThrow(`REDIRECT:/contractors/${c.to}/${c.tab}`);
      expect(resolveContractorForPage).toHaveBeenCalledWith(c.from);
    });
  }
});

for (const P of PAGES) {
  describe(`/contractors/[slug]/${P.name} resolution`, () => {
    it('confirmed nonexistent contractor ⇒ genuine 404', async () => {
      state.resolution = { kind: 'not_found' };
      await expect(P.mod.default(params('no-such-company'))).rejects.toThrow('NEXT_NOT_FOUND');
      const meta = await P.mod.generateMetadata(params('no-such-company'));
      expect(meta.robots).toBeUndefined();
    });

    it('cold cache / budget spent / data source failed ⇒ temporary 5xx, never 404 or noindex', async () => {
      for (const reason of ['cold-budget-exhausted', 'bigquery-failed', 'alias-target-cold']) {
        state.resolution = { kind: 'unavailable', reason };
        const err = await P.mod.default(params()).then(() => null, (e: unknown) => e);
        expect(isSeoTemporarilyUnavailable(err)).toBe(true);
        expect(String((err as Error).message)).toContain(reason);
        const meta = await P.mod.generateMetadata(params());
        expect(meta.robots).toBeUndefined();
      }
    });

    it('resolved under a sibling slug ⇒ 308 to the canonical slug on the same tab', async () => {
      state.recipient = { ...RECIPIENT, canonical_slug: 'acme-defense-incorporated' };
      await expect(P.mod.default(params())).rejects.toThrow(`REDIRECT:/contractors/acme-defense-incorporated/${P.name}`);
    });

    it('single-UEI contractor (no rollup row) ⇒ the tab renders instead of 404ing', async () => {
      state.recipient = { ...RECIPIENT, rollup_uei: 'UEI9', child_ueis: ['UEI9'] };
      P.set(P.rows(6), 'hit');
      const out = await html(P.mod);
      expect((out.match(/<tbody[\s\S]*?<\/tbody>/)?.[0].match(/<tr/g) ?? []).length).toBe(6);
    });
  });
}

describe('source: one resolution mechanism, no second lookup path', () => {
  const code = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  for (const tab of ['naics', 'agencies']) {
    it(`${tab} resolves through resolveContractorForPage only`, () => {
      const src = code(`src/app/contractors/[slug]/${tab}/page.tsx`);
      expect(src).toMatch(/resolveContractorForPage\(slug\)/);
      expect(src).not.toMatch(/getRollupBySlug|resolveCanonicalSlug|serveableCanonical/);
    });
  }
});

