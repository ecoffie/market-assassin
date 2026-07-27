/**
 * Date correctness + consistency (Eric 2026-07-27: "if they were consistent AND wrong we'd never
 * catch it — how do we fact-check?"). This test is the fact-check: it asserts the ONE formatter
 * turns a real SAM-shaped DB value into the CORRECT calendar day (not a TZ-shifted one), AND that
 * the map's inline client copy uses the same noon-anchored logic so it can't drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { longDate, ymd, daysUntil, localNoon } from './opp-date';

describe('opp-date — CORRECT calendar day, not a TZ-shifted one', () => {
  it('a UTC-midnight SAM value keeps its calendar day (not shifted back)', () => {
    // SAM stores "2026-07-21T00:00:00+00:00". The bug rendered this as Jul 20 in US zones.
    expect(longDate('2026-07-21T00:00:00+00:00')).toBe('Jul 21, 2026');
    expect(ymd('2026-07-21T00:00:00+00:00')).toBe('2026-07-21');
  });
  it('a date-only string formats to the same day', () => {
    expect(longDate('2026-07-21')).toBe('Jul 21, 2026');
  });
  it('a deadline with a real intraday time keeps its calendar day', () => {
    expect(longDate('2026-07-27T22:00:00+00:00')).toBe('Jul 27, 2026');
  });
  it('absent → em dash, never a fabricated/blank date', () => {
    expect(longDate(null)).toBe('—');
    expect(longDate('')).toBe('—');
    expect(longDate(undefined)).toBe('—');
  });
  it('daysUntil is noon-anchored (no half-day boundary flips)', () => {
    expect(localNoon('2026-07-21')?.getHours()).toBe(12);
    expect(daysUntil(null)).toBeNull();
  });
});

describe('the map client copy stays in sync with the shared formatter', () => {
  const tmpl = readFileSync(join(__dirname, '../../app/opportunity-map/template.html'), 'utf8');
  const route = readFileSync(join(__dirname, '../../app/opportunity-map/route.ts'), 'utf8');
  it('client longDate noon-anchors the sliced date (T12:00:00), same as the lib', () => {
    // template.html card formatter
    expect(tmpl).toContain("T12:00:00");
    // route.ts drawer formatter
    expect(route).toContain("T12:00:00'");
  });
  it('TODAY is LIVE, never a hardcoded date (the frozen-2026-07-21 bug)', () => {
    expect(tmpl).not.toMatch(/const TODAY=new Date\('2026-\d{2}-\d{2}/);
    expect(tmpl).toContain('const TODAY=(function()');
  });
});
