/**
 * Weekly calendar entries must come from a source record's own date.
 *
 * Weekly Deep Dive calendar items used to be LLM JSON. Adam Sokolowski's
 * 2026-09-11 weekly carried invented 2023 dates. A year-window filter is not
 * enough: an invented 2026 date would still pass, and unparseable rows were
 * kept. Require a source identifier + a verified date. Omit unsupported
 * entries. Never "repair" a year.
 */

export type VerifiedCalendarSource = {
  sourceId: string;
  date: string;
  event: string;
  type: 'deadline' | 'industry_day' | 'rfi_due' | 'award_expected';
  priority: 'high' | 'medium' | 'low';
};

export type CalendarEntry = {
  sourceId?: string | null;
  date?: string | null;
  event?: string | null;
  type?: string | null;
  priority?: string | null;
};

/** ISO calendar day (YYYY-MM-DD) as the record stored it. Null if unparseable. */
export function parseVerifiedDateIso(raw: string | null | undefined): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return null;
    }
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  return null;
}

export function parseCalendarYear(date: string | null | undefined): number | null {
  const iso = parseVerifiedDateIso(date);
  if (!iso) return null;
  return Number(iso.slice(0, 4));
}

function sourceKey(id: string, date: string): string {
  return `${id.trim()}|${date}`;
}

export function verifiedCalendarSource(args: {
  sourceId: string | null | undefined;
  date: string | null | undefined;
  event: string;
  type?: VerifiedCalendarSource['type'];
  priority?: VerifiedCalendarSource['priority'];
}): VerifiedCalendarSource | null {
  const sourceId = String(args.sourceId || '').trim();
  const date = parseVerifiedDateIso(args.date);
  if (!sourceId || !date) return null;
  return {
    sourceId,
    date,
    event: args.event,
    type: args.type || 'deadline',
    priority: args.priority || 'medium',
  };
}

export function calendarEntriesFromSources(
  sources: VerifiedCalendarSource[],
  max = 6,
): VerifiedCalendarSource[] {
  const seen = new Set<string>();
  const unique: VerifiedCalendarSource[] = [];
  for (const source of sources) {
    const key = sourceKey(source.sourceId, source.date);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(source);
  }
  unique.sort((a, b) => a.date.localeCompare(b.date));
  return unique.slice(0, max);
}

export function verifiedSourcesFromContracts(
  contracts: Array<{
    contractNumber?: string | null;
    contractName?: string | null;
    agency?: string | null;
    incumbent?: string | null;
    expirationDate?: string | null;
  }>,
): VerifiedCalendarSource[] {
  const out: VerifiedCalendarSource[] = [];
  for (const contract of contracts) {
    const source = verifiedCalendarSource({
      sourceId: contract.contractNumber,
      date: contract.expirationDate,
      event: `${contract.contractName || contract.contractNumber || 'Contract'} expires${
        contract.incumbent ? ` (${contract.incumbent})` : ''
      }`,
      type: 'deadline',
      priority: 'high',
    });
    if (source) out.push(source);
  }
  return out;
}

export function verifiedSourcesFromWeeklyData(data: {
  recompetes?: Array<{
    piid?: string | null;
    contractNumber?: string | null;
    incumbentName?: string | null;
    agency?: string | null;
    currentCompletionDate?: string | null;
    ultimateCompletionDate?: string | null;
  }>;
  awards?: Array<{
    awardId?: string | null;
    piid?: string | null;
    recipientName?: string | null;
    endDate?: string | null;
    startDate?: string | null;
  }>;
}): VerifiedCalendarSource[] {
  const out: VerifiedCalendarSource[] = [];
  for (const row of data.recompetes || []) {
    const source = verifiedCalendarSource({
      sourceId: row.piid || row.contractNumber,
      date: row.currentCompletionDate || row.ultimateCompletionDate,
      event: `${row.incumbentName || row.piid || 'Incumbent'} contract ends${
        row.agency ? ` at ${row.agency}` : ''
      }`,
      type: 'deadline',
      priority: 'high',
    });
    if (source) out.push(source);
  }
  for (const row of data.awards || []) {
    const source = verifiedCalendarSource({
      sourceId: row.awardId || row.piid,
      date: row.endDate || row.startDate,
      event: `${row.recipientName || row.piid || 'Award'} period of performance`,
      type: 'deadline',
      priority: 'medium',
    });
    if (source) out.push(source);
  }
  return out;
}

/**
 * Keep a calendar row only when it cites a source and a verified date.
 *
 * Generate-time: pass the source catalog. The date must equal that record's
 * date exactly — never rewrite the year to "fix" it.
 * Send-time (cached templates): omit rows that lack sourceId or a parseable
 * ISO date. Old LLM templates without source ids drop entirely.
 */
export function sanitizeBriefingCalendar<T extends CalendarEntry>(
  items: T[] | null | undefined,
  sources?: VerifiedCalendarSource[],
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  const catalog = new Map<string, string>();
  for (const source of sources || []) {
    catalog.set(source.sourceId, source.date);
  }

  for (const item of items || []) {
    const sourceId = String(item.sourceId || '').trim();
    const date = parseVerifiedDateIso(item.date);
    if (!sourceId || !date) {
      dropped.push(item);
      continue;
    }
    if (sources) {
      const verified = catalog.get(sourceId);
      if (!verified || verified !== date) {
        dropped.push(item);
        continue;
      }
    }
    kept.push(item);
  }
  return { kept, dropped };
}
