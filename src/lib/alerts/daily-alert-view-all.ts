/**
 * The daily alert's "see the rest" link — the one shown when more contracts matched than the
 * email has rows for.
 *
 * It used to be `View all N matching contracts → /app?panel=alerts`. `/app` is a retired
 * surface: sendEmail()'s legacy-destination guard (src/lib/email/legacy-destination-guard.ts)
 * flagged it on every such send (prod 2026-11-22: 305 in 12h on /api/cron/daily-alerts).
 *
 * The Map-native destination is the Open horizon of the Opportunity Map scoped to the reader's
 * alert NAICS codes — the market the alert itself is built from. That is a MARKET link
 * (docs/engineering/record-links-vs-market-links.md): it carries only the alert's own NAICS and
 * the horizon. Never the reader's state — `?naics=&state=` is the 5,416 → 0 incident
 * (opportunity-map/route.ts), because pop_state is sparse.
 *
 * POPULATION CONTRACT (population-contract.ts): the Map destination is every open contract in
 * those NAICS codes, not the N rows the alert ranked (which also used keywords, agencies and
 * scoring). So the copy names the two populations SEPARATELY — "N more aren't shown here" is a
 * fact about this email; the link says what the Map shows — and never claims "all N" or "new".
 */

export const DAILY_ALERT_MAP_PATH = '/opportunity-map';

/** Canonical NAICS codes only (2–6 digits), de-duplicated, in the order given. */
export function canonicalNaics(codes: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of codes ?? []) {
    const c = String(raw ?? '').trim();
    if (/^[0-9]{2,6}$/.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

export interface DailyAlertViewAllCta {
  /** Absolute Map URL (un-tracked; the caller wraps it in trackedUrl). */
  href: string;
  /** Plain-text fact about THIS email, e.g. "12 more matches aren't shown here." */
  remainder: string;
  /** Link text describing the destination. Never a count, never "new". */
  label: string;
}

export function dailyAlertViewAllCta(input: {
  siteUrl: string;
  naicsCodes: readonly unknown[] | null | undefined;
  /** Rows that matched but did not fit in the email. */
  moreCount: number;
}): DailyAlertViewAllCta {
  const naics = canonicalNaics(input.naicsCodes);
  const p = new URLSearchParams();
  if (naics.length) p.set('naics', naics.join(','));
  p.set('horizon', 'open');
  // The map reads comma-joined NAICS verbatim; keep the commas readable.
  const qs = p.toString().split('%2C').join(',');
  const href = `${input.siteUrl.replace(/\/+$/, '')}${DAILY_ALERT_MAP_PATH}?${qs}`;

  const n = Math.max(0, Math.floor(input.moreCount));
  const remainder = `${n.toLocaleString('en-US')} more ${n === 1 ? "match isn't" : "matches aren't"} shown here.`;
  const label = naics.length
    ? 'See open contracts in your NAICS codes on the Map'
    : 'See open contracts on the Map';
  return { href, remainder, label };
}
