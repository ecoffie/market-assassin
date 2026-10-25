/**
 * The ONE builder for a "Today's Lens" map link — used by the daily alert email AND the in-app
 * Today's Intel hero, so the two surfaces can never drift.
 *
 * A CTA COUNT AND ITS DESTINATION MUST DESCRIBE THE SAME POPULATION. The lens count is
 *   active ∩ open deadline ∩ profile NAICS (lensNaics) ∩ all lens strands
 * so the link carries BOTH the strands and the exact NAICS codes that count used. Before this the
 * link was `?strategy=` alone and the map — whose default scope is the whole corpus — applied the
 * strands to every NAICS: "Explore 13 recommended" opened 95 / 137 (Joseph Boyd, 2026-10-25).
 *
 * `lens_n` + `lens_on` record what the lens counted and WHEN, so the map can say "13 when your
 * alert was sent (Oct 21) · N now" instead of silently showing today's number as if it were the
 * alert's. They are labels only: the exact historical set was never stored and is NOT recoverable,
 * so the map never claims to show "the alert's 13".
 */

export type LensLinkSource = 'alert' | 'todays_intel';

export interface LensLinkInput {
  lensStrategy: string;
  lensNaics: string[];
  lensCount: number | null;
}

const NAICS_SHAPE = /^[0-9]{2,6}$/;
const STRAND_SHAPE = /^[a-z_]{2,40}$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Relative map path (prefix the origin for email). No strands → the plain map (nothing to scope). */
export function todaysLensMapPath(
  lens: LensLinkInput,
  opts: { src: LensLinkSource; sentOn?: string },
): string {
  const strands = String(lens.lensStrategy || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => STRAND_SHAPE.test(s));
  if (!strands.length) return `/opportunity-map?src=${opts.src}`;

  const naics = [...new Set((lens.lensNaics || []).map((c) => String(c).trim()).filter((c) => NAICS_SHAPE.test(c)))];

  // Order is part of the contract the map tests read: strategy, naics, lens_n, lens_on, src.
  const parts = [`strategy=${encodeURIComponent(strands.join(','))}`];
  if (naics.length) parts.push(`naics=${encodeURIComponent(naics.join(','))}`);
  if (typeof lens.lensCount === 'number' && Number.isFinite(lens.lensCount) && lens.lensCount >= 0) {
    parts.push(`lens_n=${Math.trunc(lens.lensCount)}`);
  }
  if (opts.sentOn && DATE_SHAPE.test(opts.sentOn)) parts.push(`lens_on=${opts.sentOn}`);
  parts.push(`src=${opts.src}`);
  return `/opportunity-map?${parts.join('&')}`;
}
