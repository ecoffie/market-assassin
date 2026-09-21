import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MINDY_DAY } from '@/lib/mindy/mindy-day';

/**
 * The confirmation page moved from static HTML (Bootcamp repo, served through a 3-hop
 * rewrite chain) to a getmindy.ai route, because the static copy could not import
 * MINDY_DAY and every value on it was hand-mirrored.
 *
 * MEASURED DRIFT on the page this replaces: a June Zoom room in SIX places (one buried
 * in Add-to-Calendar JS), a stale July date on an August event, a missing capacity
 * notice, and an .ics filename reading "mindy-launch-july-25.ics".
 *
 * These tests pin the ONE property that makes that class impossible: no event fact is
 * hardcoded in the page — every one is read from MINDY_DAY.
 */

/**
 * STRIP COMMENTS FIRST. These files EXPLAIN the drift they prevent — the page comment
 * names the "july-25" filename and the ics comment names VALUE=DATE — so a raw source
 * match flags the explanation as the defect. (The same trap is documented for the
 * silent-failure and rank-then-filter gates: a fix that quotes the bad pattern while
 * describing it must not fail its own test.)
 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const page = strip(readFileSync(join(process.cwd(), 'src/app/mindy-day/confirmed/page.tsx'), 'utf8'));
const ics = strip(readFileSync(join(process.cwd(), 'src/app/api/mindy-day/calendar.ics/route.ts'), 'utf8'));

describe('Mindy Day confirmation page: config-driven, never hand-typed', () => {
  it('hardcodes NO event fact that MINDY_DAY owns', () => {
    const source = page + ics;
    // the literal values that drifted on the old page
    const mustNotAppear: Array<[string, string]> = [
      // BOTH forms: the page RENDERS the spaced form ("861 5255 6791") while the URL
      // carries the digits ("86152556791"). Checking only the stripped form was a FALSE
      // NEGATIVE — injecting the spaced literal (the exact drift that hit the old page)
      // passed. Proven by inject -> red.
      ['Zoom meeting id (spaced)', MINDY_DAY.meetingId],
      ['Zoom meeting id (digits)', MINDY_DAY.meetingId.replace(/\s/g, '')],
      ['Zoom passcode', MINDY_DAY.passcode],
      ['date label', MINDY_DAY.dateLabel],
      ['time label', MINDY_DAY.timeLabel],
      ['livestream url', MINDY_DAY.livestreamUrl || '__none__'],
    ];
    for (const [what, literal] of mustNotAppear) {
      expect({ what, hardcoded: source.includes(literal) }).toEqual({ what, hardcoded: false });
    }
  });

  it('reads the Zoom join details from config', () => {
    for (const field of ['joinUrl', 'meetingId', 'passcode']) {
      expect(page).toContain(field);
    }
  });

  it('renders the overflow link ONLY when a livestream exists', () => {
    // the conditional is what keeps an absent URL honest instead of fabricated
    expect(page).toContain('livestreamUrl ?');
    expect(page).toContain("watch for the livestream link we&rsquo;ll email on the day");
  });

  it('states the real Zoom capacity from config, not a typed number', () => {
    expect(page).toContain('zoomCapacity.toLocaleString');
    expect(page).not.toMatch(/Zoom seats 500/);
  });

  it('derives the .ics filename — the old page shipped a July name for an August event', () => {
    expect(page).toContain('MINDY_DAY.iso');
    expect(page).not.toMatch(/july|jul-\d/i);
    expect(ics).not.toMatch(/july/i);
  });

  it('is excluded from search indexing', () => {
    expect(page).toContain('index: false');
  });
});

describe('Mindy Day .ics: a TIMED event, not all-day', () => {
  it('uses the same calendarDates field as the Google button', () => {
    expect(ics).toContain('MINDY_DAY.calendarDates.split');
  });

  it('writes DTSTART/DTEND with times (an all-day block would be wrong)', () => {
    expect(ics).toContain('DTSTART:${dtStart}');
    expect(ics).toContain('DTEND:${dtEnd}');
    expect(ics).not.toContain('VALUE=DATE');
  });

  it('refuses to emit a calendar file if the config range is malformed', () => {
    expect(ics).toContain('\\d{8}T\\d{6}Z');
    expect(ics).toContain('503');
  });

  it('uses a stable UID so re-import updates rather than duplicates', () => {
    expect(ics).toContain('UID:mindy-day-${MINDY_DAY.iso}@getmindy.ai');
  });

  it('the configured range is genuinely a 3-hour morning session', () => {
    const [s, e] = MINDY_DAY.calendarDates.split('/');
    expect(s).toMatch(/^\d{8}T\d{6}Z$/);
    expect(e).toMatch(/^\d{8}T\d{6}Z$/);
    const hrs = (Number(e.slice(9, 11)) - Number(s.slice(9, 11)));
    expect(hrs).toBe(3);
    // 14:00 UTC = 10:00 AM ET (EDT, UTC-4)
    expect(s.slice(9, 11)).toBe('14');
  });
});
