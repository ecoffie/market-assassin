/**
 * Maps find_opportunities horizon items to the shared fit scorer's FitResult (contract agreed with Data Core,
 * 2026-11-21; field names from #2276). Pure: no I/O, no filtering, no ranking of its own. Unknown stays
 * undefined; nothing is inferred from a missing field.
 *
 * Fields read, per horizon:
 *   all          horizon, title, naics_code, psc_code, buyer, place_of_performance_state (2-letter, else unknown)
 *   open_now     set_aside_description ?? set_aside_code (raw, #2276) else the legacy combined set_aside;
 *                fullAndOpen only when the published text literally says there is no set-aside;
 *                response_deadline (dateKind response_deadline); no value on SAM notices
 *   coming_back  set_aside_type (null = unknown); incumbentSoleSource8a when it literally says 8(a) sole source;
 *                total_obligation ?? potential_total_value (obligated vs obligated; #2300); current_end (dateKind current_end);
 *                awarding_sub_agency → buyerOffice; vehicle unknown (orders are excluded upstream)
 *   coming_soon  estimated_value_min / estimated_value_max → value range; contracting_office → buyerOffice;
 *                set_aside_type (null = unknown); anticipated_award_date (dateKind anticipated_award)
 */
import { scoreWindow, type FitProfile, type FitResult, type ScoredWindow } from './fit-scorer';

type Row = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const state2 = (v: unknown): string | undefined => {
  const s = str(v)?.toUpperCase();
  return s && /^[A-Z]{2}$/.test(s) ? s : undefined;
};

/** Published text that affirmatively says there is no set-aside. Anything else is a set-aside or unknown. */
const NO_SET_ASIDE = /^(no\s+set[\s-]?aside(\s+used)?|none|n\/a\s*\(no\s+set[\s-]?aside\))$/i;
const SOLE_SOURCE_8A = /8\s*\(\s*a\s*\).*sole\s*source/i;

function setAsideFields(published: string | undefined): Pick<FitResult, 'setAside' | 'fullAndOpen'> {
  if (!published) return {};
  if (NO_SET_ASIDE.test(published)) return { fullAndOpen: true };
  return { setAside: published };
}

/** One find_opportunities horizon item → FitResult (no undefined keys), or null for an unknown horizon. */
export function findRowToFitResult(row: Row): FitResult | null {
  const r = mapRow(row);
  return r ? clean(r) : null;
}

function mapRow(row: Row): FitResult | null {
  const common = {
    title: str(row.title),
    naics: str(row.naics_code),
    psc: str(row.psc_code),
    buyerAgency: str(row.buyer),
    state: state2(row.place_of_performance_state),
  };
  switch (row.horizon) {
    case 'open_now': {
      const hasRaw = 'set_aside_description' in row || 'set_aside_code' in row;
      const published = hasRaw ? str(row.set_aside_description) ?? str(row.set_aside_code) : str(row.set_aside);
      return { kind: 'open', ...common, ...setAsideFields(published), date: str(row.response_deadline), dateKind: 'response_deadline' };
    }
    case 'coming_back': {
      const published = str(row.set_aside_type);
      // Obligated first: the size factor compares against the company's largest past award, an obligated amount.
      // potential_total_value is a ceiling (or null) since Data Core #2300; it is the fallback only.
      const value = num(row.total_obligation) ?? num(row.potential_total_value);
      return {
        kind: 'coming_back', ...common, ...setAsideFields(published),
        ...(published && SOLE_SOURCE_8A.test(published) ? { incumbentSoleSource8a: true } : {}),
        ...(value !== undefined ? { value } : {}),
        date: str(row.current_end), dateKind: 'current_end',
        buyerOffice: str(row.awarding_sub_agency),
      };
    }
    case 'coming_soon': {
      const min = num(row.estimated_value_min);
      const max = num(row.estimated_value_max);
      return {
        kind: 'forecast', ...common, ...setAsideFields(str(row.set_aside_type)),
        ...(min !== undefined || max !== undefined ? { value: { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) } } : {}),
        date: str(row.anticipated_award_date), dateKind: 'anticipated_award',
        buyerOffice: str(row.contracting_office),
      };
    }
    default:
      return null;
  }
}

/** Drops undefined keys so a FitResult never carries "present but undefined" fields. */
function clean(r: FitResult): FitResult {
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as FitResult;
}

/**
 * Scores one horizon's items (the fetched window) with the shared scorer, best first, and passes the horizon's
 * matched_count through so a partial window is reported as such. Items of an unknown horizon are skipped.
 */
export function scoreFindHorizon(horizon: { items: Row[]; matched_count: number | null }, profile: FitProfile, nowMs?: number): ScoredWindow<Row> {
  const mappable = horizon.items.filter((r) => findRowToFitResult(r) !== null);
  return scoreWindow(mappable, (r) => findRowToFitResult(r) as FitResult, profile, {
    ...(typeof horizon.matched_count === 'number' ? { matchedCount: horizon.matched_count } : {}),
    ...(nowMs !== undefined ? { nowMs } : {}),
  });
}
