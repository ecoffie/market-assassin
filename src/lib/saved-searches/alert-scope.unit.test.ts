import { describe, it, expect } from 'vitest';
import {
  cronWillDeliverAlerts,
  isUnsupportedAlertScope,
  savedSearchRequestsRecompetes,
  savedSearchWantsForecasts,
  savedSearchWantsOpen,
  alertableScope,
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

describe('F2 — the saved Open horizon is honoured', () => {
  it('Open unchecked → no Open alerts; pre-horizon searches stay Open', () => {
    expect(savedSearchWantsOpen('open', { horizons: { open: false, forecast: true } })).toBe(false);
    expect(savedSearchWantsOpen('open', { horizons: { open: 'false', forecast: true } })).toBe(false);
    expect(savedSearchWantsOpen('open', { horizons: { open: true } })).toBe(true);
    expect(savedSearchWantsOpen('open', { naics: '541512' })).toBe(true);
    expect(savedSearchWantsOpen('recompete', {})).toBe(false);
  });
  it('a watch with neither Open nor Forecast is not deliverable', () => {
    expect(cronWillDeliverAlerts('open', { horizons: { open: false, recompete: false, forecast: false } })).toBe(false);
    expect(cronWillDeliverAlerts('open', { horizons: { open: false, forecast: true } })).toBe(true);
  });
});

describe('F3 — alertableScope only ever removes recompete', () => {
  it('classifies full / partial / none', () => {
    expect(alertableScope('open', { naics: '1', horizons: { open: true, forecast: false } }).kind).toBe('full');
    expect(alertableScope('open', { naics: '1', horizons: { open: true, recompete: true } })).toEqual({
      kind: 'partial', filters: { naics: '1', horizons: { open: true, recompete: false } },
    });
    expect(alertableScope('open', { horizons: { open: false, recompete: true, forecast: false } }).kind).toBe('none');
    expect(alertableScope('recompete', { horizons: { forecast: true } }).kind).toBe('none');
  });
  it('every non-none result passes the service rule', () => {
    for (const h of [{ open: true, recompete: true, forecast: true }, { open: false, recompete: true, forecast: true }, { open: true }]) {
      const p = alertableScope('open', { horizons: h });
      expect(isUnsupportedAlertScope('open', p.filters!)).toBe(false);
      expect(cronWillDeliverAlerts('open', p.filters!)).toBe(true);
    }
  });
});
