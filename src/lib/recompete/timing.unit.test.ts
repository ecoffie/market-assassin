import { describe, expect, it } from 'vitest';
import {
  addCalendarMonths,
  captureStartDateFromPopEnd,
  leadTimeMonthsFromPopEnd,
  overlayRecompeteTiming,
  RECOMPETE_CAPTURE_LEAD_MONTHS,
} from './timing';

describe('recompete timing (MINDY-006)', () => {
  it('canonical capture lead is 12 months (DB trigger / forecast PRD), not 9', () => {
    expect(RECOMPETE_CAPTURE_LEAD_MONTHS).toBe(12);
  });

  it('derives the suggested capture start from PoP end, never from today', () => {
    expect(captureStartDateFromPopEnd('2026-09-18')).toBe('2025-09-18');
    expect(captureStartDateFromPopEnd('2026-09-28')).toBe('2025-09-28');
    expect(captureStartDateFromPopEnd('2026-09-18')).not.toBe('2026-09-17');
    expect(captureStartDateFromPopEnd('2026-09-28')).not.toBe('2026-09-17');
  });

  it('different PoP ends produce different capture dates', () => {
    const a = captureStartDateFromPopEnd('2026-09-18');
    const b = captureStartDateFromPopEnd('2026-09-28');
    expect(a).not.toBe(b);
  });

  it('a calculated date in the past remains in the past', () => {
    const est = captureStartDateFromPopEnd('2026-09-18');
    expect(est).toBe('2025-09-18');
    expect(est! < '2026-09-17').toBe(true);
  });

  it('a far-future PoP end still yields PoP-end minus 12 months (not today)', () => {
    expect(captureStartDateFromPopEnd('2028-03-15')).toBe('2027-03-15');
    const now = new Date('2026-09-17T12:00:00.000Z');
    const overlay = overlayRecompeteTiming('2028-03-15', now);
    expect(overlay?.capture_start_date).toBe('2027-03-15');
    expect(overlay?.estimated_recompete_date).toBeNull();
    expect(overlay?.lead_time_months).toBeGreaterThan(12);
  });

  it('clamps month-end like Postgres INTERVAL months (leap day)', () => {
    expect(addCalendarMonths('2024-02-29', -12)).toBe('2023-02-28');
    expect(captureStartDateFromPopEnd('2024-02-29')).toBe('2023-02-28');
  });

  it('lead_time_months is remaining clock to PoP end, not the capture date', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    const overlay = overlayRecompeteTiming('2026-09-28', now);
    // The capture date stays historical under its own name (MINDY-006: no clamp) …
    expect(overlay?.capture_start_date).toBe('2025-09-28');
    expect(overlay?.lead_time_months).toBe(1);
    expect(overlay?.capture_start_passed).toBe(true);
    // … and is never emitted as a recompete date (IMI 2026-09-22).
    expect(overlay?.estimated_recompete_date).toBeNull();
  });

  it('an upcoming capture start is still NOT a recompete date (Eric, final contract)', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    const overlay = overlayRecompeteTiming('2028-03-15', now);
    expect(overlay).toMatchObject({
      capture_start_date: '2027-03-15',
      capture_start_basis: 'derived: period_of_performance_current_end − 12 months (Mindy capture lead rule)',
      capture_start_passed: false,
      estimated_recompete_date: null,
    });
  });

  it('near-term remaining clock is at least 1; capture date stays historical', () => {
    const now = new Date('2026-09-17T00:00:00.000Z');
    expect(leadTimeMonthsFromPopEnd('2026-09-18', now)).toBe(1);
    expect(captureStartDateFromPopEnd('2026-09-18')).toBe('2025-09-18');
  });

  it('returns null on unparseable PoP end rather than substituting today', () => {
    expect(captureStartDateFromPopEnd(null)).toBeNull();
    expect(captureStartDateFromPopEnd('not-a-date')).toBeNull();
    expect(overlayRecompeteTiming('')).toBeNull();
  });
});
