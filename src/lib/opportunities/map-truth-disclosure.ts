/**
 * THE MAP-TRUTH CONTRACT (Eric, 2026-09-12 — frozen).
 *
 *   "The map may show only mappable rows, but Mindy must never present that number
 *    as the total market truth."
 *
 * WHY THIS IS A MODULE AND NOT A COMMENT. On 2026-09-12 only 513 of 11,012 open
 * opportunities (4.7%) had coordinates. Every filter was CORRECT — NAICS, agency,
 * set-aside, state all returned genuinely matching rows — and the map still showed
 * a user with 42 real matches the number "1". Nothing errored. The headline simply
 * answered a narrower question ("rows we could plot") using the words of a broader
 * one ("opportunities matching your filters").
 *
 * That is this repo's most expensive bug class, the one `docs/engineering/a-number-
 * is-a-product-feature.md` was written about: not a crash, a number plausible enough
 * to act on. Four real users measured — NJ construction 0 shown / 31 real,
 * TX 541-series 0 / 24, janitorial 0 / 42, VA 30 / 1,802 — reasonably concluded the
 * FILTERS were broken. They were not.
 *
 * THIS IS PERMANENT, NOT INCIDENT CLEANUP. Even at ~95.6% coverage after the
 * 2026-09-12 backfill, 477 open rows remain legitimately unplaceable: APO/FPO
 * military mail (AP/AE have no US centroid) and foreign place-of-performance, which
 * geocode() deliberately refuses to pin to the US buying office (the "Seoul, DC"
 * guard). Those rows are not debt to be paid off — they are honestly locationless,
 * forever. So the disclosure must survive good coverage.
 *
 * THE RULE: if `matching > mappable`, the UI MUST disclose BOTH numbers.
 * Applies to Open, Awarded and Forecast alike.
 */

export type MapCountDisclosure = {
  /** Every row matching the filters — the MARKET truth. */
  matching: number;
  /** Rows carrying coordinates — what the map can actually draw. */
  mappable: number;
  /** matching - mappable. Real, honest, and never silently dropped. */
  unplaced: number;
  /** True when the two numbers differ and the UI is therefore obliged to show both. */
  mustDisclose: boolean;
  /** The exact headline to render. Never just the mappable count when they differ. */
  headline: string;
};

/**
 * Build the honest headline for a map view.
 *
 * `matching` unknown (null) is NOT the same as "equal to mappable" — an uncounted
 * total must not silently collapse into "everything is mapped" (the `count ?? 0`
 * fabrication, Bug Prevention Rule #11). When it is unknown we say so.
 */
export function buildMapCountDisclosure(
  matching: number | null | undefined,
  mappable: number,
  noun = 'opportunities',
): MapCountDisclosure {
  const safeMappable = Math.max(0, mappable | 0);

  if (matching == null) {
    return {
      matching: safeMappable,
      mappable: safeMappable,
      unplaced: 0,
      mustDisclose: false,
      headline: `${safeMappable.toLocaleString()} mapped ${noun} · total unknown`,
    };
  }

  const safeMatching = Math.max(0, matching | 0);
  // A mappable count above the matching count is incoherent; clamp so we never render
  // a negative "unplaced" (and never claim MORE than the market truth).
  const effMappable = Math.min(safeMappable, safeMatching);
  const unplaced = safeMatching - effMappable;

  if (unplaced <= 0) {
    return {
      matching: safeMatching, mappable: effMappable, unplaced: 0, mustDisclose: false,
      headline: `${safeMatching.toLocaleString()} ${noun}`,
    };
  }

  return {
    matching: safeMatching,
    mappable: effMappable,
    unplaced,
    mustDisclose: true,
    headline:
      `${safeMatching.toLocaleString()} matching ${noun} · ` +
      `${effMappable.toLocaleString()} mapped · ` +
      `${unplaced.toLocaleString()} location unavailable`,
  };
}
