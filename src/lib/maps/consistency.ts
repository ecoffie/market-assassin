/**
 * MAP CONSISTENCY GUARD — the Map's header count, horizon counts, plotted pins and side list must
 * describe the SAME answer.
 *
 * Why this exists (customer call 2026-11-23): the header read 1,386 and did not move when the
 * horizon filter changed; another view said "28 results" beside one pin. Each surface was computed
 * on its own path, and nothing compared them before release. This module is the comparison. It is
 * pure: the acceptance script (`scripts/acceptance/map-consistency.mts`) collects a snapshot from a
 * settled round in a real browser, `factsFromSnapshot()` turns it into round facts, and
 * `checkMapConsistency()` lists every disagreement.
 *
 * Unknown is never zero (CLAUDE.md rule 5): a fact the page could not establish is `null`, and a
 * check that needs it is reported as UNCHECKED — never evaluated as if the value were 0.
 */

export type Horizon = 'open' | 'recompete' | 'forecast';
export const HORIZONS: readonly Horizon[] = ['open', 'recompete', 'forecast'];

/** One horizon's count as the round published it (window.__horizonCounts[h]). */
export interface HorizonCountFact {
  /** totalForFilters for the horizon; null = not established (loading / failed / unavailable / unknown). */
  total: number | null;
  /** 'ok' | 'partial' | 'unavailable' | 'unknown' | 'failed' | 'loading' | 'needs_scope' */
  state: string;
}

/** Everything one SETTLED map round shows, reduced to numbers. null = not established. */
export interface MapRoundFacts {
  /** Every enabled horizon answered (no horizon still loading). */
  settled: boolean;
  /** The pins response omitted market-wide counts (pan with a held intent). Count checks are skipped, never zeroed. */
  countsSkipped: boolean;
  /** Horizons the round loaded (window.__roundEnabled). */
  enabledHorizons: Horizon[];
  /** Horizons the user asked for (deep link / toggles); omit when not known. */
  requestedHorizons?: Horizon[];
  /** Per-horizon count chips' source (window.__horizonCounts). */
  horizonCounts: Partial<Record<string, HorizonCountFact>>;
  /** Location-less forecast rows the round added to the list and the headline (window.__unplacedForecastTotal). */
  unplacedListTotal: number | null;
  /** The number printed in the header ("7,793 results"); null when the header shows no number. */
  headerCount: number | null;
  /** Raw header text, for reporting. */
  headerText: string;
  /** The map pill ("961 of 7,793 opportunities"): shown / total; null when hidden or unparsable. */
  pillShown: number | null;
  pillTotal: number | null;
  /** totalInView the server reported for this viewport (window.__mapMatchTotals.inView). */
  inView: number | null;
  /** Rows in the side list (template `rows`). */
  listLength: number | null;
  /** List rows that carry a location (lat/lng) and so must be on the map. */
  listLocated: number | null;
  /** Rows actually represented on the map: single pins + members of cluster bubbles. */
  plotted: number | null;
  /** Distinct coordinates among the located list rows. */
  distinctLocations: number | null;
  /** Pins are intentionally hidden at this zoom ("Zoom in to see opportunities"). */
  pinsHidden: boolean;
}

export type Severity = 'error' | 'warn' | 'unchecked';

export interface ConsistencyFinding {
  code:
    | 'NOT_SETTLED'
    | 'HORIZONS_NOT_AS_REQUESTED'
    | 'HORIZON_COUNT_FOR_DISABLED_HORIZON'
    | 'HEADER_NOT_SUM_OF_HORIZONS'
    | 'HEADER_ZERO_WITH_LIST'
    | 'LIST_EXCEEDS_MATCHED'
    | 'PLOTTED_PLUS_UNPLACED_EXCEEDS_MATCHED'
    | 'LIST_EMPTY_WHILE_COUNT'
    | 'LOCATED_ROWS_NOT_PLOTTED'
    | 'PILL_TOTAL_NOT_HEADER'
    | 'PILL_SHOWN_NOT_PLOTTED'
    | 'ALL_RESULTS_ONE_LOCATION'
    | 'HEADER_STALE_ACROSS_HORIZONS';
  severity: Severity;
  message: string;
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** Every enabled horizon's total, summed — or null when any of them is not established. */
export function sumEnabledHorizons(f: Pick<MapRoundFacts, 'enabledHorizons' | 'horizonCounts'>): number | null {
  if (!f.enabledHorizons.length) return null;
  let sum = 0;
  for (const h of f.enabledHorizons) {
    const c = f.horizonCounts[h];
    if (!c || typeof c.total !== 'number') return null;
    sum += c.total;
  }
  return sum;
}

/** The headline the round's own facts imply: Σ enabled horizon totals + location-less list rows. */
export function expectedHeaderCount(f: MapRoundFacts): number | null {
  const s = sumEnabledHorizons(f);
  if (s === null || f.unplacedListTotal === null) return null;
  return s + f.unplacedListTotal;
}

/** All disagreements in one settled round. Empty array = consistent. */
export function checkMapConsistency(f: MapRoundFacts): ConsistencyFinding[] {
  const out: ConsistencyFinding[] = [];
  const add = (code: ConsistencyFinding['code'], severity: Severity, message: string) => out.push({ code, severity, message });

  if (!f.settled) {
    add('NOT_SETTLED', 'error', 'The round never settled (a horizon was still loading) — nothing on screen can be judged.');
    return out;
  }

  if (f.requestedHorizons) {
    const req = f.requestedHorizons;
    const same = req.length === f.enabledHorizons.length && req.every((h) => f.enabledHorizons.includes(h));
    if (!same) {
      add('HORIZONS_NOT_AS_REQUESTED', 'error',
        `Asked for ${req.join('+') || 'none'} but the map loaded ${f.enabledHorizons.join('+') || 'none'} — every count below answers a different question.`);
    }
  }

  for (const k of Object.keys(f.horizonCounts)) {
    if (!f.enabledHorizons.includes(k as Horizon)) {
      add('HORIZON_COUNT_FOR_DISABLED_HORIZON', 'error', `Horizon "${k}" is off but still publishes a count.`);
    }
  }

  const header = f.headerCount;
  const expected = expectedHeaderCount(f);
  if (f.countsSkipped) {
    add('HEADER_NOT_SUM_OF_HORIZONS', 'unchecked', 'countsSkipped: the server omitted market-wide counts, so the header cannot be compared (not treated as 0).');
  } else if (expected === null) {
    const unknown = f.enabledHorizons.filter((h) => typeof f.horizonCounts[h]?.total !== 'number');
    add('HEADER_NOT_SUM_OF_HORIZONS', 'unchecked',
      `Header not compared: ${unknown.length ? `count not established for ${unknown.join(', ')}` : 'location-less list total unknown'}.`);
  } else if (header === null) {
    add('HEADER_NOT_SUM_OF_HORIZONS', 'error', `Every enabled horizon reported (sum ${fmt(expected)}) but the header shows no number ("${f.headerText}").`);
  } else if (header !== expected) {
    add('HEADER_NOT_SUM_OF_HORIZONS', 'error',
      `Header says ${fmt(header)} but the enabled horizons (${f.enabledHorizons.join('+')}) sum to ${fmt(expected)}.`);
  }

  if (header !== null && f.listLength !== null) {
    if (header === 0 && f.listLength > 0) {
      add('HEADER_ZERO_WITH_LIST', 'error', `Header says 0 while the list holds ${fmt(f.listLength)} rows.`);
    }
    if (f.listLength > header) {
      add('LIST_EXCEEDS_MATCHED', 'error', `The list holds ${fmt(f.listLength)} rows but the header says only ${fmt(header)} match.`);
    }
    if (header > 0 && f.listLength === 0) {
      if (f.inView === null) add('LIST_EMPTY_WHILE_COUNT', 'warn', `Header says ${fmt(header)} and the list is empty; in-view count unknown.`);
      else if (f.inView > 0) add('LIST_EMPTY_WHILE_COUNT', 'error', `Header says ${fmt(header)} and ${fmt(f.inView)} are in view, but the list is empty.`);
    }
  }

  const unplacedInList = f.listLength !== null && f.listLocated !== null ? f.listLength - f.listLocated : null;
  if (header !== null && f.plotted !== null && unplacedInList !== null && f.plotted + unplacedInList > header) {
    add('PLOTTED_PLUS_UNPLACED_EXCEEDS_MATCHED', 'error',
      `${fmt(f.plotted)} plotted + ${fmt(unplacedInList)} list-only rows exceed the ${fmt(header)} the header says match.`);
  }

  if (!f.pinsHidden && f.plotted !== null && f.listLocated !== null && f.plotted !== f.listLocated) {
    add('LOCATED_ROWS_NOT_PLOTTED', 'error',
      `${fmt(f.listLocated)} list rows have a location but the map represents ${fmt(f.plotted)} (pins + cluster members).`);
  }

  if (f.pillTotal !== null && header !== null && f.pillTotal !== header) {
    add('PILL_TOTAL_NOT_HEADER', 'error', `Map pill total ${fmt(f.pillTotal)} ≠ header ${fmt(header)}.`);
  }
  if (f.pillShown !== null && f.plotted !== null && !f.pinsHidden && f.pillShown !== f.plotted) {
    add('PILL_SHOWN_NOT_PLOTTED', 'error', `Map pill says ${fmt(f.pillShown)} shown on the map, but ${fmt(f.plotted)} are plotted.`);
  }

  if (!f.pinsHidden && f.listLocated !== null && f.listLocated > 1 && f.distinctLocations === 1) {
    add('ALL_RESULTS_ONE_LOCATION', 'warn',
      `All ${fmt(f.listLocated)} located results share ONE coordinate — they read as a single pin.`);
  }

  return out;
}

/**
 * Cross-round check: the enabled horizons changed and their sums differ, yet the header text did
 * not move — the "1,386 does not change with the horizon filter" symptom.
 */
export function checkHeaderFollowsHorizons(prev: MapRoundFacts, next: MapRoundFacts): ConsistencyFinding[] {
  const sameSet = prev.enabledHorizons.length === next.enabledHorizons.length
    && prev.enabledHorizons.every((h) => next.enabledHorizons.includes(h));
  if (sameSet || prev.countsSkipped || next.countsSkipped) return [];
  const a = expectedHeaderCount(prev), b = expectedHeaderCount(next);
  if (a === null || b === null || a === b) return [];
  if (prev.headerCount !== null && prev.headerCount === next.headerCount) {
    return [{ code: 'HEADER_STALE_ACROSS_HORIZONS', severity: 'error',
      message: `Horizons ${prev.enabledHorizons.join('+')} → ${next.enabledHorizons.join('+')} changed the sum ${fmt(a)} → ${fmt(b)}, but the header stayed ${fmt(next.headerCount as number)}.` }];
  }
  return [];
}

// ─── Snapshot → facts (the acceptance script's call site) ──────────────────────────────────────

/** Raw values read from the page in one evaluate(); see collectMapSnapshot in the acceptance script. */
export interface MapPageSnapshot {
  headerText: string | null;
  pillText: string | null;
  pillHidden: boolean;
  matchTotals: { inView?: unknown; settled?: unknown } | null;
  horizonCounts: Record<string, { total?: unknown; state?: unknown }> | null;
  roundEnabled: string[] | null;
  horizonsLoading: string[] | null;
  unplacedForecastTotal: unknown;
  countsSkipped?: boolean;
  listLength: number | null;
  listLocated: number | null;
  plotted: number | null;
  distinctLocations: number | null;
  pinsHidden: boolean;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "7,793 results · …" → 7793. "?", "Searching…", "Unavailable", "Nothing searched yet" → null. */
export function parseHeaderCount(text: string | null | undefined): number | null {
  const m = String(text ?? '').trim().match(/^([\d,]+)\s+results?\b/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** "961 of 7,793 opportunities · 508 not shown on map" → {shown:961,total:7793}; "12 opportunities" → {shown:12,total:12}. */
export function parsePill(text: string | null | undefined): { shown: number | null; total: number | null } {
  const t = String(text ?? '').trim();
  const frac = t.match(/^([\d,]+)\s+of\s+([\d,]+)\s+opportunit/);
  if (frac) return { shown: Number(frac[1].replace(/,/g, '')), total: Number(frac[2].replace(/,/g, '')) };
  const bare = t.match(/^([\d,]+)\s+opportunit/);
  if (bare) { const n = Number(bare[1].replace(/,/g, '')); return { shown: n, total: n }; }
  return { shown: null, total: null };
}

export function factsFromSnapshot(s: MapPageSnapshot): MapRoundFacts {
  const enabled = (s.roundEnabled ?? []).filter((h): h is Horizon => (HORIZONS as readonly string[]).includes(h));
  const horizonCounts: Record<string, HorizonCountFact> = {};
  for (const [k, v] of Object.entries(s.horizonCounts ?? {})) {
    horizonCounts[k] = { total: num(v?.total), state: String(v?.state ?? 'unknown') };
  }
  const loading = (s.horizonsLoading ?? []).length > 0;
  const pill = s.pillHidden ? { shown: null, total: null } : parsePill(s.pillText);
  return {
    settled: s.matchTotals?.settled === true && !loading,
    countsSkipped: !!s.countsSkipped,
    enabledHorizons: enabled,
    horizonCounts,
    unplacedListTotal: num(s.unplacedForecastTotal),
    headerCount: parseHeaderCount(s.headerText),
    headerText: String(s.headerText ?? ''),
    pillShown: pill.shown,
    pillTotal: pill.total,
    inView: num(s.matchTotals?.inView),
    listLength: s.listLength,
    listLocated: s.listLocated,
    plotted: s.plotted,
    distinctLocations: s.distinctLocations,
    pinsHidden: s.pinsHidden,
  };
}

// ─── The filter combinations the acceptance script drives ──────────────────────────────────────

export interface MapCombo { name: string; params: Record<string, string> }

/** Common customer views, each a deep link the Map restores (route.ts ?horizon=/setAside=/naics=/q=). */
export const MAP_CONSISTENCY_COMBOS: readonly MapCombo[] = [
  { name: 'Open now only', params: { horizon: 'open' } },
  { name: 'Coming back only', params: { horizon: 'recompete' } },
  { name: 'Coming soon only', params: { horizon: 'forecast' } },
  { name: 'Open now + Coming soon', params: { horizon: 'open,forecast' } },
  { name: 'All three horizons', params: { horizon: 'open,recompete,forecast' } },
  { name: 'Set-aside SDVOSB (Open now)', params: { horizon: 'open', setAside: 'SDVOSB' } },
  { name: 'NAICS 541512 (all horizons)', params: { horizon: 'open,recompete,forecast', naics: '541512' } },
  { name: 'Keyword "cybersecurity" (all horizons)', params: { horizon: 'open,recompete,forecast', q: 'cybersecurity' } },
];

export function comboUrl(base: string, combo: MapCombo): string {
  const u = new URL('/opportunity-map', base);
  for (const [k, v] of Object.entries(combo.params)) u.searchParams.set(k, v);
  return u.toString();
}
