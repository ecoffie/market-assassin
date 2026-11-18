/**
 * SEO data layer for /forecasts/[id] — one public page per agency procurement forecast
 * (2026-11-17). Source: Supabase `agency_forecasts` (read-only, service role). No new tables.
 *
 * WHAT CHANGED FROM THE /forecasts HUB'S "NO URL PER FORECAST" STANCE
 * -------------------------------------------------------------------
 * The hub (src/app/forecasts/page.tsx) was built as ONE page because ~36K rows must not become
 * ~36K thin URLs. Per-forecast pages are now an owner decision, so the protection moves into a
 * THIN GATE (forecastIndexability): every row renders, but only rows with real content are
 * indexed and listed in the sitemap. The rest render `noindex`.
 *
 * DATA RULES (CLAUDE.md "A number is a product feature")
 * ------------------------------------------------------
 *  - Absent ≠ zero, absent ≠ unrestricted. A missing value/set-aside/date is "Not stated" — never
 *    `$0`, never "Full & Open". A non-positive dollar value is treated as absent (it is an
 *    ingest artifact, not a forecast of a free contract).
 *  - `pop_country` has a column DEFAULT of 'USA' — it is not evidence, so it never renders alone.
 *  - `bureau` often holds the department's own name (the Gateway header-drift bug); only a REAL
 *    sub-organisation (isRealBureauAttribution) is shown as a sub-agency.
 *  - Point-of-contact fields are GATED: they never enter page HTML. The page receives only a
 *    boolean `hasPoc` (withhold the artifact, not just the link).
 *  - A read FAILURE throws SeoTemporarilyUnavailableError (→ 5xx, not cached by ISR). Only a read
 *    that ANSWERED "no such row" becomes a 404.
 */
import { cache } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SeoTemporarilyUnavailableError } from './seo-unavailable';
import { resolveForecastAgencyIdentity } from '@/lib/forecasts/agency-identity';
import { isRealBureauAttribution } from '@/lib/forecasts/bureau-provenance';
import { AGENCIES_SEO } from '@/data/agencies-seo';
import { getNaicsTopEntry } from '@/data/naics-top100';

export const FORECAST_PAGE_SELECT =
  'id, source_agency, source_url, title, description, department, bureau, contracting_office, program_office, ' +
  'naics_code, naics_description, psc_code, psc_description, fiscal_year, anticipated_quarter, ' +
  'anticipated_award_date, solicitation_date, estimated_value_min, estimated_value_max, estimated_value_range, ' +
  'contract_type, set_aside_type, competition_type, incumbent_name, poc_name, poc_email, poc_phone, ' +
  'pop_state, pop_city, status';

/** The columns the page may render. POC values are deliberately NOT here — only `hasPoc`. */
export interface ForecastPage {
  id: string;
  slug: string;
  sourceAgency: string;
  sourceUrl: string | null;
  title: string;
  description: string | null;
  department: string | null;
  bureau: string | null;
  contractingOffice: string | null;
  programOffice: string | null;
  naicsCode: string | null;
  naicsDescription: string | null;
  pscCode: string | null;
  pscDescription: string | null;
  fiscalYear: string | null;
  anticipatedQuarter: string | null;
  anticipatedAwardDate: string | null;
  solicitationDate: string | null;
  valueMin: number | null;
  valueMax: number | null;
  valueRangeText: string | null;
  contractType: string | null;
  setAside: string | null;
  competition: string | null;
  incumbentName: string | null;
  popState: string | null;
  popCity: string | null;
  status: string | null;
  /** True when the row carries any POC field. The values themselves stay server-side. */
  hasPoc: boolean;
}

/** Raw row shape (subset used by the gate, the sitemap and the page mapper). */
export interface ForecastRow {
  id: string;
  source_agency: string | null;
  title: string | null;
  description?: string | null;
  naics_code: string | null;
  estimated_value_min: number | string | null;
  estimated_value_max: number | string | null;
  estimated_value_range: string | null;
  anticipated_award_date: string | null;
  solicitation_date: string | null;
  fiscal_year: string | null;
  anticipated_quarter?: string | null;
  status: string | null;
}

// ── slugs ─────────────────────────────────────────────────────────────────────────────────

const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** `<kebab-title>-<uuid>`. The full row UUID is the resolver key; the title part is cosmetic. */
export function forecastSlug(title: string | null, id: string): string {
  const base = (title || 'forecast')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return `${base || 'forecast'}-${id.toLowerCase()}`;
}

/** The row id a slug resolves to (a bare UUID also resolves), or null for a malformed slug. */
export function parseForecastSlug(slug: string): string | null {
  const m = UUID_TAIL.exec(decodeURIComponent(slug || '').trim());
  return m ? m[1].toLowerCase() : null;
}

// ── field interpretation (pure) ───────────────────────────────────────────────────────────

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
};

/** A positive dollar amount, or null. 0 / negative / unparseable = not stated. */
export function positiveAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function validDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The latest fiscal year named in a free-text FY ("FY2026", "2026", "FY26", "FY2026-2027"). */
export function parseFiscalYear(fy: string | null | undefined): number | null {
  if (!fy) return null;
  const four = [...fy.matchAll(/(?:^|\D)(20\d{2})(?!\d)/g)].map((m) => Number(m[1]));
  if (four.length) return Math.max(...four);
  const two = /FY\s*'?(\d{2})(?!\d)/i.exec(fy);
  return two ? 2000 + Number(two[1]) : null;
}

/** Department-level label: the shared forecast identity, else the row's department, else the code. */
export function forecastAgencyLabel(sourceAgency: string | null, department?: string | null): string | null {
  const code = clean(sourceAgency);
  if (code) {
    const id = resolveForecastAgencyIdentity(code);
    if (id) return id.label;
  }
  return clean(department) || code;
}

/**
 * The /agencies/<slug> page for a forecast's source agency, or null when none exists. Navy, its
 * labs and the Army Corps publish as their own codes but are Department of Defense components.
 */
const SOURCE_TO_SEO_ABBR: Record<string, string> = {
  NAVY: 'DOD', ONR: 'DOD', NRL: 'DOD', USACE: 'DOD', STATE: 'DOS', TREASURY: 'TREAS',
};
const SEO_BY_ABBR = new Map(AGENCIES_SEO.map((a) => [a.abbreviation.toUpperCase(), a]));
export function forecastAgencySeo(sourceAgency: string | null): { slug: string; name: string } | null {
  const code = clean(sourceAgency)?.toUpperCase();
  if (!code) return null;
  const a = SEO_BY_ABBR.get(SOURCE_TO_SEO_ABBR[code] ?? code);
  return a ? { slug: a.slug, name: a.name } : null;
}

/** A real sub-organisation, or null (the department's own name in `bureau` is not one). */
export function forecastSubAgency(bureau: string | null): string | null {
  return isRealBureauAttribution(bureau) ? clean(bureau) : null;
}

/** NAICS description: the row's own, else the official title when the code is a top-100 code. */
export function naicsLabel(code: string | null, description: string | null): string | null {
  return clean(description) || (code ? getNaicsTopEntry(code)?.title ?? null : null);
}

/** True when /naics/<code> is a page we know renders (the top-100 set the sitemap lists). */
export function naicsPageExists(code: string | null): boolean {
  return !!code && /^\d{6}$/.test(code) && !!getNaicsTopEntry(code);
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${+(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** The estimated value as published, or null ("Not stated"). Never "$0". */
export function forecastValueLabel(min: unknown, max: unknown, rangeText: string | null): string | null {
  const lo = positiveAmount(min);
  const hi = positiveAmount(max);
  if (lo && hi) return lo === hi ? fmtUsd(lo) : lo < hi ? `${fmtUsd(lo)} – ${fmtUsd(hi)}` : `${fmtUsd(hi)} – ${fmtUsd(lo)}`;
  if (hi) return `Up to ${fmtUsd(hi)}`;
  if (lo) return `${fmtUsd(lo)} or more`;
  const t = clean(rangeText);
  return t && /\d/.test(t) ? t : null;
}

/** "FY2026 Q3" style label, or null. */
export function fiscalPeriodLabel(fy: string | null, quarter: string | null | undefined): string | null {
  const y = parseFiscalYear(fy);
  const q = clean(quarter);
  const qn = q ? /([1-4])/.exec(q)?.[1] : null;
  if (y && qn) return `FY${y} Q${qn}`;
  if (y) return `FY${y}`;
  return null;
}

// ── the thin gate + staleness ─────────────────────────────────────────────────────────────

/** How long past its anticipated date a forecast stays advertised. */
export const STALE_AFTER_DAYS = 180;
const MIN_TITLE = 8;
const MIN_DESCRIPTION = 40;

/**
 * A forecast is STALE when the latest date it names is more than STALE_AFTER_DAYS in the past:
 * the later of anticipated award / solicitation date, or — when neither is present — the end of
 * its fiscal year (30 Sep). Past that point the requirement has normally been solicited, awarded,
 * slipped to a new forecast row or dropped; agencies republish slips as new rows, so an old row
 * advertised as "upcoming" would be a claim we cannot stand behind. A row with no date and no
 * parseable FY is NOT stale (we cannot know) — the gate's timing signal then counts it as missing.
 */
export function isForecastStale(
  r: Pick<ForecastRow, 'anticipated_award_date' | 'solicitation_date' | 'fiscal_year'>,
  now: Date = new Date(),
): boolean {
  const cutoff = now.getTime() - STALE_AFTER_DAYS * 24 * 3600 * 1000;
  const dates = [validDate(r.anticipated_award_date), validDate(r.solicitation_date)].filter((d): d is Date => !!d);
  if (dates.length) return Math.max(...dates.map((d) => d.getTime())) < cutoff;
  const fy = parseFiscalYear(r.fiscal_year);
  if (fy) return Date.UTC(fy, 8, 30, 23, 59, 59) < cutoff;
  return false;
}

/** Statuses meaning the forecast is no longer a forecast. */
const CLOSED_STATUS = /^(awarded|cancell?ed)$/i;

export interface ForecastIndexability {
  indexable: boolean;
  signals: { naics: boolean; value: boolean; timing: boolean; description: boolean };
  reasons: string[];
}

/**
 * THE THIN GATE — shared by the page (robots) and the sitemap (listing), so the sitemap can never
 * assert a URL the page noindexes.
 *
 * Indexable iff: a real title (≥ 8 chars) AND an agency AND at least TWO of
 * {NAICS, estimated value, timing, description ≥ 40 chars that is not just the title},
 * AND not stale, AND not marked awarded/cancelled.
 *
 * `hasDescription` is passed separately so the sitemap can compute it in Postgres (see
 * getForecastSitemapEntries) without transferring every description.
 */
export function forecastIndexability(
  r: ForecastRow,
  hasDescription: boolean,
  now: Date = new Date(),
): ForecastIndexability {
  const reasons: string[] = [];
  const title = clean(r.title);
  if (!title || title.length < MIN_TITLE) reasons.push('no-title');
  if (!forecastAgencyLabel(r.source_agency)) reasons.push('no-agency');
  const signals = {
    naics: !!clean(r.naics_code) && /^\d{2,6}$/.test(clean(r.naics_code)!),
    value: forecastValueLabel(r.estimated_value_min, r.estimated_value_max, r.estimated_value_range) !== null,
    timing: !!(validDate(r.anticipated_award_date) || validDate(r.solicitation_date) || parseFiscalYear(r.fiscal_year)),
    description: hasDescription,
  };
  if (Object.values(signals).filter(Boolean).length < 2) reasons.push('thin');
  if (isForecastStale(r, now)) reasons.push('stale');
  if (r.status && CLOSED_STATUS.test(r.status.trim())) reasons.push('closed-status');
  return { indexable: reasons.length === 0, signals, reasons };
}

/** The description test the page applies to a fully-read row (the sitemap mirrors it in SQL). */
export function hasRealDescription(title: string | null, description: string | null | undefined): boolean {
  const d = clean(description);
  return !!d && d.length >= MIN_DESCRIPTION && d.toLowerCase() !== (clean(title) || '').toLowerCase();
}

/**
 * Duplicate key. The table still carries retired duplicate rows for some publishers (REPAIR-LEDGER
 * 2026-09-14), i.e. the same forecast twice under two ids. Rows sharing this key are one forecast:
 * only the smallest id is canonical / listed.
 */
export function forecastDuplicateKey(r: {
  source_agency: string | null; title: string | null; naics_code: string | null;
  fiscal_year: string | null; anticipated_award_date: string | null; solicitation_date: string | null;
}): string {
  return [r.source_agency, clean(r.title), clean(r.naics_code), clean(r.fiscal_year), r.anticipated_award_date, r.solicitation_date]
    .map((x) => x ?? '')
    .join('\u0001');
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────

function sb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type FullRow = ForecastRow & Record<string, unknown>;

function toPage(row: FullRow): ForecastPage {
  const s = (k: string) => clean(row[k]);
  return {
    id: String(row.id),
    slug: forecastSlug(row.title, String(row.id)),
    sourceAgency: s('source_agency') || '',
    sourceUrl: (() => { const u = s('source_url'); return u && /^https?:\/\//i.test(u) ? u : null; })(),
    title: s('title') || 'Untitled forecast',
    description: s('description'),
    department: s('department'),
    bureau: s('bureau'),
    contractingOffice: s('contracting_office'),
    programOffice: s('program_office'),
    naicsCode: s('naics_code'),
    naicsDescription: s('naics_description'),
    pscCode: s('psc_code'),
    pscDescription: s('psc_description'),
    fiscalYear: s('fiscal_year'),
    anticipatedQuarter: s('anticipated_quarter'),
    anticipatedAwardDate: s('anticipated_award_date'),
    solicitationDate: s('solicitation_date'),
    valueMin: positiveAmount(row.estimated_value_min),
    valueMax: positiveAmount(row.estimated_value_max),
    valueRangeText: s('estimated_value_range'),
    contractType: s('contract_type'),
    setAside: s('set_aside_type'),
    competition: s('competition_type'),
    incumbentName: s('incumbent_name'),
    popState: s('pop_state'),
    popCity: s('pop_city'),
    status: s('status'),
    hasPoc: !!(s('poc_name') || s('poc_email') || s('poc_phone')),
  };
}

export interface ForecastLookup {
  forecast: ForecastPage;
  indexability: ForecastIndexability;
  /** The id that should carry the canonical URL (differs from forecast.id for a duplicate row). */
  canonicalId: string;
  canonicalSlug: string;
}

/**
 * One forecast by id, or null when the database ANSWERED that no such row exists.
 * Memoized per request (React cache) so generateMetadata and the page share one read.
 * Throws SeoTemporarilyUnavailableError on any read failure.
 */
export const getForecastById = cache(async (id: string): Promise<ForecastLookup | null> => {
  const client = sb();
  if (!client) throw new SeoTemporarilyUnavailableError(`forecast ${id}: no Supabase client`);
  const { data, error } = await client
    .from('agency_forecasts')
    .select(FORECAST_PAGE_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new SeoTemporarilyUnavailableError(`forecast ${id}: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as FullRow;
  const forecast = toPage(row);
  const indexability = forecastIndexability(row, hasRealDescription(row.title, row.description as string | null));

  // Duplicate rows: canonicalize to the smallest id sharing the duplicate key.
  let canonicalId = forecast.id;
  if (row.title && row.source_agency) {
    const { data: dupes, error: dupErr } = await client
      .from('agency_forecasts')
      .select('id, source_agency, title, naics_code, fiscal_year, anticipated_award_date, solicitation_date')
      .eq('source_agency', row.source_agency)
      .eq('title', row.title)
      .order('id', { ascending: true })
      .limit(25);
    if (dupErr) {
      // Canonical refinement only: the page itself is correct without it. Logged, not swallowed.
      console.error(`[seo/forecast-pages] duplicate lookup failed for ${id}:`, dupErr.message);
    } else {
      const key = forecastDuplicateKey(row);
      const first = (dupes ?? []).find((d) => forecastDuplicateKey(d as ForecastRow) === key);
      if (first && String(first.id) < canonicalId) canonicalId = String(first.id);
    }
  }
  return {
    forecast,
    indexability,
    canonicalId,
    canonicalSlug: canonicalId === forecast.id ? forecast.slug : forecastSlug(row.title, canonicalId),
  };
});

export interface RelatedForecast {
  slug: string;
  title: string;
  period: string | null;
  value: string | null;
}

/**
 * "More forecasts from this agency" — scoped to the SAME source_agency IN THE QUERY, before the
 * limit (filter-before-rank), excluding self and stale rows, soonest anticipated award first.
 * A related-links block must not take the page down: a read error is logged and yields [].
 */
export async function getMoreForecastsFromAgency(f: ForecastPage, limit = 10, now: Date = new Date()): Promise<RelatedForecast[]> {
  const client = sb();
  if (!client || !f.sourceAgency) return [];
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await client
    .from('agency_forecasts')
    .select('id, title, fiscal_year, anticipated_quarter, anticipated_award_date, solicitation_date, estimated_value_min, estimated_value_max, estimated_value_range')
    .eq('source_agency', f.sourceAgency)
    .neq('id', f.id)
    .gte('anticipated_award_date', cutoff)
    .order('anticipated_award_date', { ascending: true })
    .limit(limit);
  if (error) {
    console.error('[seo/forecast-pages] more-from-agency read failed:', error.message);
    return [];
  }
  return (data ?? [])
    .filter((r) => (clean(r.title)?.length ?? 0) >= MIN_TITLE)
    .map((r) => ({
      slug: forecastSlug(r.title, String(r.id)),
      title: clean(r.title)!,
      period: fiscalPeriodLabel(r.fiscal_year, r.anticipated_quarter),
      value: forecastValueLabel(r.estimated_value_min, r.estimated_value_max, r.estimated_value_range),
    }));
}

// ── sitemap ───────────────────────────────────────────────────────────────────────────────

const PAGE = 1000; // PostgREST max-rows: a larger .limit() is silently clipped to this
const SITEMAP_SELECT =
  'id, source_agency, title, naics_code, estimated_value_min, estimated_value_max, estimated_value_range, ' +
  'anticipated_award_date, solicitation_date, fiscal_year, anticipated_quarter, status';
/** LIKE pattern matching strings of at least `n` characters (PostgREST: `*` is `%`). */
const atLeast = (n: number) => `${'_'.repeat(n)}*`;

export interface ForecastSitemapRow {
  slug: string;
}

/**
 * Every forecast that passes the thin gate, deduplicated. Pages through the whole table with
 * `.range()` (PostgREST clips any single response at 1,000 rows), ordered by id so pages are
 * stable. Descriptions never leave the database: a second id-only drain returns the rows whose
 * description is ≥ MIN_DESCRIPTION chars (a LIKE over single-char wildcards, in Postgres).
 * The "not just the title" half of hasRealDescription cannot be expressed that way, so the
 * sitemap is slightly more permissive there; a page whose description merely repeats a 40+ char
 * title is the only possible disagreement, and it still needs one other signal to be listed.
 * Throws on any read error — the route answers 503, never an empty or partial family.
 * No lastmod: `updated_at` is a trigger-maintained write time, not a proven content date.
 */
export async function getForecastSitemapEntries(now: Date = new Date()): Promise<ForecastSitemapRow[]> {
  const client = sb();
  if (!client) throw new Error('forecast sitemap: no Supabase client');

  async function drain<T>(select: string, label: string, narrow?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = client!.from('agency_forecasts').select(select).not('title', 'is', null);
      if (narrow) q = narrow(q);
      const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw new Error(`forecast sitemap (${label}) page ${from / PAGE}: ${error.message}`);
      const page = (data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE) break;
      if (rows.length > 200_000) throw new Error(`forecast sitemap (${label}): runaway pagination`);
    }
    return rows;
  }

  const [rows, described] = await Promise.all([
    drain<ForecastRow>(SITEMAP_SELECT, 'rows'),
    drain<{ id: string }>('id', 'described', (q) => q.like('description', atLeast(MIN_DESCRIPTION))),
  ]);
  const hasDesc = new Set(described.map((r) => String(r.id)));

  // Smallest id per duplicate key is the canonical row (same rule as the page).
  const canonical = new Map<string, string>();
  for (const r of rows) {
    const k = forecastDuplicateKey(r);
    const cur = canonical.get(k);
    if (!cur || String(r.id) < cur) canonical.set(k, String(r.id));
  }

  const out: ForecastSitemapRow[] = [];
  for (const r of rows) {
    const id = String(r.id);
    if (canonical.get(forecastDuplicateKey(r)) !== id) continue;
    if (!forecastIndexability(r, hasDesc.has(id), now).indexable) continue;
    out.push({ slug: forecastSlug(r.title, id) });
  }
  return out;
}

// ── internal-link surfaces: the /forecasts hub + agency pages ──────────────────────────────

/**
 * The forecast source codes whose pages belong to an /agencies/<slug> page — the reverse of
 * forecastAgencySeo(). A source code maps to the agency whose abbreviation it equals, or through
 * SOURCE_TO_SEO_ABBR (NAVY / USACE → DOD …).
 */
export function forecastSourceCodesForAgencySlug(slug: string): string[] {
  const agency = AGENCIES_SEO.find((a) => a.slug === slug);
  if (!agency?.abbreviation) return [];
  const abbr = agency.abbreviation.toUpperCase();
  const codes = new Set<string>();
  if (SEO_BY_ABBR.get(abbr)?.slug === slug) codes.add(abbr);
  for (const [code, target] of Object.entries(SOURCE_TO_SEO_ABBR)) {
    if (target === abbr) codes.add(code);
  }
  // Every code must round-trip through the forward mapping the forecast page itself uses.
  return Array.from(codes).filter((c) => forecastAgencySeo(c)?.slug === slug).sort();
}

const LINK_SELECT_FORECAST =
  'id, source_agency, title, naics_code, estimated_value_min, estimated_value_max, estimated_value_range, ' +
  'anticipated_award_date, solicitation_date, fiscal_year, anticipated_quarter, status';

/**
 * Rows → links to INDEXABLE forecast pages only (the page's own gate, so a hub never links a
 * noindex page), first duplicate-key occurrence by smallest id kept. Descriptions are not read
 * for links: the gate is evaluated with hasDescription=false, so a listed row qualifies on its
 * other signals alone — a strict subset of what the page would index. Pure (tested).
 */
export function toForecastLinks(rows: ForecastRow[], limit: number, now: Date = new Date()): RelatedForecast[] {
  const smallest = new Map<string, string>();
  for (const r of rows) {
    const k = forecastDuplicateKey(r);
    const cur = smallest.get(k);
    if (!cur || String(r.id) < cur) smallest.set(k, String(r.id));
  }
  const out: RelatedForecast[] = [];
  for (const r of rows) {
    const id = String(r.id);
    if (smallest.get(forecastDuplicateKey(r)) !== id) continue;
    if (!forecastIndexability(r, false, now).indexable) continue;
    out.push({
      slug: forecastSlug(r.title, id),
      title: clean(r.title)!,
      period: fiscalPeriodLabel(r.fiscal_year, r.anticipated_quarter),
      value: forecastValueLabel(r.estimated_value_min, r.estimated_value_max, r.estimated_value_range),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * "Recently published forecasts" on the /forecasts hub: newest rows Mindy ingested (created_at),
 * gated in TS. Returns null on a read error — the hub omits the section (logged), never shows an
 * empty list as if nothing was published.
 */
export async function getRecentForecastLinks(limit = 50, now: Date = new Date()): Promise<RelatedForecast[] | null> {
  const client = sb();
  if (!client) {
    console.error('[seo/forecast-pages] recent forecasts: no Supabase client');
    return null;
  }
  const { data, error } = await client
    .from('agency_forecasts')
    .select(LINK_SELECT_FORECAST)
    .not('title', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit * 4); // headroom: stale / thin / duplicate rows are dropped by the gate
  if (error) {
    console.error('[seo/forecast-pages] recent forecasts read failed:', error.message);
    return null;
  }
  return toForecastLinks((data ?? []) as unknown as ForecastRow[], limit, now);
}

/**
 * Upcoming forecasts for an /agencies/<slug> page: the agency's source codes scoped IN the query,
 * non-stale by anticipated award date (indexed), soonest first. [] when the agency publishes no
 * forecasts we map; null on a read error (the caller omits the block).
 */
export async function getForecastLinksForAgencySlug(
  slug: string,
  limit = 10,
  now: Date = new Date(),
): Promise<RelatedForecast[] | null> {
  const codes = forecastSourceCodesForAgencySlug(slug);
  if (codes.length === 0) return [];
  const client = sb();
  if (!client) {
    console.error('[seo/forecast-pages] agency forecasts: no Supabase client');
    return null;
  }
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await client
    .from('agency_forecasts')
    .select(LINK_SELECT_FORECAST)
    .in('source_agency', codes)
    .not('title', 'is', null)
    .gte('anticipated_award_date', cutoff)
    .order('anticipated_award_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit * 4);
  if (error) {
    console.error('[seo/forecast-pages] agency forecasts read failed:', error.message);
    return null;
  }
  return toForecastLinks((data ?? []) as unknown as ForecastRow[], limit, now);
}
