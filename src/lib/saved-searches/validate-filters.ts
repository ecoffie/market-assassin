import { STRATEGY_STRAND_KEYS } from '@/lib/opportunities/map-filters';
import type { SavedSearchFilters } from './types';

const TRUTHY_STRINGS = new Set(['1', 'true', 'yes']);

/** Top-level filter keys the Map + cron understand. Unknown keys must be rejected. */
export const ALLOWED_SAVED_SEARCH_FILTER_KEYS = [
  'q',
  'naics',
  'agency',
  'subAgency',
  'state',
  'psc',
  'setAside',
  'noticeType',
  'strategy',
  'horizons',
  'scope',
  'fullOpen',
  'closingDays',
  'postedDays',
  'country',
  'hideCommodity',
  'hasDocs',
  'hasContact',
  'sapBuyer',
  'status',
] as const;

const ALLOWED_KEY_SET = new Set<string>(ALLOWED_SAVED_SEARCH_FILTER_KEYS);
const STRATEGY_KEY_SET = new Set<string>(STRATEGY_STRAND_KEYS as readonly string[]);

function asTrimmedString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function isTruthyFlag(v: unknown): boolean {
  if (v === true) return true;
  const s = asTrimmedString(v).toLowerCase();
  return TRUTHY_STRINGS.has(s);
}

function positiveInt(v: unknown): number {
  const n = parseInt(asTrimmedString(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function strategyParts(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => asTrimmedString(x)).filter(Boolean);
  }
  return asTrimmedString(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function strategyKeys(filters: SavedSearchFilters): string[] {
  return strategyParts(filters.strategy).filter((k) => STRATEGY_KEY_SET.has(k));
}

function horizonsNarrow(filters: SavedSearchFilters): boolean {
  const h = filters.horizons;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return false;
  const rec = h as Record<string, unknown>;
  return rec.forecast === true || rec.recompete === true;
}

/**
 * A saved search must narrow the market — never schedule alerts for the whole corpus.
 * Mirrors what the Map UI stores when the user clicks Save search (non-empty FILT / q / horizons).
 */
export function savedSearchHasNarrowingFilter(filters: SavedSearchFilters): boolean {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return false;

  if (asTrimmedString(filters.q)) return true;
  if (asTrimmedString(filters.naics)) return true;
  if (asTrimmedString(filters.agency)) return true;
  if (asTrimmedString(filters.subAgency)) return true;
  if (asTrimmedString(filters.state)) return true;
  if (asTrimmedString(filters.psc)) return true;
  if (asTrimmedString(filters.setAside)) return true;
  if (asTrimmedString(filters.noticeType)) return true;
  if (asTrimmedString(filters.country)) return true;
  if (asTrimmedString(filters.sapBuyer)) return true;
  if (isTruthyFlag(filters.fullOpen)) return true;
  if (isTruthyFlag(filters.hasDocs)) return true;
  if (isTruthyFlag(filters.hasContact)) return true;
  if (isTruthyFlag(filters.hideCommodity)) return true;
  if (positiveInt(filters.closingDays) > 0) return true;
  if (positiveInt(filters.postedDays) > 0) return true;
  if (strategyKeys(filters).length > 0) return true;
  if (asTrimmedString(filters.scope).toLowerCase() === 'profile') return true;
  if (horizonsNarrow(filters)) return true;

  const status = asTrimmedString(filters.status).toLowerCase();
  if (status && status !== 'active') return true;

  return false;
}

export type ValidateFiltersResult =
  | { ok: true; filters: SavedSearchFilters }
  | { ok: false; error: string };

/**
 * Normalize + validate filters before persisting. Rejects malformed input, unknown
 * filter keys (never silently drop into a broader watch), unknown strategy strands,
 * and searches that would match the entire federal market.
 */
export function validateSavedSearchFilters(raw: unknown): ValidateFiltersResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'filters must be a plain object' };
  }

  const rawObj = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(rawObj).filter((k) => !ALLOWED_KEY_SET.has(k));
  if (unknownKeys.length > 0) {
    const hint =
      unknownKeys.includes('keyword') || unknownKeys.includes('keywords')
        ? ' Tip: use q for keyword search.'
        : '';
    return {
      ok: false,
      error:
        `Unsupported filter keys: ${unknownKeys.join(', ')}. ` +
        `Supported: ${ALLOWED_SAVED_SEARCH_FILTER_KEYS.join(', ')}. ` +
        `Do not drop unsupported filters and activate a broader watch — ask the user to adjust.${hint}`,
    };
  }

  const filters: SavedSearchFilters = { ...(raw as SavedSearchFilters) };

  if (filters.strategy !== undefined) {
    const parts = strategyParts(filters.strategy);
    const unknownStrategy = parts.filter((k) => !STRATEGY_KEY_SET.has(k));
    if (unknownStrategy.length > 0) {
      return {
        ok: false,
        error:
          `Unsupported strategy values: ${unknownStrategy.join(', ')}. ` +
          `Allowed: ${(STRATEGY_STRAND_KEYS as readonly string[]).join(', ')}. ` +
          `Do not drop unsupported strategy strands and save a broader watch.`,
      };
    }
    if (Array.isArray(filters.strategy)) {
      filters.strategy = parts;
    } else if (parts.length) {
      filters.strategy = parts.join(',');
    } else {
      delete filters.strategy;
    }
  }

  if (!savedSearchHasNarrowingFilter(filters)) {
    return {
      ok: false,
      error:
        'At least one narrowing filter is required (naics, agency, q, state, set-aside, strategy, scope=profile, or forecast horizon). Cannot schedule a watch for the entire federal market.',
    };
  }

  return { ok: true, filters };
}

/** Strip empty values the Map save flow omits — stable fingerprint input. */
export function canonicalizeSavedSearchFilters(filters: SavedSearchFilters): SavedSearchFilters {
  const out: SavedSearchFilters = {};
  const entries = Object.entries(filters).sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of entries) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && (!v.trim() || v === 'all')) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const nested = canonicalizeSavedSearchFilters(v as SavedSearchFilters);
      if (Object.keys(nested).length) out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out;
}
