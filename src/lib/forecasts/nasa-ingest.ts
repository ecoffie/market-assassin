/**
 * NASA forecast ingest — the STEADY-STATE producer.
 *
 * ⚠️ THIS CONTAINS NO CANONICALIZATION LOGIC. The one-time 2026-09-13 migration
 * (37 duplicate retirements, 109 id migrations, the title/NAICS/buying-office
 * recovery bridge) is DONE and deliberately absent here. Runtime identity is the
 * NASA SourceID and nothing else — a title bridge that survived into runtime
 * would silently re-introduce the ambiguity it was built to escape.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { mapNasaRow, NASA_SOURCE_OWNED_FIELDS, NASA_LEGACY_REPAIR_FIELDS } from './nasa-parse';

export const NASA_FORECAST_URL = 'https://www.hq.nasa.gov/office/procurement/forecast/AcqForecastNew.xlsx';
export const NASA_SHEET = 'Forecast';
export const NASA_CURRENT_SOURCE_TYPE = 'naf_xlsx';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface NasaIngestResult {
  ok: boolean; failure?: string; applied: boolean;
  rawUpstream: number; distinctSourceIds: number; rejectedNoIdentity: number; duplicateSourceIds: number;
  fingerprint: string | null; sourceLastModified: string | null; sourceEtag: string | null;
  matched: number; newProven: number; changed: number; unchanged: number;
  historicalRetained: number; physicalRows: number;
  nullProtectedRows: number; nullProtectedValues: number;
  insertAttempted: number; inserted: number; insertFailed: number;
  updateAttempted: number; updated: number; updateFailed: number;
  dataAdvanced: boolean;
}

const EMPTY = (): NasaIngestResult => ({
  ok: false, applied: false, rawUpstream: 0, distinctSourceIds: 0, rejectedNoIdentity: 0, duplicateSourceIds: 0,
  fingerprint: null, sourceLastModified: null, sourceEtag: null,
  matched: 0, newProven: 0, changed: 0, unchanged: 0, historicalRetained: 0, physicalRows: 0,
  nullProtectedRows: 0, nullProtectedValues: 0,
  insertAttempted: 0, inserted: 0, insertFailed: 0, updateAttempted: 0, updated: 0, updateFailed: 0,
  dataAdvanced: false,
});

/** Fingerprint the VALIDATED workbook bytes. NULL = unmeasured, never "unchanged". */
export function nasaFingerprint(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null;
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return null;   // HTML shell / WAF / soft-404
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

export async function runNasaIngest(
  sb: SupabaseClient,
  opts: { apply?: boolean; fetchImpl?: typeof fetch; workbook?: Uint8Array } = {},
): Promise<NasaIngestResult> {
  const apply = opts.apply === true;
  const base = EMPTY();

  let bytes: Uint8Array;
  let lastModified: string | null = null, etag: string | null = null;
  if (opts.workbook) { bytes = opts.workbook; }
  else {
    try {
      const res = await (opts.fetchImpl ?? fetch)(NASA_FORECAST_URL, { headers: { 'User-Agent': UA } });
      if (!res.ok) return { ...base, failure: `http_${res.status}` };
      lastModified = res.headers.get('last-modified');
      etag = res.headers.get('etag');
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) { return { ...base, failure: `transport: ${(e as Error).message}` }; }
  }
  if (bytes.length === 0) return { ...base, failure: 'empty_body' };
  const fingerprint = nasaFingerprint(bytes);
  // An HTML shell is NOT an empty forecast — it is a failed fetch.
  if (!fingerprint) return { ...base, failure: 'not_xlsx' };

  let rows: unknown[][];
  try {
    const wb = XLSX.read(bytes, { type: 'array' });
    const ws = wb.Sheets[NASA_SHEET];
    if (!ws) return { ...base, fingerprint, sourceLastModified: lastModified, sourceEtag: etag, failure: `sheet_missing:${NASA_SHEET}` };
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
    rows = aoa.slice(1).filter((r) => Array.isArray(r) && r.some((c) => c != null && String(c).trim() !== ''));
  } catch (e) {
    return { ...base, fingerprint, sourceLastModified: lastModified, sourceEtag: etag, failure: `parse: ${(e as Error).message}` };
  }
  if (rows.length === 0) return { ...base, fingerprint, sourceLastModified: lastModified, sourceEtag: etag, failure: 'no_data_rows' };

  const mapped = rows.map(mapNasaRow);
  const usable = mapped.filter((m): m is NonNullable<typeof m> => !!m);
  const rejectedNoIdentity = mapped.length - usable.length;
  const ids = usable.map((m) => m.sourceId);
  const duplicateSourceIds = ids.length - new Set(ids).size;
  // A duplicate SourceID is an identity failure, never a first-wins merge.
  if (duplicateSourceIds > 0) {
    return { ...base, fingerprint, sourceLastModified: lastModified, sourceEtag: etag,
      rawUpstream: rows.length, duplicateSourceIds, rejectedNoIdentity, failure: `duplicate_source_ids:${duplicateSourceIds}` };
  }

  // Held: paged. An unranged read caps at 1,000 and would fabricate the plan.
  const held = new Map<string, Record<string, unknown>>();
  let historicalRetained = 0, physicalRows = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('agency_forecasts')
      .select(['id', 'external_id', 'source_type', ...NASA_SOURCE_OWNED_FIELDS].join(','))
      .eq('source_agency', 'NASA').range(from, from + 999);
    if (error) return { ...base, fingerprint, sourceLastModified: lastModified, sourceEtag: etag, failure: `held_read: ${error.message}` };
    if (!data?.length) break;
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      physicalRows++;
      if (r.source_type === NASA_CURRENT_SOURCE_TYPE) held.set(String(r.external_id), r);
      else historicalRetained++;
    }
    if (data.length < 1000) break;
  }

  const cmp = (v: unknown) => (v == null ? '' : typeof v === 'number' ? String(v) : String(v).replace(/\s+/g, ' ').trim());
  const REPAIR = new Set<string>(NASA_LEGACY_REPAIR_FIELDS as readonly string[]);
  const toInsert: typeof usable = [];
  const toUpdate: Array<{ sourceId: string; patch: Record<string, unknown> }> = [];
  let matched = 0, unchanged = 0, nullRows = 0, nullVals = 0;

  for (const m of usable) {
    const h = held.get(m.sourceId);
    if (!h) { toInsert.push(m); continue; }
    matched++;
    const src = m.fields as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let prot = false;
    // NB: external_id is deliberately NOT in the whitelist — identity is never
    // rewritten by a routine sync; that was the one-time canonicalization's job.
    for (const f of NASA_SOURCE_OWNED_FIELDS) {
      const sv = src[f], hv = h[f];
      if (cmp(sv) === cmp(hv)) continue;
      // source NULL cannot erase a held fact — except in a proven mis-mapped field.
      if (cmp(sv) === '' && cmp(hv) !== '' && !REPAIR.has(f)) { nullVals++; prot = true; continue; }
      patch[f] = sv;
    }
    if (prot) nullRows++;
    if (Object.keys(patch).length) toUpdate.push({ sourceId: m.sourceId, patch });
    else unchanged++;
  }

  // SEMANTIC GATE — a balanced plan can still be an identity collapse.
  if (held.size > 0 && matched === 0) {
    return { ...base, fingerprint, sourceLastModified: lastModified, sourceEtag: etag,
      rawUpstream: rows.length, failure: 'semantic: matched 0 against a non-empty corpus' };
  }

  const r: NasaIngestResult = {
    ...base, ok: true, fingerprint, sourceLastModified: lastModified, sourceEtag: etag,
    rawUpstream: rows.length, distinctSourceIds: new Set(ids).size, rejectedNoIdentity, duplicateSourceIds,
    matched, newProven: toInsert.length, changed: toUpdate.length, unchanged,
    historicalRetained, physicalRows, nullProtectedRows: nullRows, nullProtectedValues: nullVals,
  };
  if (!apply) return r;

  r.applied = true;
  r.insertAttempted = toInsert.length;
  for (let i = 0; i < toInsert.length; i += 500) {
    const batch = toInsert.slice(i, i + 500).map((m) => ({
      ...(m.fields as Record<string, unknown>), ...(m.derived as Record<string, unknown>),
      source_agency: 'NASA', source_type: NASA_CURRENT_SOURCE_TYPE,
      source_url: NASA_FORECAST_URL, last_synced_at: new Date().toISOString(),
    }));
    const { count, error } = await sb.from('agency_forecasts').insert(batch, { count: 'exact' });
    if (error) { r.insertFailed += batch.length; continue; }
    r.inserted += count ?? batch.length;
  }
  r.updateAttempted = toUpdate.length;
  for (const u of toUpdate) {
    const { count, error } = await sb.from('agency_forecasts')
      .update({ ...u.patch, last_synced_at: new Date().toISOString() }, { count: 'exact' })
      .eq('source_agency', 'NASA').eq('source_type', NASA_CURRENT_SOURCE_TYPE).eq('external_id', u.sourceId);
    if (error) { r.updateFailed++; continue; }
    r.updated += count ?? 0;
  }
  r.dataAdvanced = r.inserted > 0 || r.updated > 0;
  const balanced = r.inserted + r.insertFailed === r.insertAttempted && r.updated + r.updateFailed === r.updateAttempted;
  r.ok = r.insertFailed === 0 && r.updateFailed === 0 && balanced;
  if (!r.ok) r.failure = balanced ? 'partial_mutation' : 'receipt_mismatch';
  return r;
}
