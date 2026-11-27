/**
 * State / regional matchmakers and APEX Accelerator events (src/data/regional-events-catalog.json).
 * Official organizer pages only. A row is dated ONLY when the organizer's page states the date; otherwise it is a
 * standing organizer row whose reader text is "check the organizer page" — never a guessed date. verified_at stays
 * internal (never returned).
 */
import catalog from '@/data/regional-events-catalog.json';

export type RegionalKind = 'matchmaker' | 'apex' | 'industry_day' | 'conference';

interface RegionalRow {
  id: string; name: string; organizer: string; url: string; state: string; city: string | null; kind: RegionalKind;
  description: string;
  next_occurrence: { title?: string; start: string; end: string; url?: string; location?: string | null } | null;
  verification: { verified_at: string; source_url: string; note?: string };
}

export interface RegionalEvent {
  id: string;
  title: string;
  organizer: string;
  kind: RegionalKind;
  state: string;
  city: string | null;
  /** YYYY-MM-DD from the organizer's page, or null = no date stated → check the organizer page. */
  event_date: string | null;
  event_end_date: string | null;
  url: string;
  organizer_url: string;
  /** The organizer page the row (and any date) was read from. */
  source_url: string;
  description: string;
  date_note: string | null;
}

const ROWS = (catalog as { rows: RegionalRow[] }).rows;
export const REGIONAL_COVERED_STATES: readonly string[] = (catalog as { covered_states: string[] }).covered_states;
export const REGIONAL_FALLBACK = (catalog as { fallback: { name: string; url: string } }).fallback;

/**
 * Rows for the requested states. A dated row appears when its date falls in the window; a row with no stated (or a
 * past) date appears as a standing organizer row ("check the organizer page").
 */
export function regionalEventsForStates(states: string[], todayStr: string, horizonStr: string, nearCity?: string | null): RegionalEvent[] {
  const want = new Set(states.map((s) => s.toUpperCase()));
  const city = (nearCity || '').trim().toLowerCase();
  const out: RegionalEvent[] = [];
  for (const r of ROWS) {
    if (!want.has(r.state)) continue;
    const o = r.next_occurrence;
    const dated = o && o.end >= todayStr && o.start <= horizonStr ? o : null;
    out.push({
      id: r.id,
      title: dated?.title || r.name,
      organizer: r.organizer,
      kind: r.kind,
      state: r.state,
      city: r.city,
      event_date: dated ? dated.start : null,
      event_end_date: dated ? dated.end : null,
      url: dated?.url || r.url,
      organizer_url: r.url,
      source_url: r.verification.source_url,
      description: r.description,
      date_note: dated ? null : 'No upcoming date stated on the organizer page. Check the organizer page.',
    });
  }
  // Dated first (soonest), then standing rows; within each, the requested city first.
  const cityRank = (e: RegionalEvent) => (city && (e.city || '').toLowerCase() === city ? 0 : 1);
  return out.sort((a, b) => (a.event_date ? 0 : 1) - (b.event_date ? 0 : 1)
    || (a.event_date || '').localeCompare(b.event_date || '') || cityRank(a) - cityRank(b) || a.title.localeCompare(b.title));
}

/** Coverage statement for the requested states: which have catalog rows, which do not, and the fallback. */
export function regionalCoverage(states: string[]): { covered: string[]; not_covered: string[]; fallback: { name: string; url: string } } {
  const up = [...new Set(states.map((s) => s.toUpperCase()))];
  return {
    covered: up.filter((s) => REGIONAL_COVERED_STATES.includes(s)),
    not_covered: up.filter((s) => !REGIONAL_COVERED_STATES.includes(s)),
    fallback: REGIONAL_FALLBACK,
  };
}
