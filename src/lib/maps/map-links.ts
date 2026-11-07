/**
 * "Open on the map" links, built in ONE place so the app and the map agree on the address.
 *
 * These are RECORD links (docs/engineering/record-links-vs-market-links.md): each carries the
 * record's id and nothing else. Never add a fact about the reader (their NAICS, state, set-aside)
 * to one of these: the map would re-filter and could delete the very record the link names.
 *
 * Every builder returns null when it has no usable id, so callers render no link rather than a
 * link to a blank map.
 */
export const MAP_PATH = '/opportunity-map';

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const at = (param: string, id: string): string | null => (id ? `${MAP_PATH}?${param}=${encodeURIComponent(id)}` : null);

/** A SAM notice (or any open opportunity id the map's opportunity-detail endpoint knows). */
export function mapLinkForOpportunity(noticeId: unknown): string | null {
  const id = clean(noticeId);
  // Forecast ids are prefixed fc- and must use ?forecast= (the map routes on the prefix too).
  if (/^fc-/i.test(id)) return at('forecast', id);
  return at('opp', id);
}

/** An agency forecast (agency_forecasts id). */
export function mapLinkForForecast(forecastId: unknown): string | null {
  return at('forecast', clean(forecastId));
}

/** An expiring contract / recompete (recompete_opportunities.contract_id). */
export function mapLinkForRecompete(contractId: unknown): string | null {
  return at('recompete', clean(contractId));
}

/** A company (UEI). */
export function mapLinkForCompany(uei: unknown): string | null {
  return at('company', clean(uei).toUpperCase());
}

/** A government buyer / contact (federal_contacts id). */
export function mapLinkForBuyer(contactId: unknown): string | null {
  return at('buyer', clean(contactId));
}

/** A saved search (saved_searches id). This is the one MARKET link here: it restores that search. */
export function mapLinkForSavedSearch(savedSearchId: unknown): string | null {
  return at('ss', clean(savedSearchId));
}

/** The map itself. */
export function mapHomeLink(): string {
  return MAP_PATH;
}
