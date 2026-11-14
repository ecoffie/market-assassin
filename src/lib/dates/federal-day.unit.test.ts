import { describe, it, expect } from 'vitest';
import { federalToday, addMonthsIso, daysBetween } from './federal-day';

describe('federal business day (US Eastern) is the single date basis', () => {
  it('late evening Eastern is still the same federal day even when UTC has rolled over', () => {
    expect(federalToday(new Date('2026-11-14T03:30:00Z'))).toBe('2026-11-13'); // 10:30 PM EST
    expect(federalToday(new Date('2026-11-14T05:00:00Z'))).toBe('2026-11-14'); // 00:00 EST
    expect(federalToday(new Date('2026-07-01T03:59:00Z'))).toBe('2026-06-30'); // 11:59 PM EDT
  });
  it('month arithmetic clamps to month end', () => {
    expect(addMonthsIso('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonthsIso('2026-11-13', 18)).toBe('2028-05-13');
  });
  it('day counts are calendar-day differences on the same basis', () => {
    expect(daysBetween('2026-11-13', '2026-07-31')).toBe(-105);
    expect(daysBetween('2026-11-14', '2026-07-31')).toBe(-106);
  });
});
