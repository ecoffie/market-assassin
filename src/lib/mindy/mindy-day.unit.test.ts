import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MINDY_DAY } from './mindy-day';

/**
 * mindy-day.ts is the SINGLE SOURCE OF TRUTH for the event. Its own header says the date
 * used to be scattered across ~7 files and "one always got missed".
 *
 * The ZOOM LINK had escaped that consolidation: launch-reminder-email.ts and
 * launch-confirmation-email.ts each hardcoded meeting 89280506481 — a stale June meeting —
 * while the live 2026-08-22 room is 86152556791. Every "Join Now" button in those emails
 * pointed at the wrong room. Found 2026-08-19, three days before the event.
 */
describe('Mindy Day: one source of truth', () => {
  const files = [
    'src/lib/mindy/launch-reminder-email.ts',
    'src/lib/mindy/launch-confirmation-email.ts',
  ];

  it('no email hardcodes a zoom.us meeting link', () => {
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      // a literal join URL in the source is the drift this guards
      const literals = src.match(/'https:\/\/us06web\.zoom\.us\/j\/\d+/g) || [];
      expect({ f, literals }).toEqual({ f, literals: [] });
    }
  });

  it('the join link and timezone stay consistent with the ET event', () => {
    expect(MINDY_DAY.joinUrl).toContain('us06web.zoom.us/j/');
    expect(MINDY_DAY.meetingId.replace(/\s/g, '')).toBe('86152556791');
    // ET is the source of truth: calendarDates must encode 14:00-17:00Z (= 10 AM-1 PM EDT).
    expect(MINDY_DAY.calendarDates).toBe('20260822T140000Z/20260822T170000Z');
    expect(MINDY_DAY.timeLabel).toContain('ET');
  });
});
