/**
 * Ask Mindy tool: get_vehicle_spend_mix — how a market's dollars split across contract vehicles.
 *
 * The question it answers: "How much 561320 spending runs through GSA Schedules vs VA BPAs vs
 * agency IDIQs?" Dollars and shares by vehicle type, summing to the market total.
 *
 * How the classification works (stated per bucket in the output, `rule`):
 *   1. Net obligations in scope are grouped by PARENT award (parent_piid) in the BigQuery award
 *      warehouse. Actions with no parent are standalone awards (definitive contracts and
 *      purchase orders).
 *   2. The vehicle TYPE of each parent is read from USASpending's own IDV record
 *      ("Contract Award Type": FSS, BPA, GWAC, BOA, or an indefinite-delivery type) together
 *      with the agency that awarded the parent. That is authoritative, not inferred. Parents are
 *      verified largest-first up to a budget; the verified share is reported.
 *   3. Parents left unverified (small ones past the budget, or a lookup failure) are classified
 *      from the PIID only where the PIID is unambiguous (legacy GSA schedule "GS##F", VA
 *      schedule "V797"/"36F797", a uniform PIID whose 9th character is A = BPA or G = BOA, per
 *      FAR 4.1603). That is a HEURISTIC and is counted separately in every bucket
 *      (heuristic_obligated). A PIID that cannot be read unambiguously (for example a 9th
 *      character D, which is both schedules and IDIQs) stays "unresolved", never guessed.
 *
 * The warehouse carries no IDV rows (verified 2026-11-14: award_or_idv_flag and idv_type_code
 * are empty), which is why step 2 reads USASpending rather than joining in BigQuery.
 *
 * Registered in the shared registry for Ask Mindy only. Hidden from the public MCP catalog.
 */
import agencyAliases from '@/data/agency-aliases.json';
import {
  bqDateString,
  normalizeNaicsPrefixes,
  normalizeStateArg,
  num,
  resolveFyWindow,
  round2,
  windowLabel,
  windowParams,
  windowPredicate,
} from '@/lib/bigquery/award-scope';
import { runScopedAggregate, type ScopedAggregateDeps } from '@/lib/bigquery/scoped-aggregate';
import { withCache } from '@/lib/mcp/external-cache';
import type { IgnoredArg } from '@/lib/mcp/result-contract';

const AWARDS_TABLE = '`market-assasin.usaspending.awards`';
const SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const IDV_CODES = ['IDV_A', 'IDV_B', 'IDV_B_A', 'IDV_B_B', 'IDV_B_C', 'IDV_C', 'IDV_D', 'IDV_E'];
const BATCH_SIZE = 40;
const MAX_VERIFY_PARENTS = 240;
const NAICS_REQUIRED = 'naics is required (a 2-6 digit code or prefix, e.g. "561320").';
const VERIFY_TARGET_SHARE = 0.99;

export type VehicleBucket =
  | 'gsa_schedule'
  | 'va_schedule'
  | 'other_schedule'
  | 'va_bpa'
  | 'other_bpa'
  | 'gwac'
  | 'gsa_idiq'
  | 'agency_idiq'
  | 'boa'
  | 'standalone'
  | 'unresolved';

export const BUCKETS: Record<VehicleBucket, { label: string; rule: string }> = {
  gsa_schedule: {
    label: 'GSA Schedules (Multiple Award Schedule, GSA-administered)',
    rule: 'Parent IDV is a Federal Supply Schedule (FSS) contract awarded by the General Services Administration.',
  },
  va_schedule: {
    label: 'VA-administered Federal Supply Schedules',
    rule: 'Parent IDV is an FSS contract awarded by the Department of Veterans Affairs (the VA National Acquisition Center runs these schedules under delegation from GSA; they are part of the Schedules program but not GSA-awarded).',
  },
  other_schedule: {
    label: 'Other Federal Supply Schedules',
    rule: 'Parent IDV is an FSS contract awarded by an agency other than GSA or VA.',
  },
  va_bpa: {
    label: 'VA Blanket Purchase Agreements',
    rule: 'Parent is a BPA awarded by the Department of Veterans Affairs (a BPA may itself be established under a schedule; the source records the BPA as the parent).',
  },
  other_bpa: {
    label: 'Other agencies\' Blanket Purchase Agreements',
    rule: 'Parent is a BPA awarded by an agency other than VA.',
  },
  gwac: {
    label: 'Government-wide acquisition contracts (GWACs)',
    rule: 'Parent IDV is recorded as a GWAC.',
  },
  gsa_idiq: {
    label: 'GSA multi-agency IDIQs (non-schedule)',
    rule: 'Parent IDV is an indefinite-delivery contract (IDIQ, requirements or definite quantity) awarded by GSA that is not a schedule, for example OASIS.',
  },
  agency_idiq: {
    label: 'Agency IDIQs',
    rule: 'Parent IDV is an indefinite-delivery contract (IDIQ, requirements or definite quantity) awarded by an agency other than GSA.',
  },
  boa: {
    label: 'Basic ordering agreements',
    rule: 'Parent IDV is a basic ordering agreement (BOA).',
  },
  standalone: {
    label: 'Standalone awards (no parent vehicle)',
    rule: 'Contract actions with no parent award: definitive contracts and purchase orders.',
  },
  unresolved: {
    label: 'Vehicle type not established',
    rule: 'A parent award exists but its type could not be verified and its PIID is ambiguous. Not assigned to any vehicle.',
  },
};

const BUCKET_ORDER = Object.keys(BUCKETS) as VehicleBucket[];

export interface VehicleSpendMixInput {
  naics?: unknown;
  agency?: unknown;
  state?: unknown;
  fiscal_year?: unknown;
  fiscal_year_from?: unknown;
  fiscal_year_to?: unknown;
}

export interface VehicleBucketRow {
  bucket: VehicleBucket;
  label: string;
  rule: string;
  obligated: number;
  share_pct: number;
  award_count: number;
  parent_count: number;
  /** Dollars classified from USASpending's own IDV record. */
  verified_obligated: number;
  /** Dollars classified from the PIID pattern only (heuristic). */
  heuristic_obligated: number;
  top_parents: Array<{ parent_piid: string; obligated: number; awarding_agency: string | null; basis: 'usaspending_idv_record' | 'piid_pattern' | 'none' }>;
}

export interface VehicleSpendMixResult {
  scope: { naics: string[]; agency: string | null; state: string | null; window: string };
  total_obligated: number;
  total_award_count: number;
  buckets: VehicleBucketRow[];
  /** Convenience rollups for the common question. */
  rollups: { all_schedules: { obligated: number; share_pct: number }; all_bpas: { obligated: number; share_pct: number }; all_idiqs_and_gwacs: { obligated: number; share_pct: number } };
  classification: {
    method: string;
    parent_count: number;
    parents_verified: number;
    verified_share_of_parented_pct: number;
    heuristic_share_of_total_pct: number;
    unresolved_share_of_total_pct: number;
    verification_failed: boolean;
  };
  notes: string[];
  validation_error?: string;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    count: number;
    source: string;
    applied_filters: Record<string, unknown>;
    ignored_args: IgnoredArg[];
    as_of: string | null;
    lag_note: string;
    result_state?: 'unavailable' | 'not_reported';
    validation_error?: string;
    incomplete_reason?: string;
    scan_gib?: number;
  };
}

interface ParentRow {
  parent_piid: string | null;
  obligated: number;
  award_count: number;
  as_of: unknown;
}

export interface ParentTypeRecord { type: string | null; agency: string | null }

export interface VehicleSpendMixDeps {
  bq?: ScopedAggregateDeps;
  /** PIIDs → USASpending IDV records (exact Award ID matches only). Missing key = not found. */
  lookupParentTypes?: (piids: string[]) => Promise<Map<string, ParentTypeRecord[]>>;
}

/** Map USASpending "Contract Award Type" + awarding agency to a bucket. */
export function bucketForRecord(rec: ParentTypeRecord): VehicleBucket | null {
  const t = (rec.type ?? '').toUpperCase().trim();
  const a = (rec.agency ?? '').toLowerCase();
  const isGsa = a.includes('general services administration');
  const isVa = a.includes('veterans affairs');
  if (t === 'FSS') return isGsa ? 'gsa_schedule' : isVa ? 'va_schedule' : 'other_schedule';
  if (t === 'BPA') return isVa ? 'va_bpa' : 'other_bpa';
  if (t.includes('GWAC')) return 'gwac';
  if (t === 'BOA') return 'boa';
  if (t.includes('INDEFINITE DELIVERY') || t === 'IDC') return isGsa ? 'gsa_idiq' : 'agency_idiq';
  return null;
}

/**
 * PIID-only classification for parents USASpending did not verify. Returns null whenever the
 * PIID is ambiguous: a 9th character D is both schedules (36F79720D0123 is an FSS) and IDIQs.
 */
export function heuristicBucket(piid: string): VehicleBucket | null {
  const p = piid.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^GS\d{2}F/.test(p)) return 'gsa_schedule';
  if (/^V797/.test(p) || /^36F797/.test(p)) return 'va_schedule';
  // Uniform PIID (FAR 4.1603): 6-char office code, 2-digit FY, instrument letter, serial.
  const m = /^([A-Z0-9]{6})(\d{2})([A-Z])[A-Z0-9]{4,8}$/.exec(p);
  if (!m) return null;
  const letter = m[3];
  if (letter === 'A') return m[1].startsWith('36') ? 'va_bpa' : 'other_bpa';
  if (letter === 'G') return 'boa';
  return null;
}

async function usaspendingParentTypes(piids: string[]): Promise<Map<string, ParentTypeRecord[]>> {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `Mindy-GovConGiants (${process.env.MCP_CONTACT_EMAIL || 'hello@govcongiants.com'})`,
    },
    body: JSON.stringify({
      filters: { award_type_codes: IDV_CODES, keywords: piids },
      fields: ['Award ID', 'Contract Award Type', 'Awarding Agency'],
      limit: 100,
      page: 1,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`USASpending ${res.status}`);
  const j = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const wanted = new Set(piids.map((p) => p.toUpperCase()));
  const out = new Map<string, ParentTypeRecord[]>();
  for (const r of j.results ?? []) {
    const id = String(r['Award ID'] ?? '').toUpperCase();
    if (!wanted.has(id)) continue; // keyword search can match other text; exact Award ID only
    const rec = { type: (r['Contract Award Type'] as string) ?? null, agency: (r['Awarding Agency'] as string) ?? null };
    out.set(id, [...(out.get(id) ?? []), rec]);
  }
  return out;
}

async function defaultLookupParentTypes(piids: string[]): Promise<Map<string, ParentTypeRecord[]>> {
  const sorted = [...piids].map((p) => p.toUpperCase()).sort();
  const { value } = await withCache<Record<string, ParentTypeRecord[]>>(
    'usaspending_idv_type',
    { piids: sorted },
    7 * 24 * 60 * 60,
    async () => Object.fromEntries(await usaspendingParentTypes(sorted)),
  );
  return new Map(Object.entries(value ?? {}));
}

/** Resolve an agency argument to the toptier name used in the warehouse. */
export function resolveAgency(raw: unknown): { name: string | null; ignored: IgnoredArg[] } {
  if (raw == null || raw === '') return { name: null, ignored: [] };
  if (typeof raw !== 'string') return { name: null, ignored: [{ arg: 'agency', value: JSON.stringify(raw), reason: 'wrong_type', detail: 'expected a string' }] };
  const t = raw.trim();
  const aliases = (agencyAliases as { aliases?: Record<string, string> }).aliases ?? {};
  const hit = aliases[t] ?? aliases[t.toUpperCase()] ?? Object.entries(aliases).find(([k]) => k.toLowerCase() === t.toLowerCase())?.[1];
  return { name: hit ?? t, ignored: [] };
}

export function buildParentQuery(opts: { hasState: boolean; hasAgency: boolean; windowSql: string }): string {
  const where = [opts.windowSql, "EXISTS (SELECT 1 FROM UNNEST(@naics) p WHERE STARTS_WITH(IFNULL(naics_code, ''), p))"];
  if (opts.hasState) where.push('pop_state = @state');
  // Exact (case-insensitive) agency or sub-agency name: never a substring ("va" is inside "navy").
  if (opts.hasAgency) where.push('(LOWER(awarding_agency) = LOWER(@agency) OR LOWER(awarding_sub_agency) = LOWER(@agency))');
  return `
WITH base AS (
  SELECT NULLIF(UPPER(TRIM(parent_piid)), '') AS parent_piid, award_id, obligation_amount AS obl
  FROM ${AWARDS_TABLE}
  WHERE ${where.join('\n    AND ')}
),
fresh AS (SELECT MAX(action_date) AS as_of FROM ${AWARDS_TABLE} WHERE fiscal_year = @fyTo)
SELECT parent_piid, SUM(obl) AS obligated, COUNT(DISTINCT award_id) AS award_count, ANY_VALUE(fresh.as_of) AS as_of
FROM base CROSS JOIN fresh
GROUP BY parent_piid
ORDER BY ABS(SUM(obl)) DESC
LIMIT 50000`;
}

const LAG_NOTE =
  'Source: USASpending contract actions in the Mindy BigQuery warehouse (prime contracts only; ingested weekly) plus USASpending IDV records for vehicle type. ' +
  'as_of is the latest action date loaded for the last fiscal year in the window.';

const pct = (part: number, total: number) => (total ? round2((part / total) * 100) : 0);

export async function getVehicleSpendMix(
  input: VehicleSpendMixInput,
  deps: VehicleSpendMixDeps = {},
  now: Date = new Date(),
): Promise<VehicleSpendMixResult> {
  const ignored: IgnoredArg[] = [];
  const naics = normalizeNaicsPrefixes(input.naics);
  ignored.push(...naics.ignored);
  const st = normalizeStateArg(input.state);
  ignored.push(...st.ignored);
  const ag = resolveAgency(input.agency);
  ignored.push(...ag.ignored);
  const fy = resolveFyWindow(input, now);
  ignored.push(...fy.ignored);

  const applied: Record<string, unknown> = {
    window: windowLabel(fy.window),
    fiscal_year_from: fy.window.fy_from,
    fiscal_year_to: fy.window.fy_to,
  };
  if (naics.codes.length) applied.naics = naics.codes;
  if (st.state) applied.state = st.state;
  if (ag.name) applied.agency = `${ag.name} (exact awarding agency or sub-agency name)`;

  const scope = { naics: naics.codes, agency: ag.name, state: st.state, window: windowLabel(fy.window) };
  const notes: string[] = [
    'Dollars are net obligations inside the window (de-obligations subtract), so a bucket can be small or negative; shares are of the net total.',
    'Vehicle type is read from USASpending\'s own record of each parent award where verified; heuristic_obligated marks dollars typed from the PIID pattern alone.',
  ];
  if (fy.window.defaulted) notes.push(`No window given: defaulted to the latest three complete fiscal years (${windowLabel(fy.window)}).`);
  if (st.state) notes.push('state filters on place of performance.');
  const baseMeta = {
    source: 'BigQuery usaspending.awards + USASpending IDV records',
    applied_filters: applied,
    ignored_args: ignored,
    lag_note: LAG_NOTE,
  };
  const emptyRollups = { all_schedules: { obligated: 0, share_pct: 0 }, all_bpas: { obligated: 0, share_pct: 0 }, all_idiqs_and_gwacs: { obligated: 0, share_pct: 0 } };
  const emptyClass = { method: '', parent_count: 0, parents_verified: 0, verified_share_of_parented_pct: 0, heuristic_share_of_total_pct: 0, unresolved_share_of_total_pct: 0, verification_failed: false };

  if (!naics.codes.length) {
    return {
      scope, total_obligated: 0, total_award_count: 0, buckets: [], rollups: emptyRollups, classification: emptyClass, notes,
      validation_error: NAICS_REQUIRED,
      _meta: { ...baseMeta, grounded: false, degraded: false, count: 0, as_of: null, result_state: 'not_reported', validation_error: NAICS_REQUIRED },
    };
  }

  const query = buildParentQuery({ hasState: !!st.state, hasAgency: !!ag.name, windowSql: windowPredicate(fy.window) });
  const params: Record<string, unknown> = { ...windowParams(fy.window), naics: naics.codes };
  if (st.state) params.state = st.state;
  if (ag.name) params.agency = ag.name;
  const cacheKey = `ask:vehicle-mix:v1:${naics.codes.join('|')}:${st.state ?? '-'}:${(ag.name ?? '-').toLowerCase()}:${fy.window.fy_from}-${fy.window.fy_to}`;
  const outcome = await runScopedAggregate<ParentRow>({ cacheKey, query, params, tool: 'get_vehicle_spend_mix', family: 'vehicle_mix_parents' }, deps.bq);

  if (outcome.status === 'too_broad') {
    return {
      scope, total_obligated: 0, total_award_count: 0, buckets: [], rollups: emptyRollups, classification: emptyClass,
      notes: [...notes, `Scope too broad to scan safely (${outcome.gib.toFixed(1)} GiB). Narrow the fiscal-year window. This is NOT a zero.`],
      _meta: { ...baseMeta, grounded: false, degraded: true, count: 0, as_of: null, result_state: 'unavailable', incomplete_reason: 'scope_too_broad', scan_gib: round2(outcome.gib) },
    };
  }
  if (outcome.status === 'failed') {
    return {
      scope, total_obligated: 0, total_award_count: 0, buckets: [], rollups: emptyRollups, classification: emptyClass,
      notes: [...notes, 'The award warehouse could not be queried. This is NOT a zero; retry later.'],
      _meta: { ...baseMeta, grounded: false, degraded: true, count: 0, as_of: null, result_state: 'unavailable', incomplete_reason: outcome.reason },
    };
  }

  const rows = outcome.rows.map((r) => ({ parent_piid: r.parent_piid, obligated: num(r.obligated), award_count: num(r.award_count) }));
  const asOf = outcome.rows[0] ? bqDateString(outcome.rows[0].as_of) : null;
  const total = rows.reduce((s, r) => s + r.obligated, 0);
  const totalAwards = rows.reduce((s, r) => s + r.award_count, 0);
  const parented = rows.filter((r) => r.parent_piid);
  const parentedAbs = parented.reduce((s, r) => s + Math.abs(r.obligated), 0);

  // Verify the largest parents (by absolute dollars) until the target share or the budget.
  const toVerify: string[] = [];
  let acc = 0;
  for (const r of parented) {
    if (toVerify.length >= MAX_VERIFY_PARENTS || (parentedAbs && acc / parentedAbs >= VERIFY_TARGET_SHARE)) break;
    toVerify.push(r.parent_piid!);
    acc += Math.abs(r.obligated);
  }
  const lookup = deps.lookupParentTypes ?? defaultLookupParentTypes;
  const verified = new Map<string, ParentTypeRecord>();
  let verificationFailed = false;
  const batches: string[][] = [];
  for (let i = 0; i < toVerify.length; i += BATCH_SIZE) batches.push(toVerify.slice(i, i + BATCH_SIZE));
  for (let i = 0; i < batches.length; i += 3) {
    const settled = await Promise.allSettled(batches.slice(i, i + 3).map((b) => lookup(b)));
    for (const s of settled) {
      if (s.status === 'rejected') {
        verificationFailed = true;
        continue;
      }
      for (const [piid, recs] of s.value) {
        // Same PIID under two agencies with different types: ambiguous, do not pick one.
        const buckets = new Set(recs.map((r) => bucketForRecord(r)));
        if (recs.length && buckets.size === 1 && !buckets.has(null)) verified.set(piid.toUpperCase(), recs[0]);
      }
    }
  }

  const acc2 = new Map<VehicleBucket, VehicleBucketRow>();
  for (const b of BUCKET_ORDER) {
    acc2.set(b, { bucket: b, label: BUCKETS[b].label, rule: BUCKETS[b].rule, obligated: 0, share_pct: 0, award_count: 0, parent_count: 0, verified_obligated: 0, heuristic_obligated: 0, top_parents: [] });
  }
  let verifiedParents = 0;
  let verifiedAbs = 0;
  for (const r of rows) {
    let bucket: VehicleBucket;
    let basis: 'usaspending_idv_record' | 'piid_pattern' | 'none' = 'none';
    let agency: string | null = null;
    if (!r.parent_piid) bucket = 'standalone';
    else {
      const rec = verified.get(r.parent_piid);
      const vb = rec ? bucketForRecord(rec) : null;
      if (rec && vb) {
        bucket = vb;
        basis = 'usaspending_idv_record';
        agency = rec.agency;
        verifiedParents += 1;
        verifiedAbs += Math.abs(r.obligated);
      } else {
        const hb = heuristicBucket(r.parent_piid);
        if (hb) {
          bucket = hb;
          basis = 'piid_pattern';
        } else bucket = 'unresolved';
      }
    }
    const row = acc2.get(bucket)!;
    row.obligated += r.obligated;
    row.award_count += r.award_count;
    if (r.parent_piid) {
      row.parent_count += 1;
      if (basis === 'usaspending_idv_record') row.verified_obligated += r.obligated;
      if (basis === 'piid_pattern') row.heuristic_obligated += r.obligated;
      if (row.top_parents.length < 3) row.top_parents.push({ parent_piid: r.parent_piid, obligated: round2(r.obligated), awarding_agency: agency, basis });
    }
  }

  const buckets = BUCKET_ORDER.map((b) => acc2.get(b)!)
    .filter((b) => b.award_count > 0 || b.obligated !== 0)
    .map((b) => ({ ...b, obligated: round2(b.obligated), share_pct: pct(b.obligated, total), verified_obligated: round2(b.verified_obligated), heuristic_obligated: round2(b.heuristic_obligated) }))
    .sort((a, b) => b.obligated - a.obligated);
  const sumOf = (keys: VehicleBucket[]) => keys.reduce((s, k) => s + (acc2.get(k)?.obligated ?? 0), 0);
  const schedules = sumOf(['gsa_schedule', 'va_schedule', 'other_schedule']);
  const bpas = sumOf(['va_bpa', 'other_bpa']);
  const idiqs = sumOf(['gwac', 'gsa_idiq', 'agency_idiq']);
  const heuristicTotal = BUCKET_ORDER.reduce((s, k) => s + (acc2.get(k)?.heuristic_obligated ?? 0), 0);

  const truncated = outcome.rows.length >= 50000;
  if (truncated) notes.push('More than 50,000 parent awards in scope: the smallest were cut, so totals are a floor. Narrow the scope.');
  if (verificationFailed) notes.push('Some USASpending vehicle-type lookups failed; those parents fell back to the PIID heuristic or to "unresolved". Shares still sum to the total.');

  return {
    scope,
    total_obligated: round2(total),
    total_award_count: totalAwards,
    buckets,
    rollups: {
      all_schedules: { obligated: round2(schedules), share_pct: pct(schedules, total) },
      all_bpas: { obligated: round2(bpas), share_pct: pct(bpas, total) },
      all_idiqs_and_gwacs: { obligated: round2(idiqs), share_pct: pct(idiqs, total) },
    },
    classification: {
      method: `Parents verified largest-first against USASpending IDV records (up to ${MAX_VERIFY_PARENTS} parents or ${VERIFY_TARGET_SHARE * 100}% of parented dollars); the rest typed from unambiguous PIID patterns or left unresolved.`,
      parent_count: parented.length,
      parents_verified: verifiedParents,
      verified_share_of_parented_pct: pct(verifiedAbs, parentedAbs),
      heuristic_share_of_total_pct: pct(heuristicTotal, total),
      unresolved_share_of_total_pct: pct(acc2.get('unresolved')!.obligated, total),
      verification_failed: verificationFailed,
    },
    notes,
    _meta: {
      ...baseMeta,
      grounded: rows.length > 0,
      degraded: false,
      count: buckets.length,
      as_of: asOf,
      ...(truncated
        ? { incomplete_reason: 'parent list truncated at 50,000; totals are a floor' }
        : verificationFailed
          ? { incomplete_reason: 'some vehicle-type lookups failed; affected parents typed by PIID heuristic or unresolved' }
          : {}),
    },
  };
}
