/**
 * Ask Mindy fit scorer (Ask Mindy Backend Spec, Nov 21 2026, section 4): a 0 to 100 score of how well ONE
 * result (open notice, contract coming back, or forecast) fits ONE company, with the top two reasons in plain
 * words. Pure: no I/O, not wired into any route. Starting weights are the spec's; they are meant to be tuned
 * against the regression set before anything is shown to a customer.
 *
 * Step 1, eligibility gate: a set-aside the company does not hold, or a notice NAICS the company is not small
 * under, does not drop the result. It is relabeled route:'subcontract'. The spec says such results are
 * "scored for teaming instead" without defining that score, so they are scored on the same factors and
 * labeled; a teaming score is an open product question.
 *
 * Step 2, score. Unknown is never guessed (spec section 3 and CLAUDE.md rule 5): a factor whose inputs are
 * unknown is left out and the score is scaled over the factors that ARE known. `known_weight` says how much of
 * the 100 points the score rests on, so a caller can refuse to show a score that rests on too little.
 *
 * Bands: 60+ show, 40 to 59 related (shown only when the user asks for more), below 40 hidden. A notice whose
 * response deadline has passed is hidden regardless.
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
  /** Set-aside as published, e.g. "Total Small Business", "8(a)", "SDVOSB", "HUBZone", "WOSB". Empty = full and open. Undefined = unknown. */
  setAside?: string | null;
  /** The current award was an 8(a) sole source (coming-back rows). */
  incumbentSoleSource8a?: boolean;
  value?: number;
  /** Open: response deadline. Coming back: current end date. Forecast: expected solicitation date. ISO. */
  date?: string;
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
  score: number;
  band: 'show' | 'related' | 'hidden';
  route: 'prime' | 'subcontract';
  /** Plain-word reasons, strongest first, at most two. */
  reasons: string[];
  /** Points of the 100 that rest on known inputs. */
  known_weight: number;
  factors: FactorScore[];
  /** Why the result was relabeled to the subcontract route, when it was. */
  gate?: string;
  hiddenBecause?: string;
}

export const SHOW_AT = 60;
export const RELATED_AT = 40;

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

function timing(r: FitResult, now: number): FactorScore & { expired?: boolean } {
  const id = 'timing';
  if (r.kind === 'forecast') return { id, points: 8, reason: 'is on the agency forecast, so you can position early' };
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
  if (r.setAside === undefined) return { id, points: null };
  const need = requiredCertification(r.setAside || '');
  if (need === null) return { id, points: 4 };
  if (need === 'small') return { id, points: 7, reason: 'is set aside for small business' };
  if (p.certifications === undefined) return { id, points: null };
  return has(p.certifications, need) ? { id, points: 10, reason: `is set aside for ${need}, which you hold` } : { id, points: 0 };
}

function size(r: FitResult, p: FitProfile): FactorScore {
  const id = 'size';
  if (!r.value || !p.largestPastAward || r.value <= 0 || p.largestPastAward <= 0) return { id, points: null };
  const ratio = r.value / p.largestPastAward;
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
    return `set aside for ${need}, which you do not hold`;
  }
  if (r.naics && p.smallUnder && p.smallUnder[r.naics] === false && need !== null) {
    return `you are not small under NAICS ${r.naics}`;
  }
  return null;
}

export function scoreFit(r: FitResult, p: FitProfile, nowMs: number = Date.now()): FitScore {
  const t = timing(r, nowMs);
  const factors: FactorScore[] = [capability(r, p), pastPerformance(r, p), { id: t.id, points: t.points, reason: t.reason }, competition(r, p), size(r, p), location(r, p), pathway(r, p)];
  const known = factors.filter((f) => f.points !== null);
  const knownWeight = known.reduce((n, f) => n + WEIGHTS[f.id], 0);
  const earned = known.reduce((n, f) => n + (f.points as number), 0);
  const score = knownWeight ? Math.round((earned / knownWeight) * 100) : 0;
  const gate = eligibilityGate(r, p);
  const reasons = known
    .filter((f) => f.reason && (f.points as number) > 0)
    .sort((a, b) => (b.points as number) / WEIGHTS[b.id] - (a.points as number) / WEIGHTS[a.id] || WEIGHTS[b.id] - WEIGHTS[a.id])
    .slice(0, 2)
    .map((f) => f.reason as string);
  const band: FitScore['band'] = t.expired ? 'hidden' : score >= SHOW_AT ? 'show' : score >= RELATED_AT ? 'related' : 'hidden';
  return {
    score, band, route: gate ? 'subcontract' : 'prime', reasons, known_weight: knownWeight, factors,
    ...(gate ? { gate } : {}),
    ...(t.expired ? { hiddenBecause: 'response deadline has passed' } : {}),
  };
}

/** "Matches your wheelchair transport work and is set aside for small business." */
export function reasonSentence(fit: FitScore): string {
  if (!fit.reasons.length) return '';
  const [a, b] = fit.reasons;
  const s = b ? `${a} and ${b}` : a;
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}
