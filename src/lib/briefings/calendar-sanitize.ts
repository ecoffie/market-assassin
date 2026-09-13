/**
 * Drop LLM-invented calendar dates that cannot be this week's briefing.
 *
 * Weekly Deep Dive calendar items are generated as JSON, not read from
 * `sam_events`. Adam Sokolowski's 2026-09-11 weekly carried 2023 dates.
 * Keep the current year and next year (award_expected can be next FY).
 * Undated rows stay — they are not a fabricated past year.
 */

export function parseCalendarYear(date: string | null | undefined): number | null {
  const raw = String(date || '').trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(iso[1]);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).getUTCFullYear();
}

export function isPlausibleBriefingCalendarYear(
  year: number | null,
  now: Date = new Date(),
): boolean {
  if (year === null) return true;
  const current = now.getUTCFullYear();
  return year >= current && year <= current + 1;
}

export function sanitizeBriefingCalendar<T extends { date?: string | null }>(
  items: T[] | null | undefined,
  now: Date = new Date(),
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items || []) {
    const year = parseCalendarYear(item.date);
    if (isPlausibleBriefingCalendarYear(year, now)) kept.push(item);
    else dropped.push(item);
  }
  return { kept, dropped };
}
