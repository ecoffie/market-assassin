import { describe, it, expect } from 'vitest';
import {
  trackFirstConfig, trackFirstEnrollment, trackFirstBucket,
  TRACK_FIRST_CONTROL, TRACK_FIRST_TREATMENT, type TrackFirstConfig,
} from './track-first-experiment';

const ON: TrackFirstConfig = { enabled: true, startsAt: new Date('2026-12-01T00:00:00Z'), treatmentPercent: 50 };
const NEW = '2026-12-02T00:00:00Z';

describe('track-first experiment is off by default', () => {
  it('no env → disabled, not started', () => {
    const cfg = trackFirstConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.startsAt).toBeNull();
    expect(trackFirstEnrollment({ email: 'a@b.co', accountCreatedAt: NEW, currentCohort: null, excluded: false, config: cfg }))
      .toEqual({ enroll: false, reason: 'disabled' });
  });
  it('flag without a start date still enrolls nobody', () => {
    const cfg = trackFirstConfig({ TRACK_FIRST_EXPERIMENT_ENABLED: 'true' });
    expect(trackFirstEnrollment({ email: 'a@b.co', accountCreatedAt: NEW, currentCohort: null, excluded: false, config: cfg }))
      .toEqual({ enroll: false, reason: 'not_started' });
  });
  it('only the exact string "true" enables it', () => {
    expect(trackFirstConfig({ TRACK_FIRST_EXPERIMENT_ENABLED: '1' }).enabled).toBe(false);
    expect(trackFirstConfig({ TRACK_FIRST_EXPERIMENT_ENABLED: 'yes' }).enabled).toBe(false);
  });
});

describe('enrollment rules', () => {
  const base = { email: 'buyer@acme.io', accountCreatedAt: NEW, currentCohort: null, excluded: false, config: ON };
  it('existing accounts are never enrolled', () => {
    expect(trackFirstEnrollment({ ...base, accountCreatedAt: '2026-11-01T00:00:00Z' })).toEqual({ enroll: false, reason: 'existing_account' });
  });
  it('unknown creation time is not assumed new', () => {
    expect(trackFirstEnrollment({ ...base, accountCreatedAt: null })).toEqual({ enroll: false, reason: 'unknown_created_at' });
  });
  it('an account already in any cohort is never reassigned', () => {
    expect(trackFirstEnrollment({ ...base, currentCohort: 'experiment_alerts' })).toEqual({ enroll: false, reason: 'already_in_experiment' });
  });
  it('excluded (staff/comp/test) accounts are not enrolled', () => {
    expect(trackFirstEnrollment({ ...base, excluded: true })).toEqual({ enroll: false, reason: 'excluded' });
  });
  it('assignment is deterministic and case-insensitive', () => {
    const a = trackFirstEnrollment(base);
    const b = trackFirstEnrollment({ ...base, email: 'BUYER@Acme.io' });
    expect(a).toEqual(b);
    expect(a.enroll).toBe(true);
  });
  it('0% and 100% put everyone in one arm', () => {
    expect(trackFirstEnrollment({ ...base, config: { ...ON, treatmentPercent: 0 } })).toEqual({ enroll: true, arm: TRACK_FIRST_CONTROL });
    expect(trackFirstEnrollment({ ...base, config: { ...ON, treatmentPercent: 100 } })).toEqual({ enroll: true, arm: TRACK_FIRST_TREATMENT });
  });
  it('a 50% split is close to even over many emails', () => {
    let t = 0;
    for (let i = 0; i < 4000; i++) if (trackFirstBucket(`user${i}@example.org`) < 50) t++;
    expect(t / 4000).toBeGreaterThan(0.46);
    expect(t / 4000).toBeLessThan(0.54);
  });
  it('cohort values never collide with the April 2026 experiment', () => {
    for (const v of [TRACK_FIRST_CONTROL, TRACK_FIRST_TREATMENT]) {
      expect(['experiment_alerts', 'experiment_briefings', 'experiment_hold', 'paid_existing']).not.toContain(v);
    }
  });
});
