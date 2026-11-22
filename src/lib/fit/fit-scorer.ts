/**
 * Fit scorer, shared by MCP and Ask Mindy (Ask Mindy Backend Spec, Nov 21 2026, section 4): a 0 to 100 score of how well ONE
 * result (open notice, contract coming back, or forecast) fits ONE company, with the top two reasons in plain
 * words. Pure: no I/O, not wired into any route. Starting weights are the spec's; they are meant to be tuned
 * against the regression set before anything is shown to a customer.
 *
 * Step 1, eligibility gate: a set-aside the company does not hold, or a notice NAICS the company is not small
 * under, does not drop the result. It is relabeled route:'subcontract'. The spec says such results are
 * "scored for teaming instead" without defining that score, so they are scored on the same factors and
 * labeled (Eric, 2026-11-21: temporary, until a teaming score is defined). The gate text leads the reasons
 * ("subcontract route: ...") so a gated result never reads as prime-eligible.
 *
 * Step 2, score. Unknown is never guessed (spec section 3 and CLAUDE.md rule 5): a factor whose inputs are
 * unknown is left out and the score is scaled over the factors that ARE known. `known_weight` says how much of
 * the 100 points the score rests on, so a caller can refuse to show a score that rests on too little.
 *
 * Bands: 60+ show, 40 to 59 related (shown only when the user asks for more), below 40 hidden. 'show' also
 * needs the evidence floor: capability known and SHOW_MIN_KNOWN_WEIGHT points known, else capped at related
 * with an `evidenceNote`. Nothing known at all = score null, band 'unscored'. A passed deadline is hidden.
 *
 * Shared lib (CLAUDE.md rule 9): MCP find_opportunities and Ask Mindy chat both call this. Keep it free of
 * chat- or MCP-specific imports. Contract with Data Core: score the FULL candidate set before any paging cut
 * (rank-then-filter), then page by score; surfaces add no second relevance filter.
 *
 * Decisions the spec leaves open, made here and listed so review can overrule them:
 *   - "Same industry family" = same 4-digit NAICS industry group.
 *   - Location "within 150 miles" needs geocoding Mindy does not have here; only same state is scored as 10.
 *   - Regions are the four US Census regions.
 *   - Value below 0.5x the largest past award scores 5 (the spec defines only 0.5x to 3x, up to 10x, beyond).
 *   - A contract coming back outside 6 to 18 months scores 4 on timing (the spec defines only the window).
 *   - Open-market work (no vehicle) is "not applicable" for pathway access and left out, not scored.
 */

export type ResultKind = 'open' | 'coming_back' | 'forecast';

export interface FitResult {
  kind: ResultKind;
  title?: string;
  description?: string;
  naics?: string;
  psc?: string;
  /**
   * Set-aside as published, e.g. "Total Small Business", "8(a)", "SDVOSB", "HUBZone", "WOSB". Undefined, null or
   * blank = UNKNOWN (a missing set-aside is never read as full and open; Data Core contract, 2026-11-21).
   */
  setAside?: string | null;
  /** Only when the source affirmatively says the work is full and open (no set-aside). */
  fullAndOpen?: true;
  /** The current award was an 8(a) sole source (coming-back rows). */
  incumbentSoleSource8a?: boolean;
  /** A dollar value, or a range (forecasts publish ranges). Absent = unknown. */
  value?: number | { min?: number; max?: number };
  /** Open: response deadline. Coming back: current end date. Forecast: expected award date. ISO. */
  date?: string;
  /** Which date `date` is. When it contradicts `kind` the date is treated as unknown, never reinterpreted. */
  dateKind?: 'response_deadline' | 'current_end' | 'anticipated_award';
  state?: string;
  /** Work is nationwide or remote. */
  nationwide?: boolean;
  buyerAgency?: string;
  buyerOffice?: string;
  /** Contract vehicle the work runs through. Undefined = unknown; null = open market. */
  vehicle?: { name: string; openToNewBidders?: boolean } | null;
}

export interface FitProfile {
  naicsCodes?: string[];
  pscCodes?: string[];
  /** Held certifications: '8(a)', 'HUBZone', 'WOSB', 'SDVOSB', 'VOSB'. Absent = unknown. */
  certifications?: string[];
  /** Small business size by NAICS: true = small, false = not small. Missing NAICS = unknown. */
  smallUnder?: Record<string, boolean>;
  states?: string[];
  largestPastAward?: number;
  /** Past performance, prime/sub/commercial alike (spec: "same type of work for anyone, including commercial"). */
  pastPerformance?: { buyerOffices?: string[]; buyerAgencies?: string[]; naicsCodes?: string[] };
  vehiclesHeld?: string[];
  /** The concepts the customer asked about (for the text-only capability match). */
  queryConcepts?: string[];
}

export type FactorId = 'capability' | 'past_performance' | 'timing' | 'competition' | 'size' | 'location' | 'pathway';

export const WEIGHTS: Readonly<Record<FactorId, number>> = {
  capability: 30, past_performance: 15, timing: 15, competition: 10, size: 10, location: 10, pathway: 10,
};

export interface FactorScore {
  id: FactorId;
  /** Points earned out of WEIGHTS[id]; null = unknown or not applicable (left out of the score). */
  points: number | null;
  reason?: string;
}

export interface FitScore {
  /** null = unscored: nothing about the fit could be checked. Never print or rank a made-up 0. */
  score: number | null;
  /** 'unscored' when score is null. 'show' needs the evidence floor (see SHOW_MIN_KNOWN_WEIGHT). */
  band: 'show' | 'related' | 'hidden' | 'unscored';
  route: 'prime' | 'subcontract';
  /** Plain-word reasons, strongest first, at most two. */
  reasons: string[];
  /** Points of the 100 that rest on known inputs. */
  known_weight: number;
  factors: FactorScore[];
  /** Why the result was relabeled to the subcontract route, when it was. */
  gate?: string;
  hiddenBecause?: string;
  /** Set when the score was kept out of 'show' for thin evidence, e.g. "limited evidence: only location and timing could be checked". */
  evidenceNote?: string;
}

export const SHOW_AT = 60;
export const RELATED_AT = 40;
/**
 * Evidence floor for 'show' (Agent 4 review, approved by Eric 2026-11-21): capability must be known and at
 * least this many of the 100 points must rest on known inputs. Otherwise the band is capped at 'related'.
 * A starting value, to tune against the regression set.
 */
export const SHOW_MIN_KNOWN_WEIGHT = 50;

const FACTOR_WORDS: Readonly<Record<FactorId, string>> = {
  capability: 'work match', past_performance: 'past performance', timing: 'timing', competition: 'competition',
  size: 'size', location: 'location', pathway: 'contract vehicle',
};

function listWords(ws: string[]): string {
  return ws.length <= 1 ? (ws[0] ?? '') : `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`;
}

const CERT_PATTERNS: Array<[string, RegExp]> = [
  ['8(a)', /\b8\s*\(?a\)?/i],
  ['HUBZone', /hub\s*zone/i],
  ['SDVOSB', /service[- ]disabled|sdvosb/i],
  ['WOSB', /women|wosb|edwosb/i],
  ['VOSB', /\bveteran|\bvosb/i],
];

/** The certification a set-aside requires, or 'small' for a general small business set-aside, or null. */
export function requiredCertification(setAside: string): string | 'small' | null {
  const s = setAside.trim();
  if (!s) return null;
  for (const [cert, re] of CERT_PATTERNS) if (re.test(s)) return cert;
  if (/small business|total small|partial small|\bsba\b/i.test(s)) return 'small';
  return null;
}

const REGIONS: Record<string, string> = Object.fromEntries([
  ...['CT', 'ME', 'MA', 'NH', 'RI', 'VT', 'NJ', 'NY', 'PA'].map((s) => [s, 'Northeast']),
  ...['IL', 'IN', 'MI', 'OH', 'WI', 'IA', 'KS', 'MN', 'MO', 'NE', 'ND', 'SD'].map((s) => [s, 'Midwest']),
  ...['DE', 'DC', 'FL', 'GA', 'MD', 'NC', 'SC', 'VA', 'WV', 'AL', 'KY', 'MS', 'TN', 'AR', 'LA', 'OK', 'TX'].map((s) => [s, 'South']),
  ...['AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'UT', 'WY', 'AK', 'CA', 'HI', 'OR', 'WA'].map((s) => [s, 'West']),
]);

const DAY = 86_400_000;
const norm = (s?: string) => (s || '').trim().toLowerCase();
const has = (xs: string[] | undefined, x: string | undefined) => !!x && !!xs?.some((y) => norm(y) === norm(x));

function capability(r: FitResult, p: FitProfile): FactorScore {
  const id = 'capability';
  const codesKnown = !!(p.naicsCodes?.length || p.pscCodes?.length);
  if ((r.naics && has(p.naicsCodes, r.naics)) || (r.psc && has(p.pscCodes, r.psc))) return { id, points: 30, reason: 'matches your registered work codes' };
  if (r.naics && p.naicsCodes?.some((c) => c.slice(0, 4) === r.naics!.slice(0, 4))) return { id, points: 15, reason: 'is in the same industry group as your work' };
  const text = norm(`${r.title || ''} ${r.description || ''}`);
  const concepts = (p.queryConcepts || []).map(norm).filter(Boolean);
  if (text && concepts.length && concepts.every((c) => text.includes(c))) return { id, points: 5, reason: 'describes the work you asked about' };
  if (!codesKnown && !concepts.length) return { id, points: null };
  if (!r.naics && !r.psc && !text) return { id, points: null };
  return { id, points: 0 };
}

function pastPerformance(r: FitResult, p: FitProfile): FactorScore {
  const id = 'past_performance';
  const pp = p.pastPerformance;
  if (!pp || (!pp.buyerOffices?.length && !pp.buyerAgencies?.length && !pp.naicsCodes?.length)) return { id, points: null };
  if (has(pp.buyerOffices, r.buyerOffice)) return { id, points: 15, reason: 'is with a buying office you have already delivered for' };
  if (has(pp.buyerAgencies, r.buyerAgency)) return { id, points: 10, reason: 'is with an agency you have already delivered for' };
  if (has(pp.naicsCodes, r.naics)) return { id, points: 7, reason: 'is the same type of work you have delivered before' };
  return { id, points: 0 };
}

const DATE_KIND_FOR: Readonly<Record<ResultKind, NonNullable<FitResult['dateKind']>>> = {
  open: 'response_deadline', coming_back: 'current_end', forecast: 'anticipated_award',
};

function timing(r: FitResult, now: number): FactorScore & { expired?: boolean } {
  const id = 'timing';
  if (r.kind === 'forecast') return { id, points: 8, reason: 'is on the agency forecast, so you can position early' };
  // A date of the wrong kind (e.g. an award end date on an open notice) is unknown, not reinterpreted.
  if (r.dateKind && r.dateKind !== DATE_KIND_FOR[r.kind]) return { id, points: null };
  const t = r.date ? Date.parse(r.date) : NaN;
  if (!Number.isFinite(t)) return { id, points: null };
  if (r.kind === 'open') {
    const days = (t - now) / DAY;
    if (days < 0) return { id, points: 0, expired: true };
    return days >= 10 ? { id, points: 15, reason: 'is open with time to respond' } : { id, points: 8, reason: 'is open, with under 10 days to respond' };
  }
  const months = (t - now) / (30.44 * DAY);
  return months >= 6 && months <= 18 ? { id, points: 12, reason: 'comes back in 6 to 18 months, the window to position' } : { id, points: 4 };
}

function competition(r: FitResult, p: FitProfile): FactorScore {
  const id = 'competition';
  if (r.incumbentSoleSource8a) return { id, points: 2, reason: undefined };
  const published = (r.setAside ?? '').trim();
  if (!published) return r.fullAndOpen ? { id, points: 4 } : { id, points: null };
  const need = requiredCertification(published);
  if (need === null) return { id, points: 4 };
  if (need === 'small') return { id, points: 7, reason: 'is set aside for small business' };
  if (p.certifications === undefined) return { id, points: null };
  return has(p.certifications, need) ? { id, points: 10, reason: `is set aside for ${need}, which you hold` } : { id, points: 0 };
}

/** One number for a value or a range: a range scores at its midpoint; a one-sided range at its known bound. */
export function resultValue(v: FitResult['value']): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (!v) return undefined;
  const lo = typeof v.min === 'number' && v.min > 0 ? v.min : undefined;
  const hi = typeof v.max === 'number' && v.max > 0 ? v.max : undefined;
  if (lo !== undefined && hi !== undefined) return (lo + hi) / 2;
  return lo ?? hi;
}

function size(r: FitResult, p: FitProfile): FactorScore {
  const id = 'size';
  const value = resultValue(r.value);
  if (!value || !p.largestPastAward || value <= 0 || p.largestPastAward <= 0) return { id, points: null };
  const ratio = value / p.largestPastAward;
  if (ratio >= 0.5 && ratio <= 3) return { id, points: 10, reason: 'is a size you have handled before' };
  if (ratio < 0.5 || ratio <= 10) return { id, points: 5 };
  return { id, points: 2 };
}

function location(r: FitResult, p: FitProfile): FactorScore {
  const id = 'location';
  if (r.nationwide) return { id, points: 6 };
  if (!r.state || !p.states?.length) return { id, points: null };
  const st = r.state.toUpperCase();
  if (p.states.some((s) => s.toUpperCase() === st)) return { id, points: 10, reason: `is in ${st}, where you work` };
  const region = REGIONS[st];
  if (region && p.states.some((s) => REGIONS[s.toUpperCase()] === region)) return { id, points: 6 };
  return { id, points: 2 };
}

function pathway(r: FitResult, p: FitProfile): FactorScore {
  const id = 'pathway';
  if (r.vehicle === undefined || r.vehicle === null) return { id, points: null };
  if (p.vehiclesHeld && has(p.vehiclesHeld, r.vehicle.name)) return { id, points: 10, reason: `runs through ${r.vehicle.name}, which you hold` };
  if (r.vehicle.openToNewBidders === undefined) return { id, points: null };
  return r.vehicle.openToNewBidders ? { id, points: 6 } : { id, points: 2 };
}

/** Step 1: is the company eligible to prime it? Returns why not, or null. Unknown eligibility is not a gate. */
export function eligibilityGate(r: FitResult, p: FitProfile): string | null {
  const need = r.setAside ? requiredCertification(r.setAside) : null;
  if (need && need !== 'small' && p.certifications !== undefined && !has(p.certifications, need)) {
    return `subcontract route: set aside for ${need}, which you do not hold`;
  }
  if (r.naics && p.smallUnder && p.smallUnder[r.naics] === false && need !== null) {
    return `subcontract route: you are not small under NAICS ${r.naics}`;
  }
  return null;
}

export function scoreFit(r: FitResult, p: FitProfile, nowMs: number = Date.now()): FitScore {
  const t = timing(r, nowMs);
  const factors: FactorScore[] = [capability(r, p), pastPerformance(r, p), { id: t.id, points: t.points, reason: t.reason }, competition(r, p), size(r, p), location(r, p), pathway(r, p)];
  const known = factors.filter((f) => f.points !== null);
  const knownWeight = known.reduce((n, f) => n + WEIGHTS[f.id], 0);
  const earned = known.reduce((n, f) => n + (f.points as number), 0);
  const gate = eligibilityGate(r, p);
  const route: FitScore['route'] = gate ? 'subcontract' : 'prime';

  // Nothing could be checked: unscored, never a fabricated 0 (CLAUDE.md rule 5).
  if (!knownWeight) {
    return { score: null, band: 'unscored', route, reasons: gate ? [gate] : [], known_weight: 0, factors, ...(gate ? { gate } : {}) };
  }

  const score = Math.round((earned / knownWeight) * 100);
  const fitReasons = known
    .filter((f) => f.reason && (f.points as number) > 0)
    .sort((a, b) => (b.points as number) / WEIGHTS[b.id] - (a.points as number) / WEIGHTS[a.id] || WEIGHTS[b.id] - WEIGHTS[a.id])
    .map((f) => f.reason as string);
  // A gated result leads with its route so it can never read as prime-eligible.
  const reasons = (gate ? [gate, ...fitReasons] : fitReasons).slice(0, 2);

  let band: FitScore['band'] = t.expired ? 'hidden' : score >= SHOW_AT ? 'show' : score >= RELATED_AT ? 'related' : 'hidden';
  let evidenceNote: string | undefined;
  const capabilityPoints = factors.find((f) => f.id === 'capability')?.points ?? null;
  const capabilityKnown = capabilityPoints !== null;
  // A KNOWN zero work match is not a fit, whatever timing or a set-aside add up to. Without this, 0 capability
  // + an open deadline (15) + a small business set-aside (7) = 22 of 55 known points = 40 → 'related', so
  // "show more" lists offered work the company does not do. Unknown capability is untouched (it is not a zero).
  const noWorkMatch = capabilityKnown && capabilityPoints === 0;
  if (noWorkMatch) band = 'hidden';
  if (band === 'show' && (!capabilityKnown || knownWeight < SHOW_MIN_KNOWN_WEIGHT)) {
    band = 'related';
    evidenceNote = `limited evidence: only ${listWords(known.map((f) => FACTOR_WORDS[f.id]))} could be checked`;
  }
  return {
    score, band, route, reasons, known_weight: knownWeight, factors,
    ...(gate ? { gate } : {}),
    ...(t.expired ? { hiddenBecause: 'response deadline has passed' } : noWorkMatch ? { hiddenBecause: 'no work match: the title, codes and description do not match what the company does' } : {}),
    ...(evidenceNote ? { evidenceNote } : {}),
  };
}

/** "Matches your wheelchair transport work and is set aside for small business." */
export function reasonSentence(fit: FitScore): string {
  if (!fit.reasons.length) return '';
  const [a, b] = fit.reasons;
  const s = b ? `${a} and ${b}` : a;
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export interface ScoredWindow<T> {
  /** Every candidate in the fetched window, scored and sorted best first (unscored last). */
  ranked: Array<{ item: T; fit: FitScore }>;
  /** How many candidates were scored (the fetched window). */
  window_size: number;
  /** How many matched in the source, when known. Absent = unknown, never assumed equal to the window. */
  matched_count?: number;
  /** Set when the window is smaller than what matched: the ranking is "top of what was scored", not of the market. */
  coverage_note?: string;
}

/**
 * Rank-then-page (Data Core contract, 2026-11-21): score the FULL fetched window before any page cut, sort by
 * score, and report window_size vs matched_count. Callers page `ranked`; they add no second relevance filter.
 */
export function scoreWindow<T>(
  items: readonly T[],
  toResult: (item: T) => FitResult,
  profile: FitProfile,
  opts: { matchedCount?: number; nowMs?: number } = {},
): ScoredWindow<T> {
  const now = opts.nowMs ?? Date.now();
  const ranked = items.map((item) => ({ item, fit: scoreFit(toResult(item), profile, now) }))
    .sort((a, b) => (b.fit.score ?? -1) - (a.fit.score ?? -1));
  const out: ScoredWindow<T> = { ranked, window_size: items.length };
  if (typeof opts.matchedCount === 'number' && Number.isFinite(opts.matchedCount)) {
    out.matched_count = opts.matchedCount;
    if (opts.matchedCount > items.length) {
      out.coverage_note = `ranked the top ${items.length} fetched of ${opts.matchedCount} matching; this is the best of what was scored, not of the whole market`;
    }
  }
  return out;
}
