/**
 * The deterministic detector for the fabricated government-wide budget claim.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 * `fetchAgencySpendingPatterns` read USASpending `/references/toptier_agencies/`
 * and emitted, per agency:
 *
 *     "Total obligated: $X. Congressional justification outlay: $YB"
 *
 * `Y` came from `current_total_budget_authority_amount`, which is a
 * GOVERNMENT-WIDE CONSTANT — the denominator behind
 * `percentage_of_total_budget_authority`. Measured live 2026-09-20: exactly ONE
 * distinct value across all 111 agencies. So every agency was stamped with the
 * same multi-trillion-dollar figure, presented as that agency's own evidence.
 *
 * It drifts with each fiscal quarter, which is why several vintages coexist:
 *   $13,541.1B · $16,047.1B (both found in production) · $15,495.3B (live today)
 *
 * ── WHY THIS IS NOT A STRING BLOCKLIST ───────────────────────────────────────
 * Blocking the two known numbers would let the NEXT vintage through. The durable
 * guard is STRUCTURAL: no single federal agency has budget authority anywhere
 * near the government-wide total. The largest in this corpus is DoD at ~$2.6T.
 * Any PER-AGENCY dollar claim at or above PLAUSIBLE_AGENCY_CEILING_B is
 * government-wide data wearing an agency's name, whatever its value.
 *
 * Used by the read path (`agency-intelligence`), the static-corpus loader, and
 * the opp-intel cache repair, so one rule governs source, derivation and cache.
 */

/**
 * $5,000B. Comfortably above the largest real agency figure in this corpus
 * (DoD ≈ $2,575B) and far below the government-wide total (≈ $15,500B), so the
 * guard cannot swallow a legitimate large-agency claim.
 */
export const PLAUSIBLE_AGENCY_CEILING_B = 5000;

/** The phrase the defect always carries. Retained for exact provenance in reports. */
const CJ_OUTLAY_PHRASE = /congressional\s+justification\s+outlay/i;

/** Any "$<number>B" occurrence in a claim string. */
const BILLIONS = /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*B\b/gi;

/**
 * True when a claim asserts, of ONE agency, a dollar figure no single agency can
 * hold — or carries the known-fabricated "Congressional justification outlay"
 * derivation at all.
 *
 * Deliberately conservative: it does NOT judge claims it cannot parse, so
 * unrelated strategic content passes through untouched.
 */
export function isUnsupportedBudgetClaim(text: string | null | undefined): boolean {
  if (!text) return false;
  // The derivation itself is unsupported at any magnitude — there is no
  // agency-specific source behind it, so no value of it is defensible.
  if (CJ_OUTLAY_PHRASE.test(text)) return true;
  return exceedsAgencyPlausibility(text);
}

/** True when any "$NB" in the text is at or above the per-agency ceiling. */
export function exceedsAgencyPlausibility(text: string | null | undefined): boolean {
  if (!text) return false;
  BILLIONS.lastIndex = 0;
  for (let m = BILLIONS.exec(text); m !== null; m = BILLIONS.exec(text)) {
    const n = Number.parseFloat(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n >= PLAUSIBLE_AGENCY_CEILING_B) return true;
  }
  return false;
}

/**
 * Drop every unsupported claim from a list, preserving order and every claim the
 * rule does not condemn. Returns a NEW array; never mutates.
 *
 * This is the repair primitive: unsupported content DISAPPEARS. It is never
 * rewritten into a better-looking number and never given an invented citation.
 */
export function stripUnsupportedBudgetClaims(claims: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(claims)) return [];
  return claims.filter((c) => !isUnsupportedBudgetClaim(c));
}
