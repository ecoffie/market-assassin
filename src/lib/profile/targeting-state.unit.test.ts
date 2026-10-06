import { describe, it, expect } from 'vitest';
import { targetingNotice, targetingStateFrom } from './targeting-state';

const STARTER = ['541512', '541611', '541330', '541990', '561210'];

describe('targetingStateFrom mirrors the daily-alerts gate', () => {
  it('none: no known NAICS and no keywords (the cron skips this user)', () => {
    expect(targetingStateFrom({ naics_codes: [], keywords: [] })).toBe('none');
    expect(targetingStateFrom({ naics_codes: ['999999'], keywords: [' '] })).toBe('none');
    expect(targetingStateFrom(null)).toBe('none');
  });

  it('starter_codes: exact placeholder with NULL or system_default provenance — even with keywords', () => {
    expect(targetingStateFrom({ naics_codes: STARTER, naics_source: null })).toBe('starter_codes');
    expect(targetingStateFrom({ naics_codes: [...STARTER].reverse(), naics_source: 'system_default', keywords: ['roofing'] })).toBe('starter_codes');
  });

  it('targeted: confirmed placeholder, real codes with unknown provenance, or keyword-only', () => {
    expect(targetingStateFrom({ naics_codes: STARTER, naics_source: 'user_confirmed' })).toBe('targeted');
    expect(targetingStateFrom({ naics_codes: ['238160'], naics_source: null })).toBe('targeted');
    expect(targetingStateFrom({ naics_codes: [], keywords: ['roofing'] })).toBe('targeted');
  });

  it('notice copy only claims alerts when alerts are on, and is silent when targeted', () => {
    expect(targetingNotice('none', true)).toMatch(/alerts haven’t started/);
    expect(targetingNotice('none', false)).not.toMatch(/alert/i);
    expect(targetingNotice('starter_codes', true)).toMatch(/starter codes/);
    expect(targetingNotice('targeted', true)).toBeNull();
  });
});
