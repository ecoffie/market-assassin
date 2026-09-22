/**
 * Stage 4 of Canonical Discovery — SURFACE / HORIZON POLICY.
 *
 * A policy may NARROW (window, fiscal years, which horizons, sources, recency). It never changes
 * what the query MEANS — that is the plan's job and it is shared. Viewport, mappability, dedupe
 * and pin caps are presentation; they live in the surface, not here.
 *
 * Decisions of record (Eric, 2026-09-22):
 *   - Recompete: 18-month window on MCP AND Maps (Maps adopts MCP).
 *   - Forecast: current + future fiscal years by DEFAULT on every surface. A historical consumer
 *     opts into past years explicitly (`includePastFiscalYears: true`) — never by keyword.
 */
export type HorizonKey = 'open' | 'recompete' | 'forecast';

export interface SurfacePolicy {
  surface: 'mcp' | 'maps' | 'saved_search' | 'daily_alert';
  horizons: HorizonKey[];
  open: { closingDays?: number; postedDays?: number; hideCommodity?: boolean; sources: string[] };
  /** null = no upper bound on period-of-performance end. */
  recompete: { windowMonths: number | null };
  forecast: { includePastFiscalYears: boolean };
}

const FORECAST_DEFAULT = { includePastFiscalYears: false } as const;
const RECOMPETE_DEFAULT = { windowMonths: 18 } as const;

export const MCP_POLICY: SurfacePolicy = {
  surface: 'mcp',
  horizons: ['open', 'recompete', 'forecast'],
  open: { sources: ['sam'] },
  recompete: { ...RECOMPETE_DEFAULT },
  forecast: { ...FORECAST_DEFAULT },
};

export const MAPS_POLICY: SurfacePolicy = {
  surface: 'maps',
  horizons: ['open', 'recompete', 'forecast'],
  // sam+sbir union and the commodity toggle are existing Maps SOURCE policy, not query meaning.
  open: { sources: ['sam', 'sbir'] },
  recompete: { ...RECOMPETE_DEFAULT },
  forecast: { ...FORECAST_DEFAULT },
};

export const SAVED_SEARCH_POLICY: SurfacePolicy = {
  surface: 'saved_search',
  horizons: ['open', 'forecast'],
  open: { postedDays: 30, sources: ['sam'] },
  recompete: { ...RECOMPETE_DEFAULT },
  forecast: { ...FORECAST_DEFAULT },
};

/** Daily alerts deliver Open + Recompete by product contract. Their profile-keyword path is not yet on the seam. */
export const DAILY_ALERT_POLICY: SurfacePolicy = {
  surface: 'daily_alert',
  horizons: ['open', 'recompete'],
  open: { sources: ['sam'] },
  recompete: { ...RECOMPETE_DEFAULT },
  forecast: { ...FORECAST_DEFAULT },
};
