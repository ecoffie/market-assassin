import { STRATEGY_STRAND_KEYS } from '@/lib/opportunities/map-filters';
import type { SavedSearchFilters } from './types';
import { storedNaicsValidity } from './stored-naics';

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

/**
 * VALUE SHAPES. The key allowlist alone let `{ naics: '541510', sapBuyer: true }` through
 * schedule_market_search (the hosted MCP schema is z.record(unknown), so the advertised enum is
 * never enforced). The cron's parseMapFilters calls .toLowerCase() on sapBuyer, threw on the
 * boolean, and the search failed every day as unexpected_schedule_error while the agent had been
 * told "success" (2026-10-01 → 10-04). Reject a wrong shape at write time; never coerce it —
 * `true` is not a tier, and dropping it would save a broader watch than the user asked for.
 */
const SAP_BUYER_VALUES = new Set(['', 'most', 'somewhat', 'vehicle']);
const STATUS_VALUES = new Set(['active', 'inactive', 'all']);
/** Scalar-only: parseMapFilters string-methods these directly. */
const STRING_KEYS = new Set(['q', 'country', 'scope']);
/** A string or a list of strings (the Map + MCP both store multi-selects as arrays). */
const STRING_OR_LIST_KEYS = new Set(['naics', 'agency', 'subAgency', 'state', 'psc', 'setAside', 'noticeType']);
const FLAG_KEYS = new Set(['fullOpen', 'hideCommodity', 'hasDocs', 'hasContact']);
const NUMBER_KEYS = new Set(['closingDays', 'postedDays']);

function describeValue(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  return v === null ? 'null' : typeof v;
}

/**
 * First value-shape violation, or null. null/undefined values are absent, not invalid. Exported because the
 * Map's watch path (/api/app/map-watch → saveMapWatch) persists keys this module's allowlist does not cover
 * (valueRange, setAsideMulti, noticeMulti, fsc), so it cannot run the full validator — but every stored value
 * the alert cron parses must still be a shape the cron can read. Unknown keys are not checked here.
 */
export function valueShapeError(filters: Record<string, unknown>): string | null {
  return valueShapeIssue(filters)?.message ?? null;
}

/** Same check as valueShapeError, plus WHICH key failed (for customer copy + telemetry: names, never values). */
export function valueShapeIssue(filters: Record<string, unknown>): { key: string; message: string } | null {
  for (const [k, v] of Object.entries(filters)) {
    if (v === null || v === undefined) continue;
    const got = describeValue(v);
    if (k === 'sapBuyer') {
      if (typeof v !== 'string' || !SAP_BUYER_VALUES.has(v.trim().toLowerCase())) {
        return { key: k, message: `Invalid sapBuyer value (${got} ${JSON.stringify(v)}). Allowed: "most", "somewhat", "vehicle" (or omit it).` };
      }
    } else if (k === 'status') {
      if (typeof v !== 'string' || !STATUS_VALUES.has(v.trim().toLowerCase())) {
        return { key: k, message: `Invalid status value (${got} ${JSON.stringify(v)}). Allowed: "active", "inactive", "all".` };
      }
    } else if (STRING_KEYS.has(k)) {
      if (typeof v !== 'string') return { key: k, message: `Filter ${k} must be a string (got ${got}).` };
    } else if (STRING_OR_LIST_KEYS.has(k)) {
      const ok = typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
      if (!ok) return { key: k, message: `Filter ${k} must be a string or a list of strings (got ${got}).` };
    } else if (FLAG_KEYS.has(k)) {
      if (typeof v !== 'boolean' && typeof v !== 'string') return { key: k, message: `Filter ${k} must be true/false (got ${got}).` };
    } else if (NUMBER_KEYS.has(k)) {
      const ok = (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string';
      if (!ok) return { key: k, message: `Filter ${k} must be a number (got ${got}).` };
    }
  }
  return null;
}
const STRATEGY_KEY_SET = new Set<string>(STRATEGY_STRAND_KEYS as readonly string[]);

function asTrimmedString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** A narrowing value: a non-blank string, or a list holding at least one non-blank string (multi-selects). */
function hasValue(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => asTrimmedString(x) !== '');
  return asTrimmedString(v) !== '';
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

/**
 * Horizons narrow only when Open is OFF (2026-11-14). A Coming Soon-only (or Coming Back-only) watch is a
 * deliberate choice of corpus and stays allowed: forecasts have no other push channel. But "Open + Coming
 * Soon" with nothing else is the whole Open market. The old rule counted ANY forecast/recompete flag as
 * narrowing, so a save from the default map (all horizons on, narrowed to Open + Coming Soon) passed as a
 * whole-market alert. Read-only audit that day: 8 account watches were alerting on the entire Open market
 * this way. `horizons.open` absent means Open is on (the cron's own reading).
 */
function horizonsNarrow(filters: SavedSearchFilters): boolean {
  const h = filters.horizons;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return false;
  const rec = h as Record<string, unknown>;
  // Same reading of "off" as the cron (alert-scope.ts isOffFlag): false, 0, "0", "false", "no".
  const openOff = rec.open === false || rec.open === 0
    || (typeof rec.open === 'string' && ['0', 'false', 'no'].includes(rec.open.trim().toLowerCase()));
  if (!openOff) return false;
  return rec.forecast === true || rec.recompete === true;
}

/**
 * A saved search must narrow the market — never schedule alerts for the whole corpus.
 * Mirrors what the Map UI stores when the user clicks Save search (non-empty FILT / q / horizons).
 */
export function savedSearchHasNarrowingFilter(filters: SavedSearchFilters): boolean {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return false;

  if (asTrimmedString(filters.q)) return true;
  if (hasValue(filters.naics)) return true;
  if (hasValue(filters.agency)) return true;
  if (hasValue(filters.subAgency)) return true;
  if (hasValue(filters.state)) return true;
  if (hasValue(filters.psc)) return true;
  if (hasValue(filters.setAside)) return true;
  if (hasValue(filters.noticeType)) return true;
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

/**
 * Unknown NAICS (not Census 2022) are rejected at save. `541510` was saved twice on 2026-10-01 and matched
 * nothing every day while the tool reported success. Same rule as profile NAICS (validate-market-codes):
 * 6-digit must exist, 2–5 digit prefixes must prefix a real code. The message never proposes a replacement
 * code — choosing one is the user's decision, not the validator's.
 */
export function savedSearchNaicsError(filters: Record<string, unknown>): string | null {
  const { invalid } = storedNaicsValidity(filters);
  if (!invalid.length) return null;
  return `Unknown NAICS code${invalid.length > 1 ? 's' : ''} ${invalid.map((c) => `"${c}"`).join(', ')} — not a Census 2022 NAICS code or prefix. Confirm the intended code with the user; do not substitute one.`;
}

/**
 * WHY a filter set was refused, separate from `error` (which is written for agents and stays
 * unchanged). Clients turn `reason` + `keys` into customer copy; telemetry records the key NAMES,
 * never their values.
 */
export type ValidateFiltersFailureReason =
  | 'not_object'
  | 'unsupported_keys'
  | 'invalid_value'
  | 'invalid_naics'
  | 'invalid_strategy'
  | 'no_narrowing';

export type ValidateFiltersResult =
  | { ok: true; filters: SavedSearchFilters }
  | { ok: false; error: string; reason: ValidateFiltersFailureReason; keys: string[] };

/**
 * Normalize + validate filters before persisting. Rejects malformed input, unknown
 * filter keys (never silently drop into a broader watch), unknown strategy strands,
 * and searches that would match the entire federal market.
 */
export function validateSavedSearchFilters(raw: unknown): ValidateFiltersResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'filters must be a plain object', reason: 'not_object', keys: [] };
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
      reason: 'unsupported_keys',
      keys: unknownKeys,
    };
  }

  const shapeIssue = valueShapeIssue(rawObj);
  if (shapeIssue) {
    return {
      ok: false,
      error: `${shapeIssue.message} Do not coerce or drop the filter and save a broader watch — ask the user to adjust.`,
      reason: 'invalid_value',
      keys: [shapeIssue.key],
    };
  }
  const naicsErr = savedSearchNaicsError(rawObj);
  if (naicsErr) return { ok: false, error: naicsErr, reason: 'invalid_naics', keys: ['naics'] };

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
        reason: 'invalid_strategy',
        keys: ['strategy'],
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
        'At least one narrowing filter is required (naics, agency, q, state, set-aside, strategy, scope=profile, or a Coming Soon-only horizon with Open off). Open + Coming Soon with nothing else is the entire Open market. Cannot schedule a watch for the entire federal market.',
      reason: 'no_narrowing',
      keys: [],
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
