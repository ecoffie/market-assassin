/**
 * Response-runway model — the fix for "we surface things with 1-day notice that
 * nobody can realistically pursue, so users give up."
 *
 * The data (2026-07-11): of 21,962 ACTIVE respondable opps with a deadline, 55%
 * were already PAST their response deadline yet still `active=true`, and only ~45%
 * had any future runway at all. SAM keeps a notice `active` until its `archive_date`
 * (often weeks after the response deadline), so `active=true` means "not yet
 * archived," NOT "still pursuable." Treating the two as the same floods the feed
 * with dead opportunities.
 *
 * This module is the single source of truth for:
 *   1. FILTER — is there enough runway that showing it is honest? (`hasRunway`)
 *   2. LABEL  — an honest, plain-language runway badge (`runwayLabel`)
 *   3. RANK   — an actionability weight so pursuable opps float above tight ones
 *              (`runwayRank`), used to break ties after fit score.
 *
 * Used by /api/app/opportunities (filter + rank) and AlertsPanel (badge). Same
 * derivation everywhere so the feed, the badge, and the sort never disagree.
 */

import { classifyNoticeType } from '@/lib/utils/notice-type';

export type RunwayTier = 'closed' | 'tight' | 'soon' | 'open' | 'none';

export interface Runway {
  daysLeft: number | null; // whole days until deadline; null when no deadline
  tier: RunwayTier;
  /** Honest badge text, e.g. "🟢 24 days left", "🔴 1 day — tight, act now", "⛔ Closed". */
  label: string;
  /** True when the opp has enough runway to be worth surfacing (see hasRunway). */
  actionable: boolean;
}

/**
 * Whole days from now to the deadline. null when there is no deadline (many
 * Sources Sought / RFI have none — those are always actionable, no hard clock).
 * Uses ceil so "10 hours left" reads as 1 day, not 0 — but a deadline in the PAST
 * yields a negative number and reads as closed.
 */
export function daysUntil(deadline?: string | null, now: Date = new Date()): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

/**
 * Should this opp appear in the pursuable feed at all?
 * - Has a deadline: daysLeft >= minDays (default 1). daysLeft <= 0 (past, or
 *   closes today with the time already gone) → NO.
 * - No deadline (null): keep ONLY if the notice type is actually respondable
 *   (Sources Sought / RFI / a real solicitation). This is the critical gate —
 *   844 of the 900+ active null-deadline rows are AWARD NOTICES (already awarded)
 *   or Justifications, which have no deadline precisely because there is nothing
 *   to respond to. Surfacing those as "🟢 Open" would be the same lie in a new
 *   costume. classifyNoticeType(...).respondability === 'none' → filtered out.
 *   (When notice type is unknown/blank, classify defaults to biddable, so we
 *   don't wrongly hide an un-enriched real solicitation.)
 *
 * `minDays` lets a caller demand more runway (e.g. hide anything under 2 days),
 * but the default only hides the genuinely un-actionable (expired / same-day-gone
 * / non-respondable-with-no-deadline).
 */
export function hasRunway(
  deadline?: string | null,
  minDays = 1,
  now: Date = new Date(),
  noticeType?: string | null,
): boolean {
  const days = daysUntil(deadline, now);
  if (days === null) {
    // No clock — pursuable only if there IS something to submit.
    return classifyNoticeType(noticeType).respondability !== 'none';
  }
  return days >= minDays;
}

/** Classify runway into a tier for badge + rank. null deadline → 'none' (open). */
export function runwayTier(deadline?: string | null, now: Date = new Date()): RunwayTier {
  const days = daysUntil(deadline, now);
  if (days === null) return 'none';
  if (days < 1) return 'closed';
  if (days <= 3) return 'tight';   // 1–3 days: doable but stressful
  if (days <= 10) return 'soon';   // 4–10 days: reasonable
  return 'open';                   // 11+ days: real runway
}

/** Plain-language, honest badge. Never dresses up a dead opp as pursuable. */
export function runwayLabel(deadline?: string | null, now: Date = new Date()): string {
  const days = daysUntil(deadline, now);
  if (days === null) return '🟢 Open — no deadline';
  if (days < 0) return '⛔ Closed';
  if (days === 0) return '⛔ Closes today';
  if (days === 1) return '🔴 1 day — tight, act now';
  if (days <= 3) return `🔴 ${days} days — tight, act now`;
  if (days <= 10) return `🟡 ${days} days left`;
  return `🟢 ${days} days left`;
}

/**
 * Actionability weight for ranking (higher = float higher). The point: after fit
 * score, a pursuable opp with real runway should beat one closing tomorrow — the
 * top of the feed should be things a user can actually win, not a countdown of
 * near-misses. Closed items sink to the bottom (they should already be filtered,
 * this is defense in depth).
 */
export function runwayRank(deadline?: string | null, now: Date = new Date()): number {
  switch (runwayTier(deadline, now)) {
    case 'open': return 3;   // 11+ days — best
    case 'none': return 3;   // no deadline — equally actionable
    case 'soon': return 2;   // 4–10 days
    case 'tight': return 1;  // 1–3 days — surface, but below real runway
    case 'closed': return 0; // expired — should not be here
  }
}

/** One call → everything a caller needs. */
export function computeRunway(deadline?: string | null, now: Date = new Date()): Runway {
  const daysLeft = daysUntil(deadline, now);
  const tier = runwayTier(deadline, now);
  return {
    daysLeft,
    tier,
    label: runwayLabel(deadline, now),
    actionable: tier !== 'closed',
  };
}
