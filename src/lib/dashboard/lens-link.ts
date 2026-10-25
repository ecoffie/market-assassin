/**
 * The ONE link from a Today's Lens count to the Map.
 *
 * A CTA COUNT AND ITS DESTINATION MUST DESCRIBE THE SAME POPULATION. `lensCount` is counted over
 * the reader's profile NAICS AND the lens strands (computeTodaysLens). The link used to carry only
 * `?strategy=`, so the Map applied the strands to the WHOLE corpus: "Explore 13 recommended" opened
 * 137 (Joseph Boyd, 2026-10-25). The link now carries the exact codes the count used.
 *
 * Not a record link: the lens is a market, so scope params belong on it. The Map applies
 * `?naics=` + `?strategy=` through ONE writer (the scope-link handler in opportunity-map/route.ts);
 * the lens handler only shows its pill when a scope is present.
 */
export function lensMapHref(
  lens: { lensStrategy: string; lensNaics?: readonly string[]; lensCount?: number | null },
  opts: { base?: string; src?: string } = {},
): string {
  const base = opts.base || '';
  if (!lens.lensStrategy) return `${base}/opportunity-map`;
  const codes = (lens.lensNaics || []).map((c) => String(c).trim()).filter((c) => /^[0-9]{2,6}$/.test(c));
  // The strands ride along only when the lens has rows. lensCount 0 (strands present, none on the
  // same notice) or null (count failed) → the CTA says "Explore this market", so the link is the
  // market (the codes) — never an empty strand slice, and never the strands over the whole corpus.
  const withStrands = lens.lensCount === undefined || (typeof lens.lensCount === 'number' && lens.lensCount > 0);
  const qs: string[] = [];
  if (withStrands) qs.push(`strategy=${encodeURIComponent(lens.lensStrategy)}`);
  if (codes.length) qs.push(`naics=${encodeURIComponent(codes.join(','))}`);
  if (!qs.length) return `${base}/opportunity-map`;
  if (opts.src) qs.push(`src=${encodeURIComponent(opts.src)}`);
  return `${base}/opportunity-map?${qs.join('&')}`;
}
