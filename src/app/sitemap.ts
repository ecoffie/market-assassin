/**
 * Sitemap — Next.js metadata-route convention.
 *
 * Auto-published at /sitemap.xml. Tells Google + every other crawler
 * which pages exist and how often to re-check them.
 *
 * Strategy:
 *   - Root + key marketing pages first (highest priority)
 *   - Top contractor SEO pages sourced from BigQuery (the acquisition
 *     flywheel) — see contractor block for why this is BQ-sourced, not
 *     contractors.json
 *   - Static pages from /public are auto-discovered by Google so
 *     we don't enumerate them here
 *
 * Per the SEO contractor pages PRD: the gating play is to make
 * contractor profiles indexable so Google searches like "Booz Allen
 * federal contracts" land on Mindy. This sitemap is what tells Google
 * those pages exist en masse, instead of waiting for them to discover
 * each URL organically.
 */
import type { MetadataRoute } from 'next';
import {
  getTopRecipientsForSitemap,
  recipientSlug,
  SUBPAGE_MIN_ROWS,
} from '@/lib/bigquery/recipients';
import { glossaryTerms } from '@/data/glossary';
import { BLOG_POSTS } from '@/data/blog-posts';
import { NAICS_TOP_100 } from '@/data/naics-top100';
import { AGENCIES_SEO } from '@/data/agencies-seo';
import { getFacetSlugsForSitemap } from '@/lib/seo/facets';
import { COMPETITORS } from '@/data/competitors';
import { LISTICLES } from '@/data/top-listicles';

// Canonical SEO domain. Per [memory: mindy-domain-routing] updated
// May 22, 2026: getmindy.ai is the indexable face of the product.
// Email + in-flight users still hit getmindy.ai via host
// rewrite, but every Google-facing URL points at getmindy.ai so we
// don't fragment domain authority across two hostnames.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

// Regenerate the sitemap at most once a day. The contractor block hits
// BigQuery (via the KV-cached getTopRecipientsForSitemap), so we don't
// want a fresh query on every crawler request. Daily matches the
// weekly-ish USAspending refresh cadence with margin to spare.
export const revalidate = 86400;

// Sub-page thin-content threshold (SUBPAGE_MIN_ROWS) is imported from the
// recipients lib so the sitemap and the sub-pages' own robots directives
// can't drift apart — see the constant's doc comment for why they must agree.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 1) Top-level marketing + intro pages. Priority 1.0 because
  // these are the entry points where Google sends people first.
  const now = new Date();
  const topLevel: MetadataRoute.Sitemap = [
    { url: SITE_URL,                            lastModified: now, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${SITE_URL}/contractors`,           lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
    { url: `${SITE_URL}/market-intelligence`,   lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/opportunity-hunter`,    lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${SITE_URL}/expiring-contracts`,    lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${SITE_URL}/forecasts`,             lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    // Comparison pages — target high-volume "alternative" keywords.
    // Priority 0.8 puts them in the top tier just below the homepage
    // since they're primary acquisition surfaces for paid + organic.
    { url: `${SITE_URL}/compare`,               lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/compare/govwin`,        lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/compare/sam-gov`,       lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    // Data-driven competitor comparison pages (Phase 3 — "X alternative" intent)
    ...COMPETITORS.map((c) => ({
      url: `${SITE_URL}/compare/${c.slug}`,
      lastModified: now, changeFrequency: 'weekly' as const, priority: 0.8,
    })),
    // /pricing — primary conversion surface. Mirrors the SoftwareApplication
    // offers in JSON-LD so Google can surface price in rich snippets.
    { url: `${SITE_URL}/pricing`,               lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/bd-assist`,             lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    // Glossary index — definition-intent SEO surface. Per-term pages
    // are emitted below as their own block so Google sees the full
    // vocabulary, not just the landing page.
    { url: `${SITE_URL}/glossary`,              lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    // NAICS index — top-of-funnel for "naics codes" / industry-discovery
    // queries. Per-code detail pages emitted in their own block below so
    // Google sees the full set, not just the landing page.
    { url: `${SITE_URL}/naics`,                 lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    // Blog index — top-of-funnel content surface. Daily change freq
    // because we want Google checking back as we publish; individual
    // post URLs are emitted below.
    { url: `${SITE_URL}/blog`,                  lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    // Agencies index — buyer-intent SEO surface for "[agency] contract
    // opportunities" queries. Per-agency detail pages emitted in their
    // own block below so Google sees the full set of 49 federal agencies.
    { url: `${SITE_URL}/agencies`,              lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    // Set-asides index — hub for the four SBA program landing pages
    // (8(a), HUBZone, SDVOSB, WOSB). Priority 0.8 because the program
    // pages themselves target the highest-intent transactional searches
    // in GovCon ("8a contracts", "hubzone contracts", etc.).
    { url: `${SITE_URL}/set-asides`,            lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    // Top contractor lists hub — targets the high-demand listicle queries
    // GSC surfaced ("top federal system integrators", "largest federal
    // contractors", "top defense contractors"). Priority 0.8 because the
    // intent is transactional + the queries already have proven volume.
    { url: `${SITE_URL}/top`,                   lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    // Awards database landing — targets "federal contract awards
    // database", "federal contracts awarded", "government contract
    // awards" query cluster (26+ impressions in GSC week 1).
    // Individual /awards/[id] detail pages are NOT in the sitemap
    // (63M possible URLs would explode the sitemap); they're
    // discoverable via the landing page's tables and ISR-render
    // on first crawl.
    { url: `${SITE_URL}/awards`,                lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${SITE_URL}/about`,                 lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/free-resources`,        lastModified: now, changeFrequency: 'weekly',  priority: 0.5 },
    { url: `${SITE_URL}/privacy`,               lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/terms`,                 lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
  ];

  // 2) Top contractor pages, sourced from BigQuery (the same
  // `recipients` table the pages query). Priority graded by spend so
  // Google crawls the biggest contractors first.
  //
  // Why BigQuery, not contractors.json: the legacy JSON source held
  // 2,768 hand-curated names, ~529 of which had NO matching recipient
  // row in BigQuery (parent/holding companies like "AECOM TECHNOLOGY
  // CORPORATION" whose awards land under subsidiary legal names). The
  // sitemap emitted main + 3 sub-page URLs for each, so Googlebot
  // crawled ~2,116 URLs straight into notFound() 404s. Sourcing from
  // the recipients table guarantees every emitted URL resolves, and
  // unlocks the full set of real award recipients (capped by spend).
  //
  // recipientSlug() must match getRecipientBySlug()'s in-DB slug logic
  // exactly, or these URLs would 404 the same way.
  const recipients = await getTopRecipientsForSitemap();
  const seenSlugs = new Set<string>();
  const contractorEntries: MetadataRoute.Sitemap = [];

  for (const c of recipients) {
    if (!c.recipient_name) continue;
    const slug = recipientSlug(c.recipient_name);
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    // Priority graded by spend tier. Google's "priority" field is
    // a hint relative to OTHER URLs in the sitemap, not absolute.
    const spend = c.total_obligated || 0;
    const priority =
      spend >= 1_000_000_000 ? 0.8 :  // billion-dollar primes
      spend >= 100_000_000   ? 0.6 :
      spend >= 10_000_000    ? 0.5 :
      spend >= 1_000_000     ? 0.4 :
      0.3;

    contractorEntries.push({
      url: `${SITE_URL}/contractors/${slug}`,
      lastModified: now,
      // weekly because USAspending data only refreshes weekly.
      // Telling Google "check daily" would just burn crawl budget
      // on cached responses.
      changeFrequency: 'weekly',
      priority,
    });

    // Sub-pages — one per contractor per tab. Each is its own SEO
    // target (e.g. "lockheed martin contracts"). Slightly lower
    // priority than overview since overview is the canonical entry
    // point for brand-search intent.
    //
    // Thin-page gate: a contractor with only 1-2 agencies (or NAICS
    // codes) renders a near-empty table on /agencies (or /naics).
    // Google crawls those, sees almost no unique content, and parks
    // them under "Crawled - currently not indexed" — wasting crawl
    // budget that should go to the pages that can actually rank. So we
    // only emit a tab when the contractor has enough rows to make it a
    // substantive page. /contracts always emits: every recipient has
    // award rows by definition, and it's the core brand-search target.
    const subPagePriority = Math.max(priority - 0.1, 0.2);
    const tabs = ['contracts'];
    if ((c.distinct_agency_count || 0) >= SUBPAGE_MIN_ROWS) tabs.push('agencies');
    if ((c.distinct_naics_count || 0) >= SUBPAGE_MIN_ROWS) tabs.push('naics');
    for (const tab of tabs) {
      contractorEntries.push({
        url: `${SITE_URL}/contractors/${slug}/${tab}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: subPagePriority,
      });
    }
  }

  // 3) One sitemap entry per glossary term. Priority 0.5 because each
  // page is a focused definition that can independently rank for
  // "what is X" queries. Monthly because definitions are stable —
  // we'd rather Google spend crawl budget on the contractor pages.
  const glossaryEntries: MetadataRoute.Sitemap = glossaryTerms.map((t) => ({
    url: `${SITE_URL}/glossary/${t.slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  // 4) One sitemap entry per blog post. Priority 0.7 because long-form
  // posts are higher-intent SEO surfaces than glossary stubs but lower
  // priority than the homepage. Weekly change freq matches a realistic
  // editing cadence — we'll bump lastModified when we substantively
  // update a post.
  const blogEntries: MetadataRoute.Sitemap = BLOG_POSTS.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: new Date(p.updatedAt + 'T00:00:00Z'),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  // 5) One sitemap entry per top-100 NAICS code. Priority 0.5 (matches
  // glossary terms — they're definition-intent pages that earn their
  // own long-tail rankings). Monthly because the underlying NAICS
  // taxonomy is stable; the page content shifts only when contractors.json
  // refreshes, which is infrequent.
  const naicsEntries: MetadataRoute.Sitemap = NAICS_TOP_100.map((e) => ({
    url: `${SITE_URL}/naics/${e.code}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  // 6) One sitemap entry per federal agency. Priority 0.6 — higher than
  // glossary/NAICS (more buyer-intent) but lower than contractor mega-
  // entries since the cohort is small (49) and each page is medium-depth
  // content. Monthly because budget figures + pain points shift slowly.
  const agencyEntries: MetadataRoute.Sitemap = AGENCIES_SEO.map((a) => ({
    url: `${SITE_URL}/agencies/${a.slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  // 7) Four SBA set-aside program pages — 8(a), HUBZone, SDVOSB, WOSB.
  // Priority 0.8 (transactional / very-high-intent searches) with weekly
  // change freq because the underlying opportunity data Mindy surfaces
  // moves daily — we want Google rechecking these pages often even
  // though the page copy itself is stable.
  const setAsideSlugs = ['8a', 'hubzone', 'sdvosb', 'wosb'];
  const setAsideEntries: MetadataRoute.Sitemap = setAsideSlugs.map((slug) => ({
    url: `${SITE_URL}/set-asides/${slug}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  // 8) Top contractor listicle pages. Priority 0.8 — these target
  // proven-demand queries from GSC ("top federal system integrators",
  // "largest federal contractors", etc.).
  const listicleEntries: MetadataRoute.Sitemap = LISTICLES.map((l) => ({
    url: `${SITE_URL}/top/${l.slug}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  // NOTE: the ~34k /opportunity/[slug] pages live in their OWN child sitemap
  // (/sitemap-opportunities.xml, listed in /sitemap-index.xml) so THIS sitemap
  // stays well under Google's 50k-URL cap as the opportunity set grows. (Phase 5.)

  // Phase-2 faceted pages: NAICS×state, PSC, set-aside×NAICS. Elon mode —
  // index every facet with ≥1 active opp; enrich the winners later (Phase 4).
  // Fail-safe to empty so a facet query never breaks the sitemap.
  let facetEntries: MetadataRoute.Sitemap = [];
  try {
    const f = await getFacetSlugsForSitemap();
    facetEntries = [
      ...f.naicsState.map((x) => ({
        url: `${SITE_URL}/naics/${x.naics}/${x.state.toLowerCase()}`,
        lastModified: now, changeFrequency: 'daily' as const, priority: 0.6,
      })),
      ...f.psc.map((code) => ({
        url: `${SITE_URL}/psc/${code.toLowerCase()}`,
        lastModified: now, changeFrequency: 'daily' as const, priority: 0.6,
      })),
      ...f.setAsideNaics.map((x) => ({
        url: `${SITE_URL}/set-aside/${x.setAside}/${x.naics}`,
        lastModified: now, changeFrequency: 'daily' as const, priority: 0.7,
      })),
    ];
  } catch {
    facetEntries = [];
  }

  return [
    ...topLevel,
    ...contractorEntries,
    ...glossaryEntries,
    ...blogEntries,
    ...naicsEntries,
    ...agencyEntries,
    ...setAsideEntries,
    ...listicleEntries,
    ...facetEntries,
  ];
}
