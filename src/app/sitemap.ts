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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mi.govcongiants.com';

interface ContractorRow {
  company: string;
  contract_value_num?: number;
}

export default function sitemap(): MetadataRoute.Sitemap {
  // 1) Top-level marketing + intro pages. Priority 1.0 because
  // these are the entry points where Google sends people first.
  const now = new Date();
  const topLevel: MetadataRoute.Sitemap = [
    { url: SITE_URL,                          lastModified: now, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${SITE_URL}/contractors`,          lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
    { url: `${SITE_URL}/market-intelligence`,  lastModified: now, changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/app`,                  lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${SITE_URL}/pricing`,              lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
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

  return [...topLevel, ...contractorEntries];
}
