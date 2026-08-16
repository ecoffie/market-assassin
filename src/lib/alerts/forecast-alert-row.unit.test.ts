/**
 * Guards the forecast → alert-card adapter.
 *
 * Eric, 2026-08-02: "you should be able to see any new forecast that surfaces
 * that you might have missed."
 *
 * Forecasts had NO push channel before this — chat, MCP and the market report
 * are all pull, and 14,389 of 33,075 have no coordinate so they never appear on
 * the map either. This adapter is what lets the existing saved-search alert
 * email carry them.
 *
 * Fixtures use real column values from agency_forecasts.
 */
import { describe, it, expect } from 'vitest';
import { toAlertRow, forecastTimingLabel } from './forecast-alert-row';

const URL = 'https://getmindy.ai';

describe('forecastTimingLabel', () => {
  it('combines quarter and fiscal year the way a card reads', () => {
    expect(forecastTimingLabel({ fiscal_year: 'FY2026', anticipated_quarter: 'Q3' })).toBe('Q3 FY2026');
  });

  it('takes whichever half exists', () => {
    expect(forecastTimingLabel({ fiscal_year: 'FY2027' })).toBe('FY2027');
    expect(forecastTimingLabel({ anticipated_quarter: 'Q1' })).toBe('Q1');
  });

  it('returns empty rather than inventing timing', () => {
    expect(forecastTimingLabel({})).toBe('');
  });
});

describe('toAlertRow', () => {
  const base = {
    external_id: 'USACE-DA-ENDIST-OMAHA-1A2B3C',
    title: 'B-21 Weapons Generation Facility',
    source_agency: 'USACE',
    contracting_office: 'ENDIST OMAHA',
    naics_code: '236220',
    set_aside_type: 'SDVOSB',
    fiscal_year: 'FY2026',
    anticipated_quarter: 'Q3',
    last_synced_at: '2026-08-02T00:00:00Z',
  };

  it('keys the dedupe on external_id — the forecast\'s stable id', () => {
    // The alert diff uses notice_id; a forecast has no such column. Mapping it
    // here keeps ONE dedupe contract instead of branching the cron.
    expect(toAlertRow(base, URL).notice_id).toBe('USACE-DA-ENDIST-OMAHA-1A2B3C');
  });

  it('labels the card as a forecast WITH its timing', () => {
    expect(toAlertRow(base, URL).notice_type).toBe('Forecast · Q3 FY2026');
  });

  it('still labels it a forecast when the agency gave no timing', () => {
    const { fiscal_year: _f, anticipated_quarter: _q, ...noTiming } = base;
    expect(toAlertRow(noTiming, URL).notice_type).toBe('Forecast');
  });

  it('surfaces the contracting office — the actionable buyer', () => {
    expect(toAlertRow(base, URL).solicitation_number).toBe('ENDIST OMAHA');
  });

  it('uses the ANTICIPATED SOLICITATION date as the deadline, not an award date', () => {
    // The solicitation date is what a capture manager plans against; the award
    // date is downstream of a bid that has not happened yet.
    const r = toAlertRow({ ...base, solicitation_date: '2026-05-01', anticipated_award_date: '2026-09-01' }, URL);
    expect(r.response_deadline).toBe('2026-05-01');
  });

  it('falls back to the award date only when there is no solicitation date', () => {
    const r = toAlertRow({ ...base, anticipated_award_date: '2026-09-01' }, URL);
    expect(r.response_deadline).toBe('2026-09-01');
  });

  it('NEVER invents a date the agency did not publish', () => {
    // Most forecasts carry neither. The card shows "—", which is the honest
    // answer; a fabricated deadline on a 6-18mo signal would be worse than none.
    expect(toAlertRow(base, URL).response_deadline).toBeNull();
  });

  it('does not fabricate a location for an unmapped forecast', () => {
    // 14,389 rows have no place at all — that is the population this alert
    // exists to reach, so a null here must survive as null.
    const r = toAlertRow(base, URL);
    expect(r.pop_state).toBeNull();
    expect(r.pop_city).toBeNull();
  });

  it('uses last_synced_at for "posted" — a forecast is never posted', () => {
    expect(toAlertRow(base, URL).posted_date).toBe('2026-08-02T00:00:00Z');
  });

  it('links to the forecast horizon on the map — via ?mode=, the param the map READS', () => {
    // Was ?horizon=forecast. The intent was always right; the param was wrong — the map has
    // never read `horizon`, so every forecast row in a live alert email landed on the
    // unfiltered national map. Measured + corrected 2026-08-16.
    expect(toAlertRow(base, URL).ui_link).toBe('https://getmindy.ai/opportunity-map?mode=forecast');
  });

  it('passes the set-aside label through for the card chip', () => {
    expect(toAlertRow(base, URL).set_aside_code).toBe('SDVOSB');
  });

  it('prefers department over source_agency when both exist', () => {
    expect(toAlertRow({ ...base, department: 'Department of the Army' }, URL).department)
      .toBe('Department of the Army');
    expect(toAlertRow(base, URL).department).toBe('USACE');
  });
});
