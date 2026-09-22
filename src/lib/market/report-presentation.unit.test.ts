import { describe, it, expect } from 'vitest';
import { dedupeForecasts, forecastIdentity, normalizeForecastSetAside, presentRecompete } from './report-presentation';

describe('forecastIdentity', () => {
  it('treats GW-L:<id> and <id> for the same agency as one listing (3,311 such twins, 2026-09-22)', () => {
    expect(forecastIdentity({ agency: 'DOI', external_id: '7799', title: 'a' }))
      .toBe(forecastIdentity({ agency: 'DOI', external_id: 'GW-L:7799', title: 'a slightly different spacing' }));
  });
  it('never merges two agencies that share a numeric listing id', () => {
    expect(forecastIdentity({ agency: 'DOI', external_id: '7799' })).not.toBe(forecastIdentity({ agency: 'DOT', external_id: '7799' }));
  });
  it('same title, different incumbent = different procurements (Navy OPF-L DO #3)', () => {
    const { rows, removed } = dedupeForecasts([
      { agency: 'NAVY', title: 'OPF-L Delivery Order #3', incumbent_name: 'Aerovironment, Inc' },
      { agency: 'NAVY', title: 'OPF-L Delivery Order #3', incumbent_name: 'Anduril Industries' },
      { agency: 'NAVY', title: 'OPF-L Delivery Order #3', incumbent_name: 'Teledyne FLIR Detection' },
    ]);
    expect(rows).toHaveLength(3);
    expect(removed).toBe(0);
  });
});

describe('normalizeForecastSetAside', () => {
  it.each(['true', 'True', 'false', 'TBD', '', null])('%s → not stated (null), never a guessed category', (v) => {
    expect(normalizeForecastSetAside(v)).toBeNull();
  });
  it.each([
    ['Small Business', 'Small Business'], ['SB', 'Small Business'], ['Small Business Set Aside - Total', 'Small Business'],
    ['Full and Open', 'Full & Open'], ['No set aside used', 'Full & Open'], ['8(a) Sole Source', '8(a) Sole Source'],
    ['Set-aside - Service Disabled Veteran Owned Small Business', 'SDVOSB'], ['HUBZone', 'HUBZone'],
    ['Set-Aside Small Business - Partial', 'Small Business (partial)'],
  ])('%s → %s', (raw, want) => {
    expect(normalizeForecastSetAside(raw)).toBe(want);
  });
  it('an unrecognised real category passes through unchanged', () => {
    expect(normalizeForecastSetAside('Indian Small Business Economic Enterprise')).toBe('Indian Small Business Economic Enterprise');
  });
});

describe('presentRecompete', () => {
  it('renames the MINDY-006 capture date and flags when it has passed', () => {
    const r = presentRecompete({ contract_id: 'x', estimated_recompete_date: '2025-09-23' }, new Date('2026-09-22T00:00:00Z'));
    expect(r).not.toHaveProperty('estimated_recompete_date');
    expect(r.capture_start_date).toBe('2025-09-23');
    expect(r.capture_start_passed).toBe(true);
  });
  it('a future capture date is not passed; a missing one is unknown', () => {
    expect(presentRecompete({ estimated_recompete_date: '2027-03-01' }, new Date('2026-09-22')).capture_start_passed).toBe(false);
    expect(presentRecompete({ estimated_recompete_date: null }).capture_start_passed).toBeNull();
  });
});
