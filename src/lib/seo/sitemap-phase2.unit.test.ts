/**
 * SEO recovery Phase 2 (2026-11-12): sitemap split, data-dated lastmod, the opportunity
 * pagination fix, and crawlable internal links.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const m = vi.hoisted(() => ({
  mget: vi.fn(),
  recipients: vi.fn(),
  served: vi.fn(),
  rowCounts: vi.fn(),
  oppPages: [] as Array<{ data: unknown[] | null; error: { message: string } | null }>,
  oppCalls: [] as Array<{ filters: string[]; range: [number, number] }>,
}));

vi.mock('@vercel/kv', () => ({ kv: { mget: m.mget } }));
vi.mock('@/lib/bigquery/recipients', async (orig) => ({
  ...(await orig<typeof import('@/lib/bigquery/recipients')>()),
  getTopRecipientsForSitemap: m.recipients,
}));
vi.mock('@/lib/awards-serving', async (orig) => ({
  ...(await orig<typeof import('@/lib/awards-serving')>()),
  getServedContractsAsOf: m.served,
}));
vi.mock('@/lib/seo/subpage-row-counts', () => ({ getSubpageRowCounts: m.rowCounts }));
// A PostgREST-shaped fake: records filters + range per request, returns queued pages.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const filters: string[] = [];
      const q: Record<string, unknown> = {};
      for (const f of ['select', 'eq', 'like', 'or', 'not', 'order']) {
        q[f] = (...a: unknown[]) => { filters.push(`${f}:${a.map(String).join('|')}`); return q; };
      }
      q.range = (from: number, to: number) => {
        m.oppCalls.push({ filters: [...filters], range: [from, to] });
        return Promise.resolve(m.oppPages.shift() ?? { data: [], error: null });
      };
      return q;
    },
  }),
}));

import { toLastmod, latestLastmod, renderUrlset, renderSitemapIndex } from './sitemap-xml';
import { opportunityStatus, getOpportunitySitemapEntries, isIndexableOpp } from './opportunities';
import { contractorSections, staticEntries, SITEMAP_CHILDREN } from './sitemap-sections';
import { servableAwardIds, isLinkableAwardId, awardHref } from './award-links';
import { resolveHubTargets } from './hub-links';

const NOW = new Date('2026-11-12T12:00:00Z');
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  m.mget.mockReset();
  m.recipients.mockReset();
  m.served.mockReset();
  m.rowCounts.mockReset().mockResolvedValue(new Map());
  m.oppPages = [];
  m.oppCalls = [];
});

describe('lastmod is a data date or nothing', () => {
  it('normalizes real dates and rejects invalid or future ones', () => {
    expect(toLastmod('2026-08-20', NOW)).toBe('2026-08-20');
    expect(toLastmod('2026-11-10T22:15:00Z', NOW)).toBe('2026-11-10');
    expect(toLastmod('not a date', NOW)).toBeNull();
    expect(toLastmod(null, NOW)).toBeNull();
    expect(toLastmod('2027-01-01', NOW)).toBeNull(); // a future date is not a modification time
  });
  it('takes the latest valid date', () => {
    expect(latestLastmod(['2026-10-01', null, '2026-10-18T05:00:00Z', 'junk'], NOW)).toBe('2026-10-18');
    expect(latestLastmod([null, undefined], NOW)).toBeNull();
  });
  it('omits <lastmod> when unknown and escapes XML', () => {
    const xml = renderUrlset([
      { url: 'https://getmindy.ai/a?x=1&y=2', changeFrequency: 'weekly', priority: 0.5 },
      { url: 'https://getmindy.ai/b', lastModified: '2026-10-01' },
    ]);
    expect(xml).toContain('<loc>https://getmindy.ai/a?x=1&amp;y=2</loc>');
    expect(xml.split('<url>')[1]).not.toContain('<lastmod>');
    expect(xml).toContain('<lastmod>2026-10-01</lastmod>');
  });
  it('no section stamps the build time as lastmod', () => {
    const src = read('src/lib/seo/sitemap-sections.ts').replace(/^\s*(\/\/|\*).*$/gm, '');
    expect(src).not.toMatch(/lastModified:\s*(now|new Date\(\))/);
    expect(staticEntries().filter((e) => e.lastModified && !e.url.includes('/blog/'))).toEqual([]);
  });
});

describe('the sitemap is split by page family', () => {
  it('the index lists one child per family and no build-time lastmod', () => {
    expect(SITEMAP_CHILDREN).toEqual([
      'sitemap-static.xml', 'sitemap-contractors.xml', 'sitemap-contracts.xml',
      'sitemap-contractor-tabs.xml', 'sitemap-opportunities.xml', 'sitemap-facets.xml',
    ]);
    const xml = renderSitemapIndex(SITEMAP_CHILDREN.map((c) => ({ loc: `https://getmindy.ai/${c}` })));
    expect(xml.match(/<sitemap>/g)).toHaveLength(6);
    expect(xml).not.toContain('<lastmod>');
  });
});

describe('contractor sections keep the existing gates and add data lastmod', () => {
  const rec = (name: string, uei: string, ob: number, n: number) =>
    ({ recipient_name: name, rollup_uei: uei, total_obligated: ob, award_count: n, distinct_agency_count: 3, distinct_naics_count: 3 });

  it('lists only non-thin, serveable contractors, dated by their latest award action', async () => {
    m.recipients.mockResolvedValue([
      rec('Big Co', 'U1', 5e8, 100),     // serveable, served contracts page
      rec('Cold Co', 'U2', 5e8, 100),    // not in KV → not listed anywhere
      rec('Thin Co', 'U3', 10_000, 1),   // thin gate
    ]);
    m.mget.mockImplementation(async (...keys: string[]) =>
      keys.map((k) => (k.includes(':big-co:') ? [{ last_action_date: '2026-08-20' }] : k.includes(':thin-co:') ? [{ last_action_date: '2026-01-01' }] : null)),
    );
    m.served.mockResolvedValue({ ok: true, asOf: new Map([['U1', '2026-08-11'], ['U2', '2026-08-11']]) });
    const s = await contractorSections({ contracts: true });
    expect(s.profiles).toEqual([
      expect.objectContaining({ url: 'https://getmindy.ai/contractors/big-co', lastModified: '2026-08-20' }),
    ]);
    expect(s.contracts).toEqual([
      expect.objectContaining({ url: 'https://getmindy.ai/contractors/big-co/contracts', lastModified: '2026-08-11' }),
    ]);
  });

  it('refuses (→ 503) instead of publishing an empty family', async () => {
    m.recipients.mockResolvedValue([]);
    await expect(contractorSections()).rejects.toThrow(/unavailable/);

    m.recipients.mockResolvedValue([rec('Big Co', 'U1', 5e8, 100)]);
    m.mget.mockRejectedValue(new Error('KV down'));
    await expect(contractorSections()).rejects.toThrow(/profile cache unreadable/);

    m.mget.mockResolvedValue([[{ last_action_date: '2026-08-20' }]]);
    m.served.mockResolvedValue({ ok: false, reason: 'postgrest: timeout' });
    await expect(contractorSections({ contracts: true })).rejects.toThrow(/served contracts table unreadable/);
  });
});

describe('opportunities: open / closed / awarded', () => {
  it('active does not mean open', () => {
    expect(opportunityStatus({ notice_type: 'Award Notice', response_deadline: null }, NOW)).toBe('awarded');
    expect(opportunityStatus({ notice_type: 'Solicitation', response_deadline: '2026-11-01T00:00:00Z' }, NOW)).toBe('closed');
    expect(opportunityStatus({ notice_type: 'Solicitation', response_deadline: '2026-12-01T00:00:00Z' }, NOW)).toBe('open');
    expect(opportunityStatus({ notice_type: 'Sources Sought', response_deadline: null }, NOW)).toBe('open');
  });
});

describe('opportunity sitemap pagination (the 798 cap)', () => {
  const row = (i: number, extra: Record<string, unknown> = {}) => ({
    notice_id: `N${String(i).padStart(6, '0')}abcd`, title: `Engineering support services ${i}`,
    notice_type: 'Solicitation', response_deadline: '2026-12-15T00:00:00Z',
    posted_date: '2026-10-01T00:00:00Z', seo_enriched_at: '2026-10-05T00:00:00Z', ...extra,
  });
  const page = (from: number, n: number) => ({ data: Array.from({ length: n }, (_, k) => row(from + k)), error: null });

  it('reads past PostgREST’s 1,000-row clip and never selects the 20 KB text columns', async () => {
    // description-qualified: 1000 + 1000 + 500 rows; sow-qualified: 0
    m.oppPages = [page(0, 1000), { data: [], error: null }, page(1000, 1000), page(2000, 500)];
    const rows = await getOpportunitySitemapEntries(NOW);
    expect(rows).toHaveLength(2500);
    const ranges = m.oppCalls.map((c) => c.range[0]);
    expect(ranges).toEqual(expect.arrayContaining([0, 1000, 2000]));
    for (const c of m.oppCalls) {
      const select = c.filters.find((f) => f.startsWith('select:'))!;
      expect(select).not.toMatch(/description|sow_text/);
    }
    expect(rows[0]).toEqual(expect.objectContaining({ status: 'open', lastModified: '2026-10-05' }));
  });

  it('runs the thin test in Postgres and excludes closed notices', async () => {
    m.oppPages = [
      { data: [row(1), row(2, { response_deadline: '2026-11-12T01:00:00Z' }), row(3, { notice_type: 'Award Notice', response_deadline: null })], error: null },
      { data: [], error: null },
    ];
    const rows = await getOpportunitySitemapEntries(NOW);
    expect(rows.map((r) => r.status)).toEqual(['open', 'awarded']); // row 2 closed earlier today
    const desc = m.oppCalls[0].filters.find((f) => f.startsWith('like:description'))!;
    expect(desc).toBe(`like:description|${'_'.repeat(200)}*`);
  });

  it('a short-description row qualifies only if sow_text alone clears the bar (a subset of the page rule)', () => {
    // The page's rule would accept 150 + 60; the sitemap's server-side test would not. Subset = safe.
    expect(isIndexableOpp({ title: 'Engineering services', description: 'x'.repeat(150), sow_text: 'y'.repeat(60) })).toBe(true);
    const src = read('src/lib/seo/opportunities.ts');
    expect(src).toContain(".not('description', 'like', atLeast(MIN_BODY)).like('sow_text', atLeast(MIN_BODY))");
  });

  it('throws on any read error instead of returning a partial list', async () => {
    m.oppPages = [page(0, 1000), { data: null, error: { message: 'canceling statement due to statement timeout' } }];
    await expect(getOpportunitySitemapEntries(NOW)).rejects.toThrow(/statement timeout/);
  });
});

describe('award links point at crawlable pages that can serve', () => {
  it('links only ids whose award record is cached; a cached [] (not found) is not linked', async () => {
    m.mget.mockResolvedValue([[{ award_id: 'A_1' }], [], null]);
    const s = await servableAwardIds(['A_1', 'A_2', 'A_3', 'bad id!', null, 'A_1']);
    expect([...s]).toEqual(['A_1']);
    expect(m.mget).toHaveBeenCalledWith(
      expect.stringContaining(':awards:detail:A_1'), expect.stringContaining(':awards:detail:A_2'), expect.stringContaining(':awards:detail:A_3'),
    );
  });
  it('fails closed on a KV error', async () => {
    m.mget.mockRejectedValue(new Error('KV down'));
    expect((await servableAwardIds(['A_1'])).size).toBe(0);
  });
  it('validates ids like the award route does, and never builds a /contracts/<piid> link', () => {
    expect(isLinkableAwardId('CONT_AWD_N6426725C0352_9700_-NONE-_-NONE-')).toBe(true);
    expect(isLinkableAwardId('../etc')).toBe(false);
    expect(awardHref('CONT_AWD_X')).toBe('/awards/CONT_AWD_X');
    for (const f of [
      'src/app/contractors/[slug]/contracts/[[...page]]/page.tsx',
      'src/app/awards/page.tsx',
      'src/app/contractors/[slug]/page.tsx',
    ]) {
      expect(read(f), f).not.toMatch(/href=\{?`\/contracts\/\$\{/);
    }
  });
});

describe('contractor hub links', () => {
  it('links serveable slugs as-is, follows aliases to a serveable canonical, drops the rest', async () => {
    m.mget.mockImplementation(async (...keys: string[]) =>
      keys.map((k) => {
        if (k.includes('rollup:by-slug:live-co:')) return [{ last_action_date: '2026-08-01' }];
        if (k.includes('rollup:by-slug:parent-co:')) return [{ last_action_date: '2026-08-01' }];
        if (k.includes('canonical-of:old-name:')) return [{ canonical_slug: 'parent-co' }];
        if (k.includes('canonical-of:alias-to-cold:')) return [{ canonical_slug: 'cold-parent' }];
        return null;
      }),
    );
    const t = await resolveHubTargets(['live-co', 'old-name', 'alias-to-cold', 'dead-co']);
    expect(t).toEqual(new Map([['live-co', 'live-co'], ['old-name', 'parent-co']]));
  });
  it('returns null (fall back to the unverified list) when KV cannot be read', async () => {
    m.mget.mockRejectedValue(new Error('KV down'));
    expect(await resolveHubTargets(['live-co'])).toBeNull();
  });
});
