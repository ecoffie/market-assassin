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
  /** Typed award columns — set by the SAM sync only when the award notice carries a winner. */
  awardeeName: string | null;
  awardDate: string | null;
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
      'notice_id, solicitation_number, title, description, sow_text, naics_code, psc_code, department, sub_tier, office, notice_type, set_aside_description, posted_date, response_deadline, pop_state, pop_city, ui_link, active, seo_summary, awardee_name, award_date',
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
    awardeeName: (row.awardee_name || '').trim() || null,
    awardDate: row.award_date || null,
  };
}

/** LIKE pattern matching strings of at least `n` characters (PostgREST: `*` is `%`). */
const atLeast = (n: number) => `${'_'.repeat(n)}*`;

export interface RelatedOpenOpportunities {
  /** Which scope produced the list: same NAICS first, then the same department. */
  scope: 'naics' | 'agency';
  items: SimilarOpportunity[];
}

/**
 * Related OPEN opportunities — the internal-link web, and the next step a visitor on a CLOSED
 * notice actually wants. `active` does not mean open (see opportunityStatus), so the old
 * "Similar Active Opportunities" block could link a past-deadline notice under an "active"
 * heading. Every scope — NAICS/department, open-ness, the thin gate — is applied IN THE QUERY,
 * before the limit, so a big NAICS full of closed notices cannot starve the list (filter, then
 * rank). The JS pass only re-checks open-ness to the second (the query is day-grained).
 *
 * Returns null when nothing could be read or nothing qualifies — the page then renders no block.
 * A read error is logged, never presented as "no related opportunities".
 */
export async function getRelatedOpenOpportunities(
  opp: Pick<SeoOpportunity, 'noticeId' | 'naicsCode' | 'department'>,
  limit = 6,
  now: Date = new Date(),
): Promise<RelatedOpenOpportunities | null> {
  const client = sb();
  if (!client) return null;
  const today = now.toISOString().slice(0, 10);

  const scopes: Array<{ scope: 'naics' | 'agency'; column: string; value: string | null }> = [
    { scope: 'naics', column: 'naics_code', value: opp.naicsCode },
    { scope: 'agency', column: 'department', value: opp.department },
  ];
  for (const sc of scopes) {
    if (!sc.value) continue;
    const { data, error } = await client
      .from('sam_opportunities')
      .select('notice_id, title, department, notice_type, response_deadline, naics_code')
      .eq('active', true)
      .eq(sc.column, sc.value)
      .neq('notice_id', opp.noticeId)
      .or(`response_deadline.gte.${today},response_deadline.is.null`)
      .or('notice_type.is.null,notice_type.not.ilike.*award*')
      .like('title', atLeast(8))
      .like('description', atLeast(MIN_BODY)) // a subset of isIndexableOpp: never links a 404
      .order('posted_date', { ascending: false })
      .limit(limit * 2);
    if (error) {
      // A related-links block must not take the page down; log it so a broken column is visible.
      console.error(`[seo/opportunities] related-open (${sc.scope}) read failed:`, error.message);
      return null;
    }
    const items = (data ?? [])
      .filter((r) => r.title && r.title.trim().length >= 8)
      .filter((r) => opportunityStatus(r, now) === 'open')
      .slice(0, limit)
      .map((r) => ({
        slug: opportunitySlug(r.title, r.notice_id),
        title: r.title,
        department: r.department || null,
        noticeType: r.notice_type || null,
        responseDeadline: r.response_deadline || null,
        naicsCode: r.naics_code || null,
      }));
    if (items.length > 0) return { scope: sc.scope, items };
  }
  return null;
}

export type OpportunityStatus = 'open' | 'closed' | 'awarded';

/**
 * What a notice IS right now. `active` in sam_opportunities does not mean "open": measured
 * 2026-11-12, 19,182 of 28,010 indexable active rows were past their response deadline and 531
 * were award notices. The sitemap and the page must not present those as open solicitations.
 */
export function opportunityStatus(
  o: { notice_type?: string | null; response_deadline?: string | null; active?: boolean | null },
  now: Date = new Date(),
): OpportunityStatus {
  if (o.notice_type && /award/i.test(o.notice_type)) return 'awarded';
  if (o.response_deadline) {
    const d = new Date(o.response_deadline);
    if (!Number.isNaN(d.getTime()) && d.getTime() < now.getTime()) return 'closed';
    if (!Number.isNaN(d.getTime()) && d.getTime() >= now.getTime()) {
      // SAM archived it (active=false) — no longer accepting responses even if the deadline is
      // still in the future (cancelled / archived early). Never call an archived notice open.
      if (o.active === false) return 'closed';
      return 'open';
    }
  }
  // No usable deadline: cannot claim open (active=true + null deadline is unknown, not open).
  if (o.active === false) return 'closed';
  return 'closed';
}

function fmtUtcDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The status banner a page shows. Every clause is a fact from the row: "responses were due"
 * only with a real deadline, "awarded to" only when the award notice names the winner. An
 * award notice without a named winner says so plainly instead of guessing one.
 */
export function opportunityStatusLabel(
  o: { notice_type?: string | null; response_deadline?: string | null; active?: boolean | null;
       awardee_name?: string | null; award_date?: string | null },
  now: Date = new Date(),
): { status: OpportunityStatus; label: string } {
  const status = opportunityStatus(o, now);
  if (status === 'awarded') {
    const winner = (o.awardee_name || '').trim();
    const on = fmtUtcDate(o.award_date);
    return {
      status,
      label: winner ? `Awarded to ${winner}${on ? ` on ${on}` : ''}` : 'Award notice',
    };
  }
  if (status === 'closed') {
    const due = fmtUtcDate(o.response_deadline);
    const pastDue = due && new Date(o.response_deadline!).getTime() < now.getTime();
    return {
      status,
      label: pastDue ? `Closed — responses were due ${due}` : 'Closed — this notice has been archived on SAM.gov',
    };
  }
  return { status, label: 'Open for responses' };
}

export interface OpportunitySitemapRow {
  slug: string;
  status: Exclude<OpportunityStatus, 'closed'>;
  /** Latest of posted_date / seo_enriched_at — both change what the page renders. */
  lastModified: string | null;
}

export interface ClosedOpportunitySitemapRow {
  slug: string;
  status: 'closed';
  /** The response deadline — the page states it ("responses were due …"). */
  responseDeadline: string;
  lastModified: string | null;
}

const PAGE = 1000; // PostgREST max-rows: a larger .limit() is silently clipped to this

type SitemapSourceRow = {
  notice_id: string; title: string | null; notice_type: string | null; active?: boolean | null;
  response_deadline: string | null; posted_date: string | null; seo_enriched_at: string | null;
};
// The PostgREST filter builder, without spelling out supabase-js's generics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filterable = any;

/**
 * Read every non-thin sam_opportunities row matching `scope`, paged past PostgREST's 1,000-row
 * clip.
 *
 * Cost shape: the thin test runs IN POSTGRES as a LIKE over N single-char wildcards, so the
 * 2 KB descriptions and 20 KB sow_text never leave the database (pulling them for ~40K rows
 * would be ~800 MB per build). Rows whose description is short qualify only if sow_text alone
 * reaches MIN_BODY — a strict SUBSET of isIndexableOpp(), so a sitemap can never assert a
 * page the renderer would 404. Throws on any read error: the caller answers 503, never an
 * empty family.
 */
async function drainIndexable(
  client: SupabaseClient,
  label: string,
  select: string,
  scope: (q: Filterable) => Filterable,
): Promise<SitemapSourceRow[]> {
  const base = (): Filterable => scope(client.from('sam_opportunities').select(select).like('title', atLeast(8)));
  async function drain(thin: (q: Filterable) => Filterable, part: string): Promise<SitemapSourceRow[]> {
    const rows: SitemapSourceRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await thin(base())
        .order('notice_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`${label} (${part}) page ${from / PAGE}: ${error.message}`);
      const page = (data ?? []) as SitemapSourceRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
      if (rows.length > 200_000) throw new Error(`${label} (${part}): runaway pagination`);
    }
    return rows;
  }

  const [byDescription, bySow] = await Promise.all([
    drain((q) => q.like('description', atLeast(MIN_BODY)), 'description'),
    drain((q) => q.not('description', 'like', atLeast(MIN_BODY)).like('sow_text', atLeast(MIN_BODY)), 'sow'),
  ]);

  const seen = new Set<string>();
  const out: SitemapSourceRow[] = [];
  for (const r of [...byDescription, ...bySow]) {
    if (seen.has(r.notice_id)) continue;
    seen.add(r.notice_id);
    if (!r.title || r.title.trim().length < 8) continue; // mirror isIndexableOpp's trim
    out.push(r);
  }
  return out;
}

/**
 * Every sitemap-worthy active opportunity that is OPEN or AWARDED.
 * Closed notices are listed in their own child (getClosedOpportunitySitemapEntries →
 * sitemap-opportunities-closed.xml), so Search Console reports them separately.
 *
 * Replaces getOpportunitySlugsForSitemap(45000), which asked for 45,000 rows in ONE request:
 * PostgREST clipped it to 1,000, the thin filter left 798, and the error was never checked.
 */
export async function getOpportunitySitemapEntries(now: Date = new Date()): Promise<OpportunitySitemapRow[]> {
  const client = sb();
  if (!client) throw new Error('opportunity sitemap: no Supabase client');
  const today = now.toISOString().slice(0, 10);
  const statusOr = `response_deadline.gte.${today},response_deadline.is.null,notice_type.ilike.*award*`;
  const rows = await drainIndexable(
    client,
    'opportunity sitemap',
    'notice_id, title, notice_type, response_deadline, posted_date, seo_enriched_at',
    (q) => q.eq('active', true).or(statusOr),
  );
  const out: OpportunitySitemapRow[] = [];
  for (const r of rows) {
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

/** How far back closed notices are listed. Old solicitation numbers are still searched. */
export const CLOSED_SITEMAP_WINDOW_MONTHS = 24;

/**
 * Closed notices for sitemap-opportunities-closed.xml (2026-11-17).
 *
 * WHY THEY WERE EXCLUDED, AND WHY LISTING THEM IS NOW SAFE. On 2026-11-12 closed notices were
 * dropped from the sitemap because `active` ≠ open (19,182 of 28,010 indexable active rows were
 * past their deadline): advertising them presented dead solicitations as live ones. The page
 * now states the status as a fact from the row — "Closed — responses were due <date>", or
 * "archived" for active=false — and leads to related OPEN notices. Listed under that label, a
 * closed notice is an honest record, which is what a search for an old solicitation number wants.
 *
 * Scope: non-thin, NOT an award notice, response deadline in the past and within the last
 * CLOSED_SITEMAP_WINDOW_MONTHS. Active AND archived (active=false) rows: the page route renders
 * either (getOpportunityBySlug has no `active` filter). Rows with no deadline are left out —
 * the page could not say when responses were due. Disjoint from the open/awarded child, which
 * requires deadline ≥ today, no deadline, or an award notice.
 *
 * Size cap, explicit: Google allows `limit` (SITEMAP_URL_LIMIT) URLs per file. If the window
 * holds more, the MOST RECENT deadlines are kept and the cut is returned (`dropped`) and logged
 * — never a silent slice.
 */
export async function getClosedOpportunitySitemapEntries(
  now: Date = new Date(),
  limit = 50_000,
): Promise<{ rows: ClosedOpportunitySitemapRow[]; dropped: number }> {
  const client = sb();
  if (!client) throw new Error('closed opportunity sitemap: no Supabase client');
  const windowStart = new Date(now);
  windowStart.setUTCMonth(windowStart.getUTCMonth() - CLOSED_SITEMAP_WINDOW_MONTHS);
  const rows = await drainIndexable(
    client,
    'closed opportunity sitemap',
    'notice_id, title, notice_type, active, response_deadline, posted_date, seo_enriched_at',
    (q) => q
      .lt('response_deadline', now.toISOString())
      .gte('response_deadline', windowStart.toISOString())
      .or('notice_type.is.null,notice_type.not.ilike.*award*'),
  );

  const closed: ClosedOpportunitySitemapRow[] = [];
  for (const r of rows) {
    if (!r.response_deadline) continue;
    if (opportunityStatus(r, now) !== 'closed') continue; // exact re-check of the query
    const due = new Date(r.response_deadline);
    if (Number.isNaN(due.getTime()) || due.getTime() < windowStart.getTime()) continue;
    closed.push({
      slug: opportunitySlug(r.title, r.notice_id),
      status: 'closed',
      responseDeadline: due.toISOString(),
      lastModified: latestLastmod([r.posted_date, r.seo_enriched_at], now),
    });
  }
  // Newest deadline first; the ISO strings sort lexically.
  closed.sort((a, b) => (a.responseDeadline < b.responseDeadline ? 1 : a.responseDeadline > b.responseDeadline ? -1 : 0));
  const dropped = Math.max(0, closed.length - limit);
  if (dropped > 0) {
    console.warn(
      `[seo/opportunities] closed sitemap: ${closed.length} eligible, keeping the ${limit} most recent deadlines (${dropped} older left out)`,
    );
  }
  return { rows: closed.slice(0, limit), dropped };
}
