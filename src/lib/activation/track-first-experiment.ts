/**
 * Tracking-first onboarding experiment: ASSIGNMENT ONLY (activation Phase 1, prepared 2026-11-14).
 *
 * ⛔ NOT WIRED INTO ONBOARDING AND DISABLED. Nothing in the product calls this yet. Eric approves the final
 * treatment experience and the measurement plan separately, and the experiment may not start before
 * "Mindy Stabilization Complete" (see docs/activation/ACTIVATION-FRAMEWORK.md).
 *
 * Arms: control = today's onboarding · treatment = short business description → relevant opportunities →
 * a clear invitation to track one.
 *
 * Reuses the existing experiment infrastructure (migration 20260427_experiment_cohorts.sql):
 *   user_notification_settings.experiment_cohort / cohort_assigned_at (all NULL in production today) and the
 *   experiment_log audit table. Values are namespaced so they can never collide with the April 2026
 *   alerts/briefings experiment values (experiment_alerts / experiment_briefings / experiment_hold / paid_existing).
 *
 * Assignment is deterministic (hash of experiment id + email), so the arm is stable across devices and retries,
 * and is independent of anything the person does, which is what makes the comparison causal.
 */
import { createHash } from 'node:crypto';

export const TRACK_FIRST_EXPERIMENT_ID = 'track_first_v1';
export const TRACK_FIRST_CONTROL = `${TRACK_FIRST_EXPERIMENT_ID}_control` as const;
export const TRACK_FIRST_TREATMENT = `${TRACK_FIRST_EXPERIMENT_ID}_treatment` as const;
export type TrackFirstArm = typeof TRACK_FIRST_CONTROL | typeof TRACK_FIRST_TREATMENT;

export interface TrackFirstConfig {
  enabled: boolean;
  /** Only accounts created at or after this instant are enrolled. Null = not started. */
  startsAt: Date | null;
  /** Share of new accounts in treatment, 0..100. */
  treatmentPercent: number;
}

/** Env-driven config. Defaults to OFF: the flag must be exactly "true" AND a valid start must be set. */
export function trackFirstConfig(env: Record<string, string | undefined> = process.env): TrackFirstConfig {
  const enabled = String(env.TRACK_FIRST_EXPERIMENT_ENABLED || '').trim().toLowerCase() === 'true';
  const startMs = Date.parse(String(env.TRACK_FIRST_EXPERIMENT_STARTS_AT || ''));
  const pct = Number.parseInt(String(env.TRACK_FIRST_TREATMENT_PERCENT ?? '50'), 10);
  return {
    enabled,
    startsAt: Number.isFinite(startMs) ? new Date(startMs) : null,
    treatmentPercent: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 50,
  };
}

/** Stable bucket 0..99 for this email within this experiment. */
export function trackFirstBucket(email: string): number {
  const h = createHash('sha256').update(`${TRACK_FIRST_EXPERIMENT_ID}:${email.trim().toLowerCase()}`).digest();
  return h.readUInt32BE(0) % 100;
}

export type EnrollmentDecision =
  | { enroll: true; arm: TrackFirstArm }
  | { enroll: false; reason: 'disabled' | 'not_started' | 'existing_account' | 'unknown_created_at' | 'already_in_experiment' | 'invalid_email' | 'excluded' };

/**
 * Whether a NEW account should be enrolled, and in which arm. Existing accounts are never enrolled, an account
 * already carrying any cohort is never reassigned, and staff/comp/test accounts are excluded by the caller's flag.
 */
export function trackFirstEnrollment(p: {
  email: string;
  accountCreatedAt: string | null | undefined;
  currentCohort: string | null | undefined;
  excluded: boolean;
  config?: TrackFirstConfig;
}): EnrollmentDecision {
  const cfg = p.config ?? trackFirstConfig();
  if (!cfg.enabled) return { enroll: false, reason: 'disabled' };
  if (!cfg.startsAt) return { enroll: false, reason: 'not_started' };
  const email = String(p.email || '').trim().toLowerCase();
  if (!email.includes('@') || email.startsWith('anon:')) return { enroll: false, reason: 'invalid_email' };
  if (p.excluded) return { enroll: false, reason: 'excluded' };
  if (p.currentCohort) return { enroll: false, reason: 'already_in_experiment' };
  const created = Date.parse(String(p.accountCreatedAt || ''));
  if (!Number.isFinite(created)) return { enroll: false, reason: 'unknown_created_at' };
  if (created < cfg.startsAt.getTime()) return { enroll: false, reason: 'existing_account' };
  return { enroll: true, arm: trackFirstBucket(email) < cfg.treatmentPercent ? TRACK_FIRST_TREATMENT : TRACK_FIRST_CONTROL };
}
