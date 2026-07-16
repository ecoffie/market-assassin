import { describe, it, expect } from 'vitest';
import { buildEventsIcs } from './ics';

const NOW = new Date('2026-07-16T12:30:45Z');
const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

describe('buildEventsIcs', () => {
  it('builds a valid VCALENDAR with an all-day VEVENT (DTEND exclusive)', () => {
    const r = buildEventsIcs(
      [{ date: '2026-03-15', title: 'DoD Industry Day', location: 'Arlington, VA', url: 'https://sam.gov/x' }],
      NOW,
    );
    expect(r.eventCount).toBe(1);
    expect(r.skippedUndated).toBe(0);
    expect(r.ics).toContain('BEGIN:VCALENDAR');
    expect(r.ics).toContain('VERSION:2.0');
    expect(r.ics).toContain('END:VCALENDAR');
    expect(r.ics).toContain('DTSTART;VALUE=DATE:20260315');
    expect(r.ics).toContain('DTEND;VALUE=DATE:20260316'); // exclusive → next day
    expect(r.ics).toContain('DTSTAMP:20260716T123045Z');
    expect(r.ics).toContain('SUMMARY:DoD Industry Day');
    expect(r.ics).toContain('LOCATION:Arlington\\, VA');
    expect(r.ics).toMatch(/\r\n$/); // final line terminator
    expect(decode(r.base64)).toBe(r.ics);
  });

  it('rolls DTEND across a month and a year boundary', () => {
    expect(buildEventsIcs([{ date: '2026-03-31', title: 'A' }], NOW).ics).toContain('DTEND;VALUE=DATE:20260401');
    expect(buildEventsIcs([{ date: '2026-12-31', title: 'B' }], NOW).ics).toContain('DTEND;VALUE=DATE:20270101');
    // 2028 is a leap year — Feb 29 exists and rolls to Mar 1.
    expect(buildEventsIcs([{ date: '2028-02-29', title: 'C' }], NOW).ics).toContain('DTEND;VALUE=DATE:20280301');
  });

  // ── the no-fabrication contract ──────────────────────────────────────────────
  it('SKIPS undated events instead of guessing a day', () => {
    const r = buildEventsIcs(
      [
        { date: '2026-03-15', title: 'Dated' },
        { date: null, title: 'Undated AI-discovered series' },
        { date: '', title: 'Empty' },
      ],
      NOW,
    );
    expect(r.eventCount).toBe(1);
    expect(r.skippedUndated).toBe(2);
    expect(r.ics).toContain('SUMMARY:Dated');
    expect(r.ics).not.toContain('Undated AI-discovered series');
  });

  it('rejects malformed and impossible dates rather than rolling them over', () => {
    const r = buildEventsIcs(
      [
        { date: 'March 2026', title: 'Cadence not a date' },
        { date: '2026-13-01', title: 'Month 13' },
        { date: '2026-02-31', title: 'Feb 31' },
        { date: '2027-02-29', title: 'Non-leap Feb 29' },
        { date: '26-03-15', title: 'Short year' },
      ],
      NOW,
    );
    expect(r.eventCount).toBe(0);
    expect(r.skippedUndated).toBe(5);
  });

  it('returns empty (not a hollow VCALENDAR) when nothing is dated', () => {
    const r = buildEventsIcs([{ date: null, title: 'X' }], NOW);
    expect(r.ics).toBe('');
    expect(r.base64).toBe('');
    expect(r.eventCount).toBe(0);
  });

  it('returns empty for no events at all', () => {
    expect(buildEventsIcs([], NOW)).toMatchObject({ ics: '', base64: '', eventCount: 0, skippedUndated: 0 });
  });

  // ── RFC 5545 mechanics ───────────────────────────────────────────────────────
  it('escapes TEXT per §3.3.11 (backslash, semicolon, comma, newline)', () => {
    const r = buildEventsIcs(
      [{ date: '2026-03-15', title: 'A;B,C\\D', description: 'line1\nline2' }],
      NOW,
    );
    expect(r.ics).toContain('SUMMARY:A\\;B\\,C\\\\D');
    expect(r.ics).toContain('line1\\nline2');
  });

  it('folds long lines to a 75-octet budget without splitting UTF-8 sequences', () => {
    const r = buildEventsIcs([{ date: '2026-03-15', title: `Café ${'é'.repeat(120)} end` }], NOW);
    for (const line of r.ics.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
    // Unfolding (drop CRLF + one leading space) must restore the original text.
    const unfolded = r.ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`SUMMARY:Café ${'é'.repeat(120)} end`);
  });

  it('gives an event a stable UID across runs so re-import updates instead of duplicating', () => {
    const e = [{ date: '2026-03-15', title: 'Industry Day', url: 'https://sam.gov/x' }];
    const uid = (s: string) => s.match(/UID:(.+)/)![1];
    expect(uid(buildEventsIcs(e, NOW).ics)).toBe(uid(buildEventsIcs(e, new Date('2027-01-01T00:00:00Z')).ics));
  });

  it('gives different events different UIDs', () => {
    const r = buildEventsIcs(
      [
        { date: '2026-03-15', title: 'Industry Day' },
        { date: '2026-04-20', title: 'Industry Day' }, // same title, different date
      ],
      NOW,
    );
    const uids = [...r.ics.matchAll(/UID:(.+)/g)].map((m) => m[1]);
    expect(uids).toHaveLength(2);
    expect(uids[0]).not.toBe(uids[1]);
  });

  it('omits optional properties when absent and carries the URL into the body', () => {
    const bare = buildEventsIcs([{ date: '2026-03-15', title: 'Bare' }], NOW).ics;
    expect(bare).not.toContain('LOCATION:');
    expect(bare).not.toContain('DESCRIPTION:');
    expect(bare).not.toContain('URL:');

    const full = buildEventsIcs([{ date: '2026-03-15', title: 'T', url: 'https://sam.gov/x' }], NOW).ics;
    expect(full).toContain('URL:https://sam.gov/x');
    expect(full).toContain('DESCRIPTION:Registration: https://sam.gov/x');
  });

  it('falls back to a generic summary for a blank title', () => {
    expect(buildEventsIcs([{ date: '2026-03-15', title: '   ' }], NOW).ics).toContain('SUMMARY:Federal contracting event');
  });
});
