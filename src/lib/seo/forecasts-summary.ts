/**
 * Agency forecast summary — the data layer for the public /forecasts hub.
 *
 * WHY THIS EXISTS
 * ---------------
 * `agency_forecasts` holds ~36,000 rows in Supabase and had NO public surface.
 * Every reader was `/opportunity-map/*` (authenticated), an `/api/*` route, or
 * `/mcp/about`, while `/forecasts` — the obvious URL — returned 404 despite
 * being advertised in sitemap.xml and linked from ~1,300 public pages.
 *
 * WHY IT READS A MATERIALIZED SUMMARY AND NOT THE TABLE
 * -----------------------------------------------------
 * The first version paged the whole table on the request path — ~36,000 rows
 * over ~36 round-trips, per ISR regeneration, and AGAIN for generateMetadata,
 * because Next calls that separately. That is a full-table transfer on a public
 * route: slow, fragile, and unbounded as the table grows.
 *
 * PostgREST aggregates are disabled on this project ("Use of aggregate
 * functions is not allowed"), so the grouping cannot be pushed into the
 * database from here. Instead a bounded offline job
 * (`npm run seo:build-forecast-summary`) computes one compact summary and
 * writes it to KV; this module only ever reads that single small object.
 *
 * The page and its metadata share ONE read per request via React `cache()`.
 *
 * FAIL CLOSED
 * -----------
 * A summary that is missing, unreadable, schema-mismatched, marked `truncated`
 * (the job hit its row cap and the counts would understate reality), or older
 * than MAX_AGE_MS is treated as UNAVAILABLE. The page then renders an honest
 * unavailable state and noindexes rather than publishing counts it cannot
 * stand behind. Never render a number you cannot prove.
 */
import { cache } from 'react';
import { kv } from '@vercel/kv';

/** Bump when the stored shape changes, so an old object is never misread. */
export const FORECAST_SUMMARY_VERSION = 'v1';
export const FORECAST_SUMMARY_KEY = `seo:forecast-summary:${FORECAST_SUMMARY_VERSION}`;

/** Older than this and we would be publishing stale counts as current. */
export const FORECAST_SUMMARY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface Tally {
  key: string;
  label: string;
  count: number;
}

/** Exactly what the builder writes and the page reads. */
export interface StoredForecastSummary {
  version: string;
  /** ISO timestamp of when the summary was BUILT (not when data was synced). */
  builtAt: string;
  /** Authoritative row count, from a COUNT query — not from rows transferred. */
  total: number;
  /** True when the builder could not read every row; counts would understate. */
  truncated: boolean;
  agencies: Tally[];
  naics: Tally[];
  fiscalYears: Tally[];
  setAsides: Tally[];
  sources: Tally[];
  /** Most recent last_synced_at across the corpus, ISO or null. */
  lastSynced: string | null;
}

export interface ForecastSummary extends Omit<StoredForecastSummary, 'version'> {
  available: boolean;
  /** Why it is unavailable, for logs. Never rendered to a visitor. */
  reason?: string;
}

const UNAVAILABLE = (reason: string): ForecastSummary => ({
  available: false,
  reason,
  builtAt: '',
  total: 0,
  truncated: false,
  agencies: [],
  naics: [],
  fiscalYears: [],
  setAsides: [],
  sources: [],
  lastSynced: null,
});

function isTallyArray(v: unknown): v is Tally[] {
  return (
    Array.isArray(v) &&
    v.every(
      (x) =>
        x &&
        typeof x === 'object' &&
        typeof (x as Tally).key === 'string' &&
        typeof (x as Tally).count === 'number',
    )
  );
}

/** Structural validation — a stored object from another version must not render. */
function validate(v: unknown): StoredForecastSummary | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Partial<StoredForecastSummary>;
  if (s.version !== FORECAST_SUMMARY_VERSION) return null;
  if (typeof s.total !== 'number' || s.total <= 0) return null;
  if (typeof s.builtAt !== 'string' || !s.builtAt) return null;
  if (typeof s.truncated !== 'boolean') return null;
  for (const f of ['agencies', 'naics', 'fiscalYears', 'setAsides', 'sources'] as const) {
    if (!isTallyArray(s[f])) return null;
  }
  return s as StoredForecastSummary;
}

/**
 * Decide whether a stored object may be published. Pure, so the fail-closed
 * rules are unit-testable without KV — which matters, because every branch
 * here is a case where rendering the data would be a lie.
 */
export function evaluateSummary(raw: unknown, now = Date.now()): ForecastSummary {
  if (raw == null) return UNAVAILABLE('no-summary-materialized');

  const s = validate(raw);
  if (!s) return UNAVAILABLE('summary-shape-invalid-or-wrong-version');

  // A truncated build undercounts. Publishing it would assert a total that is
  // simply wrong, which is worse than publishing nothing.
  if (s.truncated) return UNAVAILABLE('summary-truncated');

  const age = now - Date.parse(s.builtAt);
  if (!Number.isFinite(age)) return UNAVAILABLE('summary-builtAt-unparseable');
  if (age > FORECAST_SUMMARY_MAX_AGE_MS) return UNAVAILABLE('summary-stale');

  const { version: _version, ...rest } = s;
  return { available: true, ...rest };
}

/**
 * Read the materialized summary. Memoized per request with React `cache()`, so
 * `generateMetadata` and the page body share ONE KV read instead of two.
 */
export const getForecastSummary = cache(async (): Promise<ForecastSummary> => {
  let raw: unknown;
  try {
    raw = await kv.get(FORECAST_SUMMARY_KEY);
  } catch (err) {
    console.error('[forecasts] KV read failed:', err instanceof Error ? err.message : err);
    return UNAVAILABLE('kv-read-failed');
  }
  const result = evaluateSummary(raw);
  if (!result.available) {
    console.warn(`[forecasts] summary unavailable: ${result.reason}`);
  }
  return result;
});

/** Slugify an agency name the way /agencies/[slug] expects. */
export function agencySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
