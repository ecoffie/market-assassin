/**
 * Sitemap — Next.js metadata-route convention.
 *
 * Auto-published at /sitemap.xml. Tells Google + every other crawler
 * which pages exist and how often to re-check them.
 *
 * Strategy:
 *   - Root + key marketing pages first (highest priority)
 *   - All 2,768 contractor SEO pages (the acquisition flywheel)
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
import contractorsData from '@/data/contractors.json';
import { getContractorSlug } from '@/lib/contractor-sales-history';
import { glossaryTerms } from '@/data/glossary';
import { BLOG_POSTS } from '@/data/blog-posts';

// Canonical SEO domain. Per [memory: mindy-domain-routing] updated
// May 22, 2026: getmindy.ai is the indexable face of the product.
// Email + in-flight users still hit mi.govcongiants.com via host
// rewrite, but every Google-facing URL points at getmindy.ai so we
// don't fragment domain authority across two hostnames.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://getmindy.ai';

interface ContractorRow {
  company: string;
  contract_value_num?: number;
}

export default function sitemap(): MetadataRoute.Sitemap {
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
    { url: `${SITE_URL}/compare/govwin`,        lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/compare/sam-gov`,       lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    // /pricing — primary conversion surface. Mirrors the SoftwareApplication
    // offers in JSON-LD so Google can surface price in rich snippets.
    { url: `${SITE_URL}/pricing`,               lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/bd-assist`,             lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    // Glossary index — definition-intent SEO surface. Per-term pages
    // are emitted below as their own block so Google sees the full
    // vocabulary, not just the landing page.
    { url: `${SITE_URL}/glossary`,              lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    // Blog index — top-of-funnel content surface. Daily change freq
    // because we want Google checking back as we publish; individual
    // post URLs are emitted below.
    { url: `${SITE_URL}/blog`,                  lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${SITE_URL}/about`,                 lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/free-resources`,        lastModified: now, changeFrequency: 'weekly',  priority: 0.5 },
    { url: `${SITE_URL}/privacy`,               lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/terms`,                 lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
  ];

  // 2) Every contractor page. Priority graded by spend so Google
  // crawls the biggest contractors first.
  //
  // De-duplicate by slug — contractors.json has a few near-duplicate
  // rows ("OPTUM PUBLIC SECTOR SOLUTIONS INC" vs "OPTUM PUBLIC
  // SECTOR SOLUTIONS  INC.") that would otherwise emit two entries
  // for the same URL.
  const rows = contractorsData as ContractorRow[];
  const seenSlugs = new Set<string>();
  const contractorEntries: MetadataRoute.Sitemap = [];

  for (const c of rows) {
    if (!c.company) continue;
    const slug = getContractorSlug({ company: c.company });
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    // Priority graded by spend tier. Google's "priority" field is
    // a hint relative to OTHER URLs in the sitemap, not absolute.
    const spend = c.contract_value_num || 0;
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

  return [...topLevel, ...contractorEntries, ...glossaryEntries, ...blogEntries];
}
