/**
 * SSA OSDBU contracting-forecast producer — steady-state, fully automated.
 *
 * ⚠️ THREE SSA-SPECIFIC TRAPS, each measured on the live source:
 *
 * 1. AKAMAI WAF. ssa.gov refuses a bare or UA-only request with 403, and rate-limits
 *    bursts. It can also return **HTTP 200 with an HTML error body**, so status is NOT
 *    proof of a payload — the XLSM signature is checked separately. HEAD is refused
 *    outright, so metadata comes from the GET response.
 *
 * 2. THE CANONICAL LINK IS NOT THE NEWEST-LOOKING FILENAME. The page lists
 *    `SBF_SSASy_Report_06222026.xlsm` (correct, FY26, in the "Contracting Forecast"
 *    section) and `SBF_SSASy_Report_12112026.xlsm` (stale, in "Main Menu"). Sorting by
 *    the filename date picks the WRONG one — 12112026 parses as later. Selection is
 *    therefore SEMANTIC: scope to the Contracting Forecast section, then take the
 *    highest explicit FY<YY> label in the link text.
 *
 * 3. PRINT-LAYOUT BANDS. The sheet repeats its 15 columns at offsets 35 and 51; those
 *    bands are always empty. Only the first band carries data, and the header is not
 *    row 0 — it is located by finding the row containing "APP #".
 *
 * Identity is the source-native APP # (`SSA-<APP#>`). The recovered 12112026 edition is
 * provenance-repair EVIDENCE ONLY and must never participate in runtime ingestion.
 */
import { applyInsertGuard } from './writer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import * as xlsx from 'xlsx';

export const SSA_DISCOVERY_URL = 'https://www.ssa.gov/osdbu/contract-forecast-intro.html';
export const SSA_SOURCE_KEY = 'forecast_ssa_osdbu';
const SSA_ORIGIN = 'https://www.ssa.gov';

/** The browser-like header set proven to pass the WAF. A UA alone is NOT enough. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
function wafHeaders(referer?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Upgrade-Insecure-Requests': '1',
  };
  if (referer) h.Referer = referer;
  return h;
}

/** Typed failures — a source problem must never read as "0 forecasts" or "current". */
export type SsaFailure =
  | 'source_access_blocked' | 'not_xlsm' | 'source_retired' | 'discovery_failure'
  | 'parse_failure' | 'source_schema_failure' | 'identity_failure' | 'receipt_mismatch';

export interface SsaIngestResult {
  /** Set when the daily-sync new-row guard refused this run's inserts (src/lib/forecasts/writer.ts). */
  insertRefused?: string;
  /** Whether the refused new rows were saved to forecast_refused_loads (false = replay needs a re-fetch). */
  insertQuarantined?: boolean;
  ok: boolean; failure?: SsaFailure; failureDetail?: string; applied: boolean;
  discoveryUrl: string; selectedUrl?: string; selectedLabel?: string;
  fingerprint?: string; sourceLastModified?: string | null; sourceEtag?: string | null;
  rawUpstream: number; distinctSourceIds: number; rejectedNoIdentity: number; duplicateSourceIds: number;
  matched: number; newProven: number; changed: number; unchanged: number;
  inserted: number; updated: number; historicalRetained: number; physicalRows: number;
  nullProtectedRows: number; nullProtectedValues: number;
  malformedHeldRawData: number; rawDataRepairsNeeded: number; legacySetAsideRepairsNeeded: number;
  insertAttempted: number; insertFailed: number; updateAttempted: number; updateFailed: number;
  dataAdvanced: boolean;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Paced, bounded-retry fetch. A 403 is retryable; it is never "empty". */
async function wafFetch(url: string, referer: string | undefined, fetchImpl: typeof fetch, tries = 4) {
  let last = 0;
  for (let i = 0; i < tries; i++) {
    const res = await fetchImpl(url, { headers: wafHeaders(referer), redirect: 'follow' });
    if (res.status !== 403) return res;
    last = res.status;
    if (i < tries - 1) await sleep(1200 * (i + 1));   // pace; do not hammer
  }
  return { ok: false, status: last, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' } as unknown as Response;
}

/**
 * Select the canonical workbook SEMANTICALLY.
 * Scope to the "Contracting Forecast" section, then the highest explicit FY<YY> label.
 */
export function selectCanonicalLink(html: string): { url: string; label: string; fy: number } | null {
  const secRe = /<h[1-6][^>]*>\s*Contracting\s+Forecast\s*<\/h[1-6]>/i;
  const m = secRe.exec(html);
  if (!m) return null;
  const after = html.slice(m.index + m[0].length);
  const end = /<\/section>/i.exec(after);
  const scope = end ? after.slice(0, end.index) : after;

  let best: { url: string; label: string; fy: number } | null = null;
  const aRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let a: RegExpExecArray | null;
  while ((a = aRe.exec(scope))) {
    const href = a[1];
    const label = a[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const fym = /\bFY\s?(\d{2})\b/i.exec(label);
    if (!fym) continue;                                   // an FY label is required
    if (!/\.(xlsm|xlsx|csv)(\?|$)/i.test(href)) continue; // machine-readable only
    const fy = 2000 + Number(fym[1]);
    if (!best || fy > best.fy) {
      best = { url: href.startsWith('http') ? href : new URL(href, SSA_DISCOVERY_URL).toString(), label, fy };
    }
  }
  return best;
}

/** Locate the real header row + first data band. Print-layout bands are ignored. */
export function parseSsaWorkbook(buf: Buffer) {
  let wb: xlsx.WorkBook;
  try { wb = xlsx.read(buf, { type: 'buffer' }); }
  catch (e) { throw Object.assign(new Error(`xlsx read failed: ${(e as Error).message}`), { failure: 'parse_failure' as SsaFailure }); }
  if (!wb.SheetNames.length) throw Object.assign(new Error('no sheets'), { failure: 'source_schema_failure' as SsaFailure });

  const grid = xlsx.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  let hi = -1;
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const cells = (grid[i] || []).map(c => String(c ?? '').trim().toUpperCase());
    if (cells.some(c => c === 'APP #' || c === 'APP#')) { hi = i; break; }
  }
  if (hi < 0) throw Object.assign(new Error('header row containing "APP #" not found'), { failure: 'source_schema_failure' as SsaFailure });

  const header = (grid[hi] || []).map(c => String(c ?? '').trim());
  const appIdx = header.findIndex(h => /^APP ?#$/i.test(h));
  const rows: Array<Record<string, unknown>> = [];
  let rawUpstream = 0, blankIdentity = 0;
  for (const r of grid.slice(hi + 1)) {
    if (!r || !r.slice(0, 15).some(c => c !== null && String(c).trim() !== '')) continue;  // band/blank
    rawUpstream++;
    const app = r[appIdx];
    if (app === null || app === undefined || String(app).trim() === '') { blankIdentity++; continue; }
    const obj: Record<string, unknown> = {};
    header.forEach((h, i) => { if (h && i < 15) obj[h] = r[i] === undefined ? null : r[i]; });
    rows.push(obj);
  }
  return { header, rows, rawUpstream, blankIdentity };
}

export const SSA_SOURCE_OWNED_FIELDS = [
  'title', 'description', 'bureau', 'contracting_office', 'naics_code', 'naics_description',
  'estimated_value_min', 'estimated_value_max', 'set_aside_type', 'contract_type',
  'competition_type', 'incumbent_name', 'incumbent_contract_number', 'pop_state',
] as const;

/** The established canonical normalization — never hand-authored strings. */
export function normalizeSetAside(competition: unknown): string | null {
  if (!competition) return null;
  const c = String(competition).toLowerCase();
  if (c.includes('8(a)')) return '8(a)';
  if (c.includes('small business') || c.includes('small-business')) return 'Small Business';
  if (c.includes('unrestricted') || c.includes('full and open')) return 'Full and Open';
  return String(competition);
}

/** estimated_value_* is a BIGINT column; the established contract rounds. No cents churn. */
export function parseEstCost(v: unknown): { min: number | null; max: number | null } {
  if (v === null || v === undefined || String(v).trim() === '') return { min: null, max: null };
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, '').trim());
  if (!Number.isFinite(n)) return { min: null, max: null };
  const r = Math.round(n);
  return { min: r, max: r };
}

const txt = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());

export function mapSourceRow(src: Record<string, unknown>) {
  const site = txt(src['SITE Type']), req = txt(src['REQUIREMENT TYPE']), desc = txt(src['DESCRIPTION']);
  const naics = txt(src['NAICS']); const { min, max } = parseEstCost(src['EST COST PER FY']);
  return {
    title: desc ?? `SSA ${req ?? 'Forecast'}`,
    description: `${req ?? ''} - ${desc ?? ''}`.trim(),
    bureau: site, contracting_office: site,
    naics_code: naics ? naics.slice(0, 6) : null,
    naics_description: txt(src['NAICS DESCRIPTION']),
    estimated_value_min: min, estimated_value_max: max,
    set_aside_type: normalizeSetAside(src['TYPE OF COMPETITION']),
    contract_type: txt(src['CONTRACT TYPE']) ?? req,
    competition_type: txt(src['TYPE OF COMPETITION']),
    incumbent_name: txt(src['INCUMBENT VENDOR']),
    incumbent_contract_number: txt(src['EXISTING AWD #']),
    pop_state: txt(src['PLACE OF PERFORMANCE']),
  };
}

export async function runSsaIngest(
  sb: SupabaseClient,
  opts: { apply: boolean; fetchImpl?: typeof fetch } ,
): Promise<SsaIngestResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base: SsaIngestResult = {
    ok: false, applied: false, discoveryUrl: SSA_DISCOVERY_URL,
    rawUpstream: 0, distinctSourceIds: 0, rejectedNoIdentity: 0, duplicateSourceIds: 0,
    matched: 0, newProven: 0, changed: 0, unchanged: 0, inserted: 0, updated: 0,
    historicalRetained: 0, physicalRows: 0, nullProtectedRows: 0, nullProtectedValues: 0,
    malformedHeldRawData: 0, rawDataRepairsNeeded: 0, legacySetAsideRepairsNeeded: 0,
    insertAttempted: 0, insertFailed: 0, updateAttempted: 0, updateFailed: 0, dataAdvanced: false,
  };

  // 1) discovery
  const page = await wafFetch(SSA_DISCOVERY_URL, undefined, fetchImpl);
  if (page.status === 403) return { ...base, failure: 'source_access_blocked', failureDetail: 'discovery page 403 after retries' };
  if (page.status === 404) return { ...base, failure: 'source_retired', failureDetail: 'discovery page 404' };
  if (!page.ok) return { ...base, failure: 'source_access_blocked', failureDetail: `discovery status ${page.status}` };
  const html = await page.text();
  const pick = selectCanonicalLink(html);
  if (!pick) return { ...base, failure: 'discovery_failure', failureDetail: 'no FY-labelled link in the Contracting Forecast section' };

  // 2) workbook — status is NOT proof; the PK signature is.
  const wbRes = await wafFetch(pick.url, SSA_DISCOVERY_URL, fetchImpl);
  if (wbRes.status === 403) return { ...base, selectedUrl: pick.url, failure: 'source_access_blocked', failureDetail: 'workbook 403 after retries' };
  if (wbRes.status === 404) return { ...base, selectedUrl: pick.url, failure: 'source_retired', failureDetail: 'workbook 404' };
  if (!wbRes.ok) return { ...base, selectedUrl: pick.url, failure: 'source_access_blocked', failureDetail: `workbook status ${wbRes.status}` };
  const buf = Buffer.from(await wbRes.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    return { ...base, selectedUrl: pick.url, failure: 'not_xlsm', failureDetail: `HTTP ${wbRes.status} but payload is not a PK/XLSM (likely a WAF/HTML body)` };
  }
  const fingerprint = createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const sourceLastModified = wbRes.headers.get('last-modified');
  const sourceEtag = wbRes.headers.get('etag');

  // 3) parse
  let parsed;
  try { parsed = parseSsaWorkbook(buf); }
  catch (e) {
    const f = (e as { failure?: SsaFailure }).failure ?? 'parse_failure';
    return { ...base, selectedUrl: pick.url, fingerprint, failure: f, failureDetail: (e as Error).message };
  }

  const byId = new Map<string, Record<string, unknown>>();
  let duplicateSourceIds = 0;
  for (const r of parsed.rows) {
    const id = `SSA-${String(r['APP #']).trim()}`;
    if (byId.has(id)) { duplicateSourceIds++; continue; }
    byId.set(id, r);
  }
  if (duplicateSourceIds > 0) {
    return { ...base, selectedUrl: pick.url, fingerprint, rawUpstream: parsed.rawUpstream,
      distinctSourceIds: byId.size, duplicateSourceIds, rejectedNoIdentity: parsed.blankIdentity,
      failure: 'identity_failure', failureDetail: `${duplicateSourceIds} duplicate APP # in source` };
  }

  // 4) held state — exact count, then paged reads (never the implicit 1,000 cap)
  const { count, error: cErr } = await sb.from('agency_forecasts')
    .select('*', { count: 'exact', head: true }).eq('source_agency', 'SSA');
  if (cErr || count === null) throw new Error(`held count unknown: ${cErr?.message ?? 'null count'}`);
  const held: Array<Record<string, unknown>> = [];
  for (let f = 0; f < count; f += 1000) {
    const { data, error } = await sb.from('agency_forecasts').select('*')
      .eq('source_agency', 'SSA').order('id', { ascending: true }).range(f, f + 999);
    if (error) throw new Error(`held page: ${error.message}`);
    held.push(...(data ?? []));
  }
  const heldById = new Map(held.map(h => [String(h.external_id), h]));

  const upIds = [...byId.keys()];
  const matchedIds = upIds.filter(i => heldById.has(i));
  const newIds = upIds.filter(i => !heldById.has(i));
  const historicalRetained = held.filter(h => !byId.has(String(h.external_id))).length;

  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  let malformedHeldRawData = 0;
  for (const h of held) {
    const rd = h.raw_data;
    if (!isObj(rd)) { malformedHeldRawData++; continue; }
    const keys = Object.keys(rd as object);
    if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) malformedHeldRawData++;
  }

  // 5) diff over the source-owned whitelist ONLY
  const norm = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : v);
  const changedIds: string[] = [];
  let nullProtectedRows = 0, nullProtectedValues = 0, rawDataRepairsNeeded = 0, legacySetAsideRepairsNeeded = 0;
  const updates = new Map<string, Record<string, unknown>>();

  for (const id of matchedIds) {
    const src = byId.get(id)!; const h = heldById.get(id)!;
    const mapped = mapSourceRow(src);
    const patch: Record<string, unknown> = {};
    let protectedHere = false;
    for (const f of SSA_SOURCE_OWNED_FIELDS) {
      const uv = norm((mapped as Record<string, unknown>)[f]);
      const hv = norm(h[f]);
      if (uv === null && hv !== null) { protectedHere = true; nullProtectedValues++; continue; }  // preserve held
      if (uv === null && hv === null) continue;
      const same = (typeof uv === 'number' || typeof hv === 'number')
        ? Number(uv) === Number(hv) : String(uv) === String(hv);
      if (!same) {
        patch[f] = uv;
        if (f === 'set_aside_type' && /unrestricted competition/i.test(String(hv ?? ''))) legacySetAsideRepairsNeeded++;
      }
    }
    if (protectedHere) nullProtectedRows++;
    const rd = h.raw_data;
    const rawBad = !isObj(rd) || String((rd as Record<string, unknown>)['APP #'] ?? '') !== String(src['APP #'] ?? '');
    if (rawBad) { patch.raw_data = src; rawDataRepairsNeeded++; }
    if (Object.keys(patch).length) { changedIds.push(id); updates.set(id, patch); }
  }

  const result: SsaIngestResult = {
    ...base, ok: true, applied: opts.apply, selectedUrl: pick.url, selectedLabel: pick.label,
    fingerprint, sourceLastModified, sourceEtag,
    rawUpstream: parsed.rawUpstream, distinctSourceIds: byId.size,
    rejectedNoIdentity: parsed.blankIdentity, duplicateSourceIds,
    matched: matchedIds.length, newProven: newIds.length,
    changed: changedIds.length, unchanged: matchedIds.length - changedIds.length,
    historicalRetained, physicalRows: count,
    nullProtectedRows, nullProtectedValues, malformedHeldRawData,
    rawDataRepairsNeeded, legacySetAsideRepairsNeeded,
    dataAdvanced: false,
  };

  if (!opts.apply) return result;   // DRY: zero writes, here and in the route

  // 6) apply
  let inserted = 0, insertFailed = 0, updated = 0, updateFailed = 0;
  const nowIso = new Date().toISOString();
  // BACKFILL SAFETY (src/lib/forecasts/writer.ts): no bulk of NEW rows while SSA's alert floor is active.
  // ALL-OR-NOTHING: every new row is built first and guarded as ONE set before the first insert, so a
  // refused run writes zero new rows and the full payload is quarantined for replay.
  const newRows = newIds.map((id) => {
    const src = byId.get(id)!;
    return {
      source_agency: 'SSA', source_type: 'excel', source_url: pick.url, external_id: id,
      department: 'Social Security Administration', pop_country: 'USA', status: 'forecast',
      ...mapSourceRow(src), raw_data: src,
      created_at: nowIso, updated_at: nowIso, last_synced_at: nowIso,
    };
  });
  const insertGuard = await applyInsertGuard(sb, 'SSA', newRows);
  if (insertGuard.refused) {
    result.insertRefused = insertGuard.refused.reason;
    result.insertQuarantined = insertGuard.refused.quarantined;
  }
  for (const row of insertGuard.allowed) {
    const { error } = await sb.from('agency_forecasts').insert(row);
    if (error) insertFailed++; else inserted++;
  }
  for (const [id, patch] of updates) {
    const { error } = await sb.from('agency_forecasts')
      .update({ ...patch, updated_at: nowIso, last_synced_at: nowIso })
      .eq('source_agency', 'SSA').eq('external_id', id);
    if (error) updateFailed++; else updated++;
  }
  // Current-source rows are re-confirmed; HISTORICAL rows are deliberately NOT touched —
  // a poll is not proof a historical row was observed.
  const unchangedMatched = matchedIds.filter(i => !updates.has(i));
  if (unchangedMatched.length) {
    for (let i = 0; i < unchangedMatched.length; i += 200) {
      await sb.from('agency_forecasts').update({ last_synced_at: nowIso })
        .eq('source_agency', 'SSA').in('external_id', unchangedMatched.slice(i, i + 200));
    }
  }

  const { count: after } = await sb.from('agency_forecasts')
    .select('*', { count: 'exact', head: true }).eq('source_agency', 'SSA');

  result.inserted = inserted; result.insertFailed = insertFailed;
  result.insertAttempted = insertGuard.allowed.length; result.updateAttempted = updates.size;
  result.updated = updated; result.updateFailed = updateFailed;
  result.physicalRows = after ?? count;
  result.dataAdvanced = inserted > 0 || updated > 0;
  if (insertFailed > 0 || updateFailed > 0) {
    result.ok = false; result.failure = 'receipt_mismatch';
    result.failureDetail = `insertFailed=${insertFailed} updateFailed=${updateFailed}`;
  }
  return result;
}
