/**
 * why-fit.ts — the pre-track nudge. Turn a passive feed row into "here's your move."
 *
 * The give-up data (2026-07-12): of browsers who never tracked, 9 of 10 had a REAL
 * profile — they saw RELEVANT opportunities and chose not to act. So the gap isn't
 * targeting (we fixed runway/expired/nulls); it's motivation. A card that shows the
 * title + badges asks the user to do the matching in their head. This computes, from
 * data the feed already has:
 *   1. WHY it fits THEM — which of the user's own NAICS / keywords this opp hit,
 *      in plain language ("Matches your NAICS 541512 · your keyword 'cyber'").
 *   2. WHAT they'd do next — the same computeNextAction() the track flow uses, so
 *      the card previews the move BEFORE tracking, not after.
 *
 * Pure + deterministic (no fetch) — the panel already holds the user's criteria
 * (searchCriteria) and each opp's fields. Testable in isolation.
 *
 * STRONG-MATCH ONLY: the "why" line renders only when the fit is genuinely strong
 * (exact / same-4-digit-industry-group NAICS, a real keyword hit, or a set-aside
 * the user qualifies for). A mere 3-digit-subsector coincidence — how the feed
 * WIDENS to catch non-obvious codes — earns no "fits you" claim, because that
 * would put a dishonest nudge on a loose match (a law firm next to a fume-hood
 * job). Honest-or-silent: we only say "fits you" when it does.
 */
import { computeNextAction } from '@/lib/pipeline/next-action';

export interface FitInputs {
  /** The opportunity's own fields. */
  naicsCode?: string | null;
  title?: string | null;
  description?: string | null;
  noticeType?: string | null;
  setAsideEligible?: boolean | null;
  setAsideDescription?: string | null;
}

export interface UserCriteria {
  naicsCodes: string[];
  keywords: string[];
}

export interface WhyFit {
  /** Short reasons THIS opp matches THIS user, most-specific first. May be empty. */
  reasons: string[];
  /** One-line "why you", e.g. "Matches your NAICS 541512 · your keyword \"cyber\"". */
  whyLine: string;
  /** The next step preview text (from computeNextAction), or '' when track-only. */
  nextStep: string;
}

/**
 * STRONG NAICS match only. The feed WIDENS to the 3-digit subsector to surface
 * opps in non-obvious codes, but 3-digit is a grab-bag — 541 (Professional
 * Services) lumps law firms in with construction/engineering, so a law firm
 * (541110) "matches" a fume-hood job (541350) at the 3-digit level. Claiming
 * "Matches your NAICS" on that coincidence makes the nudge a LIE and exposes the
 * loose match. So the "why" reason requires EXACT or same-4-digit-INDUSTRY-GROUP
 * overlap (541110 vs 541191 both = 5411 legal-ish) — a genuinely related code.
 * A 3-digit-only overlap surfaces the opp but earns no "fits you" claim.
 * Returns the user's matched code, or null.
 */
function matchedNaics(oppNaics: string | null | undefined, userCodes: string[]): string | null {
  const opp = String(oppNaics || '').replace(/\D/g, '');
  if (opp.length < 4) return null;
  for (const raw of userCodes) {
    const u = String(raw || '').replace(/\D/g, '');
    if (u.length < 4) continue;
    // Exact, or share the 4-digit INDUSTRY GROUP (genuinely-related industries).
    if (opp === u || opp.slice(0, 4) === u.slice(0, 4)) return u;
  }
  return null;
}

/** Which of the user's keywords appear in the opp's title/description (case-insensitive,
 *  most-specific = longest first, capped so the line stays short). */
function matchedKeywords(
  title: string | null | undefined,
  description: string | null | undefined,
  userKeywords: string[],
): string[] {
  const hay = `${title || ''} ${description || ''}`.toLowerCase();
  const hits = userKeywords
    .map((k) => String(k || '').trim())
    .filter((k) => k.length >= 3 && hay.includes(k.toLowerCase()));
  // Longest first (a longer phrase is the more meaningful reason), dedup, cap 2.
  return Array.from(new Set(hits)).sort((a, b) => b.length - a.length).slice(0, 2);
}

export function computeWhyFit(opp: FitInputs, user: UserCriteria): WhyFit {
  const reasons: string[] = [];

  const naicsHit = matchedNaics(opp.naicsCode, user.naicsCodes || []);
  if (naicsHit) reasons.push(`your NAICS ${naicsHit}`);

  const kwHits = matchedKeywords(opp.title, opp.description, user.keywords || []);
  for (const k of kwHits) reasons.push(`your keyword "${k}"`);

  // Set-aside eligibility is a strong, concrete "this is FOR you" signal.
  if (opp.setAsideEligible && opp.setAsideDescription) {
    reasons.push(`${opp.setAsideDescription} set-aside you qualify for`);
  }

  const whyLine = reasons.length ? `Matches ${reasons.join(' · ')}` : '';
  // No fit reason → no nudge. The pre-track prompt only earns its place when the
  // opp is actually relevant to THIS user; nudging a next-step on an opp that
  // doesn't match them is noise (and an Award Notice with no match is not a lead).
  const nextStep = reasons.length ? computeNextAction(opp.noticeType, null).label : '';

  return { reasons, whyLine, nextStep };
}
