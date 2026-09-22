import { describe, it, expect } from 'vitest';
import {
  isPausedAlertDelivery,
  paidRefreshNotificationPatch,
  saveProfileAlertDeliveryPatch,
} from './paused-delivery';

/**
 * Dedicated-account reproduction of Adam's unsubscribe → targeting save.
 * In-memory row `repro-unsub@example.test` — never writes Adam's Gmail.
 */
const DEDICATED = {
  alerts_enabled: false,
  alert_frequency: 'paused',
  is_active: true,
  briefings_enabled: true,
};

describe('dedicated-account: unsubscribe then preferences / save-profile', () => {
  it('GET unsubscribe leaves the row paused', () => {
    expect(isPausedAlertDelivery(DEDICATED)).toBe(true);
  });

  it('save-profile with targeting only (no frequency) keeps paused — the Adam overwrite', () => {
    const before = {
      alerts_enabled: true,
      alert_frequency: 'paused' as const,
    };
    // Pre-fix: always wrote alerts_enabled=true, alert_frequency=daily
    expect(saveProfileAlertDeliveryPatch(before, undefined)).toEqual({
      alerts_enabled: false,
      alert_frequency: 'paused',
    });
  });

  it('explicit daily after unsubscribe is a user resume, not a clobber', () => {
    expect(saveProfileAlertDeliveryPatch(DEDICATED, 'daily')).toEqual({
      alerts_enabled: true,
      alert_frequency: 'daily',
    });
  });

  it('webhook paid-refresh does not unmute paused alerts', () => {
    const patch = paidRefreshNotificationPatch(DEDICATED, {
      stripeCustomerId: 'cus_test',
      nowIso: '2026-09-13T00:00:00.000Z',
    });
    expect(patch.alerts_enabled).toBeUndefined();
    expect(patch.paid_status).toBe(true);
    expect(patch.briefings_enabled).toBe(true);
    expect(patch.stripe_customer_id).toBe('cus_test');
  });

  it('webhook paid-refresh still enables alerts for a never-unsubscribed payer', () => {
    const patch = paidRefreshNotificationPatch(
      { alerts_enabled: true, alert_frequency: 'daily', is_active: true },
      { stripeCustomerId: 'cus_2', nowIso: '2026-09-13T00:00:00.000Z' },
    );
    expect(patch.alerts_enabled).toBe(true);
    expect(patch.briefings_enabled).toBe(true);
  });

  it('does not re-activate a master-switch opt-out', () => {
    const patch = paidRefreshNotificationPatch(
      { alerts_enabled: false, alert_frequency: 'paused', is_active: false, briefings_enabled: false },
      { stripeCustomerId: 'cus_3', nowIso: '2026-09-13T00:00:00.000Z' },
    );
    expect(patch.briefings_enabled).toBeUndefined();
    expect(patch.is_active).toBeUndefined();
    expect(patch.alerts_enabled).toBeUndefined();
    expect(patch.paid_status).toBe(true);
  });
});
