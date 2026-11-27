/**
 * Key people on get_contractor_profile (Agent 4, Mindy Day research parity, 2026-11-25): BQ recipient_executives
 * (FFATA executive compensation) was read only by the SEO contractor pages. A research report on a company needs
 * who runs it. "none_reported" is never "no executives"; a cold cache is "unavailable", never "none".
 */
import { describe, it, expect } from 'vitest';
import { shapeKeyPeople, KEY_PEOPLE_SOURCE } from './tier2-tools';

describe('shapeKeyPeople', () => {
  it('reported officers with compensation and date, cited to the FFATA source', () => {
    const r = shapeKeyPeople([{ exec_name: ' Jane Officer ', exec_amount: 900000, reported_at: '2025-03-01' }], false);
    expect(r).toMatchObject({ status: 'reported', source: KEY_PEOPLE_SOURCE, people: [{ name: 'Jane Officer', reported_compensation: 900000, reported_at: '2025-03-01' }] });
    expect(r.note).toMatch(/Verify current roles/);
  });
  it('no rows → none_reported, explicitly not evidence of who runs the company', () => {
    const r = shapeKeyPeople([], false);
    expect(r.status).toBe('none_reported');
    expect(r.note).toMatch(/not evidence of who runs the company/);
  });
  it('cache cold / budget spent → unavailable, never none', () => {
    const r = shapeKeyPeople([], true);
    expect(r.status).toBe('unavailable');
    expect(r.note).toMatch(/Not "none"/);
  });
  it('blank names are dropped; a missing amount is null, never 0', () => {
    const r = shapeKeyPeople([{ exec_name: '', exec_amount: 1, reported_at: 'x' }, { exec_name: 'A', exec_amount: NaN, reported_at: '' }], false);
    expect(r.people).toEqual([{ name: 'A', reported_compensation: null, reported_at: '' }]);
  });
});
