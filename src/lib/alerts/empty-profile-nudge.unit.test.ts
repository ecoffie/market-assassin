import { describe, it, expect } from 'vitest';
import { shouldShowAlertSetupNudges, hasNoProfileAtAll } from './profile-setup';

const OLD = new Date('2026-03-15T00:00:00Z').toISOString();   // aged out of the window
const NEW = new Date().toISOString();                          // inside the window

describe('hasNoProfileAtAll', () => {
  it('true only when BOTH naics and keywords are empty', () => {
    expect(hasNoProfileAtAll({ naics_codes: [], keywords: [] })).toBe(true);
    expect(hasNoProfileAtAll({ naics_codes: null, keywords: null })).toBe(true);
    expect(hasNoProfileAtAll({ naics_codes: ['541512'], keywords: [] })).toBe(false);
    expect(hasNoProfileAtAll({ naics_codes: [], keywords: ['cyber'] })).toBe(false);
  });
  it('ignores empty-string junk in the arrays', () => {
    expect(hasNoProfileAtAll({ naics_codes: [''], keywords: ['', ''] })).toBe(true);
  });
});

describe('shouldShowAlertSetupNudges — the pa.joof case', () => {
  it('STILL nudges an empty profile that aged out of the window', () => {
    // Enrolled March, 99 alerts sent, profile completely empty. Before this fix
    // the window suppressed the nudge and he got generic email forever.
    const paJoof = { naics_codes: [], keywords: [], created_at: OLD, total_alerts_sent: 99 };
    expect(shouldShowAlertSetupNudges(paJoof)).toBe(true);
  });

  it('nudges a brand-new empty profile too (unchanged behaviour)', () => {
    expect(shouldShowAlertSetupNudges({ naics_codes: [], keywords: [], created_at: NEW, total_alerts_sent: 0 })).toBe(true);
  });

  it('does NOT nudge a settled user with a real profile', () => {
    const settled = { naics_codes: ['541512', '541519'], keywords: ['cyber', 'rmf'], created_at: OLD, total_alerts_sent: 120 };
    expect(shouldShowAlertSetupNudges(settled)).toBe(false);
  });

  it('does NOT start nagging every long-time user — only the empty ones', () => {
    // Has codes but they are thin. Old behaviour (window-gated) preserved.
    const thin = { naics_codes: ['541512'], keywords: [], created_at: OLD, total_alerts_sent: 200 };
    expect(shouldShowAlertSetupNudges(thin)).toBe(false);
  });

  it('a new user with a thin profile still gets the nudge (in-window)', () => {
    const thinNew = { naics_codes: ['541512'], keywords: [], created_at: NEW, total_alerts_sent: 1 };
    expect(shouldShowAlertSetupNudges(thinNew)).toBe(true);
  });

  it('never throws on missing fields', () => {
    expect(() => shouldShowAlertSetupNudges({ naics_codes: null, keywords: null })).not.toThrow();
  });
});
