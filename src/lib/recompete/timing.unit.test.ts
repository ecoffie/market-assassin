import { describe, expect, it } from 'vitest';
import {
  addCalendarMonths,
  estimatedRecompeteDateFromPopEnd,
  leadTimeMonthsFromPopEnd,
  overlayRecompeteTiming,
  RECOMPETE_CAPTURE_LEAD_MONTHS,
} from './timing';

describe('recompete timing (MINDY-006)', () => {
  it('canonical capture lead is 12 months (DB trigger / forecast PRD), not 9', () => {
    expect(RECOMPETE_CAPTURE_LEAD_MONTHS).toBe(12);
  });

  it('derives estimated_recompete_date from PoP end, never from today', () => {
    expect(estimatedRecompeteDateFromPopEnd('2026-09-18')).toBe('2025-09-18');
    expect(estimatedRecompeteDateFromPopEnd('2026-09-28')).toBe('2025-09-28');
    expect(estimatedRecompeteDateFromPopEnd('2026-09-18')).not.toBe('2026-09-17');
    expect(estimatedRecompeteDateFromPopEnd('2026-09-28')).not.toBe('2026-09-17');
  });

  it('different PoP ends produce different capture dates', () => {
    const a = estimatedRecompeteDateFromPopEnd('2026-09-18');
    const b = estimatedRecompeteDateFromPopEnd('2026-09-28');
    expect(a).not.toBe(b);
  });

  it('a calculated date in the past remains in the past', () => {
    const est = estimatedRecompeteDateFromPopEnd('2026-09-18');
    expect(est).toBe('2025-09-18');
    expect(est! < '2026-09-17').toBe(true);
  });

  it('clamps month-end like Postgres INTERVAL months (leap day)', () => {
    expect(addCalendarMonths('2024-02-29', -12)).toBe('2023-02-28');
    expect(estimatedRecompeteDateFromPopEnd('2024-02-29')).toBe('2023-02-28');
  });

  it('lead_time_months is remaining clock to PoP end, not the capture date', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    const overlay = overlayRecompeteTiming('2026-09-28', now);
    expect(overlay?.estimated_recompete_date).toBe('2025-09-28');
    expect(overlay?.lead_time_months).toBe(1);
    expect(overlay?.estimated_recompete_date).not.toBe('2026-09-17');
  });

  it('near-term remaining clock is at least 1; capture date stays historical', () => {
    const now = new Date('2026-09-17T00:00:00.000Z');
    expect(leadTimeMonthsFromPopEnd('2026-09-18', now)).toBe(1);
    expect(estimatedRecompeteDateFromPopEnd('2026-09-18')).toBe('2025-09-18');
  });

  it('returns null on unparseable PoP end rather than substituting today', () => {
    expect(estimatedRecompeteDateFromPopEnd(null)).toBeNull();
    expect(estimatedRecompeteDateFromPopEnd('not-a-date')).toBeNull();
    expect(overlayRecompeteTiming('')).toBeNull();
  });
});
