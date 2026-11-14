/**
 * Saved-search OPEN evaluator — ONE meaning for a saved search, shared with the Opportunity Map.
 *
 * The Map turns a request into a query through mapsOpenRequest + applyMapsOpenFilters (canonical
 * discovery: the plan owns free text, buyer identity, query-named codes/states/set-asides). The
 * saved-search alert cron and the MCP filter-reach probe still ran the LEGACY path
 * (parseMapFilters + applyMapFilters with a live `search`), so the same saved search meant two
 * different things. Measured 2026-11-14 over the cron's own 30-day window:
 *   "hvac maintenance"  Map 133 vs alert 1,389 · "medical staffing" 75 vs 612 · "janitorial services" 144 vs 36
 *   "Show me SBA opportunities" → legacy 8,880 of 9,193 rows (effectively the whole window).
 * Record: tasks/saved-search-alert-parity-2026-11-14.md
 *
 * This module does NOT build a third evaluator. `canonical` IS the Map's adapter; `legacy` IS the old
 * path, kept only so the engine can be flipped back by env without a deploy.
 *
 * Two rules that are not in the Map adapter, because an alert is unattended:
 *   1. The cron's 30-day posted window (an alert reports what is NEW, not the whole active corpus).
 *   2. A plan the canonical engine REFUSES (needs_refinement / needs_positive_scope) is returned as
 *      `blocked`, never run. The plan would turn it into `notice_id IS NULL` — a zero that would be
 *      stamped as a healthy, quiet search (silent-failure class: no execution ≠ success).
 */
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { applyMapsOpenFilters, mapsOpenRequest } from '@/lib/opportunities/maps-open-discovery';

export type SavedSearchOpenEngine = 'legacy' | 'canonical';

/** The alert cron's Open window (unchanged from the legacy cron). */
export const SAVED_SEARCH_OPEN_POSTED_DAYS = 30;

/** Same contract as resolveForecastEngine: env `true` → canonical; preview may opt in per request. */
export function resolveOpenEngine(env: string | undefined, preview: boolean, requested: string | null): SavedSearchOpenEngine {
  if (env === 'true') return 'canonical';
  if (preview && requested === 'canonical') return 'canonical';
  return 'legacy';
}

export interface ProfileScope { profileNaics?: string[]; profileStates?: string[] }

/**
 * A stored saved-search row read EXACTLY as the Map reads the same search from its URL.
 *
 * The Map only ever sees strings. A stored row is JSON, so `fullOpen: true` is a boolean — and
 * parseMapFilters accepts only '1'/'true', so the alert silently DROPPED Full & Open (and hideCommodity /
 * hasDocs / hasContact) while the Map applied it. Measured 2026-11-14: 4 alerting searches store
 * fullOpen as a boolean. Arrays join with ',' except agency, whose names contain commas
 * ("VETERANS AFFAIRS, DEPARTMENT OF") and therefore join with '|', the Map's multi-agency separator.
 * Objects (the stored `horizons`) are not filters and read as absent.
 */
export function savedFilterGetter(filters: Record<string, unknown>): (k: string) => string | null {
  return (k: string) => {
    const v = (filters || {})[k];
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) {
      const xs = v.filter((x) => typeof x === 'string' || typeof x === 'number').map(String);
      return xs.length ? xs.join(k === 'agency' ? '|' : ',') : null;
    }
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    return typeof v === 'string' ? v : null;
  };
}

export type SavedSearchOpenEvaluation =
  | {
      ok: true;
      engine: SavedSearchOpenEngine;
      /** canonical: the plan's retrieval path (text / text_or_taxonomy / structured_only); legacy: 'legacy'. */
      via: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apply: (query: any) => any;
    }
  | {
      ok: false;
      engine: 'canonical';
      status: 'needs_refinement' | 'needs_positive_scope';
      refinement: string | null;
    };

/**
 * Stored filters (+ resolved profile, when scope=profile) → the Open query for this saved search.
 * Throws exactly where parseMapFilters throws (unreadable stored value) — callers already classify that
 * as invalid_saved_filters.
 */
export function savedSearchOpenEvaluation(
  savedFilters: Record<string, unknown>,
  profile: ProfileScope | undefined,
  engine: SavedSearchOpenEngine,
  opts: { postedDays?: number } = {},
): SavedSearchOpenEvaluation {
  const window = opts.postedDays ?? SAVED_SEARCH_OPEN_POSTED_DAYS;

  if (engine === 'legacy') {
    // Byte-identical to the pre-change cron (raw stored values), so an env rollback restores it exactly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (k: string) => (savedFilters as Record<string, any>)[k] ?? null;
    const f = parseMapFilters(raw, profile);
    f.postedDays = f.postedDays || window;
    return { ok: true, engine, via: 'legacy', apply: (q) => applyMapFilters(q, f) };
  }

  const req = mapsOpenRequest(savedFilterGetter(savedFilters), profile);
  if (req.plan.status !== 'ok') {
    return { ok: false, engine, status: req.plan.status, refinement: req.plan.refinement };
  }
  req.filters.postedDays = req.filters.postedDays || window;
  return { ok: true, engine, via: req.plan.horizons.open.via, apply: (q) => applyMapsOpenFilters(q, req) };
}

/**
 * Did the engine that last evaluated this search change? A stored NULL means the search has only ever
 * been evaluated by the legacy engine (the column did not exist before the canonical engine).
 * A change in EITHER direction must re-baseline: last_seen_notice_ids holds the previous engine's
 * window, so diffing the new engine's matches against it would email weeks-old notices as "new"
 * (and a rollback to legacy would email its broad set).
 */
export function openEngineChanged(stored: unknown, current: SavedSearchOpenEngine): boolean {
  const prev: SavedSearchOpenEngine = stored === 'canonical' ? 'canonical' : 'legacy';
  return prev !== current;
}
