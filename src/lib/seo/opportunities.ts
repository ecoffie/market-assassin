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
      'notice_id, solicitation_number, title, description, sow_text, naics_code, psc_code, department, sub_tier, office, notice_type, set_aside_description, posted_date, response_deadline, pop_state, pop_city, ui_link, active',
    )
    .ilike('notice_id', `%${tail}`)
    .limit(5);
  if (error || !data?.length) return null;

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
