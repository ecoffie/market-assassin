import { describe, it, expect } from 'vitest';
import { normalizeAlertPreferences } from './alert-preferences';

describe('normalizeAlertPreferences', () => {
  it('active daily: alerts on + daily cadence', () => {
    expect(normalizeAlertPreferences({ alertsEnabled: true, alertFrequency: 'daily' })).toEqual({
      alertsEnabled: true,
      alertFrequency: 'daily',
    });
  });

  it('paused frequency forces alerts off', () => {
    expect(normalizeAlertPreferences({ alertsEnabled: true, alertFrequency: 'paused' })).toEqual({
      alertsEnabled: false,
      alertFrequency: 'paused',
    });
  });

  it('alerts off canonicalizes to paused frequency', () => {
    expect(normalizeAlertPreferences({ alertsEnabled: false, alertFrequency: 'daily' })).toEqual({
      alertsEnabled: false,
      alertFrequency: 'paused',
    });
  });

  it('defaults to active daily when unspecified', () => {
    expect(normalizeAlertPreferences({})).toEqual({
      alertsEnabled: true,
      alertFrequency: 'daily',
    });
  });
});
