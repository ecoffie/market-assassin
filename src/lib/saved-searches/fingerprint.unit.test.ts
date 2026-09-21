import { describe, it, expect } from 'vitest';
import { savedSearchFingerprint, savedSearchesMatchFingerprint } from './fingerprint';

describe('saved-search idempotency fingerprint', () => {
  it('same filters in different key order → same fingerprint', () => {
    const a = savedSearchFingerprint({
      mode: 'open',
      filters: { naics: '541512', agency: 'DEFENSE' },
      alertFrequency: 'daily',
      alertsEnabled: true,
    });
    const b = savedSearchFingerprint({
      mode: 'open',
      filters: { agency: 'DEFENSE', naics: '541512' },
      alertFrequency: 'daily',
      alertsEnabled: true,
    });
    expect(a).toBe(b);
  });

  it('different cadence → different fingerprint', () => {
    const daily = savedSearchFingerprint({
      mode: 'open',
      filters: { naics: '541512' },
      alertFrequency: 'daily',
      alertsEnabled: true,
    });
    const weekly = savedSearchFingerprint({
      mode: 'open',
      filters: { naics: '541512' },
      alertFrequency: 'weekly',
      alertsEnabled: true,
    });
    expect(daily).not.toBe(weekly);
  });

  it('savedSearchesMatchFingerprint compares row to fingerprint', () => {
    const fp = savedSearchFingerprint({
      mode: 'open',
      filters: { naics: '236220' },
      alertFrequency: 'weekly',
      alertsEnabled: false,
    });
    expect(
      savedSearchesMatchFingerprint(
        { mode: 'open', filters: { naics: '236220' }, alert_frequency: 'weekly', alerts_enabled: false },
        fp,
      ),
    ).toBe(true);
  });
});
