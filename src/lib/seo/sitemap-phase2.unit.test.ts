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
      for (const f of ['select', 'eq', 'neq', 'lt', 'gte', 'like', 'or', 'not', 'order']) {
        q[f] = (...a: unknown[]) => { filters.push(`${f}:${a.map(String).join('|')}`); return q; };
      }
      q.range = (from: number, to: number) => {
        m.oppCalls.push({ filters: [...filters], range: [from, to] });
        return Promise.resolve(m.oppPages.shift() ?? { data: [], error: null });
      };
      q.limit = (n: number) => {
        m.oppCalls.push({ filters: [...filters, `limit:${n}`], range: [0, n - 1] });
        return Promise.resolve(m.oppPages.shift() ?? { data: [], error: null });
      };
      return q;
    },
  }),
}));

import { toLastmod, latestLastmod, renderUrlset, renderSitemapIndex } from './sitemap-xml';
import {
  opportunityStatus, opportunityStatusLabel, getOpportunitySitemapEntries, getClosedOpportunitySitemapEntries,
  getRelatedOpenOpportunities, isIndexableOpp,
} from './opportunities';
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
    // The original six stay first and in order; later families are appended after them.
    expect(SITEMAP_CHILDREN.slice(0, 6)).toEqual([
      'sitemap-static.xml', 'sitemap-contractors.xml', 'sitemap-contracts.xml',
      'sitemap-contractor-tabs.xml', 'sitemap-opportunities.xml', 'sitemap-facets.xml',
    ]);
    // Families added 2026-11-17 (closed opps, forecasts, offices, expiring contracts).
    expect(SITEMAP_CHILDREN).toEqual(expect.arrayContaining([
      'sitemap-opportunities-closed.xml', 'sitemap-forecasts.xml', 'sitemap-offices.xml',
      'sitemap-recompetes-1.xml', 'sitemap-recompetes-2.xml', 'sitemap-recompetes-3.xml',
    ]));
    expect(new Set(SITEMAP_CHILDREN).size).toBe(SITEMAP_CHILDREN.length);
    for (const c of SITEMAP_CHILDREN) expect(() => read(`src/app/${c}/route.ts`)).not.toThrow();
    const xml = renderSitemapIndex(SITEMAP_CHILDREN.map((c) => ({ loc: `https://getmindy.ai/${c}` })));
    expect(xml.match(/<sitemap>/g)).toHaveLength(SITEMAP_CHILDREN.length);
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

describe('closed opportunities: honest label, own sitemap child', () => {
  const row = (i: number, extra: Record<string, unknown> = {}) => ({
    notice_id: `C${String(i).padStart(6, '0')}abcd`, title: `Janitorial services for building ${i}`,
    notice_type: 'Solicitation', active: true, response_deadline: '2026-06-15T00:00:00Z',
    posted_date: '2026-05-01T00:00:00Z', seo_enriched_at: null, ...extra,
  });

  it('an archived notice is never "open", whatever its deadline field says', () => {
    expect(opportunityStatus({ notice_type: 'Solicitation', response_deadline: '2027-01-01T00:00:00Z', active: false }, NOW)).toBe('closed');
    expect(opportunityStatus({ notice_type: 'Solicitation', response_deadline: null, active: false }, NOW)).toBe('closed');
    expect(opportunityStatus({ notice_type: 'Award Notice', response_deadline: null, active: false }, NOW)).toBe('awarded');
    // `active` omitted keeps the old behaviour (callers that never read the column).
    expect(opportunityStatus({ notice_type: 'Solicitation', response_deadline: null }, NOW)).toBe('open');
  });

  it('labels state only what the row establishes', () => {
    expect(opportunityStatusLabel({ notice_type: 'Solicitation', response_deadline: '2026-06-15T00:00:00Z' }, NOW))
      .toEqual({ status: 'closed', label: 'Closed — responses were due June 15, 2026' });
    expect(opportunityStatusLabel({ notice_type: 'Solicitation', response_deadline: null, active: false }, NOW))
      .toEqual({ status: 'closed', label: 'Closed — this notice has been archived on SAM.gov' });
    // A future deadline on an archived notice is not "were due": it never passed.
    expect(opportunityStatusLabel({ notice_type: 'Solicitation', response_deadline: '2027-01-01T00:00:00Z', active: false }, NOW).label)
      .toBe('Closed — this notice has been archived on SAM.gov');
    expect(opportunityStatusLabel({ notice_type: 'Award Notice', awardee_name: 'Acme Corp', award_date: '2026-09-30' }, NOW).label)
      .toBe('Awarded to Acme Corp on September 30, 2026');
    // No named winner → no "awarded to" claim.
    expect(opportunityStatusLabel({ notice_type: 'Award Notice', awardee_name: '  ' }, NOW).label).toBe('Award notice');
    expect(opportunityStatusLabel({ notice_type: 'Solicitation', response_deadline: '2026-12-01T00:00:00Z', active: true }, NOW).label)
      .toBe('Open for responses');
  });

  it('lists past-deadline, non-award notices (active or archived) within the window, newest first', async () => {
    m.oppPages = [
      {
        data: [
          row(1, { response_deadline: '2026-03-01T00:00:00Z' }),
          row(2, { response_deadline: '2026-10-01T00:00:00Z', active: false }), // archived: still listed
          row(3, { response_deadline: '2027-01-01T00:00:00Z' }),                // future: not closed
          row(4, { response_deadline: '2024-01-01T00:00:00Z' }),                // outside 24 months
          row(5, { response_deadline: null, active: false }),                   // no date to state
          row(6, { notice_type: 'Award Notice' }),                              // awards belong elsewhere
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    const { rows, dropped } = await getClosedOpportunitySitemapEntries(NOW);
    expect(dropped).toBe(0);
    expect(rows.map((r) => r.slug)).toEqual([
      'janitorial-services-for-building-2-0002abcd',
      'janitorial-services-for-building-1-0001abcd',
    ]);
    expect(rows.every((r) => r.status === 'closed')).toBe(true);
    expect(rows[0].lastModified).toBe('2026-05-01');

    // The window, the exclusions and the thin gate are all in the query, before the paging.
    const f = m.oppCalls[0].filters;
    expect(f).toContain(`lt:response_deadline|${NOW.toISOString()}`);
    expect(f).toContain('gte:response_deadline|2024-11-12T12:00:00.000Z');
    expect(f).toContain('or:notice_type.is.null,notice_type.not.ilike.*award*');
    expect(f).toContain(`like:description|${'_'.repeat(200)}*`);
    expect(f.some((x) => x.startsWith('eq:active'))).toBe(false); // archived rows render too
  });

  it('caps explicitly at the per-file limit, keeping the newest deadlines', async () => {
    m.oppPages = [
      {
        data: [
          row(1, { response_deadline: '2026-01-01T00:00:00Z' }),
          row(2, { response_deadline: '2026-09-01T00:00:00Z' }),
          row(3, { response_deadline: '2026-05-01T00:00:00Z' }),
        ],
        error: null,
      },
      { data: [], error: null },
    ];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rows, dropped } = await getClosedOpportunitySitemapEntries(NOW, 2);
    expect(dropped).toBe(1);
    expect(rows.map((r) => r.responseDeadline.slice(0, 10))).toEqual(['2026-09-01', '2026-05-01']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 older left out'));
    warn.mockRestore();
  });

  it('a read failure fails the family (503), never an empty sitemap', async () => {
    m.oppPages = [{ data: null, error: { message: 'statement timeout' } }];
    await expect(getClosedOpportunitySitemapEntries(NOW)).rejects.toThrow(/closed opportunity sitemap.*statement timeout/);
  });

  it('related links are OPEN-only and scoped in the query before the limit (NAICS, then agency)', async () => {
    const open = (i: number, extra: Record<string, unknown> = {}) => ({
      notice_id: `O${i}xyzxyz`, title: `Custodial services ${i}`, department: 'VA', notice_type: 'Solicitation',
      response_deadline: '2026-12-20T00:00:00Z', naics_code: '561720', ...extra,
    });
    m.oppPages = [
      { data: [], error: null }, // NAICS scope: nothing open
      { data: [open(1), open(2, { response_deadline: '2026-11-12T01:00:00Z' })], error: null }, // agency scope
    ];
    const r = await getRelatedOpenOpportunities({ noticeId: 'SELF', naicsCode: '561720', department: 'VA' }, 6, NOW);
    expect(r?.scope).toBe('agency');
    expect(r?.items.map((x) => x.title)).toEqual(['Custodial services 1']); // #2 closed earlier today
    const [naicsCall, agencyCall] = m.oppCalls;
    expect(naicsCall.filters).toEqual(expect.arrayContaining([
      'eq:active|true', 'eq:naics_code|561720', 'neq:notice_id|SELF',
      'or:response_deadline.gte.2026-11-12,response_deadline.is.null',
      'or:notice_type.is.null,notice_type.not.ilike.*award*',
    ]));
    expect(agencyCall.filters).toContain('eq:department|VA');
    // The scope is applied BEFORE the limit: the limit is the last thing on the request.
    expect(agencyCall.filters[agencyCall.filters.length - 1]).toBe('limit:12');
  });

  it('a related-links read error renders no block (null), not a "none found" list', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.oppPages = [{ data: null, error: { message: 'boom' } }];
    expect(await getRelatedOpenOpportunities({ noticeId: 'SELF', naicsCode: '561720', department: 'VA' }, 6, NOW)).toBeNull();
    err.mockRestore();
  });

  it('closed and awarded pages offer alerts, not "track this", and the child route is wired', () => {
    const page = read('src/app/opportunity/[slug]/page.tsx');
    expect(page).toContain("Get alerts when {agency ? agency : 'this agency'} posts the next one");
    expect(page).toContain('getRelatedOpenOpportunities(opp)');
    expect(page).not.toContain('getSimilarOpportunities');
    expect(page).toContain('active: opp.active');
    expect(read('src/app/sitemap-opportunities-closed.xml/route.ts')).toContain('closedOpportunityEntries');
  });
});
