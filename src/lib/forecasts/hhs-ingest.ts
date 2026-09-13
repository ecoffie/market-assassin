/**
 * HHS SBCX ingest — fetch, plan, and (optionally) apply.
 *
 * Read-only by default: `apply: false` produces the full plan and writes nothing,
 * so the accounting and the semantic gate can both be inspected before mutation.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HHS_FORECAST_URL, parseHhsForecast, hhsExternalId, hhsQuarter, hhsFy, hhsValueLabel, type HhsForecastRow } from './hhs-forecast';
import {
  planHhsReconciliation, hhsPlanReconciles, hhsPlanIsSemanticallySane,
  canonicalHhsFingerprint, hhsDataAdvanced, HHS_SOURCE_OWNED_FIELDS,
  type HhsRow, type HhsReconcilePlan,
} from './hhs-reconcile';

export interface HhsIngestResult {
  ok: boolean;
  failure?: string;
  upstreamTotal: number;
  usableUpstream: number;
  parseRejected: number;
  duplicateSourceIds: number;
  matchedExisting: number;
  changed: number;
  unchanged: number;
  newProven: number;
  historicalRetained: number;
  fingerprint: string | null;
  applied: boolean;
  insertAttempted: number; inserted: number; insertFailed: number;
  updateAttempted: number; updated: number; updateFailed: number;
  dataAdvanced: boolean;
}

/**
 * Map a parsed source row onto the DB shape, source-owned fields only.
 *
 * ⚠️ THESE ARE NORMALIZED VALUES, NOT RAW SOURCE VALUES. The original importer
 * stored derived forms, and writing the raw ones would have reported all 3,479
 * matched rows as CHANGED and then corrupted every one of them. Measured against
 * the live corpus, the conventions are:
 *   estimated_value_range hhsValueLabel(...) -> '> $10K and <= $25K', not the code
 *   contracting_office    the DIVISION acronym ('IHS'), not contractingOfficeCode
 *   status                the literal 'forecasted' — Mindy's lifecycle vocabulary,
 *                         not the source's 'PUBLISHED' (every HHS record is PUBLISHED,
 *                         so copying it would destroy a meaningful column)
 *   bureau                'HHS ' + division
 * A diff is only trustworthy when both sides speak the same dialect.
 */
export function toDbRow(r: HhsForecastRow): HhsRow {
  return {
    external_id: hhsExternalId(r),
    title: r.title,
    description: r.description ?? null,
    naics_code: r.naicsCode ?? null,

    estimated_value_min: r.valueMin ?? null,
    estimated_value_max: r.valueMax ?? null,
    estimated_value_range: hhsValueLabel(r.valueRange) ?? null,
    contract_type: r.strategy ?? null,
    program_office: r.pocOffice ?? null,
    contracting_office: r.division ?? null,
    poc_name: r.pocName ?? null,
    poc_email: r.pocEmail ?? null,
    incumbent_name: r.incumbentName ?? null,
    incumbent_contract_number: r.incumbentContractNumber ?? null,
    status: 'forecasted',
    bureau: r.division ? `HHS ${r.division}` : null,
    source_url: HHS_FORECAST_URL,
  };
}

/**
 * Mindy-DERIVED fields, applied to NEW rows ONLY so the corpus keeps one
 * convention. Never part of the diff and never in an UPDATE payload — see
 * HHS_DERIVED_FIELDS. Derived from the AWARD month/year, the convention proven
 * against the existing 3,479 rows at 100%/99.97%.
 */
export function derivedFieldsForInsert(r: HhsForecastRow): Record<string, unknown> {
  return {
    anticipated_quarter: hhsQuarter(r.awardMonth) ?? null,
    fiscal_year: hhsFy(r.awardFy) ?? null,
  };
}

export async function runHhsIngest(
  sb: SupabaseClient,
  opts: { apply?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<HhsIngestResult> {
  const apply = opts.apply === true;
  const f = opts.fetchImpl ?? fetch;
  const base: HhsIngestResult = {
    ok: false, upstreamTotal: 0, usableUpstream: 0, parseRejected: 0, duplicateSourceIds: 0,
    matchedExisting: 0, changed: 0, unchanged: 0, newProven: 0, historicalRetained: 0,
    fingerprint: null, applied: false,
    insertAttempted: 0, inserted: 0, insertFailed: 0,
    updateAttempted: 0, updated: 0, updateFailed: 0, dataAdvanced: false,
  };

  // ── FETCH. Any transport/parse failure is a FAILURE, never an empty result. ──
  let payload: unknown;
  try {
    const res = await f(HHS_FORECAST_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ...base, failure: `http_${res.status}` };
    const text = await res.text();
    try { payload = JSON.parse(text); }
    catch { return { ...base, failure: 'invalid_json' }; }
  } catch (e) {
    return { ...base, failure: `transport: ${(e as Error).message}` };
  }
  if (!Array.isArray(payload)) return { ...base, failure: 'payload_not_array' };
  // HTTP 200 + [] is NOT a legitimate zero for a 5k-record forecast.
  if (payload.length === 0) return { ...base, failure: 'empty_payload' };

  const fingerprint = canonicalHhsFingerprint(payload);
  if (!fingerprint) return { ...base, failure: 'fingerprint_unmeasured' };

  const parsed = parseHhsForecast(payload);
  const upstreamRows = parsed.rows.map(toDbRow);
  // Keyed so inserts can carry derived values without those fields ever entering
  // the diff or an update payload.
  const derivedById = new Map(parsed.rows.map((r) => [hhsExternalId(r), derivedFieldsForInsert(r)]));

  // ── HELD. Paged; an unranged read would cap at 1,000 and fabricate a plan. ──
  const held = new Map<string, Record<string, unknown>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('agency_forecasts')
      .select(['external_id', ...HHS_SOURCE_OWNED_FIELDS].join(','))
      .eq('source_agency', 'HHS')
      .range(from, from + 999);
    if (error) return { ...base, fingerprint, failure: `held_read: ${error.message}` };
    if (!data?.length) break;
    for (const r of data as unknown as Array<Record<string, unknown>>) held.set(String(r.external_id), r);
    if (data.length < 1000) break;
  }

  const plan: HhsReconcilePlan = planHhsReconciliation(
    [...upstreamRows, ...Array<null>(parsed.skipped).fill(null)], held,
  );
  const acct = hhsPlanReconciles(plan);
  if (!acct.ok) return { ...base, fingerprint, failure: `accounting: ${acct.problems.join('; ')}` };
  const sane = hhsPlanIsSemanticallySane(plan, held.size);
  if (!sane.ok) return { ...base, fingerprint, failure: `semantic: ${sane.problems.join('; ')}` };

  const result: HhsIngestResult = {
    ...base, ok: true, fingerprint,
    upstreamTotal: plan.upstreamTotal,
    usableUpstream: plan.usableUpstream,
    parseRejected: plan.parseRejected,
    duplicateSourceIds: plan.duplicateSourceIds.length,
    matchedExisting: plan.matchedExisting,
    changed: plan.toUpdate.length,
    unchanged: plan.unchanged,
    newProven: plan.toInsert.length,
    historicalRetained: plan.absentUpstream.length,
  };
  if (!apply) return result;

  // ── WRITE. Batched, with EXACT receipts — never inferred from a capped payload. ──
  result.applied = true;
  result.insertAttempted = plan.toInsert.length;
  for (let i = 0; i < plan.toInsert.length; i += 500) {
    const batch = plan.toInsert.slice(i, i + 500).map((r) => ({
      ...r,
      ...(derivedById.get(r.external_id) ?? {}),   // INSERT ONLY — never an update
      source_agency: 'HHS', source_type: 'sbcx_api',
      last_synced_at: new Date().toISOString(),
    }));
    const { count, error } = await sb.from('agency_forecasts').insert(batch, { count: 'exact' });
    if (error) { result.insertFailed += batch.length; continue; }
    result.inserted += count ?? batch.length;
  }
  result.updateAttempted = plan.toUpdate.length;
  for (const u of plan.toUpdate) {
    const { count, error } = await sb.from('agency_forecasts')
      .update({ ...u.patch, last_synced_at: new Date().toISOString() }, { count: 'exact' })
      .eq('source_agency', 'HHS').eq('external_id', u.externalId);
    if (error) { result.updateFailed++; continue; }
    result.updated += count ?? 0;
  }
  result.dataAdvanced = hhsDataAdvanced(result.inserted, result.updated);
  result.ok = result.insertFailed === 0 && result.updateFailed === 0;
  if (!result.ok) result.failure = 'partial_mutation';
  return result;
}
