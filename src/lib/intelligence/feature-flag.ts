/**
 * Deterministic per-user feature-flag bucketing.
 *
 * Hash a user's email into a 0-99 bucket. New email features should
 * gate on `userBucket(email) < ROLLOUT_PERCENT` so a single-commit
 * regression breaks 10% of users, not 100%.
 *
 * Built 2026-05-31 after the Mindy Insights commit broke ALL daily
 * alerts for 4 days. With this helper the same commit would have
 * broken ~117 users instead of ~917, and the throughput-regression
 * detector (also shipped today) would have caught it the next morning.
 *
 * Usage:
 *   import { userBucket } from '@/lib/intelligence/feature-flag';
 *
 *   const insightsEnabled = process.env.ENABLE_MINDY_INSIGHTS === 'true'
 *     && userBucket(user.user_email) < 10;  // 10% rollout
 *
 *   if (insightsEnabled) { ... }
 *
 * Determinism matters: the same email always maps to the same bucket,
 * so users don't oscillate in and out of the feature day-to-day. To
 * shuffle the assignment (e.g. start a fresh A/B test), pass a salt:
 *
 *   userBucket(email, 'experiment-v2')
 */

import { createHash } from 'crypto';

export function userBucket(email: string, salt = ''): number {
  if (!email) return 0;
  const hash = createHash('sha256').update(`${salt}|${email.toLowerCase().trim()}`).digest();
  // First 4 bytes as uint32; mod 100 for 0-99.
  const n = hash.readUInt32BE(0);
  return n % 100;
}

/**
 * Convenience wrapper: returns true if the user falls within the
 * rollout percent. ROLLOUT_PERCENT semantics — 10 means "10% of
 * users get the feature."
 */
export function userInRollout(email: string, rolloutPercent: number, salt = ''): boolean {
  if (rolloutPercent <= 0) return false;
  if (rolloutPercent >= 100) return true;
  return userBucket(email, salt) < rolloutPercent;
}
