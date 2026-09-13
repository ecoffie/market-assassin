import { describe, it, expect } from 'vitest';
import { parseCalendarYear, sanitizeBriefingCalendar } from './calendar-sanitize';

describe('sanitizeBriefingCalendar', () => {
  const now = new Date('2026-09-13T12:00:00Z');

  it('drops Adam-style invented 2023 dates and keeps the current year', () => {
    const { kept, dropped } = sanitizeBriefingCalendar(
      [
        { date: '2023-03-15', event: 'Industry day' },
        { date: '2026-09-18', event: 'RFI due' },
        { date: '2027-01-06', event: 'Award expected' },
      ],
      now,
    );
    expect(dropped.map((d) => d.date)).toEqual(['2023-03-15']);
    expect(kept.map((d) => d.date)).toEqual(['2026-09-18', '2027-01-06']);
  });

  it('keeps undated rows (not a fabricated year)', () => {
    const { kept, dropped } = sanitizeBriefingCalendar([{ event: 'TBD' }], now);
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });

  it('parses ISO years', () => {
    expect(parseCalendarYear('2023-11-01')).toBe(2023);
    expect(parseCalendarYear('')).toBeNull();
  });
});
