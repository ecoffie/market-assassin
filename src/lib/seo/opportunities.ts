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
import { cache } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

const SLUG_LOOKUP_COLUMNS =
  'notice_id, solicitation_number, title, description, sow_text, naics_code, psc_code, department, sub_tier, office, notice_type, set_aside_description, posted_date, response_deadline, pop_state, pop_city, ui_link, active, seo_summary';

interface SlugLookupRow {
  notice_id: string;
  solicitation_number: string | null;
  title: string | null;
  description: string | null;
  sow_text: string | null;
  naics_code: string | null;
  psc_code: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
  notice_type: string | null;
  set_aside_description: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  pop_state: string | null;
  pop_city: string | null;
  ui_link: string | null;
  active: boolean | null;
  seo_summary: string | null;
}

/**
 * A `title ILIKE` pattern derived from the slug's title words, or null when the
 * slug carries no usable title (placeholder base 'opportunity', or no base).
 *
 * opportunitySlug() lowercases the title and turns every run of [^a-z0-9] into a
 * single '-', so the slug base is exactly the title's [a-z0-9] runs, in order
 * (the last one possibly cut by the 80-char slice). '%w1%w2%…%wn%' therefore
 * matches every title that can produce this slug — a strict SUPERSET filter, and
 * the words contain no LIKE/PostgREST metacharacters. Its only job is to let
 * Postgres use the title trigram index (idx_sam_opps_title_trgm) instead of
 * seq-scanning for the leading-wildcard notice_id suffix.
 */
export function slugTitlePattern(slug: string): string | null {
  const tail = noticeTailFromSlug(slug);
  if (!tail || slug.length <= tail.length + 1) return null;
  const base = slug.slice(0, slug.length - tail.length - 1);
  if (base === 'opportunity') return null; // placeholder — the title may be null
  const words = base.split('-').filter(Boolean);
  if (!words.length || words.some((w) => !/^[a-z0-9]+$/.test(w))) return null;
  return `%${words.join('%')}%`;
}

/**
 * Resolve a slug → the full opportunity, or null if not found / thin.
 *
 * Wrapped in React cache(): /opportunity/[slug] calls this from BOTH
 * generateMetadata and the page; Next documents cache() as the way to share one
 * fetch between them within a render (metadata-and-og-images.md, "Memoizing data
 * requests"). Outside a React server render cache() is a passthrough.
 */
export const getOpportunityBySlug = cache(async function getOpportunityBySlug(
  slug: string,
): Promise<SeoOpportunity | null> {
  const client = sb();
  if (!client) return null;
  const tail = noticeTailFromSlug(slug);
  if (!tail || tail.length < 6) return null;

  // Candidates = notice_id ending in the slug tail (8 alnum chars); the exact
  // slug is re-verified in JS below.
  //
  // 1) Index-assisted: AND a title predicate from the slug words, so the title
  //    trigram index narrows the scan (the notice_id suffix ILIKE alone can't
  //    use the btree and seq-scanned the whole table — 14% of prod DB time).
  // 2) Fallback: the ORIGINAL notice_id-only query, unchanged, when (1) yields
  //    no exact match (placeholder title, Unicode case-folding edge cases), so the
  //    set of slugs that resolve is identical to before. Cost note: a slug that
  //    matches NOTHING (404 / stale links) still pays the original seq scan via
  //    this fallback. Measure that share in pg_stat_statements: calls of the
  //    notice_id-only shape vs calls of the title+notice_id shape.
  const pattern = slugTitlePattern(slug);
  let row: SlugLookupRow | null = null;
  if (pattern) {
    const { data, error } = await client
      .from('sam_opportunities')
      .select(SLUG_LOOKUP_COLUMNS)
      .ilike('title', pattern)
      .ilike('notice_id', `%${tail}`)
      .limit(5);
    if (!error && data?.length) {
      row = (data as unknown as SlugLookupRow[]).find((r) => opportunitySlug(r.title, r.notice_id) === slug) || null;
    }
  }
  if (!row) {
    const { data, error } = await client
      .from('sam_opportunities')
      .select(SLUG_LOOKUP_COLUMNS)
      .ilike('notice_id', `%${tail}`)
      .limit(5);
    if (error || !data?.length) return null;
    row = (data as unknown as SlugLookupRow[]).find((r) => opportunitySlug(r.title, r.notice_id) === slug) || null;
  }
  if (!row || !isIndexableOpp(row)) return null;

  return {
    noticeId: row.notice_id,
    slug,
    title: row.title as string, // isIndexableOpp guarantees a title
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
});

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
  const { data } = await client
    .from('sam_opportunities')
    .select('notice_id, title, description, sow_text, department, notice_type, response_deadline, naics_code')
    .eq('active', true)
    .eq('naics_code', opp.naicsCode)
    .neq('notice_id', opp.noticeId)
    .order('posted_date', { ascending: false })
    .limit(limit * 3); // over-fetch; filter thin below
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
export async function getOpportunitySlugsForSitemap(cap = 20000): Promise<{ slug: string; lastModified: string }[]> {
  const client = sb();
  if (!client) return [];
  const { data } = await client
    .from('sam_opportunities')
    .select('notice_id, title, description, sow_text, last_modified, posted_date')
    .eq('active', true)
    .not('description', 'is', null)
    .order('posted_date', { ascending: false })
    .limit(cap);
  if (!data?.length) return [];
  return data
    .filter(isIndexableOpp)
    .map((r) => ({
      slug: opportunitySlug(r.title, r.notice_id),
      lastModified: (r.last_modified || r.posted_date || new Date().toISOString()).slice(0, 10),
    }));
}
