/**
 * WHAT CHANGED SINCE YOUR LAST VISIT — the change-class registry.
 *
 * This file exists to stop a number shipping that Mindy cannot defend. Every candidate
 * class was checked against the live database before it was allowed to render, and the
 * ones that failed are recorded here WITH their evidence so nobody re-derives them.
 *
 * Read `docs/product/return-what-changed.md` for the full audit. The short version,
 * measured on production 2026-09-21:
 *
 * ┌ PROVABLE ───────────────────────────────────────────────────────────────────────┐
 * │ new_in_market   `sam_opportunities.created_at` is a real arrival clock — 17,006  │
 * │                 rows arrived in 14 days, median lag behind SAM's posted_date     │
 * │                 1.04 days, ZERO arrivals backdated more than 2 days in that      │
 * │                 window. naics_code is filled on 15,587 of 16,588 open rows       │
 * │                 (94.0%). Simulated over the 414 real returners: 110 had a        │
 * │                 recoverable market, 70 of them had at least one genuinely new    │
 * │                 opportunity, MEDIAN 7.                                           │
 * │ listing_closed  Needs no history at all. `response_deadline` is a fixed future   │
 * │                 instant; if it lies between your last visit and now then it      │
 * │                 passed while you were gone, and that is arithmetic, not a diff.  │
 * │                 Filled on 1,409 of the 1,415 opened listings we can resolve      │
 * │                 (99.6%). Simulated: 47 returners, 92 listings.                   │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌ NOT SHIPPED — and why (never render a number for these) ─────────────────────────┐
 * │ amendment       `sam_opportunities.last_modified` is NULL on 215,098 of 215,098  │
 * │                 rows. SAM's v2 /search response has no modified field at all     │
 * │                 (see the comment in api/cron/pursuit-changes/route.ts). The only │
 * │                 amendment signal in this codebase is a re-posted `posted_date`   │
 * │                 compared against a PER-ITEM SNAPSHOT, and snapshots exist only   │
 * │                 for `user_pipeline` pursuits — 44 such observations, ever.       │
 * │                 A save is not a pursuit, so a saved listing has no snapshot.     │
 * │ deadline_moved  The detector has existed since 2026-06 and `pursuit_change_log`  │
 * │                 holds ZERO rows of change_type 'deadline' across its whole life  │
 * │                 (3,004 'closed' + 44 'amendment' and nothing else). A mechanism  │
 * │                 with no observations is UNMEASURED, not "0 changes".             │
 * │ forecast_change `agency_forecasts.created_at` is OUR import clock, not the        │
 * │                 agency's: 1,981 rows landed on 2026-09-13 against 17–120 on      │
 * │                 normal days. Rendering that as "1,981 new forecasts" would be a  │
 * │                 batch artifact wearing a market event's clothes. `updated_at`    │
 * │                 moved on 153 of 35,912 rows (0.43%) and records no field, so     │
 * │                 "timing moved" and "a typo was fixed" are indistinguishable.     │
 * │ recompete_moved PROVABLE, deliberately not shipped. `recompete_changes` is a     │
 * │                 real append-only log (38,790 rows; 5,793 period-of-performance   │
 * │                 end changes in 30 days) and the sweep IS complete — all 478      │
 * │                 NAICS attempted within 48h. It is withheld on SCOPE, not truth:  │
 * │                 the recompete horizon is off by default on the map, so this      │
 * │                 would be a fourth number answering a question the returning      │
 * │                 visitor did not ask. Ship it when the horizon is on.             │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * The invariant this file enforces, and `change-classes.unit.test.ts` proves:
 * A class that is not PROVABLE has no place to put a count. `ClassResult` is a
 * discriminated union and only the `measured` arm carries `count`, so rendering a
 * number for an unmeasured class is a TYPE ERROR, not a code-review catch.
 */

/** Every class we have considered. Named so telemetry and docs cannot drift apart. */
export const CHANGE_CLASS_KEYS = [
  'new_in_market',
  'listing_closed',
  'amendment',
  'deadline_moved',
  'forecast_change',
  'recompete_moved',
] as const;
export type ChangeClassKey = (typeof CHANGE_CLASS_KEYS)[number];

/** The classes this feature is allowed to put a number on. */
export const RENDERABLE_CLASSES = ['new_in_market', 'listing_closed'] as const satisfies readonly ChangeClassKey[];
export type RenderableClassKey = (typeof RENDERABLE_CLASSES)[number];

export type WithheldReason = 'unmeasured' | 'out_of_scope';

export interface WithheldClass {
  key: ChangeClassKey;
  reason: WithheldReason;
  /** The live evidence, quoted so a future session does not have to re-measure. */
  evidence: string;
}

/**
 * The frozen record of what we refused to show, and why.
 *
 * This is not documentation-for-documentation's-sake: it is the thing that stops the
 * next session "adding forecasts to the return brief" because it looks thin. Each
 * entry names a measurement, not an opinion.
 */
export const WITHHELD_CLASSES: readonly WithheldClass[] = [
  {
    key: 'amendment',
    reason: 'unmeasured',
    evidence:
      'sam_opportunities.last_modified is NULL on 215,098/215,098 rows — SAM publishes no ' +
      'per-notice modified timestamp. The only amendment signal (a re-posted posted_date vs a ' +
      'per-item snapshot) exists solely for user_pipeline pursuits: 44 observations, ever.',
  },
  {
    key: 'deadline_moved',
    reason: 'unmeasured',
    evidence:
      "pursuit_change_log has recorded 0 rows of change_type 'deadline' since 2026-06-30, " +
      "against 3,004 'closed' and 44 'amendment'. The detector exists; the observation does not.",
  },
  {
    key: 'forecast_change',
    reason: 'unmeasured',
    evidence:
      'agency_forecasts.created_at is our import clock (1,981 rows on 2026-09-13 vs 17–120 on ' +
      'ordinary days), and updated_at moved on 153/35,912 rows (0.43%) without recording which ' +
      'field moved. Neither can separate a market event from a batch import or a typo fix.',
  },
  {
    key: 'recompete_moved',
    reason: 'out_of_scope',
    evidence:
      'PROVABLE — recompete_changes holds 38,790 append-only rows (5,793 period-of-performance ' +
      'end changes in 30d) and all 478 NAICS are swept within 48h, so a multi-day window is ' +
      'complete. Withheld because the recompete horizon is OFF by default on the map; shipping ' +
      'it here would answer a question the returning visitor did not ask.',
  },
] as const;

/** How we know which market this visitor cares about. Ordered most→least authoritative. */
export type ScopeBasis = 'saved_watch' | 'last_filter';

export interface MarketScope {
  basis: ScopeBasis;
  /** The filter payload, in the shape `parseMapFilters` reads. */
  filters: Record<string, unknown>;
  /** Human label for the strip — "NAICS 541512 · Navy". Derived from `filters`, never typed. */
  label: string;
  /** Market-link query string (scope only — never a record id, never a reader fact beyond scope). */
  query: string;
}

export interface ClosedListing {
  noticeId: string;
  title: string | null;
  /** The deadline that passed. Always inside (lastVisitAt, now]. */
  deadline: string;
}

/**
 * A class either has a number, or it has a reason. There is no third arm, and the
 * `measured` arm is the only one with a `count` field — so "unknown rendered as 0"
 * cannot be written without deleting a branch of this union.
 */
export type ClassResult<T = unknown> =
  | { state: 'measured'; count: number; detail: T }
  /** We could not establish a basis (no market scope / no resolvable listing). NOT zero. */
  | { state: 'no_basis'; why: string }
  /** The query itself failed. NOT zero. INT-005: no source ≠ zero. */
  | { state: 'unknown'; why: string };

export interface ReturnBrief {
  isReturn: boolean;
  lastVisitAt: string | null;
  /** "yesterday" / "3 days ago" — coarse by design. */
  gapLabel: string;
  /**
   * The exact sentence the strip renders, built SERVER-SIDE by `summarise()`.
   *
   * The browser does not re-derive it. If the client had its own copy of "which classes
   * count and how they read", the strip and the API could disagree about whether there
   * was anything to say — and the client copy is the one nobody tests. Empty string
   * means render NOTHING.
   */
  line: string;
  newInMarket: ClassResult<{ scope: MarketScope; link: string }>;
  listingClosed: ClassResult<{ listings: ClosedListing[]; resolved: number; unresolved: number }>;
  withheld: readonly WithheldClass[];
  _meta: {
    grounded: boolean;
    identityKind: 'anon' | 'account';
    reason: string;
    /** Provenance strings, one per rendered number. */
    provenance: string[];
  };
}

/** Only `measured` yields a number. Anything else is absent — never 0. */
export function countOf(r: ClassResult): number | null {
  return r.state === 'measured' ? r.count : null;
}

/**
 * The one-line summary the map strip renders.
 *
 * Built from the SAME ClassResult union the API returns, so a class that is not
 * `measured` cannot contribute a clause. A class measured at 0 is also dropped: "0 new
 * opportunities" is true but is not news, and padding the line with zeroes is how a
 * habit surface turns into wallpaper.
 *
 * Returns '' when there is nothing true to say — the caller must render NOTHING in that
 * case, not an empty strip reading "no changes", which would claim a completeness we do
 * not have (59% of returners have no recoverable market at all).
 */
export function summarise(brief: Pick<ReturnBrief, 'newInMarket' | 'listingClosed'>): string {
  const parts: string[] = [];
  const nNew = countOf(brief.newInMarket);
  if (nNew != null && nNew > 0) parts.push(`${nNew.toLocaleString()} new ${nNew === 1 ? 'opportunity' : 'opportunities'}`);
  const nClosed = countOf(brief.listingClosed);
  if (nClosed != null && nClosed > 0) parts.push(`${nClosed} you opened ${nClosed === 1 ? 'has' : 'have'} closed`);
  return parts.join(' · ');
}

/**
 * Build the MARKET link for the new-in-market class.
 *
 * Market link, so scope belongs on it (`docs/engineering/record-links-vs-market-links.md`).
 * It carries the SAME filters the count was computed from — if it carried anything else
 * the destination could disagree with the number that sent the user there.
 */
export function marketLink(scope: MarketScope): string {
  return scope.query ? `/opportunity-map?${scope.query}` : '/opportunity-map';
}

/**
 * Build the RECORD link for one closed listing.
 *
 * `?opp=<notice_id>` and NOTHING else. The frozen rule: a record link carries the
 * record's id and nothing that can exclude it. Adding the visitor's NAICS or state here
 * is precisely the bug that emptied the map from an alert email (PR #1441) — and a
 * closed listing is `active=false` / past-deadline, so even the map's own default status
 * filter would delete it. `?opp=` makes the map's scope-param IIFE early-return, which
 * is the whole point: it removes the wrong writer from this link class.
 */
export function recordLink(noticeId: string): string {
  return `/opportunity-map?opp=${encodeURIComponent(noticeId)}`;
}

/** Human label for a scope — derived from the filters, never asserted separately. */
export function scopeLabel(filters: Record<string, unknown>): string {
  const bits: string[] = [];
  const s = (k: string) => { const v = filters[k]; return typeof v === 'string' ? v.trim() : ''; };
  const q = s('q') || s('search');
  if (q) bits.push(`"${q}"`);
  const naics = s('naics');
  if (naics) {
    const codes = naics.split(',').map((c) => c.trim()).filter(Boolean);
    if (codes.length === 1) bits.push(`NAICS ${codes[0]}`);
    else if (codes.length > 1) bits.push(`${codes.length} NAICS codes`);
  }
  const agency = s('agency') || s('subAgency');
  if (agency) bits.push(agency);
  const state = s('state');
  if (state) bits.push(state.toUpperCase());
  return bits.join(' · ');
}

/**
 * Turn a stored filter payload into a market-link query string.
 *
 * ALLOWLISTED. Only genuine scope keys survive, so a stray key from a telemetry blob
 * (`bbox`, `zoom`, `entry`, `device`) can never end up on a shareable URL, and nothing
 * that describes the READER rather than the market can be smuggled through.
 */
const SCOPE_KEYS = ['naics', 'psc', 'agency', 'subAgency', 'state', 'setAside', 'noticeType', 'q'] as const;

export function scopeQuery(filters: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const k of SCOPE_KEYS) {
    const v = filters[k];
    if (typeof v === 'string' && v.trim()) p.set(k, v.trim());
  }
  const fullOpen = filters.fullOpen;
  if (fullOpen === true || fullOpen === '1' || fullOpen === 'true') p.set('fullOpen', '1');
  return p.toString();
}

/** True when a filter payload names a market at all. An empty payload is NOT a market. */
export function hasScope(filters: Record<string, unknown> | null | undefined): boolean {
  if (!filters) return false;
  return scopeQuery(filters).length > 0;
}
