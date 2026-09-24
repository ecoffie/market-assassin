/**
 * MINDY INTEL — short, accurate lessons shown ONLY during genuinely long Maps waits (Maps P2B, 2026-09-24).
 *
 * One content system, not loading copy scattered through Maps. The Maps client receives this list as JSON
 * (market-feedback.ts) and decides WHEN a card may appear; this file decides WHAT may be said.
 *
 * Rules for a card (enforced by mindy-intel.unit.test.ts):
 *  - It teaches something true about the federal market or about how Mindy works. No motivation, no
 *    marketing superlatives, no numbers that are not sourced below.
 *  - One or two sentences; readable in the time it is on screen.
 *  - `horizons` names the horizons it is ABOUT. A card about recompetes is only shown while the Recompete
 *    horizon is part of the view, so a lesson never describes something the user has hidden.
 *
 * Every claim is sourced in the comment beside it — change the product, change the card.
 */
export type IntelHorizon = 'open' | 'recompete' | 'forecast';

export interface IntelCard {
  id: string;
  text: string;
  /** Horizons this card is about. Empty = about the market in general (always eligible). */
  horizons: IntelHorizon[];
}

export const MINDY_INTEL: readonly IntelCard[] = [
  {
    // The Maps horizons: Open (sam_opportunities) + Recompete (recompete_opportunities, expiring awards).
    id: 'beyond-open',
    text: 'Open solicitations are only part of your market. Mindy also tracks contracts likely to come back to market.',
    horizons: ['recompete'],
  },
  {
    // agency_forecasts are agency procurement forecasts — planned buys, not notices (Forecast Intelligence).
    id: 'forecast-not-solicitation',
    text: 'A forecast isn’t a solicitation. It’s an early signal that an agency expects to buy.',
    horizons: ['forecast'],
  },
  {
    // Canonical Discovery industry presets / concept classification map plain words to NAICS + PSC.
    id: 'translate-market',
    text: 'Mindy translates markets like janitorial and cybersecurity into the government buying categories behind them.',
    horizons: [],
  },
  {
    // Recompete timeline research (CLAUDE.md): Sources Sought / RFI appear 6–12 months before the RFP.
    id: 'recompete-early',
    text: 'The best time to prepare for a recompete is before the new solicitation appears.',
    horizons: ['recompete'],
  },
  {
    // Map-truth contract: place of performance is missing on many notices; Maps discloses the unmapped count.
    id: 'unmapped-disclosed',
    text: 'Many federal notices don’t say where the work happens. Mindy counts those matches and tells you how many it couldn’t put on the map.',
    horizons: ['open'],
  },
  {
    // Keyword-first research (CLAUDE.md): a product like drones spans many NAICS codes; the obvious one is a fraction.
    id: 'naics-is-not-the-market',
    text: 'One NAICS code rarely covers a whole market. Mindy starts from what you sell and finds the codes buyers actually use.',
    horizons: [],
  },
];

/** A card is eligible when it is general, or about at least one horizon in the current view. */
export function eligibleIntel(cards: readonly IntelCard[], enabled: readonly string[]): IntelCard[] {
  return cards.filter((c) => c.horizons.length === 0 || c.horizons.some((h) => enabled.includes(h)));
}
