/**
 * DOJ forecast ingest — fetch, plan, and (optionally) apply.
 *
 * Read-only by default (`apply: false`) so the accounting, the semantic gate and
 * the identity guards can all be inspected before anything mutates.
 */
import { applyInsertGuard } from './writer';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { mapDojRow } from './doj-parse';
import {
  auditDojIdentity, planDojReconciliation, dojPlanReconciles, dojPlanIsSemanticallySane,
  dojWorkbookFingerprint, dojDataAdvanced, DOJ_SOURCE_OWNED_FIELDS, type DojRow,
} from './doj-reconcile';

/** The recorded URL 301s to /jmd/…; fetch follows it and reads the FINAL response. */
export const DOJ_FORECAST_URL = 'https://www.justice.gov/media/1381791/dl';
export const DOJ_SHEET = 'Sheet2';
/** secnav-style WAFs reject non-browser agents; justice.gov is served the same way. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface DojIngestResult {
  /** Set when the daily-sync new-row guard refused this run's inserts (src/lib/forecasts/writer.ts). */
  insertRefused?: string;
  /** Whether the refused new rows were saved to forecast_refused_loads (false = replay needs a re-fetch). */
  insertQuarantined?: boolean;
  ok: boolean;
  failure?: string;
  applied: boolean;
  // source populations — never collapsed
  rawUpstream: number;
  withinWorkbookIdentityRejected: number;
  duplicateAtnGroups: number;
  crossEditionIdentitySuspect: number;
  safeCurrentUpstream: number;
  blankAtnRows: number;
  fingerprint: string | null;
  /** Last-Modified of the FINAL 200 — never the 301's. */
  sourceLastModified: string | null;
  // reconciliation
  matchedSafe: number;
  changedSafe: number;
  unchangedSafe: number;
  newProven: number;
  absentRetained: number;
  heldAmbiguous: number;
  corruptLegacyIdentity: number;
  nullProtectedRows: number;
  nullProtectedFields: Record<string, number>;
  suspects: Array<{ atn: string; heldTitle: string; upstreamTitle: string }>;
  // receipts
  insertAttempted: number; inserted: number; insertFailed: number;
  updateAttempted: number; updated: number; updateFailed: number;
  dataAdvanced: boolean;
}

const EMPTY = (): DojIngestResult => ({
  ok: false, applied: false,
  rawUpstream: 0, withinWorkbookIdentityRejected: 0, duplicateAtnGroups: 0,
  crossEditionIdentitySuspect: 0, safeCurrentUpstream: 0, blankAtnRows: 0,
  fingerprint: null, sourceLastModified: null,
  matchedSafe: 0, changedSafe: 0, unchangedSafe: 0, newProven: 0,
  absentRetained: 0, heldAmbiguous: 0, corruptLegacyIdentity: 0,
  nullProtectedRows: 0, nullProtectedFields: {}, suspects: [],
  insertAttempted: 0, inserted: 0, insertFailed: 0,
  updateAttempted: 0, updated: 0, updateFailed: 0, dataAdvanced: false,
});

export async function runDojIngest(
  sb: SupabaseClient,
  opts: { apply?: boolean; fetchImpl?: typeof fetch; workbook?: Uint8Array; lastModified?: string } = {},
): Promise<DojIngestResult> {
  const apply = opts.apply === true;
  const base = EMPTY();

  // ── FETCH. Any transport/shape failure is a FAILURE, never an empty result. ──
  let bytes: Uint8Array;
  let lastModified: string | null = opts.lastModified ?? null;
  if (opts.workbook) {
    bytes = opts.workbook;
  } else {
    try {
      const res = await (opts.fetchImpl ?? fetch)(DOJ_FORECAST_URL, { headers: { 'User-Agent': UA } });
      if (!res.ok) return { ...base, failure: `http_${res.status}` };
      // ⚠️ res.headers belongs to the FINAL response after redirects — the 301's
      // own Last-Modified (the redirect resource's) must never be read as the
      // workbook's clock.
      lastModified = res.headers.get('last-modified');
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      return { ...base, failure: `transport: ${(e as Error).message}` };
    }
  }
  if (bytes.length === 0) return { ...base, failure: 'empty_body' };
  const fingerprint = dojWorkbookFingerprint(bytes);
  // Not a ZIP/XLSX -> an HTML login page, a WAF block or a soft-404, never "0 rows".
  if (!fingerprint) return { ...base, failure: 'not_xlsx' };

  let rows: unknown[][];
  try {
    const wb = XLSX.read(bytes, { type: 'array' });
    const ws = wb.Sheets[DOJ_SHEET];
    if (!ws) return { ...base, fingerprint, sourceLastModified: lastModified, failure: `sheet_missing:${DOJ_SHEET}` };
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
    rows = aoa.slice(1).filter((r) => Array.isArray(r) && r.some((c) => c != null && String(c).trim() !== ''));
  } catch (e) {
    return { ...base, fingerprint, sourceLastModified: lastModified, failure: `parse: ${(e as Error).message}` };
  }
  if (rows.length === 0) return { ...base, fingerprint, sourceLastModified: lastModified, failure: 'no_data_rows' };

  const audit = auditDojIdentity(rows.map((r) => String(r[1] ?? '')));
  const rejectedAtns = new Set(audit.duplicateAtnGroups);
  const parsed = rows.map(mapDojRow).filter((x): x is NonNullable<typeof x> => !!x)
    .filter((p) => !rejectedAtns.has(p.atn));

  // ── HELD. Paged; an unranged read caps at 1,000 and would fabricate the plan. ──
  const held = new Map<string, Record<string, unknown>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('agency_forecasts')
      .select(['external_id', ...DOJ_SOURCE_OWNED_FIELDS].join(','))
      .eq('source_agency', 'DOJ').range(from, from + 999);
    if (error) return { ...base, fingerprint, sourceLastModified: lastModified, failure: `held_read: ${error.message}` };
    if (!data?.length) break;
    for (const r of data as unknown as Array<Record<string, unknown>>) held.set(String(r.external_id), r);
    if (data.length < 1000) break;
  }

  const plan = planDojReconciliation(parsed.map((p) => p.fields as DojRow), rejectedAtns, held, audit);
  const acct = dojPlanReconciles(plan, held.size);
  if (!acct.ok) return { ...base, fingerprint, sourceLastModified: lastModified, failure: `accounting: ${acct.problems.join('; ')}` };
  const sane = dojPlanIsSemanticallySane(plan, held.size);
  if (!sane.ok) return { ...base, fingerprint, sourceLastModified: lastModified, failure: `semantic: ${sane.problems.join('; ')}` };

  const derivedById = new Map(parsed.map((p) => [p.atn, p.derived]));
  const r: DojIngestResult = {
    ...base, ok: true, fingerprint, sourceLastModified: lastModified,
    rawUpstream: plan.rawUpstream,
    withinWorkbookIdentityRejected: plan.identityRejectedRows,
    duplicateAtnGroups: plan.duplicateAtnGroups,
    crossEditionIdentitySuspect: plan.crossEditionSuspect.length,
    // ⚠️ SAFE population EXCLUDES the cross-edition suspects. 449 is the
    // unique-ATN count; 446 is what DOJ identifies well enough to represent.
    safeCurrentUpstream: plan.usableUniqueIdentity - plan.crossEditionSuspect.length,
    blankAtnRows: plan.blankAtnRows,
    matchedSafe: plan.matchedExisting,
    changedSafe: plan.toUpdate.length,
    unchangedSafe: plan.unchanged,
    newProven: plan.toInsert.length,
    absentRetained: plan.absentUpstream.length,
    heldAmbiguous: plan.heldAmbiguous.length,
    corruptLegacyIdentity: plan.corruptLegacyIdentity.length,
    nullProtectedRows: plan.nullProtectedRows,
    nullProtectedFields: plan.nullProtected,
    suspects: plan.crossEditionSuspect,
  };
  if (!apply) return r;

  // ── WRITE. Batched, EXACT receipts — never inferred from a capped payload. ──
  r.applied = true;
  // BACKFILL SAFETY (src/lib/forecasts/writer.ts): a daily run may not create a bulk of NEW rows while the
  // publisher's alert floor is active — those would all read as "new" Forecasts. Updates still apply.
  // ALL-OR-NOTHING: the guard runs BEFORE the first batch, over the whole run's new rows. A refused
  // run inserts ZERO rows (never a partial prefix) and quarantines the full payload for replay.
  const insertGuard = await applyInsertGuard(sb, 'DOJ', plan.toInsert);
  if (insertGuard.refused) {
    r.insertRefused = insertGuard.refused.reason;
    r.insertQuarantined = insertGuard.refused.quarantined;
  }
  const allowedInserts = insertGuard.allowed;
  r.insertAttempted = allowedInserts.length;
  for (let i = 0; i < allowedInserts.length; i += 500) {
    const batch = allowedInserts.slice(i, i + 500).map((row) => ({
      ...row,
      ...(derivedById.get(row.external_id) ?? {}),   // INSERT ONLY — never an update
      source_agency: 'DOJ', source_type: 'excel',
      source_url: DOJ_FORECAST_URL,
      last_synced_at: new Date().toISOString(),
    }));
    const { count, error } = await sb.from('agency_forecasts').insert(batch, { count: 'exact' });
    if (error) { r.insertFailed += batch.length; continue; }
    r.inserted += count ?? batch.length;
  }
  r.updateAttempted = plan.toUpdate.length;
  for (const u of plan.toUpdate) {
    const { count, error } = await sb.from('agency_forecasts')
      .update({ ...u.patch, last_synced_at: new Date().toISOString() }, { count: 'exact' })
      .eq('source_agency', 'DOJ').eq('external_id', u.externalId);
    if (error) { r.updateFailed++; continue; }
    r.updated += count ?? 0;
  }
  r.dataAdvanced = dojDataAdvanced(r.inserted, r.updated);
  // Receipt must balance, or the run is NOT a success.
  const balanced = r.inserted + r.insertFailed === r.insertAttempted
                && r.updated + r.updateFailed === r.updateAttempted;
  r.ok = r.insertFailed === 0 && r.updateFailed === 0 && balanced;
  if (!r.ok) r.failure = balanced ? 'partial_mutation' : 'receipt_mismatch';
  return r;
}
