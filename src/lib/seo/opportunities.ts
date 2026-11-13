/**
 * SEO data layer for /opportunity/[slug] — public, indexable pages for every
 * active SAM opportunity. (HigherGov-style programmatic SEO: own the index for
 * "<title> government contract", "<solicitation#>", "who is buying <naics>".)
 *
 * Data discipline (rule #1 + thin-page guard): a page only renders if the opp
 * has REAL content (a title + a meaningful description or SOW). Thin opps are
 * 404'd and kept out of the sitemap — Google penalizes thin pages
 * (`fix/sitemap-gate-thin-subpages`).
 *
 * Source: sam_opportunities (Supabase). Read-only, service-role.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { latestLastmod } from './sitemap-xml';

const MIN_BODY = 200; // chars of real description/SOW required to be indexable

export interface SeoOpportunity {
  noticeId: string;
  slug: string;
  title: string;
  solicitationNumber: string | null;
  description: string;
  sowText: string | null;
  naicsCode: string | null;
  pscCode: string | null;
  department: string | null;
  subTier: string | null;
  office: string | null;
  noticeType: string | null;
  setAsideDescription: string | null;
  postedDate: string | null;
  responseDeadline: string | null;
  popState: string | null;
  popCity: string | null;
  uiLink: string | null;
  active: boolean;
  seoSummary: string | null;
}

export interface SimilarOpportunity {
  slug: string;
  title: string;
  department: string | null;
  noticeType: string | null;
  responseDeadline: string | null;
  naicsCode: string | null;
}

function sb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Stable, readable slug for an opportunity: <kebab-title>-<short-notice-id>.
 * The notice_id suffix guarantees uniqueness (titles repeat) and lets us
 * resolve the slug back to the exact row without a title lookup.
 */
export function opportunitySlug(title: string | null, noticeId: string): string {
  const base = (title || 'opportunity')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  // Last 8 of the notice_id — enough to disambiguate, short in the URL.
  const tail = noticeId.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
  return `${base || 'opportunity'}-${tail}`;
}

/** Extract the notice_id tail from a slug (the part after the last hyphen). */
function noticeTailFromSlug(slug: string): string {
  const parts = slug.split('-');
  return parts[parts.length - 1] || '';
}

/** True if the opp has enough real content to be a non-thin, indexable page. */
export function isIndexableOpp(o: { title?: string | null; description?: string | null; sow_text?: string | null }): boolean {
  if (!o.title || o.title.trim().length < 8) return false;
  const body = `${o.description || ''} ${o.sow_text || ''}`.trim();
  return body.length >= MIN_BODY;
}

/** Resolve a slug → the full opportunity, or null if not found / thin. */
export async function getOpportunityBySlug(slug: string): Promise<SeoOpportunity | null> {
  const client = sb();
  if (!client) return null;
  const tail = noticeTailFromSlug(slug);
  if (!tail || tail.length < 6) return null;

  // Match on the notice_id ending in the slug tail. ilike on a suffix is
  // exact enough (8 hex chars); we re-verify the full slug below.
  const { data, error } = await client
    .from('sam_opportunities')
    .select(
      'notice_id, solicitation_number, title, description, sow_text, naics_code, psc_code, department, sub_tier, office, notice_type, set_aside_description, posted_date, response_deadline, pop_state, pop_city, ui_link, active, seo_summary',
    )
    .ilike('notice_id', `%${tail}`)
    .limit(5);
  // A read FAILURE is not "this opportunity does not exist". Returning null here 404'd real
  // pages whenever Supabase hiccuped, and ISR held each false 404 for a day. Throw instead: the
  // route answers 5xx (not cached), and the next request retries. (Same rule as the contractor
  // routes, 2026-11-12.)
  if (error) throw new Error(`opportunity lookup failed for ${slug}: ${error.message}`);
  if (!data?.length) return null;

  // Pick the row whose generated slug matches the requested slug exactly.
  const row = data.find((r) => opportunitySlug(r.title, r.notice_id) === slug) || null;
  if (!row || !isIndexableOpp(row)) return null;

  return {
    noticeId: row.notice_id,
    slug,
    title: row.title,
    solicitationNumber: row.solicitation_number || null,
    description: row.description || '',
    sowText: row.sow_text || null,
    naicsCode: row.naics_code || null,
    pscCode: row.psc_code || null,
    department: row.department || null,
    subTier: row.sub_tier || null,
    office: row.office || null,
    noticeType: row.notice_type || null,
    setAsideDescription: row.set_aside_description || null,
    postedDate: row.posted_date || null,
    responseDeadline: row.response_deadline || null,
    popState: row.pop_state || null,
    popCity: row.pop_city || null,
    uiLink: row.ui_link || null,
    active: !!row.active,
    seoSummary: row.seo_summary || null,
  };
}

/**
 * "Similar Active Opportunities" — the internal-link web (SEO juice + dwell).
 * Same NAICS, active, excluding self, most-recent first. NAICS match is the
 * simplest reliable signal available now; semantic match is a later upgrade.
 */
export async function getSimilarOpportunities(
  opp: SeoOpportunity,
  limit = 6,
): Promise<SimilarOpportunity[]> {
  const client = sb();
  if (!client || !opp.naicsCode) return [];
  const { data, error } = await client
    .from('sam_opportunities')
    .select('notice_id, title, description, sow_text, department, notice_type, response_deadline, naics_code')
    .eq('active', true)
    .eq('naics_code', opp.naicsCode)
    .neq('notice_id', opp.noticeId)
    .order('posted_date', { ascending: false })
    .limit(limit * 3); // over-fetch; filter thin below
  if (error) {
    // A related-links block must not take the page down; log it so a broken column is visible.
    console.error('[seo/opportunities] similar-opportunities read failed:', error.message);
    return [];
  }
  if (!data?.length) return [];
  return data
    .filter(isIndexableOpp)
    .slice(0, limit)
    .map((r) => ({
      slug: opportunitySlug(r.title, r.notice_id),
      title: r.title,
      department: r.department || null,
      noticeType: r.notice_type || null,
      responseDeadline: r.response_deadline || null,
      naicsCode: r.naics_code || null,
    }));
}

/**
 * Slugs for the sitemap — only indexable (non-thin) active opps. Capped so the
 * sitemap stays sane; ordered by most recent. (Sitemap has a 50k URL limit;
 * we cap well under and can paginate later if needed.)
 */
export type OpportunityStatus = 'open' | 'closed' | 'awarded';

/**
 * What a notice IS right now. `active` in sam_opportunities does not mean "open": measured
 * 2026-11-12, 19,182 of 28,010 indexable active rows were past their response deadline and 531
 * were award notices. The sitemap and the page must not present those as open solicitations.
 */
export function opportunityStatus(
  o: { notice_type?: string | null; response_deadline?: string | null },
  now: Date = new Date(),
): OpportunityStatus {
  if (o.notice_type && /award/i.test(o.notice_type)) return 'awarded';
  if (o.response_deadline) {
    const d = new Date(o.response_deadline);
    if (!Number.isNaN(d.getTime()) && d.getTime() < now.getTime()) return 'closed';
  }
  return 'open';
}

export interface OpportunitySitemapRow {
  slug: string;
  status: Exclude<OpportunityStatus, 'closed'>;
  /** Latest of posted_date / seo_enriched_at — both change what the page renders. */
  lastModified: string | null;
}

/** LIKE pattern matching strings of at least `n` characters (PostgREST: `*` is `%`). */
const atLeast = (n: number) => `${'_'.repeat(n)}*`;
const PAGE = 1000; // PostgREST max-rows: a larger .limit() is silently clipped to this

/**
 * Every sitemap-worthy opportunity: active, non-thin, and OPEN or AWARDED.
 * Closed (past-deadline) notices still render and stay indexable; they are simply not
 * advertised — a sitemap is a claim that a URL deserves crawl priority.
 *
 * Replaces getOpportunitySlugsForSitemap(45000), which asked for 45,000 rows in ONE request:
 * PostgREST clipped it to 1,000, the thin filter left 798, and the error was never checked.
 *
 * Cost shape: the thin test runs IN POSTGRES as a LIKE over N single-char wildcards, so the
 * 2 KB descriptions and 20 KB sow_text never leave the database (pulling them for ~40K rows
 * would be ~800 MB per build). Rows whose description is short qualify only if sow_text alone
 * reaches MIN_BODY — a strict SUBSET of isIndexableOpp(), so the sitemap can never assert a
 * page the renderer would 404. Throws on any read error: the caller answers 503, never an
 * empty family.
 */
export async function getOpportunitySitemapEntries(now: Date = new Date()): Promise<OpportunitySitemapRow[]> {
  const client = sb();
  if (!client) throw new Error('opportunity sitemap: no Supabase client');
  const today = now.toISOString().slice(0, 10);
  const statusOr = `response_deadline.gte.${today},response_deadline.is.null,notice_type.ilike.*award*`;
  const select = 'notice_id, title, notice_type, response_deadline, posted_date, seo_enriched_at';

  type Row = {
    notice_id: string; title: string | null; notice_type: string | null;
    response_deadline: string | null; posted_date: string | null; seo_enriched_at: string | null;
  };
  async function drain(build: (q: ReturnType<typeof base>) => ReturnType<typeof base>, label: string): Promise<Row[]> {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(base())
        .order('notice_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`opportunity sitemap (${label}) page ${from / PAGE}: ${error.message}`);
      const page = (data ?? []) as Row[];
      rows.push(...page);
      if (page.length < PAGE) break;
      if (rows.length > 200_000) throw new Error(`opportunity sitemap (${label}): runaway pagination`);
    }
    return rows;
  }
  function base() {
    return client!
      .from('sam_opportunities')
      .select(select)
      .eq('active', true)
      .like('title', atLeast(8))
      .or(statusOr);
  }

  const [byDescription, bySow] = await Promise.all([
    drain((q) => q.like('description', atLeast(MIN_BODY)), 'description'),
    drain((q) => q.not('description', 'like', atLeast(MIN_BODY)).like('sow_text', atLeast(MIN_BODY)), 'sow'),
  ]);

  const seen = new Set<string>();
  const out: OpportunitySitemapRow[] = [];
  for (const r of [...byDescription, ...bySow]) {
    if (seen.has(r.notice_id)) continue;
    seen.add(r.notice_id);
    if (!r.title || r.title.trim().length < 8) continue; // mirror isIndexableOpp's trim
    const status = opportunityStatus(r, now);
    if (status === 'closed') continue; // the date filter is day-grained; this is exact
    out.push({
      slug: opportunitySlug(r.title, r.notice_id),
      status,
      lastModified: latestLastmod([r.posted_date, r.seo_enriched_at], now),
    });
  }
  return out;
}
