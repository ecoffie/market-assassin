import { describe, it, expect } from 'vitest';
import {
  cronWillDeliverAlerts,
  isUnsupportedAlertScope,
  savedSearchRequestsRecompetes,
  savedSearchWantsForecasts,
} from './alert-scope';

describe('alert-scope (cron parity)', () => {
  it('open mode is deliverable', () => {
    expect(cronWillDeliverAlerts('open', { naics: '541512' })).toBe(true);
    expect(isUnsupportedAlertScope('open', { naics: '541512' })).toBe(false);
  });

  it('forecast horizon is deliverable', () => {
    const filters = { naics: '541512', horizons: { forecast: true } };
    expect(savedSearchWantsForecasts('open', filters)).toBe(true);
    expect(cronWillDeliverAlerts('open', filters)).toBe(true);
  });

  it('rejects recompete mode even when open/forecast data could be substituted', () => {
    expect(cronWillDeliverAlerts('recompete', { naics: '541512' })).toBe(false);
    expect(isUnsupportedAlertScope('recompete', { naics: '541512' })).toBe(true);

    const filters = { naics: '541512', horizons: { forecast: true } };
    expect(cronWillDeliverAlerts('recompete', filters)).toBe(true);
    expect(isUnsupportedAlertScope('recompete', filters)).toBe(true);
  });

  it('rejects open mode when recompete horizon is requested', () => {
    const filters = { naics: '541512', horizons: { recompete: true } };
    expect(cronWillDeliverAlerts('open', filters)).toBe(true);
    expect(savedSearchRequestsRecompetes('open', filters)).toBe(true);
    expect(isUnsupportedAlertScope('open', filters)).toBe(true);
  });

  it('recognizes serialized truthy recompete horizon flags', () => {
    expect(isUnsupportedAlertScope('open', { horizons: { recompete: 'true' } })).toBe(true);
    expect(isUnsupportedAlertScope('open', { horizons: { recompete: '1' } })).toBe(true);
    expect(isUnsupportedAlertScope('open', { horizons: { recompete: false } })).toBe(false);
  });
});
