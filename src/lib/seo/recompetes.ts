/**
 * SEO data layer for /recompetes/[slug] — one public record page per expiring federal contract
 * (2026-11-17). GovTribe-style: the record is free, the follow-through (alerts, change history
 * detail, contacts) sits behind a free sign-up.
 *
 * SOURCE: Supabase `recompete_opportunities` — real per-contract rows from the USASpending sync
 * (CLAUDE.md "Recompete Tracker"). Only `quality_flag IS NULL` rows are real; the
 * `grouped_synthetic` rows (and the value-quarantine flags) never get a page — they 404.
 *
 * URL: /recompetes/<kebab incumbent + agency>--<contract_id>. Resolution is by the id after the
 * FIRST "--" only (a kebab slug can never contain "--"), so a renamed incumbent or agency never
 * breaks a link; a stale prefix 308s to the canonical one. `contract_id` is USASpending's
 * generated_internal_id (`CONT_AWD_<piid>_<agency>_<parent>_<parent agency>`), which is unique
 * (UNIQUE(contract_id)) — a PIID is NOT unique across agencies, so it is not the key.
 *
 * Read failures THROW (the route answers 5xx, never an empty or "not found" page) — the same
 * contract as src/app/awards/[id]/page.tsx and src/lib/seo/seo-unavailable.ts.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { addMonthsIso, federalToday } from '@/lib/dates/federal-day';
import { getNaics } from '@/lib/codes/lookup';
import { parseAwardLineage, type AwardKind } from '@/lib/recompete/award-lineage';
import { SeoTemporarilyUnavailableError } from '@/lib/seo/seo-unavailable';

export const RECOMPETE_COLUMNS =
  'contract_id,piid,incumbent_name,incumbent_uei,awarding_agency,awarding_sub_agency,awarding_office,naics_code,naics_description,psc_code,psc_description,description,total_obligation,potential_total_value,period_of_performance_start,period_of_performance_current_end,place_of_performance_state,place_of_performance_city,contract_type,set_aside_type,set_aside_enriched,last_synced_at,quality_flag';

export interface RecompeteRecord {
  contract_id: string;
  piid: string | null;
  incumbent_name: string | null;
  incumbent_uei: string | null;
  awarding_agency: string | null;
  awarding_sub_agency: string | null;
  awarding_office: string | null;
  naics_code: string | null;
  naics_description: string | null;
  psc_code: string | null;
  psc_description: string | null;
  description: string | null;
  total_obligation: number | null;
  potential_total_value: number | null;
  period_of_performance_start: string | null;
  period_of_performance_current_end: string | null;
  place_of_performance_state: string | null;
  place_of_performance_city: string | null;
  contract_type: string | null;
  /** set_aside_enriched ?? set_aside_type — null means UNKNOWN, never "unrestricted". */
  set_aside: string | null;
  last_synced_at: string | null;
  award_kind: AwardKind;
  parent_vehicle_piid: string | null;
}

/** Days past the end date a page stays indexable (the follow-on is often still being competed). */
export const RECENTLY_ENDED_DAYS = 90;
/** Sitemap horizon: contracts ending within this many months are advertised. */
export const SITEMAP_HORIZON_MONTHS = 24;

/** A contract_id we can put in a URL and resolve back exactly. */
export function isValidContractId(id: string | null | undefined): id is string {
  return !!id && id.length >= 3 && id.length <= 160 && /^[A-Za-z0-9_-]+$/.test(id) && !id.includes('--');
}

/** USASpending's generated award id shape — what the per-contract sync writes. */
export function isGeneratedAwardId(id: string | null | undefined): boolean {
  return !!id && /^CONT_(AWD|IDV)_/i.test(id);
}

function kebab(s: string | null | undefined): string {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Canonical path segment: <incumbent>-<agency>--<contract_id>. */
export function recompeteSlug(row: {
  contract_id: string;
  incumbent_name?: string | null;
  awarding_sub_agency?: string | null;
  awarding_agency?: string | null;
}): string {
  const label = kebab(`${row.incumbent_name || ''} ${row.awarding_sub_agency || row.awarding_agency || ''}`)
    .slice(0, 80)
    .replace(/-+$/g, '');
  return label ? `${label}--${row.contract_id}` : row.contract_id;
}

export function recompeteHref(row: Parameters<typeof recompeteSlug>[0]): string {
  return `/recompetes/${recompeteSlug(row)}`;
}

/** The contract_id a path segment names, or null when it cannot name one. */
export function contractIdFromSlug(segment: string): string | null {
  let s = segment;
  try { s = decodeURIComponent(segment); } catch { /* keep raw */ }
  const i = s.indexOf('--');
  const id = i >= 0 ? s.slice(i + 2) : s;
  return isValidContractId(id) ? id : null;
}

/** The headline value: potential total value when stated, else obligated. Null = not stated. */
export function headlineValue(r: { potential_total_value: number | null; total_obligation: number | null }): number | null {
  const p = r.potential_total_value;
  if (p != null && Number.isFinite(p) && p > 0) return p;
  const o = r.total_obligation;
  if (o != null && Number.isFinite(o) && o > 0) return o;
  return null;
}

const UNKNOWN = /^\s*(unknown)?\s*$/i;

export type IndexVerdict =
  | { indexable: true }
  | { indexable: false; reason: 'no_incumbent' | 'no_agency' | 'no_value' | 'no_end_date' | 'ended' | 'beyond_horizon' | 'legacy_id' };

/**
 * THE THIN GATE. A page is indexable (and may be listed in the sitemap) only when it carries the
 * facts that make it a record worth a search result: a named incumbent, an agency, a stated value
 * and an end date that has not long passed. Called by BOTH the page (robots) and the sitemap, so
 * the sitemap can never advertise a page that noindexes itself.
 *
 * `beyond_horizon` applies to the SITEMAP only (pass `forSitemap`): a page further out still
 * renders indexable — it is simply not advertised.
 */
export function recompeteIndexVerdict(
  r: Pick<RecompeteRecord, 'contract_id' | 'incumbent_name' | 'awarding_agency' | 'period_of_performance_current_end' | 'potential_total_value' | 'total_obligation'>,
  now: Date = new Date(),
  opts: { forSitemap?: boolean } = {},
): IndexVerdict {
  if (!isGeneratedAwardId(r.contract_id)) return { indexable: false, reason: 'legacy_id' };
  if (!r.incumbent_name || UNKNOWN.test(r.incumbent_name)) return { indexable: false, reason: 'no_incumbent' };
  if (!r.awarding_agency || UNKNOWN.test(r.awarding_agency)) return { indexable: false, reason: 'no_agency' };
  if (headlineValue(r) == null) return { indexable: false, reason: 'no_value' };
  const end = (r.period_of_performance_current_end || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return { indexable: false, reason: 'no_end_date' };
  const today = federalToday(now);
  const floor = isoDaysAgo(today, RECENTLY_ENDED_DAYS);
  if (end < floor) return { indexable: false, reason: 'ended' };
  if (opts.forSitemap && end > addMonthsIso(today, SITEMAP_HORIZON_MONTHS)) {
    return { indexable: false, reason: 'beyond_horizon' };
  }
  return { indexable: true };
}

function isoDaysAgo(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export interface RebidWindow {
  /** Estimated Sources Sought / RFI window: 12 → 6 months before the current end date. */
  sourcesSought: { from: string; to: string };
  /** Estimated RFP window: 4 → 2 months before the current end date. */
  rfp: { from: string; to: string };
  phase: 'before_sources_sought' | 'sources_sought' | 'between' | 'rfp' | 'final_months' | 'ended';
}

/**
 * Likely rebid window — an ESTIMATE from the documented recompete timeline (CLAUDE.md: Sources
 * Sought/RFI 6–12 months before expiration, RFP 2–4 months before). It is derived only from the
 * stored current end date; nothing stored independently establishes a solicitation date, so the
 * page must label it as an estimate. Null when there is no usable end date.
 */
export function estimateRebidWindow(endDate: string | null | undefined, now: Date = new Date()): RebidWindow | null {
  const end = (endDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const today = federalToday(now);
  const ss = { from: addMonthsIso(end, -12), to: addMonthsIso(end, -6) };
  const rfp = { from: addMonthsIso(end, -4), to: addMonthsIso(end, -2) };
  let phase: RebidWindow['phase'];
  if (today > end) phase = 'ended';
  else if (today < ss.from) phase = 'before_sources_sought';
  else if (today <= ss.to) phase = 'sources_sought';
  else if (today < rfp.from) phase = 'between';
  else if (today <= rfp.to) phase = 'rfp';
  else phase = 'final_months';
  return { sourcesSought: ss, rfp, phase };
}

// ── reads ────────────────────────────────────────────────────────────────────────────────────

function sb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new SeoTemporarilyUnavailableError('recompetes: Supabase not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

type RawRow = Omit<RecompeteRecord, 'set_aside' | 'award_kind' | 'parent_vehicle_piid' | 'total_obligation' | 'potential_total_value'> & {
  total_obligation: number | string | null;
  potential_total_value: number | string | null;
  set_aside_type: string | null;
  set_aside_enriched: string | null;
  quality_flag: string | null;
};

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toRecord(r: RawRow): RecompeteRecord {
  const lineage = parseAwardLineage(r);
  return {
    contract_id: r.contract_id,
    piid: r.piid ?? null,
    incumbent_name: r.incumbent_name ?? null,
    incumbent_uei: r.incumbent_uei ?? null,
    awarding_agency: r.awarding_agency ?? null,
    awarding_sub_agency: r.awarding_sub_agency ?? null,
    awarding_office: r.awarding_office ?? null,
    naics_code: r.naics_code ?? null,
    // USASpending's endpoint returns the NAICS description NULL; derive it from the code we store
    // (same coalesce as src/lib/recompete/query.ts). Never guessed beyond the authoritative map.
    naics_description: r.naics_description ?? (r.naics_code ? getNaics(r.naics_code)?.title ?? null : null),
    psc_code: r.psc_code ?? null,
    psc_description: r.psc_description ?? null,
    description: r.description ?? null,
    total_obligation: num(r.total_obligation),
    potential_total_value: num(r.potential_total_value),
    period_of_performance_start: r.period_of_performance_start ?? null,
    period_of_performance_current_end: r.period_of_performance_current_end ?? null,
    place_of_performance_state: r.place_of_performance_state ?? null,
    place_of_performance_city: r.place_of_performance_city ?? null,
    contract_type: r.contract_type ?? null,
    set_aside: r.set_aside_enriched ?? r.set_aside_type ?? null,
    last_synced_at: r.last_synced_at ?? null,
    award_kind: lineage.award_kind,
    parent_vehicle_piid: lineage.parent_vehicle_piid,
  };
}

/**
 * The record, or null when the id names no REAL row (absent, or quarantined by quality_flag —
 * a grouped_synthetic row is not a contract and must never get a page). Throws on a read error.
 */
export async function getRecompeteById(contractId: string): Promise<RecompeteRecord | null> {
  if (!isValidContractId(contractId)) return null;
  const { data, error } = await sb()
    .from('recompete_opportunities')
    .select(RECOMPETE_COLUMNS)
    .eq('contract_id', contractId)
    .limit(1);
  if (error) throw new SeoTemporarilyUnavailableError(`recompete ${contractId}: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as RawRow | null;
  if (!row || row.quality_flag != null) return null;
  return toRecord(row);
}

/**
 * Exact number of recorded changes (recompete_changes) for this contract. Null = UNKNOWN (read
 * failed or no count returned) — rendered as "unavailable", never as 0 (Bug Prevention Rule #11).
 */
export async function getRecompeteChangeCount(contractId: string): Promise<number | null> {
  const { count, error } = await sb()
    .from('recompete_changes')
    .select('id', { count: 'exact', head: true })
    .eq('contract_id', contractId);
  if (error) {
    console.error('[seo/recompetes] change count failed:', error.message);
    return null;
  }
  return typeof count === 'number' ? count : null;
}

export interface RelatedRecompete {
  href: string;
  piid: string | null;
  incumbent_name: string | null;
  end: string | null;
  value: number | null;
}

/**
 * "Other contracts expiring at this agency" — scoped by agency (and NAICS when known) INSIDE the
 * query, before the limit, so the list is this agency's own contracts rather than the national
 * soonest-expiring set filtered afterwards (the rank-then-filter class). Applies the same thin
 * gate as the sitemap in SQL, then once more in TS. Returns null on a read error so the page can
 * say "unavailable" instead of showing an empty list as if there were none.
 */
export async function getOtherAgencyRecompetes(
  r: RecompeteRecord,
  limit = 10,
  now: Date = new Date(),
): Promise<RelatedRecompete[] | null> {
  if (!r.awarding_agency) return [];
  const today = federalToday(now);
  let q = sb()
    .from('recompete_opportunities')
    .select('contract_id,piid,incumbent_name,awarding_agency,awarding_sub_agency,period_of_performance_current_end,potential_total_value,total_obligation')
    .is('quality_flag', null)
    .eq('awarding_agency', r.awarding_agency)
    .neq('contract_id', r.contract_id)
    .gt('period_of_performance_current_end', today)
    .like('contract_id', 'CONT_%');
  if (r.naics_code) q = q.eq('naics_code', r.naics_code);
  const { data, error } = await q
    .order('period_of_performance_current_end', { ascending: true })
    .order('contract_id', { ascending: true })
    .limit(limit * 2); // headroom for rows the TS gate drops (no value / Unknown incumbent)
  if (error) {
    console.error('[seo/recompetes] related read failed:', error.message);
    return null;
  }
  type Rel = { contract_id: string; piid: string | null; incumbent_name: string | null; awarding_agency: string | null; awarding_sub_agency: string | null; period_of_performance_current_end: string | null; potential_total_value: number | string | null; total_obligation: number | string | null };
  return ((data ?? []) as unknown as Rel[])
    .map((x) => ({ ...x, potential_total_value: num(x.potential_total_value), total_obligation: num(x.total_obligation) }))
    .filter((x) => isValidContractId(x.contract_id) && recompeteIndexVerdict(x, now).indexable)
    .slice(0, limit)
    .map((x) => ({
      href: recompeteHref(x),
      piid: x.piid,
      incumbent_name: x.incumbent_name,
      end: x.period_of_performance_current_end,
      value: headlineValue(x),
    }));
}

// ── sitemap ──────────────────────────────────────────────────────────────────────────────────

const PAGE = 1000; // PostgREST max-rows: a larger range is silently clipped to this
/** URLs per numbered child. Under SITEMAP_URL_LIMIT (50,000) with headroom. */
export const RECOMPETE_SITEMAP_CHUNK = 45_000;
/** Numbered children (sitemap-recompetes-1.xml … -N.xml). Capacity = N × CHUNK. */
export const RECOMPETE_SITEMAP_CHILD_COUNT = 3;

export interface RecompeteSitemapRow {
  slug: string;
  end: string;
}

type SitemapRaw = {
  contract_id: string; incumbent_name: string | null; awarding_agency: string | null; awarding_sub_agency: string | null;
  period_of_performance_current_end: string | null; potential_total_value: number | string | null; total_obligation: number | string | null;
};

/**
 * One numbered sitemap child: the gated set, ordered by contract_id (unique → stable paging),
 * rows [chunk × CHUNK, (chunk + 1) × CHUNK). Paged 1,000 at a time with .range() — never one
 * oversized request (PostgREST clips it to 1,000 silently). Throws on any read error (→ 503,
 * Google keeps the last good copy). The LAST child also throws when rows remain beyond total
 * capacity: the family then needs another child, and silently dropping URLs is not an option.
 *
 * No lastmod: `last_synced_at` and `updated_at` move on every hourly re-sync whether or not the
 * contract changed (the sync upserts every row it sees; the trigger stamps updated_at), so either
 * would be the "always now" lastmod src/lib/seo/sitemap-xml.ts forbids.
 */
export async function getRecompeteSitemapChunk(chunk: number, now: Date = new Date()): Promise<RecompeteSitemapRow[]> {
  if (!Number.isInteger(chunk) || chunk < 0 || chunk >= RECOMPETE_SITEMAP_CHILD_COUNT) {
    throw new Error(`recompete sitemap: no chunk ${chunk}`);
  }
  const client = sb();
  const today = federalToday(now);
  const floor = isoDaysAgo(today, RECENTLY_ENDED_DAYS);
  const ceiling = addMonthsIso(today, SITEMAP_HORIZON_MONTHS);
  const base = () =>
    client
      .from('recompete_opportunities')
      .select('contract_id,incumbent_name,awarding_agency,awarding_sub_agency,period_of_performance_current_end,potential_total_value,total_obligation')
      .is('quality_flag', null)
      .like('contract_id', 'CONT_%')
      .neq('incumbent_name', 'Unknown')
      .neq('awarding_agency', 'Unknown')
      .gte('period_of_performance_current_end', floor)
      .lte('period_of_performance_current_end', ceiling)
      .or('potential_total_value.gt.0,total_obligation.gt.0')
      .order('contract_id', { ascending: true });

  const start = chunk * RECOMPETE_SITEMAP_CHUNK;
  const end = start + RECOMPETE_SITEMAP_CHUNK; // exclusive
  const rows: SitemapRaw[] = [];
  for (let from = start; from < end; from += PAGE) {
    const to = Math.min(from + PAGE, end) - 1;
    const { data, error } = await base().range(from, to);
    if (error) throw new Error(`recompete sitemap chunk ${chunk} at ${from}: ${error.message}`);
    const page = (data ?? []) as unknown as SitemapRaw[];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  if (chunk === RECOMPETE_SITEMAP_CHILD_COUNT - 1 && rows.length === RECOMPETE_SITEMAP_CHUNK) {
    const { data, error } = await base().range(end, end);
    if (error) throw new Error(`recompete sitemap overflow probe: ${error.message}`);
    if ((data ?? []).length > 0) {
      throw new Error(
        `recompete sitemap exceeds ${RECOMPETE_SITEMAP_CHILD_COUNT} × ${RECOMPETE_SITEMAP_CHUNK} URLs; add a child`,
      );
    }
  }

  const out: RecompeteSitemapRow[] = [];
  for (const r of rows) {
    const rec = { ...r, potential_total_value: num(r.potential_total_value), total_obligation: num(r.total_obligation) };
    if (!isValidContractId(rec.contract_id)) continue;
    // The SQL filters are a superset check; the TS gate is the authority (same one the page uses).
    if (!recompeteIndexVerdict(rec, now, { forSitemap: true }).indexable) continue;
    out.push({ slug: recompeteSlug(rec), end: (rec.period_of_performance_current_end || '').slice(0, 10) });
  }
  return out;
}

// ── internal-link surfaces: the /recompetes hub + the contractor profile block ───────────────

const LINK_SELECT =
  'contract_id,piid,incumbent_name,incumbent_uei,awarding_agency,awarding_sub_agency,period_of_performance_current_end,potential_total_value,total_obligation';

export type RecompeteLinkRaw = {
  contract_id: string; piid: string | null; incumbent_name: string | null; incumbent_uei?: string | null;
  awarding_agency: string | null; awarding_sub_agency: string | null; period_of_performance_current_end: string | null;
  potential_total_value: number | string | null; total_obligation: number | string | null;
};

export interface RecompeteLink extends RelatedRecompete {
  contract_id: string;
  agency: string | null;
  subAgency: string | null;
}

/**
 * Raw rows → links, keeping ONLY rows whose page passes the thin gate (so a hub never links a
 * page that noindexes itself), soonest end first, deduplicated by contract_id. Pure (tested).
 */
export function toRecompeteLinks(rows: RecompeteLinkRaw[], limit: number, now: Date = new Date()): RecompeteLink[] {
  const seen = new Set<string>();
  return rows
    .map((x) => ({ ...x, potential_total_value: num(x.potential_total_value), total_obligation: num(x.total_obligation) }))
    .filter((x) => {
      if (!isValidContractId(x.contract_id) || seen.has(x.contract_id)) return false;
      seen.add(x.contract_id);
      return recompeteIndexVerdict(x, now).indexable;
    })
    .sort((a, b) =>
      (a.period_of_performance_current_end || '').localeCompare(b.period_of_performance_current_end || '') ||
      a.contract_id.localeCompare(b.contract_id))
    .slice(0, limit)
    .map((x) => ({
      contract_id: x.contract_id,
      href: recompeteHref(x),
      piid: x.piid,
      incumbent_name: x.incumbent_name,
      end: x.period_of_performance_current_end,
      value: headlineValue(x),
      agency: x.awarding_agency,
      subAgency: x.awarding_sub_agency,
    }));
}

/** The real-row filters the sitemap uses, applied IN the query (before any limit). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function realRowFilters(q: any, today: string): any {
  return q
    .is('quality_flag', null)
    .like('contract_id', 'CONT_%')
    .neq('incumbent_name', 'Unknown')
    .neq('awarding_agency', 'Unknown')
    .gte('period_of_performance_current_end', today)
    .or('potential_total_value.gt.0,total_obligation.gt.0');
}

/**
 * The /recompetes hub: the soonest-expiring indexable contracts from today forward. Every gate
 * runs in the query BEFORE the limit (filter-before-rank); the TS gate then re-checks each row
 * (headroom covers what it drops). Throws on a read error — the hub renders "unavailable",
 * never an empty list presented as "nothing expiring".
 */
export async function getRecompeteHubLinks(limit = 200, now: Date = new Date()): Promise<RecompeteLink[]> {
  const today = federalToday(now);
  const { data, error } = await realRowFilters(
    sb().from('recompete_opportunities').select(LINK_SELECT),
    today,
  )
    .order('period_of_performance_current_end', { ascending: true })
    .order('contract_id', { ascending: true })
    .limit(Math.min(PAGE, Math.ceil(limit * 1.5)));
  if (error) throw new Error(`recompete hub read failed: ${error.message}`);
  return toRecompeteLinks((data ?? []) as RecompeteLinkRaw[], limit, now);
}

/** Split a UEI set into `.in()`-sized chunks (URL length), uppercased, deduplicated. Pure. */
export function ueiChunks(ueis: readonly string[], size = 150): string[][] {
  const clean = Array.from(new Set(ueis.map((u) => String(u || '').trim().toUpperCase()).filter((u) => /^[A-Z0-9]{12}$/.test(u))));
  const out: string[][] = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out;
}

/** UEI chunks queried for one profile. A rollup beyond this is read partially and logged. */
const MAX_UEI_CHUNKS = 20;

/**
 * "Contracts expiring soon" on a contractor profile: real rows held by ANY of the profile's UEIs
 * (scoped in the query, before the limit), future end date, soonest first. Each chunk returns its
 * own soonest rows, so the merged top `limit` is exact across chunks.
 * Returns null on a read error — the caller omits the block rather than print "0 expiring".
 */
export async function getExpiringRecompetesForUeis(
  ueis: readonly string[],
  limit = 10,
  now: Date = new Date(),
): Promise<RecompeteLink[] | null> {
  const chunks = ueiChunks(ueis);
  if (chunks.length === 0) return [];
  if (chunks.length > MAX_UEI_CHUNKS) {
    console.error(`[seo/recompetes] profile has ${chunks.length} UEI chunks; reading the first ${MAX_UEI_CHUNKS}`);
  }
  const today = federalToday(now);
  let client: SupabaseClient;
  try {
    client = sb();
  } catch (e) {
    console.error('[seo/recompetes] expiring-for-profile: no client:', (e as Error).message);
    return null;
  }
  const results = (await Promise.all(
    chunks.slice(0, MAX_UEI_CHUNKS).map((chunk) =>
      realRowFilters(client.from('recompete_opportunities').select(LINK_SELECT), today)
        .in('incumbent_uei', chunk)
        .order('period_of_performance_current_end', { ascending: true })
        .order('contract_id', { ascending: true })
        .limit(limit * 2), // headroom for rows the TS gate drops
    ),
  )) as Array<{ data: unknown; error: { message: string } | null }>;
  const rows: RecompeteLinkRaw[] = [];
  for (const r of results) {
    if (r.error) {
      console.error('[seo/recompetes] expiring-for-profile read failed:', r.error.message);
      return null;
    }
    rows.push(...((r.data ?? []) as RecompeteLinkRaw[]));
  }
  return toRecompeteLinks(rows, limit, now);
}
