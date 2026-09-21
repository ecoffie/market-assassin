/**
 * "Since your last visit" — deriving the visit boundary from data we ALREADY hold.
 *
 * RETURNING IS THE CONVERSION. 8,096 of 9,315 monthly users visit one day and never
 * come back; the 414 who DO return to the Opportunity Map are shown exactly what they
 * were shown last time, with no way to tell what moved. Answering "what changed while
 * you were gone" needs one thing before any change class: a defensible *last visit*.
 *
 * It is derived, never stored. `user_engagement` already records every map event with a
 * timestamp and a stable identity (`anon:<uuid>` for the 96% who are not signed in, the
 * account email otherwise). That is enough — no new identity system, no new table, no
 * new cookie.
 *
 * ── THE SESSION RULE ───────────────────────────────────────────────────────────────
 * A *visit* is a maximal run of that identity's events separated by less than
 * SESSION_GAP_MS. "Last visit" is the END of the run immediately before the current
 * one. Sessionising is not optional: `max(created_at)` alone answers "a few seconds
 * ago" for anyone mid-session, which would make every window empty and every class
 * read a confident, wrong ZERO.
 *
 * ── WHY THERE IS A FLOOR ───────────────────────────────────────────────────────────
 * A 20-minute coffee break is not a visit you can have missed something during. Below
 * MIN_RETURN_GAP_MS we report NOT a return rather than a return with nothing in it —
 * "unknown is not zero" applies to the WINDOW as much as to the counts inside it.
 * Measured on production (30 days, map events, 30-minute sessionisation): 414 identities
 * returned at all; 258 of them after more than 12 hours; 217 after more than a day.
 *
 * Pure: every function here takes rows and a clock and returns a value. No I/O, no
 * Supabase, no Date.now() — so the boundary logic is testable without a database.
 */

/** Two events more than this far apart belong to different visits. */
export const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

/**
 * The shortest gap we are willing to call "your last visit".
 *
 * Six hours, not thirty minutes: the phrase promises that time passed and the market
 * had a chance to move. A step away for lunch did not clear that bar, and saying
 * "nothing changed since your last visit" about a 40-minute gap is technically true
 * and useless — worse, it teaches the user the line is noise.
 */
export const MIN_RETURN_GAP_MS = 6 * 60 * 60 * 1000; // 6 hours

/** The minimum an event row must carry for this module. */
export interface VisitEvent {
  /** ISO-8601 timestamp of the event. */
  created_at: string;
}

export interface VisitWindow {
  /** True only when a PREVIOUS visit exists and the gap cleared MIN_RETURN_GAP_MS. */
  isReturn: boolean;
  /** End of the previous visit — the lower bound of "since". Null when not a return. */
  lastVisitAt: string | null;
  /** Start of the CURRENT visit — the upper bound of "since". Null when not a return. */
  returnStartedAt: string | null;
  /** Milliseconds between the two. Null when not a return. */
  gapMs: number | null;
  /**
   * Why this is not a return, when it is not. Rendered nowhere; carried so an
   * operator reading `_meta` can tell "no history" from "too soon" from "no events" —
   * three different situations that all produce an empty strip.
   */
  reason: 'return' | 'no_events' | 'first_visit' | 'gap_too_short';
}

const NOT_A_RETURN = (reason: VisitWindow['reason']): VisitWindow => ({
  isReturn: false, lastVisitAt: null, returnStartedAt: null, gapMs: null, reason,
});

/**
 * Group an identity's events into visits, oldest first.
 *
 * Rows may arrive in any order (a PostgREST `order` is a request, not a guarantee once
 * a caller merges pages), so this sorts rather than trusting the caller. An unparseable
 * timestamp is DROPPED rather than coerced to epoch 0 — a bad row must not invent an
 * ancient "last visit" that makes the whole corpus look new.
 */
export function sessionise(
  events: VisitEvent[],
  gapMs: number = SESSION_GAP_MS,
): Array<{ startedAt: string; endedAt: string; count: number }> {
  const stamps = events
    .map((e) => Date.parse(e?.created_at ?? ''))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (!stamps.length) return [];

  const out: Array<{ startedAt: string; endedAt: string; count: number }> = [];
  let start = stamps[0];
  let prev = stamps[0];
  let count = 1;
  for (let i = 1; i < stamps.length; i++) {
    const t = stamps[i];
    if (t - prev > gapMs) {
      out.push({ startedAt: new Date(start).toISOString(), endedAt: new Date(prev).toISOString(), count });
      start = t; count = 0;
    }
    prev = t; count++;
  }
  out.push({ startedAt: new Date(start).toISOString(), endedAt: new Date(prev).toISOString(), count });
  return out;
}

/**
 * Derive the "since" window for an identity that is on the page RIGHT NOW.
 *
 * `nowMs` is injected rather than read from the clock so the boundary is testable and
 * so a caller can reproduce a window exactly.
 *
 * The CURRENT visit is the last session when it is still open (its end is within
 * `gapMs` of now); otherwise `now` itself opens a new one and the last session becomes
 * the previous visit. Both cases are real — a visitor who loads the map after two days
 * has no "current session" in the table yet, because the page has not finished writing
 * its first event.
 */
export function deriveVisitWindow(
  events: VisitEvent[],
  nowMs: number,
  opts?: { gapMs?: number; minGapMs?: number },
): VisitWindow {
  const gapMs = opts?.gapMs ?? SESSION_GAP_MS;
  const minGapMs = opts?.minGapMs ?? MIN_RETURN_GAP_MS;

  // Events at or after `now` are not history. They are the caller's own page load
  // racing its telemetry, and letting them define the window would make the window
  // start in the future.
  const past = events.filter((e) => {
    const t = Date.parse(e?.created_at ?? '');
    return Number.isFinite(t) && t <= nowMs;
  });
  const sessions = sessionise(past, gapMs);
  if (!sessions.length) return NOT_A_RETURN('no_events');

  const last = sessions[sessions.length - 1];
  const lastEnd = Date.parse(last.endedAt);
  const currentIsOpen = nowMs - lastEnd <= gapMs;

  // The visit BEFORE the one in progress.
  const prior = currentIsOpen ? sessions[sessions.length - 2] : last;
  if (!prior) return NOT_A_RETURN('first_visit');

  const returnStartedMs = currentIsOpen ? Date.parse(last.startedAt) : nowMs;
  const lastVisitMs = Date.parse(prior.endedAt);
  const gap = returnStartedMs - lastVisitMs;
  if (!Number.isFinite(gap) || gap < minGapMs) return NOT_A_RETURN('gap_too_short');

  return {
    isReturn: true,
    lastVisitAt: new Date(lastVisitMs).toISOString(),
    returnStartedAt: new Date(returnStartedMs).toISOString(),
    gapMs: gap,
    reason: 'return',
  };
}

/**
 * "Friday" / "3 days ago" — the human label beside the counts.
 *
 * Deliberately coarse. We know the timestamp to the millisecond and showing it that way
 * would be a precision claim about a derived boundary: the true last visit is the last
 * event we RECORDED, which is not exactly when the person closed the tab.
 */
export function describeGap(gapMs: number | null): string {
  if (gapMs == null || !Number.isFinite(gapMs) || gapMs <= 0) return '';
  const h = gapMs / 3_600_000;
  if (h < 24) return 'earlier today';
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 14) return 'last week';
  const w = Math.floor(d / 7);
  if (w < 5) return `${w} weeks ago`;
  const m = Math.floor(d / 30);
  return m <= 1 ? 'last month' : `${m} months ago`;
}
