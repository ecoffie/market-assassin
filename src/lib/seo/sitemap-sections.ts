/**
 * Sitemap sections, one per page family (2026-11-12, SEO recovery Phase 2).
 *
 * WHY SPLIT
 * ---------
 * The single /sitemap.xml mixed ~22K URLs of five unrelated families. Search Console reports
 * indexing PER SITEMAP, so when contractor pages collapsed (10,173 → 1,347 indexed) nothing told
 * the profiles apart from the contract pages, the facets or the static pages. One child per
 * family makes each family's indexing measurable on its own.
 *
 * WHAT DID NOT CHANGE
 * -------------------
 * Eligibility. Every gate below is carried over unchanged from src/app/sitemap.ts: the $25K /
 * 2-award thin gate (must match the profile page's noindex predicate), the verified-serveable
 * profile gate, the per-recipient served-table gate for /contracts, and the renderer's own row
 * counts for the naics/agencies tabs. This phase changes WHERE a URL is listed and its lastmod,
 * not WHETHER it is listed.
 *
 * LASTMOD: see src/lib/seo/sitemap-xml.ts — a data date or nothing, never the build time.
 */
import {
  getTopRecipientsForSitemap,
  recipientSlug,
  SUBPAGE_MIN_ROWS,
} from '@/lib/bigquery/recipients';
import { getServeableProfiles } from '@/lib/seo/served-slugs';
import { getServedContractsAsOf } from '@/lib/awards-serving';
import { glossaryTerms } from '@/data/glossary';
import { MISSIONS } from '@/lib/learn/missions';
import { BLOG_POSTS } from '@/data/blog-posts';
import { NAICS_TOP_100 } from '@/data/naics-top100';
import { getSubpageRowCounts } from '@/lib/seo/subpage-row-counts';
import { subpageSitemapEligible } from '@/lib/seo/subpage-contract';
import { AGENCIES_SEO } from '@/data/agencies-seo';
import { getFacetSlugsForSitemap } from '@/lib/seo/facets';
import { COMPETITORS } from '@/data/competitors';
import { LISTICLES } from '@/data/top-listicles';
import { publishedPublications } from '@/lib/analytics/research-publications';
import { getOpportunitySitemapEntries } from '@/lib/seo/opportunities';
import { toLastmod, renderSitemapIndex, SITEMAP_URL_LIMIT, type SitemapEntry } from '@/lib/seo/sitemap-xml';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

/** The child sitemaps, in the order the index lists them. */
export const SITEMAP_CHILDREN = [
  'sitemap-static.xml',
  'sitemap-contractors.xml',
  'sitemap-contracts.xml',
  'sitemap-contractor-tabs.xml',
  'sitemap-opportunities.xml',
  'sitemap-facets.xml',
] as const;

/** The index document, served at /sitemap.xml and /sitemap-index.xml. */
export function sitemapIndexResponse(): Response {
  const xml = renderSitemapIndex(SITEMAP_CHILDREN.map((c) => ({ loc: `${SITE_URL}/${c}` })));
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

/**
 * Code-defined pages: marketing, glossary, learn, blog, NAICS, agencies, set-asides, listicles,
 * research. No lastmod except blog posts, which carry a real `updatedAt` — these pages have no
 * data timestamp, and the deploy time is not one.
 */
export function staticEntries(): SitemapEntry[] {
  const topLevel: SitemapEntry[] = [
    { url: SITE_URL,                            changeFrequency: 'daily',   priority: 1.0 },
    { url: `${SITE_URL}/contractors`,           changeFrequency: 'daily',   priority: 0.9 },
    // /market-intelligence — the page body is a client-side Stripe upgrade widget
    // (64 chars of server-rendered text, no h1, as measured 2026-09-21). Its layout
    // now server-renders the H1, the copy, JSON-LD and the cluster links, so the URL
    // is worth asserting again. Reservation on file in that layout: copy wrapped
    // around a checkout widget may still not earn indexation on its own merits.
    { url: `${SITE_URL}/market-intelligence`,   changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE_URL}/opportunity-hunter`,    changeFrequency: 'daily',   priority: 0.8 },
    // /expiring-contracts stays OUT: it 308-redirects to `/` (retired product,
    // next.config.ts). Google reported it "Page with redirect", canonical `/`.
    //
    // /forecasts is back IN, because it is now a real page. It 404'd for as long
    // as it was advertised here, while `agency_forecasts` held 35,912 rows in
    // Supabase with no public surface at all. The route now renders those counts
    // as server HTML, and noindexes itself if the read fails.
    { url: `${SITE_URL}/forecasts`,             changeFrequency: 'daily',   priority: 0.8 },
    // Comparison pages — target high-volume "alternative" keywords.
    // Priority 0.8 puts them in the top tier just below the homepage
    // since they're primary acquisition surfaces for paid + organic.
    { url: `${SITE_URL}/compare`,               changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/compare/govwin`,        changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/compare/sam-gov`,       changeFrequency: 'weekly',  priority: 0.8 },
    // Data-driven competitor comparison pages (Phase 3 — "X alternative" intent)
    ...COMPETITORS.map((c) => ({
      url: `${SITE_URL}/compare/${c.slug}`,
      changeFrequency: 'weekly' as const, priority: 0.8,
    })),
    // /pricing — primary conversion surface. Mirrors the SoftwareApplication
    // offers in JSON-LD so Google can surface price in rich snippets.
    { url: `${SITE_URL}/pricing`,               changeFrequency: 'monthly', priority: 0.8 },
    // /bd-assist removed 2026-09-21 — it 307-redirects to /briefings (an app route).
    // Glossary index — definition-intent SEO surface. Per-term pages
    // are emitted below as their own block so Google sees the full
    // vocabulary, not just the landing page.
    { url: `${SITE_URL}/glossary`,              changeFrequency: 'weekly',  priority: 0.7 },
    // Mindy Learn — public GovCon tutorials (Learn PR B). Index + one page per mission, from static data.
    { url: `${SITE_URL}/learn`,                 changeFrequency: 'weekly',  priority: 0.8 },
    ...MISSIONS.map((m) => ({ url: `${SITE_URL}/learn/${m.slug}`, changeFrequency: 'monthly' as const, priority: 0.6 })),
    // NAICS index — top-of-funnel for "naics codes" / industry-discovery
    // queries. Per-code detail pages emitted in their own block below so
    // Google sees the full set, not just the landing page.
    { url: `${SITE_URL}/naics`,                 changeFrequency: 'weekly',  priority: 0.7 },
    // Blog index — top-of-funnel content surface. Daily change freq
    // because we want Google checking back as we publish; individual
    // post URLs are emitted below.
    { url: `${SITE_URL}/blog`,                  changeFrequency: 'daily',   priority: 0.8 },
    // Agencies index — buyer-intent SEO surface for "[agency] contract
    // opportunities" queries. Per-agency detail pages emitted in their
    // own block below so Google sees the full set of 49 federal agencies.
    { url: `${SITE_URL}/agencies`,              changeFrequency: 'weekly',  priority: 0.7 },
    // Set-asides index — hub for the four SBA program landing pages
    // (8(a), HUBZone, SDVOSB, WOSB). Priority 0.8 because the program
    // pages themselves target the highest-intent transactional searches
    // in GovCon ("8a contracts", "hubzone contracts", etc.).
    { url: `${SITE_URL}/set-asides`,            changeFrequency: 'monthly', priority: 0.8 },
    // Top contractor lists hub — targets the high-demand listicle queries
    // GSC surfaced ("top federal system integrators", "largest federal
    // contractors", "top defense contractors"). Priority 0.8 because the
    // intent is transactional + the queries already have proven volume.
    { url: `${SITE_URL}/top`,                   changeFrequency: 'weekly',  priority: 0.8 },
    // Awards database landing — targets "federal contract awards
    // database", "federal contracts awarded", "government contract
    // awards" query cluster (26+ impressions in GSC week 1).
    // Individual /awards/[id] detail pages are NOT in the sitemap
    // (63M possible URLs would explode the sitemap); they're
    // discoverable via the landing page's tables and ISR-render
    // on first crawl.
    { url: `${SITE_URL}/awards`,                changeFrequency: 'daily',   priority: 0.8 },
    // /spending and /discover were LIVE, server-rendered and indexable but absent
    // from this file until 2026-09-21 — so the only way in was a link we did not have
    // either. /spending in particular is one of the strongest public pages on the
    // domain: 9,499 chars of server-rendered text, ItemList + GovernmentService
    // JSON-LD, and 42 internal links out to /awards/[id] detail pages.
    { url: `${SITE_URL}/spending`,              changeFrequency: 'daily',   priority: 0.8 },
    { url: `${SITE_URL}/discover`,              changeFrequency: 'weekly',  priority: 0.7 },
    // /recompete — server-rendered content added to its layout 2026-09-21 (it was a
    // 387-char client shell). It is the live destination for the "expiring contracts"
    // intent now that /expiring-contracts is a retired product 308-ing to `/`.
    { url: `${SITE_URL}/recompete`,             changeFrequency: 'daily',   priority: 0.7 },
    { url: `${SITE_URL}/about`,                 changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/free-resources`,        changeFrequency: 'weekly',  priority: 0.5 },
    { url: `${SITE_URL}/privacy`,               changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/terms`,                 changeFrequency: 'yearly',  priority: 0.3 },
    // The Mindy Institute — the public research index (front door) + each PUBLISHED publication
    // (Class A). The children auto-list from the registry so every future publication is
    // discoverable the moment it flips to status:'published' with a slug.
    { url: `${SITE_URL}/research`,              changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE_URL}/research/about`,        changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/research/how-we-publish`, changeFrequency: 'weekly', priority: 0.5 },
    ...publishedPublications().map((p) => ({
      url: `${SITE_URL}/research/${p.slug}`,
      changeFrequency: 'monthly' as const, priority: 0.7,
    })),
  ];

  const glossary: SitemapEntry[] = glossaryTerms.map((t) => ({
    url: `${SITE_URL}/glossary/${t.slug}`, changeFrequency: 'monthly', priority: 0.5,
  }));
  const blog: SitemapEntry[] = BLOG_POSTS.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: toLastmod(`${p.updatedAt}T00:00:00Z`),
    changeFrequency: 'weekly', priority: 0.7,
  }));
  const naics: SitemapEntry[] = NAICS_TOP_100.map((e) => ({
    url: `${SITE_URL}/naics/${e.code}`, changeFrequency: 'monthly', priority: 0.5,
  }));
  const agencies: SitemapEntry[] = AGENCIES_SEO.map((a) => ({
    url: `${SITE_URL}/agencies/${a.slug}`, changeFrequency: 'monthly', priority: 0.6,
  }));
  const setAsides: SitemapEntry[] = ['8a', 'hubzone', 'sdvosb', 'wosb'].map((slug) => ({
    url: `${SITE_URL}/set-asides/${slug}`, changeFrequency: 'weekly', priority: 0.8,
  }));
  const listicles: SitemapEntry[] = LISTICLES.map((l) => ({
    url: `${SITE_URL}/top/${l.slug}`, changeFrequency: 'weekly', priority: 0.8,
  }));
  return [...topLevel, ...glossary, ...blog, ...naics, ...agencies, ...setAsides, ...listicles];
}

export interface ContractorSections {
  profiles: SitemapEntry[];
  contracts: SitemapEntry[];
  tabs: SitemapEntry[];
}

/**
 * Contractor profiles, their /contracts pages, and their naics/agencies tabs.
 *
 * Throws (→ 503 at the route) when a source cannot be read, instead of returning an empty or
 * partial family. Google keeps the last good copy of a 5xx sitemap; an empty 200 would tell it
 * every contractor URL had disappeared. `need` limits which sources are read.
 */
export async function contractorSections(need: { contracts?: boolean; tabs?: boolean } = {}): Promise<ContractorSections> {
  const recipients = await getTopRecipientsForSitemap();
  if (recipients.length === 0) {
    // Cache-only read: [] means the cached recipient list is cold or KV is unreachable, not that
    // there are no contractors.
    throw new Error('contractor recipient list unavailable (cold cache or KV unreachable)');
  }
  const candidateSlugs = recipients
    .map((c) => (c.recipient_name ? recipientSlug(c.recipient_name) : ''))
    .filter(Boolean);
  // VERIFIED-SERVEABLE GATE (2026-09-21): advertise a contractor only if its per-slug profile
  // record is in KV — the page's own eligibility. The same read yields last_action_date.
  const { profiles: serveable, failedBatches } = await getServeableProfiles(candidateSlugs);
  if (failedBatches > 0) throw new Error(`profile cache unreadable (${failedBatches} KV batches failed)`);

  let servedAsOf = new Map<string, string | null>();
  if (need.contracts) {
    const served = await getServedContractsAsOf();
    if (!served.ok) throw new Error(`served contracts table unreadable: ${served.reason}`);
    servedAsOf = served.asOf;
  }
  let naicsRowCounts = new Map<string, number>();
  let agencyRowCounts = new Map<string, number>();
  if (need.tabs) {
    const tabUeis = recipients.map((c) => c.rollup_uei).filter((u): u is string => !!u);
    [naicsRowCounts, agencyRowCounts] = await Promise.all([
      getSubpageRowCounts('naics', tabUeis),
      getSubpageRowCounts('agencies', tabUeis),
    ]);
  }

  const out: ContractorSections = { profiles: [], contracts: [], tabs: [] };
  const seen = new Set<string>();
  for (const c of recipients) {
    if (!c.recipient_name) continue;
    const slug = recipientSlug(c.recipient_name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    // Thin-content gate — MUST match the noindex predicate in contractors/[slug]/page.tsx.
    if ((c.total_obligated || 0) < 25000 || (c.award_count || 0) < 2) continue;
    const profile = serveable.get(slug);
    if (!profile) continue;

    const spend = c.total_obligated || 0;
    const priority =
      spend >= 1_000_000_000 ? 0.8 :
      spend >= 100_000_000 ? 0.6 :
      spend >= 10_000_000 ? 0.5 :
      spend >= 1_000_000 ? 0.4 :
      0.3;
    out.profiles.push({
      url: `${SITE_URL}/contractors/${slug}`,
      // The latest award action: the profile's "recent awards" and totals change when it moves.
      lastModified: toLastmod(profile.lastActionDate),
      changeFrequency: 'weekly',
      priority,
    });
    const subPriority = Math.max(priority - 0.1, 0.2);
    // /contracts only when the durable served table has page 1 (the per-recipient gate).
    if (servedAsOf.has(c.rollup_uei)) {
      out.contracts.push({
        url: `${SITE_URL}/contractors/${slug}/contracts`,
        // MAX(action_date) of the data behind the page, recorded when the page was built.
        lastModified: toLastmod(servedAsOf.get(c.rollup_uei) ?? profile.lastActionDate),
        changeFrequency: 'weekly',
        priority: subPriority,
      });
    }
    // NAICS / agency tabs: only when the renderer's own row cache clears SUBPAGE_MIN_ROWS.
    if (subpageSitemapEligible(agencyRowCounts.get(c.rollup_uei), SUBPAGE_MIN_ROWS)) {
      out.tabs.push({ url: `${SITE_URL}/contractors/${slug}/agencies`, lastModified: toLastmod(profile.lastActionDate), changeFrequency: 'weekly', priority: subPriority });
    }
    if (subpageSitemapEligible(naicsRowCounts.get(c.rollup_uei), SUBPAGE_MIN_ROWS)) {
      out.tabs.push({ url: `${SITE_URL}/contractors/${slug}/naics`, lastModified: toLastmod(profile.lastActionDate), changeFrequency: 'weekly', priority: subPriority });
    }
  }
  return out;
}

/** Active opportunities: open and awarded (closed notices render but are not advertised). */
export async function opportunityEntries(): Promise<SitemapEntry[]> {
  const rows = await getOpportunitySitemapEntries();
  if (rows.length > SITEMAP_URL_LIMIT) {
    // Never silently truncate: past this point the family needs a second child file.
    throw new Error(`opportunity sitemap has ${rows.length} URLs, over the ${SITEMAP_URL_LIMIT} per-file limit`);
  }
  return rows.map((r) => ({
    url: `${SITE_URL}/opportunity/${r.slug}`,
    lastModified: r.lastModified,
    changeFrequency: r.status === 'open' ? 'daily' : 'monthly',
    priority: r.status === 'open' ? 0.6 : 0.5,
  }));
}

/**
 * Faceted opportunity listings (NAICS×state, PSC, set-aside×NAICS). Selection is UNCHANGED in
 * this phase — including the known 1,000-row clip inside getFacetSlugsForSitemap, which today
 * limits facets to those present in the first 1,000 active rows. Lifting it would publish
 * thousands of facets, many thin (naics×state pages measure ~138 words median); that is a
 * Phase 3 indexability decision, not a sitemap fix. No lastmod: no per-facet data date exists.
 */
export async function facetEntries(): Promise<SitemapEntry[]> {
  const f = await getFacetSlugsForSitemap();
  // getFacetSlugsForSitemap swallows read errors into empty arrays. An all-empty result is that
  // failure, not a market with zero active opportunities: refuse rather than publish nothing.
  if (f.naicsState.length + f.psc.length + f.setAsideNaics.length === 0) {
    throw new Error('facet source returned nothing (read failure)');
  }
  return [
    ...f.naicsState.map((x) => ({
      url: `${SITE_URL}/naics/${x.naics}/${x.state.toLowerCase()}`, changeFrequency: 'daily' as const, priority: 0.6,
    })),
    ...f.psc.map((code) => ({ url: `${SITE_URL}/psc/${code.toLowerCase()}`, changeFrequency: 'daily' as const, priority: 0.6 })),
    ...f.setAsideNaics.map((x) => ({
      url: `${SITE_URL}/set-aside/${x.setAside}/${x.naics}`, changeFrequency: 'daily' as const, priority: 0.7,
    })),
  ];
}
