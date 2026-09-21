/**
 * RETENTION COHORT TRUTH — does a saver come back more often than a browser?
 *
 * Workstream E of the "returning is the conversion" batch. The batch is judged on RETURNING USERS,
 * not on pursuits/proposals/awards, so this file is the measurement that decides whether the batch
 * worked. It is a PURE library: no I/O, no Supabase, no `fetch`. The caller loads rows; this file
 * does the arithmetic and is unit-testable without a database.
 *
 * ┌─ WHY THIS EXISTS AS CODE AND NOT AS A DASHBOARD ────────────────────────────────────────────┐
 * │ "A number is a product feature" (docs/engineering/a-number-is-a-product-feature.md). The     │
 * │ three traps below are ARITHMETIC traps, not rendering traps — a dashboard would render them  │
 * │ just as confidently. So the defence lives in the arithmetic, with tests that fail when the   │
 * │ arithmetic drifts. The read side is a repeatable script (scripts/retention-cohorts.ts),      │
 * │ not a new admin page.                                                                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ── TRAP 1: REVERSE CAUSALITY (the one that makes savers look 4x better than they are) ──
 * "Users who saved a listing return more" is CIRCULAR if saves are counted over a user's LIFETIME:
 * a user who returned 9 times had 9 chances to save, so returning CAUSES the save, not the other
 * way round. Measured on this corpus 2026-09-21, the two framings disagree by 2.5x:
 *     lifetime listing-opens  → no opens D7 7.5% · 1-2 D7 18.9% · 3+ D7 32.1%   (4.3x — CIRCULAR)
 *     day-0-only opens        → no opens D7 9.2% · 1-2 D7 12.7% · 3+ D7 15.5%   (1.7x — honest)
 * So EVERY cohort here is assigned from DAY-0 BEHAVIOUR ONLY — what the user did on the calendar
 * day they first appeared — and retention is measured strictly AFTER day 0. `classifyDay0` refuses
 * to look at an event outside day 0; `assignCohorts` is tested to produce the same cohort for a
 * user whether or not their later events are present.
 *
 * ── TRAP 2: NO OPPORTUNITY TO RETURN ≠ CHURN ──
 * A user who first appeared 2 hours ago has not FAILED to come back for 7 days; they have not had
 * the CHANCE. Including them in a D7 denominator measures how recently we acquired people and
 * prints the result as "habit". Each DN here has its OWN denominator: only users whose first-seen
 * is at least N full days old. Everyone younger is reported as `notYetEligible`, NEVER folded into
 * the denominator and never counted as a non-returner.
 *
 * ── TRAP 3: COMPOSITION (the fake 82% D30) ──
 * A blended D30 of 82% next to a blended D1 of 6.7% is not a retention curve that goes UP; it is
 * two different populations. Only long-tenured daily-email subscribers are old enough to be in the
 * D30 denominator, while the D1 denominator is dominated by last week's anonymous Map traffic. The
 * numbers are each individually correct and the comparison between them is meaningless.
 * Defence: every user carries an `acquisitionSurface` derived from day 0, every DN is reported
 * PER SEGMENT, and `compositionDrift` compares each DN denominator's segment mix against D1's.
 * When the mix moves more than COMPOSITION_DRIFT_LIMIT, that DN is stamped `comparableToD1:false`
 * and the caller must not draw a curve through it.
 *
 * ── KNOWN LIMITS OF THE IDENTITY ITSELF (verified against the emitters 2026-09-21) ──
 * These are not defects in the arithmetic; they are ceilings on what the arithmetic can mean, and
 * the reader prints them beside every number so no one reads past them:
 *   1. `anon:<uuid>` lives in **localStorage**, not a cookie and not a server-set id. It is stable
 *      per browser profile, and NOT stable across devices, browsers, or private windows.
 *   2. Safari evicts script-writable storage after ~7 days of no interaction, so anonymous D7 and
 *      D30 are STRUCTURALLY UNDER-COUNTED on Safari — a returning Safari visitor comes back as a
 *      brand-new user. Anonymous retention is therefore a FLOOR, never a point estimate.
 *   3. `user_engagement` is NEVER reconciled anon -> email (no UPDATE of that table exists
 *      anywhere in the repo). A visitor who saves anonymously and then signs up appears here as
 *      TWO users, and the signup reads as churn for the first and acquisition for the second.
 *      `anonymous_shortlist` keeps both ids (`owner_anon_id` + `claimed_by`) and is the only
 *      durable join key; `claimAnonWatch` OVERWRITES `user_email`, so a claimed watch leaves no
 *      link behind at all.
 *   4. All four save/watch events are browser-emitted and best-effort (ad-blockers, closed tabs),
 *      so `anonymous_shortlist` row counts will exceed `shortlist_saved` event counts. When the
 *      two disagree, the TABLE is the truth and the event stream is the floor.
 *
 * ── DENOMINATOR RULE ──
 * No rate is ever returned without the denominator that produced it. A rate over an empty
 * denominator is `null` ("unmeasured"), NEVER 0 — `count ?? 0` is data fabrication
 * (Bug Prevention Rule #11), and so is `rate ?? 0`. A cohort below MIN_REPORTABLE_COHORT returns
 * its counts but `rate: null` and `reportable: false`: a 2-of-3 cohort is not "67% retention".
 */

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

/** One telemetry row, already narrowed to the columns the arithmetic needs. */
export interface RetentionEvent {
  /** `user_engagement.user_email`. Holds `anon:<uuid>` for anonymous visitors. */
  user: string;
  /** ms epoch of `created_at`. */
  ts: number;
  /** `event_source` (e.g. 'opportunity_map', 'daily_alert'). */
  source: string | null;
  /** `event_type` (e.g. 'tool_use', 'page_view', 'email_open'). */
  type: string | null;
  /** `metadata->>'action'` — the map's real event name. Null on email rows. */
  action: string | null;
  /**
   * `metadata->>'notice_id'` when present.
   *
   * Browsing DEPTH means distinct listings, not clicks: 6,947 `listing_open` events over 30 days
   * resolve to 4,688 distinct user×notice pairs, so ~32% are re-opens of something already seen.
   * Re-reading one listing three times is not a heavy browser. When this is absent the event is
   * counted as its own listing (one open), which is the conservative reading.
   */
  listingId?: string | null;
}

/**
 * TRUE all-history first-seen per user, in ms epoch.
 *
 * This MUST come from a query over the whole table, not from the loaded window. If first-seen is
 * derived from a 30-day window, every user who predates the window gets a fabricated first-seen
 * pinned to the window edge, their day 0 is wrong, and their day-0 cohort is really "whatever they
 * happened to do on the day the window opened". A user missing from this map is LEFT-CENSORED:
 * their true first-seen is unknown, and unknown is excluded, never guessed.
 */
export type FirstSeenMap = Record<string, number>;

// ─────────────────────────────────────────────────────────────────────────────
// Event vocabulary — the tokens that define each behaviour
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A SAVE: the user kept something. This is the behaviour the whole batch is betting on.
 *
 * ⚠️ These spellings are load-bearing. A save that lands under an action name missing from this
 * set is invisible here, and the cohort silently reads as "no savers" — which is exactly what an
 * unshipped feature looks like too. The two must never be confusable, so the reader script runs
 * `findUnmappedBehaviourTokens()` against live data and FAILS LOUDLY on any save-ish/watch-ish
 * action token that is not listed here. Add the token here; do not widen the matcher.
 */
export const SAVE_ACTIONS: ReadonlySet<string> = new Set([
  // Verified against the emitters 2026-09-21. Every token below is one that a browser actually
  // sends today — no speculative spellings, because an invented token can never fire and would
  // quietly pad this set with the appearance of coverage.
  'shortlist_saved',   // opportunity_map / tool_use — anonymous shortlist (W2, PR #1601)
  'save_to_pipeline',  // source_feed / tool_use — pre-existing identified-user save
]);

/** A WATCH: the user asked to be told when this market changes. */
export const WATCH_ACTIONS: ReadonlySet<string> = new Set([
  'watch_created',     // opportunity_map / tool_use — anonymous market watch (W1, PR #1600)
]);

/**
 * CLAIM tokens — deliberately NOT saves.
 *
 * `shortlist_attached` and `watch_claimed` fire when a user signs in and adopts things they had
 * already saved anonymously. Counting them as saves would double-count one decision and, worse,
 * would attribute it to the WRONG identity: the claim fires after sign-in, so the row carries the
 * real email while the save that earned it sits under `anon:<uuid>`. That would manufacture a
 * day-0 "saver" out of a user whose day 0 contained no save at all.
 */
export const CLAIM_ACTIONS: ReadonlySet<string> = new Set(['shortlist_attached', 'watch_claimed']);

/**
 * A LISTING OPEN: the browsing-depth unit. Map and app-panel spellings.
 *
 * ⚠️ `listing_view` is deliberately ABSENT. Measured over 30 days: 6,947 `listing_open` against
 * 5,488 `listing_view` (0.84 views per open) with only 9 user-days showing a view and no open —
 * it is the page_view that trails the open, not a second open. Counting both inflated day-0 depth
 * by ~80% and pushed users over the 3+ "heavy" line for opening two listings.
 */
export const LISTING_OPEN_ACTIONS: ReadonlySet<string> = new Set([
  'listing_open',
  'open_details',
]);

/**
 * Save-ish-LOOKING tokens that are acknowledged NOT to be saves.
 *
 * The drift guard is a hard failure by design, so it is only useful if it stays quiet about things
 * we have already judged. Each entry here is a decision, not a suppression:
 *   `saved_removed`     — an UN-save. Counting it as a save would let a user who saved then
 *                         immediately removed the listing register as two saves.
 *   `use_saved_profile` — the Forecasts panel reusing a stored search profile. Unrelated feature.
 *   `save_profile`      — the onboarding wizard writing profile settings. Not a listing save.
 *   `save_contact` / `partner_finder_save` — CRM/partner bookmarks, a different object entirely.
 */
export const ACKNOWLEDGED_NON_SAVE_ACTIONS: ReadonlySet<string> = new Set([
  'saved_removed', 'use_saved_profile', 'save_profile', 'save_contact', 'partner_finder_save',
]);

/**
 * Passive signals that are NOT evidence of a return visit.
 *
 * An email open is an image-pixel fetch: it fires from a preview pane, from a prefetcher, and from
 * a mail client the person never looked at. Counting it as "came back" inflates retention for the
 * email-subscriber segment specifically — the very segment that already dominates the D30
 * denominator — so it would deepen Trap 3 rather than measure habit. A `link_click` from the same
 * email IS an active return and IS counted.
 */
export const PASSIVE_EVENT_TYPES: ReadonlySet<string> = new Set(['email_open']);

/** Sources that mean "arrived from an email we sent", for acquisition segmentation. */
const EMAIL_SOURCES: ReadonlySet<string> = new Set([
  'daily_alert', 'daily_alerts', 'weekly_alert', 'weekly_alerts',
  'daily_briefing', 'weekly_deep_dive', 'pursuit_brief',
]);

/** Sources that mean "arrived on the public Map / feed surface". */
const MAP_SOURCES: ReadonlySet<string> = new Set([
  'opportunity_map', 'source_feed', 'todays_intel', 'targeting_card', 'welcome',
]);

/** How a user first reached us — the segment that keeps Trap 3 visible. */
export type AcquisitionSurface = 'map' | 'email' | 'app';

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds — every one of these is a stated policy, not a magic number
// ─────────────────────────────────────────────────────────────────────────────

/** 3+ listing opens on day 0 = "heavy browser"; 1-2 = "light"; 0 = "none". */
export const HEAVY_BROWSER_MIN_OPENS = 3;

/**
 * Below this, a cohort gets counts but NO rate.
 *
 * 30 is a floor against nonsense ("2 of 3 savers came back = 67%!"), not a power calculation.
 * The power calculation is separate and much larger — see `minimumDetectableCohort()`.
 */
export const MIN_REPORTABLE_COHORT = 30;

/**
 * Segment-mix drift, in percentage points, past which a DN is not comparable to D1.
 *
 * On this corpus the D30 denominator is ~0% map / ~100% email while D1 is the reverse — a drift
 * near 100pp. 20pp is tight enough to catch that long before it reaches 100.
 */
export const COMPOSITION_DRIFT_LIMIT = 20;

const DAY_MS = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────
// Day-0 profile
// ─────────────────────────────────────────────────────────────────────────────

/** UTC calendar day key for a ms epoch. Retention days are UTC days, consistently. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** What a user did on day 0, plus the active days they had afterwards. */
export interface UserProfile {
  user: string;
  /** TRUE all-history first-seen (ms). */
  firstSeenMs: number;
  /** UTC day of `firstSeenMs`. Day-0 counters below advance only for events on THIS day. */
  day0: string;
  /** Day-0 counts ONLY — the reverse-causality firewall. */
  day0Saves: number;
  day0Watches: number;
  /** DISTINCT listings opened on day 0 — the browsing-depth unit that decides heavy vs light. */
  day0ListingOpens: number;
  /** Raw day-0 open EVENTS, including re-opens. Reported for transparency, never for classification. */
  day0ListingOpenEvents: number;
  /** Where they arrived — decided by their earliest day-0 event's source. */
  acquisitionSurface: AcquisitionSurface;
  /** Every distinct UTC day with an ACTIVE event, including day 0. */
  activeDays: Set<string>;
  /** Active days strictly after day 0 — the return evidence. */
  returnDays: string[];
  /** True when this user is anonymous (`anon:` prefix). */
  anonymous: boolean;
}

function surfaceOf(source: string | null): AcquisitionSurface {
  if (source && EMAIL_SOURCES.has(source)) return 'email';
  if (source && MAP_SOURCES.has(source)) return 'map';
  return 'app';
}

/** An event counts as ACTIVE (evidence of a real visit) unless its type is passive. */
export function isActiveEvent(e: RetentionEvent): boolean {
  return !(e.type != null && PASSIVE_EVENT_TYPES.has(e.type));
}

/**
 * Build per-user profiles from raw events + a TRUE all-history first-seen map.
 *
 * Users absent from `firstSeen` are LEFT-CENSORED and returned in `leftCensored` rather than
 * profiled: we cannot place their day 0, so every cohort and every DN for them would be fiction.
 * Excluding them is the honest move, and surfacing the count is what stops the exclusion from
 * being silent.
 */
export function buildProfiles(
  events: readonly RetentionEvent[],
  firstSeen: FirstSeenMap,
): { profiles: Map<string, UserProfile>; leftCensored: string[] } {
  const profiles = new Map<string, UserProfile>();
  const censored = new Set<string>();
  // The event that decides acquisition surface: the earliest ACTIVE day-0 event seen so far.
  const surfaceTs = new Map<string, number>();
  // Distinct listings opened on day 0, per user — so a re-open cannot inflate browsing depth.
  const day0Listings = new Map<string, Set<string>>();

  for (const e of events) {
    if (!e.user) continue;
    const fs = firstSeen[e.user];
    if (fs == null) { censored.add(e.user); continue; }
    if (!isActiveEvent(e)) continue;

    const day0 = dayKey(fs);
    let p = profiles.get(e.user);
    if (!p) {
      p = {
        user: e.user,
        firstSeenMs: fs,
        day0,
        day0Saves: 0,
        day0Watches: 0,
        day0ListingOpens: 0,
        day0ListingOpenEvents: 0,
        acquisitionSurface: surfaceOf(e.source),
        activeDays: new Set<string>(),
        returnDays: [],
        anonymous: e.user.startsWith('anon:'),
      };
      profiles.set(e.user, p);
      surfaceTs.set(e.user, Number.POSITIVE_INFINITY);
      day0Listings.set(e.user, new Set<string>());
    }

    const d = dayKey(e.ts);
    p.activeDays.add(d);

    // ── THE FIREWALL: day-0 counters advance ONLY for events on day 0. ──
    // Without this guard a user's 40th-day save would classify them as a day-0 saver and the
    // "savers return more" claim would be measuring the return, not the save.
    if (d === p.day0) {
      const a = e.action;
      if (a && SAVE_ACTIONS.has(a)) p.day0Saves += 1;
      if (a && WATCH_ACTIONS.has(a)) p.day0Watches += 1;
      if (a && LISTING_OPEN_ACTIONS.has(a)) {
        p.day0ListingOpenEvents += 1;
        // A missing notice_id falls back to a key unique to this event, so an untagged open still
        // counts as exactly one listing — never zero (that would erase a real open) and never a
        // shared bucket (that would collapse several real listings into one).
        day0Listings.get(e.user)!.add(e.listingId || `evt:${e.ts}:${p.day0ListingOpenEvents}`);
      }
      const best = surfaceTs.get(e.user)!;
      if (e.ts < best) { surfaceTs.set(e.user, e.ts); p.acquisitionSurface = surfaceOf(e.source); }
    }
  }

  for (const p of profiles.values()) {
    p.returnDays = [...p.activeDays].filter((d) => d > p.day0).sort();
    p.day0ListingOpens = day0Listings.get(p.user)!.size;
  }
  return { profiles, leftCensored: [...censored].sort() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cohorts — assigned from DAY 0 ONLY
// ─────────────────────────────────────────────────────────────────────────────

export type CohortKey =
  | 'saver' | 'opened_no_save'
  | 'watcher' | 'no_watch'
  | 'heavy_browser' | 'light_browser' | 'no_browse';

/** The three required comparisons, each a pair of mutually exclusive arms. */
export const COHORT_PAIRS: { id: string; label: string; arms: [CohortKey, CohortKey] }[] = [
  { id: 'save',  label: 'Saved a listing vs opened listings but saved none', arms: ['saver', 'opened_no_save'] },
  { id: 'watch', label: 'Created a watch vs created none',                    arms: ['watcher', 'no_watch'] },
  { id: 'depth', label: 'Heavy browser (3+ opens) vs light browser (1-2)',   arms: ['heavy_browser', 'light_browser'] },
];

/**
 * Day-0 cohort membership for one user.
 *
 * Note `opened_no_save` REQUIRES at least one day-0 listing open: the comparison the batch needs
 * is saver vs someone who had the same chance to save and didn't. A user who never opened a
 * listing never saw a save button, so putting them in the control arm would compare "saved" against
 * "never reached the feature" and credit the save with the whole difference in intent.
 */
export function classifyDay0(p: UserProfile): Set<CohortKey> {
  const c = new Set<CohortKey>();
  if (p.day0Saves > 0) c.add('saver');
  else if (p.day0ListingOpens > 0) c.add('opened_no_save');

  if (p.day0Watches > 0) c.add('watcher'); else c.add('no_watch');

  if (p.day0ListingOpens >= HEAVY_BROWSER_MIN_OPENS) c.add('heavy_browser');
  else if (p.day0ListingOpens > 0) c.add('light_browser');
  else c.add('no_browse');

  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention
// ─────────────────────────────────────────────────────────────────────────────

export interface RetentionCell {
  /** Cumulative horizon: returned at least once within N days AFTER day 0. */
  n: number;
  /** Users whose first-seen is old enough that the whole [day0+1, day0+N] window has elapsed. */
  denominator: number;
  /** Of the denominator, how many were active on a later day inside the window. */
  returned: number;
  /** returned/denominator as a percentage — `null` when unmeasurable. NEVER 0 for "unknown". */
  rate: number | null;
  /** Users excluded from `denominator` purely because they are too young. Not churn. */
  notYetEligible: number;
  /** False when denominator < MIN_REPORTABLE_COHORT: counts are real, the rate is not meaningful. */
  reportable: boolean;
  /** Segment mix of the DENOMINATOR, as percentages. The raw material for Trap 3. */
  mix: Record<AcquisitionSurface, number>;
}

/**
 * DN for one set of users. Cumulative ("came back at least once by day N"), which is why the
 * curve rises with N — each DN is a strict superset window of the one before it, measured over a
 * DIFFERENT (older) denominator.
 */
export function retentionAt(
  users: readonly UserProfile[],
  n: number,
  nowMs: number,
): RetentionCell {
  const cutoff = nowMs - n * DAY_MS;
  const eligible: UserProfile[] = [];
  let notYetEligible = 0;
  for (const p of users) {
    if (p.firstSeenMs <= cutoff) eligible.push(p);
    else notYetEligible += 1;
  }

  const windowEnd = (p: UserProfile) => dayKey(p.firstSeenMs + n * DAY_MS);
  const returned = eligible.filter((p) => {
    const end = windowEnd(p);
    return p.returnDays.some((d) => d <= end);
  }).length;

  const denominator = eligible.length;
  const reportable = denominator >= MIN_REPORTABLE_COHORT;
  const mix: Record<AcquisitionSurface, number> = { map: 0, email: 0, app: 0 };
  if (denominator > 0) {
    const counts: Record<AcquisitionSurface, number> = { map: 0, email: 0, app: 0 };
    for (const p of eligible) counts[p.acquisitionSurface] += 1;
    for (const k of ['map', 'email', 'app'] as AcquisitionSurface[]) {
      mix[k] = Math.round((counts[k] / denominator) * 1000) / 10;
    }
  }

  return {
    n,
    denominator,
    returned,
    // Two separate reasons for null, both meaning "we do not know": nobody is old enough, or the
    // cohort is too small for a percentage to mean anything. Neither is 0%.
    rate: denominator > 0 && reportable ? Math.round((returned / denominator) * 1000) / 10 : null,
    notYetEligible,
    reportable,
    mix,
  };
}

/**
 * Compare each DN's denominator mix against D1's.
 *
 * Returns, per horizon, the largest per-segment percentage-point gap and whether that DN may be
 * read on the same axis as D1. This is the mechanical form of "the 82% D30 is a composition
 * artifact": nothing about 82% is arithmetically wrong, it is simply a different population, and
 * a drift number is how that stops being a footnote somebody forgets.
 */
export function compositionDrift(cells: readonly RetentionCell[]): Map<number, { driftPp: number | null; comparableToD1: boolean }> {
  const out = new Map<number, { driftPp: number | null; comparableToD1: boolean }>();
  const base = cells.find((c) => c.n === 1);
  for (const c of cells) {
    if (!base || base.denominator === 0 || c.denominator === 0) {
      out.set(c.n, { driftPp: null, comparableToD1: false });
      continue;
    }
    let worst = 0;
    for (const k of ['map', 'email', 'app'] as AcquisitionSurface[]) {
      worst = Math.max(worst, Math.abs(c.mix[k] - base.mix[k]));
    }
    const driftPp = Math.round(worst * 10) / 10;
    out.set(c.n, { driftPp, comparableToD1: driftPp <= COMPOSITION_DRIFT_LIMIT });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity shape (the non-retention half of "do they come back more often")
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityShape {
  users: number;
  /** Median distinct active days per user. `null` when there are no users. */
  medianActiveDays: number | null;
  /** Users with >= 2 distinct active days, and that as a share of `users`. */
  multiDayUsers: number;
  multiDayRate: number | null;
  /** Users active on >= 50% of the days since their first-seen ("near-daily"). */
  nearDailyUsers: number;
  nearDailyRate: number | null;
  /** Users whose ONLY activity was day 0. The single biggest population on this corpus. */
  oneDayOnlyUsers: number;
}

export function activityShape(users: readonly UserProfile[], nowMs: number): ActivityShape {
  const n = users.length;
  if (n === 0) {
    return {
      users: 0, medianActiveDays: null, multiDayUsers: 0, multiDayRate: null,
      nearDailyUsers: 0, nearDailyRate: null, oneDayOnlyUsers: 0,
    };
  }
  const counts = users.map((p) => p.activeDays.size).sort((a, b) => a - b);
  const mid = Math.floor(counts.length / 2);
  const median = counts.length % 2 ? counts[mid] : (counts[mid - 1] + counts[mid]) / 2;

  const multiDay = users.filter((p) => p.activeDays.size >= 2).length;
  const oneDay = users.filter((p) => p.activeDays.size === 1).length;
  const nearDaily = users.filter((p) => {
    // Tenure in whole days, floored at 1 so a same-day user is 1 day of opportunity, not 0
    // (dividing by 0 would make every brand-new user "near-daily" at Infinity).
    const tenureDays = Math.max(1, Math.floor((nowMs - p.firstSeenMs) / DAY_MS) + 1);
    return p.activeDays.size / tenureDays >= 0.5;
  }).length;

  return {
    users: n,
    medianActiveDays: median,
    multiDayUsers: multiDay,
    multiDayRate: Math.round((multiDay / n) * 1000) / 10,
    nearDailyUsers: nearDaily,
    nearDailyRate: Math.round((nearDaily / n) * 1000) / 10,
    oneDayOnlyUsers: oneDay,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistical floor — "how many savers before the answer means anything"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Users PER ARM needed to detect a lift from `baselineRate` to `targetRate`
 * (two-proportion z-test, two-sided alpha=0.05, power=0.80).
 *
 * This is the number that answers "when can we report the saver result?". The MIN_REPORTABLE_COHORT
 * floor of 30 only stops obvious nonsense; it does NOT make a 30-user result trustworthy. Reporting
 * "savers retain better" off a handful of users is the same class of error as the capped
 * user_breakdown count — plausible enough to change a decision, and wrong.
 */
export function minimumDetectableCohort(baselineRate: number, targetRate: number): number {
  const p1 = baselineRate, p2 = targetRate;
  const delta = Math.abs(p2 - p1);
  if (delta === 0) return Number.POSITIVE_INFINITY;
  const zA = 1.959963985, zB = 0.841621234;
  const pBar = (p1 + p2) / 2;
  const a = zA * Math.sqrt(2 * pBar * (1 - pBar));
  const b = zB * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil(((a + b) ** 2) / (delta ** 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Token drift guard
// ─────────────────────────────────────────────────────────────────────────────

/** Actions that LOOK like a save/watch but are not in our vocabulary — a spelling-drift alarm. */
export function findUnmappedBehaviourTokens(actions: readonly string[]): string[] {
  const known = new Set([
    ...SAVE_ACTIONS, ...WATCH_ACTIONS, ...LISTING_OPEN_ACTIONS, ...CLAIM_ACTIONS,
    ...ACKNOWLEDGED_NON_SAVE_ACTIONS,
  ]);
  // Deliberately NOT used to widen matching — only to shout. A save landing under an unknown
  // spelling and an unshipped save feature both look like "0 savers"; this is what tells them
  // apart, and it must stay a hard failure in the reader rather than a console warning.
  const suspicious = /(save|saved|shortlist|watch|bookmark|keep|follow|pin_save)/i;
  const out = new Set<string>();
  for (const a of actions) {
    if (!a || known.has(a)) continue;
    if (suspicious.test(a)) out.add(a);
  }
  return [...out].sort();
}
