import { describe, it, expect } from 'vitest';
import {
  calendarEntriesFromSources,
  parseVerifiedDateIso,
  sanitizeBriefingCalendar,
  verifiedCalendarSource,
  verifiedSourcesFromContracts,
} from './calendar-sanitize';

describe('sanitizeBriefingCalendar — source-grounded, no year repair', () => {
  // Must stay strictly after CI's UTC calendar day. 2026-09-18 was "today" when
  // the fixture shipped and started failing on 2026-09-19 (`date < today` drop).
  const GROUNDED_DAY = '2026-12-15';
  const sources = [
    verifiedCalendarSource({
      sourceId: 'N00178-21-D-1234',
      date: GROUNDED_DAY,
      event: 'NIWC cyber expires',
    })!,
    verifiedCalendarSource({
      sourceId: 'HT0011-24-C-0001',
      date: '2027-01-06',
      event: 'DHA award ends',
    })!,
  ];

  it('omits invented years, unparseable dates, and rows with no source id', () => {
    const { kept, dropped } = sanitizeBriefingCalendar(
      [
        { date: '2023-03-15', event: 'Industry day' },
        { date: GROUNDED_DAY, event: 'Invented this year, no source' },
        { date: 'March 30, 2026', event: 'Unparseable prose date', sourceId: 'N00178-21-D-1234' },
        { sourceId: 'N00178-21-D-1234', date: GROUNDED_DAY, event: 'Grounded' },
      ],
      sources,
    );
    expect(kept.map((d) => d.event)).toEqual(['Grounded']);
    expect(dropped).toHaveLength(3);
  });

  it('does not keep an invented current-year date even when a source id is attached to the wrong day', () => {
    const { kept, dropped } = sanitizeBriefingCalendar(
      [{ sourceId: 'N00178-21-D-1234', date: '2026-12-25', event: 'Wrong day' }],
      sources,
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it('never rewrites a mismatched year onto the source date', () => {
    const item = { sourceId: 'N00178-21-D-1234', date: '2023-09-18', event: 'Same month, wrong year' };
    const { kept } = sanitizeBriefingCalendar([item], sources);
    expect(kept).toHaveLength(0);
    expect(item.date).toBe('2023-09-18');
  });

  it('send-time cached templates: omit rows without sourceId or ISO date', () => {
    const { kept, dropped } = sanitizeBriefingCalendar([
      { date: GROUNDED_DAY, event: 'LLM leftover' },
      { sourceId: 'N00178-21-D-1234', date: 'not a date', event: 'Bad date' },
      { sourceId: 'N00178-21-D-1234', date: GROUNDED_DAY, event: 'Cached grounded' },
      { sourceId: 'OLD', date: '2015-12-31', event: 'Verified but already past' },
    ]);
    expect(dropped).toHaveLength(3);
    expect(kept.map((d) => d.event)).toEqual(['Cached grounded']);
  });

  it('builds calendar from source records and skips undated or past contracts', () => {
    const built = calendarEntriesFromSources(
      verifiedSourcesFromContracts([
        { contractNumber: 'A', contractName: 'Cyber IDIQ', incumbent: 'Acme', expirationDate: '2026-10-01' },
        { contractNumber: 'B', contractName: 'No date', expirationDate: '' },
        { contractNumber: 'C', contractName: 'Prose date', expirationDate: 'October 1, 2026' },
        { contractNumber: 'D', contractName: 'Later', incumbent: 'Beta', expirationDate: '2026-11-15' },
        { contractNumber: 'E', contractName: 'Already ended', incumbent: 'Old', expirationDate: '2015-12-31' },
      ]),
    );
    expect(built.map((row) => row.sourceId)).toEqual(['A', 'D']);
    expect(built.map((row) => row.date)).toEqual(['2026-10-01', '2026-11-15']);
  });

  it('rejects impossible calendar days instead of rolling them', () => {
    expect(parseVerifiedDateIso('2026-02-30')).toBeNull();
    expect(parseVerifiedDateIso('2026-09-18')).toBe('2026-09-18');
  });
});
