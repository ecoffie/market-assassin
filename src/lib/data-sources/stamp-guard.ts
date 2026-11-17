/**
 * The manual freshness stamp (`/api/cron/check-data-freshness?stamp=<key>`) may only
 * advance `data_sources.last_built` when the caller supplies EVIDENCE of a refresh.
 *
 * Before 2026-11-17 the stamp was a bare `UPDATE last_built = today` for any key,
 * so the one action that clears a freshness alert required nothing but the
 * admin password. Rule (Eric, 2026-11-17): never mark a source refreshed merely to
 * clear an alert.
 *
 * Refused outright:
 *  - unknown or inactive keys
 *  - table-measured sources (freshness comes from their rows, not a stamp)
 *  - the events catalog (freshness comes from the file)
 *  - producer-stamped sources (their own job writes the stamp from its own evidence)
 *  - live APIs (nothing is stored to go stale)
 * Otherwise a stamp needs a positive record count and a written evidence note that
 * names where the refresh can be checked (a URL, commit, PR or file path).
 * The evidence is appended to `notes` so the stamp can be audited later.
 */
import { isTableMeasured } from './table-measured';
import { CATALOG_KEY } from '@/lib/events/catalog-freshness';

export const CATALOG_STAMP_KEY = CATALOG_KEY;

/** Sources whose producer writes `last_built` itself from its own run evidence. */
export const PRODUCER_STAMPED_KEYS: ReadonlySet<string> = new Set([
  'bq_awards',
  'bq_award_lookups',
  'bq_players',
  'institute_gao',
  'institute_legislation',
  'seo_lookup_demand',
]);

const EVIDENCE_REFERENCE = /(https?:\/\/\S+|\b[0-9a-f]{7,40}\b|#\d+|\b[\w./-]+\.(json|csv|md|ts|js|mjs|sql)\b)/i;
const MIN_EVIDENCE_CHARS = 20;

export type StampRow = { key: string; is_active?: boolean | null; category?: string | null; notes?: string | null };

export type StampDecision =
  | { ok: true; update: { last_built: string; record_count: number; notes: string } }
  | { ok: false; status: number; reason: string };

export function decideStamp(input: {
  key: string;
  row: StampRow | null | undefined;
  evidence: string | null | undefined;
  records: string | number | null | undefined;
  today: string;
}): StampDecision {
  const { key, row, today } = input;
  if (!row) return { ok: false, status: 404, reason: `unknown data source "${key}"` };
  if (row.is_active === false) return { ok: false, status: 409, reason: `"${key}" is inactive` };
  if (isTableMeasured(key)) {
    return { ok: false, status: 409, reason: `"${key}" is measured from its own rows; a stamp cannot change its freshness` };
  }
  if (key === CATALOG_STAMP_KEY) {
    return { ok: false, status: 409, reason: `"${key}" freshness comes from the catalog file (lastFullReview + per-entry verification); edit the file instead` };
  }
  if (PRODUCER_STAMPED_KEYS.has(key)) {
    return { ok: false, status: 409, reason: `"${key}" is stamped by its own producer from run evidence; a manual stamp would bypass that` };
  }
  if (row.category === 'live_api') {
    return { ok: false, status: 409, reason: `"${key}" is a live API; there is nothing stored to stamp` };
  }

  const evidence = (input.evidence ?? '').trim();
  if (evidence.length < MIN_EVIDENCE_CHARS || !EVIDENCE_REFERENCE.test(evidence)) {
    return {
      ok: false,
      status: 400,
      reason: `evidence required: describe the refresh in ≥${MIN_EVIDENCE_CHARS} characters and cite where it can be checked (URL, commit, PR or file path)`,
    };
  }
  const recordsRaw = typeof input.records === 'number' ? String(input.records) : (input.records ?? '').trim();
  if (!/^\d+$/.test(recordsRaw) || Number(recordsRaw) <= 0) {
    return { ok: false, status: 400, reason: 'records required: the positive record count the refresh produced' };
  }
  const records = Number(recordsRaw);
  const line = `[stamped ${today}] records=${records} evidence=${evidence.replace(/\s+/g, ' ')}`;
  const notes = row.notes ? `${row.notes}\n${line}` : line;
  return { ok: true, update: { last_built: today, record_count: records, notes } };
}
