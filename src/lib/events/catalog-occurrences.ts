/**
 * Dated occurrences in the curated event catalog (src/data/federal-events-sources.json).
 *
 * Most catalog entries hold only a typical month. An entry may also carry `next_occurrence`: a date
 * read from the organizer's own page, with where and when it was read. Only those are ever treated
 * as a real date. Once the event is over the date stops being returned, so the entry falls back to
 * its typical month instead of presenting a past date as "next".
 */
import eventsStaticData from '@/data/federal-events-sources.json';
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';

export interface CatalogOccurrence {
  /** YYYY-MM-DD */
  start: string;
  /** YYYY-MM-DD, inclusive */
  end: string;
  location: string | null;
  /** Structured 2-letter state of the venue (null = virtual / not stated). Used by the state filter. */
  state?: string | null;
  registration_url: string | null;
  verified_at: string;
  source_url: string;
}

export interface CatalogEventRow {
  title: string;
  event_date: string;
  event_end_date: string;
  location: string | null;
  state: string | null;
  url: string | null;
  description: string | null;
  verified_at: string;
  source_url: string;
}

type DatedConference = {
  name?: string;
  audience?: string;
  value?: string;
  url?: string;
  agencies?: string[];
  next_occurrence?: CatalogOccurrence;
};

/** The occurrence, unless it has already finished. Dates are compared as YYYY-MM-DD strings. */
export function currentOccurrence(o: CatalogOccurrence | undefined, todayStr: string): CatalogOccurrence | null {
  return o && o.end >= todayStr ? o : null;
}

/**
 * Dated events for one agency that overlap the window. Matching is exact on the normalized name, so
 * "Veterans Affairs" and "VA" find a VA event but a fragment such as "Affairs" does not.
 */
export function catalogOccurrencesForAgency(agency: string, todayStr: string, horizonStr: string): CatalogEventRow[] {
  const key = normalizeAgencyKey(agency);
  if (!key) return [];
  const conferences = (eventsStaticData as { majorAnnualConferences?: DatedConference[] }).majorAnnualConferences || [];
  const rows: CatalogEventRow[] = [];
  for (const c of conferences) {
    const o = currentOccurrence(c.next_occurrence, todayStr);
    if (!o || o.start > horizonStr || !c.name) continue;
    if (!(c.agencies || []).some((a) => normalizeAgencyKey(a) === key)) continue;
    rows.push({
      title: c.name,
      event_date: o.start,
      event_end_date: o.end,
      location: o.location,
      state: o.state ?? null,
      url: o.registration_url || c.url || o.source_url,
      description: c.value || c.audience || null,
      verified_at: o.verified_at,
      source_url: o.source_url,
    });
  }
  return rows.sort((a, b) => a.event_date.localeCompare(b.event_date));
}

/** Every catalog entry with a verified, not-yet-finished occurrence (name + start), any agency. */
export function catalogFutureDates(todayStr: string): Array<{ name: string; start: string }> {
  const conferences = (eventsStaticData as { majorAnnualConferences?: DatedConference[] }).majorAnnualConferences || [];
  const out: Array<{ name: string; start: string }> = [];
  for (const c of conferences) {
    const o = currentOccurrence(c.next_occurrence, todayStr);
    if (o && c.name) out.push({ name: c.name, start: o.start });
  }
  return out;
}

/** Dated catalog conferences whose venue is in one of the states (structured `state`, never parsed text). */
export function catalogOccurrencesForStates(states: string[], todayStr: string, horizonStr: string): CatalogEventRow[] {
  const want = new Set(states.map((x) => x.toUpperCase()));
  const conferences = (eventsStaticData as { majorAnnualConferences?: DatedConference[] }).majorAnnualConferences || [];
  const rows: CatalogEventRow[] = [];
  for (const c of conferences) {
    const o = currentOccurrence(c.next_occurrence, todayStr);
    if (!o || o.start > horizonStr || !c.name || !o.state || !want.has(o.state)) continue;
    rows.push({
      title: c.name, event_date: o.start, event_end_date: o.end, location: o.location, state: o.state,
      url: o.registration_url || c.url || o.source_url, description: c.value || c.audience || null,
      verified_at: o.verified_at, source_url: o.source_url,
    });
  }
  return rows.sort((a, b) => a.event_date.localeCompare(b.event_date));
}
