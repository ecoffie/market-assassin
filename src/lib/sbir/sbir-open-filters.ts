/**
 * Which Open-map filters can an SBIR/STTR topic NEVER satisfy?
 *
 * SBIR topics are folded into the Open horizon (`?sources=sam,sbir`), but the topic record carries no
 * set-aside code (`set: 'None'`), no NAICS (`naics: ''`), no PSC, and its notice type is the program
 * (SBIR/STTR) — see `sbir-map-pins.ts`. Before this guard the route merged every in-view topic into
 * the pins AND the headline count regardless of those filters, so "SDVOSB + NAICS 561210" showed
 * ~25 unrelated SBIR topics ("Set-aside: Not stated", blank NAICS) counted as matches. The count
 * and the pins then disagreed with what the customer asked for.
 *
 * A filter listed here is one the topic provably fails (the field is absent on every topic), so
 * dropping the layer is exact — it is not an unknown being turned into a zero.
 */
export type SbirExcludingFilter = 'setAside' | 'fullOpen' | 'naics' | 'psc' | 'noticeType' | 'profile';

export function sbirExcludingFilters(
  get: (k: string) => string | null | undefined,
  opts?: { profileNaics?: string[] },
): SbirExcludingFilter[] {
  const has = (k: string) => String(get(k) ?? '').split(',').some((v) => v.trim() !== '');
  const out: SbirExcludingFilter[] = [];
  if (has('setAside')) out.push('setAside');
  const fo = String(get('fullOpen') ?? '').trim();
  if (fo === '1' || fo === 'true') out.push('fullOpen'); // "Full & Open" — SBIR is small-business only by statute
  if (has('naics')) out.push('naics');
  if (has('psc')) out.push('psc');
  // A notice-type filter excludes SBIR unless it explicitly asks for the SBIR/STTR program types.
  const nt = String(get('noticeType') ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (nt.length && !nt.some((v) => v === 'sbir' || v === 'sttr')) out.push('noticeType');
  // "My profile" scope narrows Open to the RESOLVED profile NAICS — a topic with no NAICS cannot
  // match. Only when a profile actually resolved codes (a signed-out scope=profile narrows nothing).
  if (String(get('scope') ?? '').trim().toLowerCase() === 'profile' && (opts?.profileNaics?.length ?? 0) > 0) out.push('profile');
  return out;
}
