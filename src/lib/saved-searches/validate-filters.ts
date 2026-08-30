import { STRATEGY_STRAND_KEYS } from '@/lib/opportunities/map-filters';
import type { SavedSearchFilters } from './types';

const TRUTHY_STRINGS = new Set(['1', 'true', 'yes']);

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

function strategyKeys(filters: SavedSearchFilters): string[] {
  const raw = filters.strategy;
  const parts = Array.isArray(raw)
    ? raw.map((x) => asTrimmedString(x)).filter(Boolean)
    : asTrimmedString(raw).split(',').map((s) => s.trim()).filter(Boolean);
  return parts.filter((k) => (STRATEGY_STRAND_KEYS as readonly string[]).includes(k));
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
 * Normalize + validate filters before persisting. Rejects malformed input and searches
 * that would silently match the entire federal market.
 */
export function validateSavedSearchFilters(raw: unknown): ValidateFiltersResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'filters must be a plain object' };
  }

  const filters: SavedSearchFilters = { ...(raw as SavedSearchFilters) };

  // Drop unknown strategy keys (same allowlist as parseMapFilters).
  if (filters.strategy !== undefined) {
    const allowed = strategyKeys(filters);
    if (Array.isArray(filters.strategy)) {
      filters.strategy = allowed;
    } else if (asTrimmedString(filters.strategy)) {
      filters.strategy = allowed.join(',');
    } else {
      delete filters.strategy;
    }
  }

  if (!savedSearchHasNarrowingFilter(filters)) {
    return {
      ok: false,
      error:
        'At least one narrowing filter is required (naics, agency, keyword/q, state, set-aside, strategy, scope=profile, or forecast horizon). Cannot schedule alerts for the entire federal market.',
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
