/**
 * DHS allRecords ingest — plan (and optionally apply) from a public CSV/XLSX.
 *
 * Read-only by default: `apply: false` produces the full plan and writes nothing.
 * Apply requires an explicit opts.apply === true AND is never invoked from unit
 * tests against a real database. Orphans are NEVER deleted.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DHS_ALLRECORDS_CSV_URL,
  DHS_ALLRECORDS_SOURCE_TYPE,
  dhsAllrecordsToDbRow,
  parseDhsAllrecordsBuffer,
  type DhsAllrecordsParsedRow,
} from './dhs-allrecords';
import {
  DHS_ALLRECORDS_SOURCE_OWNED_FIELDS,
  planDhsAllrecordsReconciliation,
  dhsAllrecordsPlanReconciles,
  dhsAllrecordsPlanIsSemanticallySane,
  dhsAllrecordsDataAdvanced,
  type DhsAllrecordsRow,
  type DhsAllrecordsReconcilePlan,
} from './dhs-allrecords-reconcile';

export interface DhsAllrecordsIngestResult {
  ok: boolean;
  failure?: string;
  applied: boolean;
  upstreamTotal: number;
  usableUpstream: number;
  parseRejected: number;
  missingApfs: number;
  duplicateSourceIds: number;
  matchedExisting: number;
  changed: number;
  unchanged: number;
  newProven: number;
  /** Held rows not in today's file — retained, never deleted. */
  absentUpstream: number;
  sampleConflicts: Array<{ externalId: string; changedFields: string[] }>;
  insertAttempted: number;
  inserted: number;
  insertFailed: number;
  updateAttempted: number;
  updated: number;
  updateFailed: number;
  dataAdvanced: boolean;
  sourceUrl: string;
  plan?: DhsAllrecordsReconcilePlan;
}

const EMPTY = (sourceUrl: string): DhsAllrecordsIngestResult => ({
  ok: false,
  applied: false,
  upstreamTotal: 0,
  usableUpstream: 0,
  parseRejected: 0,
  missingApfs: 0,
  duplicateSourceIds: 0,
  matchedExisting: 0,
  changed: 0,
  unchanged: 0,
  newProven: 0,
  absentUpstream: 0,
  sampleConflicts: [],
  insertAttempted: 0,
  inserted: 0,
  insertFailed: 0,
  updateAttempted: 0,
  updated: 0,
  updateFailed: 0,
  dataAdvanced: false,
  sourceUrl,
});

export interface DhsAllrecordsIngestOpts {
  /** Must be explicitly true to mutate. Default false (dry-run). */
  apply?: boolean;
  /** Local file / fetched bytes. Required unless fetchUrl is set. */
  buffer?: Buffer | Uint8Array;
  /** Public URL to fetch when buffer is omitted. */
  fetchUrl?: string;
  fetchImpl?: typeof fetch;
  /**
   * When true, skip the semantic "matchedExisting=0" tripwire.
   * Only for a deliberate empty-corpus first load — never a daily default.
   */
  allowEmptyCorpus?: boolean;
}

async function loadHeld(
  sb: SupabaseClient,
): Promise<{ held: Map<string, Record<string, unknown>>; error?: string }> {
  const held = new Map<string, Record<string, unknown>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('agency_forecasts')
      .select(['external_id', ...DHS_ALLRECORDS_SOURCE_OWNED_FIELDS].join(','))
      .eq('source_agency', 'DHS')
      .range(from, from + 999);
    if (error) return { held, error: error.message };
    if (!data?.length) break;
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      held.set(String(r.external_id), r);
    }
    if (data.length < 1000) break;
  }
  return { held };
}

/**
 * Run the DHS allRecords ingest.
 *
 * ⚠️ Tests must pass a mock Supabase client (or only exercise plan helpers) —
 * never call with apply:true against production credentials.
 */
export async function runDhsAllrecordsIngest(
  sb: SupabaseClient,
  opts: DhsAllrecordsIngestOpts = {},
): Promise<DhsAllrecordsIngestResult> {
  const apply = opts.apply === true;
  const sourceUrl = opts.fetchUrl || DHS_ALLRECORDS_CSV_URL;
  const base = EMPTY(sourceUrl);

  let buf: Buffer | Uint8Array;
  if (opts.buffer) {
    buf = opts.buffer;
  } else {
    try {
      const res = await (opts.fetchImpl ?? fetch)(sourceUrl, {
        headers: { 'User-Agent': 'GovConGiants-Mindy/1.0' },
        cache: 'no-store',
      });
      if (!res.ok) return { ...base, failure: `http_${res.status}` };
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      return { ...base, failure: `transport: ${(e as Error).message}` };
    }
  }
  if (!buf.length) return { ...base, failure: 'empty_body' };

  let parsed;
  try {
    parsed = parseDhsAllrecordsBuffer(buf);
  } catch (e) {
    return { ...base, failure: `parse: ${(e as Error).message}` };
  }
  if (parsed.headerRow === -1) return { ...base, failure: 'no_header_row' };
  if (!parsed.rows.length) return { ...base, failure: 'empty_payload' };

  const upstreamRows: DhsAllrecordsRow[] = parsed.rows.map((r: DhsAllrecordsParsedRow) =>
    dhsAllrecordsToDbRow(r, { sourceUrl }) as DhsAllrecordsRow,
  );

  const { held, error: heldErr } = await loadHeld(sb);
  if (heldErr) return { ...base, failure: `held_read: ${heldErr}` };

  const plan = planDhsAllrecordsReconciliation(
    [...upstreamRows, ...Array<null>(parsed.missingApfs).fill(null)],
    held,
  );
  const acct = dhsAllrecordsPlanReconciles(plan);
  if (!acct.ok) return { ...base, failure: `accounting: ${acct.problems.join('; ')}` };

  if (!opts.allowEmptyCorpus) {
    const sane = dhsAllrecordsPlanIsSemanticallySane(plan, held.size);
    if (!sane.ok) return { ...base, failure: `semantic: ${sane.problems.join('; ')}`, plan };
  }

  const result: DhsAllrecordsIngestResult = {
    ...base,
    ok: true,
    upstreamTotal: plan.upstreamTotal,
    usableUpstream: plan.usableUpstream,
    parseRejected: plan.parseRejected,
    missingApfs: parsed.missingApfs,
    duplicateSourceIds: plan.duplicateSourceIds.length,
    matchedExisting: plan.matchedExisting,
    changed: plan.toUpdate.length,
    unchanged: plan.unchanged,
    newProven: plan.toInsert.length,
    absentUpstream: plan.absentUpstream.length,
    sampleConflicts: plan.toUpdate.slice(0, 5).map((u) => ({
      externalId: u.externalId,
      changedFields: u.changedFields,
    })),
    plan,
  };
  if (!apply) return result;

  // ── WRITE. Inserts + updates only. NEVER delete absentUpstream. ──
  result.applied = true;
  const now = new Date().toISOString();
  result.insertAttempted = plan.toInsert.length;
  for (let i = 0; i < plan.toInsert.length; i += 500) {
    const batch = plan.toInsert.slice(i, i + 500).map((r) => ({
      ...r,
      source_agency: 'DHS',
      source_type: DHS_ALLRECORDS_SOURCE_TYPE,
      last_synced_at: now,
    }));
    const { count, error } = await sb.from('agency_forecasts').insert(batch, { count: 'exact' });
    if (error) {
      result.insertFailed += batch.length;
      continue;
    }
    result.inserted += count ?? batch.length;
  }
  result.updateAttempted = plan.toUpdate.length;
  for (const u of plan.toUpdate) {
    const { count, error } = await sb
      .from('agency_forecasts')
      .update({ ...u.patch, last_synced_at: now }, { count: 'exact' })
      .eq('source_agency', 'DHS')
      .eq('external_id', u.externalId);
    if (error) {
      result.updateFailed++;
      continue;
    }
    result.updated += count ?? 0;
  }
  result.dataAdvanced = dhsAllrecordsDataAdvanced(result.inserted, result.updated);
  result.ok = result.insertFailed === 0 && result.updateFailed === 0;
  if (!result.ok) result.failure = 'partial_mutation';
  return result;
}
