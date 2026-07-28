/**
 * Build contractor capability profiles from award history (PRD Phase 1).
 * docs/PRD-contractor-capability-profiles.md
 *
 * ONE batched BigQuery aggregate → upsert into contractor_capability_profiles. Local `tsx`
 * runner, not an HTTP cron (rule #7: >1000 rows → local runner; Vercel routes throttle under
 * bulk load and this writes ~95K rows).
 *
 * WHY BATCH: the source is the 63M-row awards table. A per-request BQ read on a user-facing
 * path is how the June-2026 $2,075 spike happened (tasks/bigquery-cost-spike-2026-06.md).
 * This build measures ~4.8GB ≈ $0.03 and every user-facing read is Supabase afterward.
 *
 * GROUNDING (rule #1): every value written comes from a coded BQ column. awards.description
 * (free text) is EXCLUDED on purpose — median 35 chars, dominated by boilerplate, and it
 * contradicts the coded fields (nitrile gloves under PSC "FLOOR POLISHERS AND VACUUM CLEANING
 * EQUIPMENT"). psc_description / naics_description are 99.998% populated and are the real
 * capability vocabulary.
 *
 * KEYED ON rollup_uei: one company can hold several UEIs (measured: LOCKHEED MARTIN CORPORATION
 * under both H7PNSVNN5827 and KMEVRAKJVBD3 in FY2025 FL alone). recipients_rollup_merged
 * collapses them, and the contractor SEO pages already read that rollup — profiles must agree.
 *
 * Usage:
 *   npx tsx scripts/build-capability-profiles.ts --dry            # sizing + sample, NO write
 *   npx tsx scripts/build-capability-profiles.ts --limit=500      # small real write (verify first)
 *   npx tsx scripts/build-capability-profiles.ts                  # full build
 *   npx tsx scripts/build-capability-profiles.ts --min-awards=1 --since-fy=2019   # widen population
 *
 * Env: BigQuery creds (GOOGLE_APPLICATION_CREDENTIALS or GCP_SERVICE_ACCOUNT_JSON),
 *      NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
// Must load env BEFORE the bigquery/supabase clients below read process.env at module scope
// (same pattern as the other scripts/ runners); an ESM import would be hoisted above this call.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { bqQuery, BQ_TABLES } from '../src/lib/bigquery/client';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

interface ProfileRow {
  rollup_uei: string;
  rollup_name: string;
  child_ueis: string[] | null;
  state: string | null;
  top_pscs: Array<{ code: string; description: string; awards: number; obligated: number; share: number }>;
  top_naics: Array<{ code: string; description: string; awards: number; obligated: number }>;
  top_agencies: Array<{ agency: string; awards: number; obligated: number; share: number }>;
  set_asides_won: string[] | null;
  award_count: number;
  total_obligated: number;
  first_award_date: string | null;
  last_award_date: string | null;
  fy_totals: Record<string, number>;
  distinct_psc: number;
  distinct_naics: number;
  distinct_agencies: number;
  specialty_score: number | null;
  specialty_tier: string | null;
  psc_hhi: number | null;
  agency_concentration: number | null;
}

/**
 * The aggregate. Structure:
 *   scoped  — awards narrowed to the fiscal-year window (the ONLY full-table scan)
 *   rollup  — recipient_uei → rollup_uei via recipients_rollup_merged.child_ueis
 *   base    — per-company totals, dates, distinct counts
 *   psc/naics/agency — per-company per-code aggregates, ranked + shared
 *   final   — top-5 arrays + the derived concentration metrics
 *
 * Everything is computed IN BigQuery: pulling 22M rows into Node to aggregate would be slow
 * and pointless when BQ does it in one pass.
 */
function buildQuery(sinceFy: number, minAwards: number, limit?: number): string {
  return `
WITH scoped AS (
  SELECT
    a.recipient_uei, a.recipient_name, a.recipient_state,
    a.psc_code, a.psc_description, a.naics_code, a.naics_description,
    a.awarding_agency, a.set_aside, a.obligation_amount, a.award_id,
    a.action_date, a.fiscal_year
  FROM ${BQ_TABLES.awards} a
  WHERE a.fiscal_year >= @sinceFy
    AND a.obligation_amount > 0
    AND a.recipient_uei IS NOT NULL AND a.recipient_uei != ''
),
-- Map every child UEI to its canonical rollup. LEFT JOIN + COALESCE so a UEI absent from the
-- rollup table still gets a profile under its own UEI rather than being silently dropped.
--
-- ⚠️ MEASURED SOURCE DEFECT (2026-07-28): recipients_rollup_merged.child_ueis OVERLAPS between
-- rollups — 16,862 of 317,110 child mappings (5.32%) belong to 2+ rollups, worst case 9. E.g.
-- QN1BCFY7JDJ5 is a child of BOTH "RTX CORP" and "ROCKWELL COLLINS AUSTRALIA PTY LIMITED".
-- A naive UNNEST + JOIN therefore fans out and counts the same awards into several companies,
-- which inflated the largest primes: the first dry run showed RTX and Rockwell Collins with an
-- IDENTICAL top PSC and award count (358 "GUIDED MISSILES"), because both inherited the same
-- child's awards.
--
-- FIX: pick ONE winning rollup per child UEI. Largest rollup wins (total_obligated DESC), tie-break
-- on rollup_uei for determinism so reruns are stable. Rationale: the acquirer/parent is the larger
-- entity, so attributing a shared subsidiary's work to it matches how a BD user reads the market
-- ("that's an RTX company"). Deterministic beats arbitrary — QUALIFY makes the choice explicit
-- rather than letting the join pick a random duplicate.
rmap AS (
  SELECT rollup_uei, rollup_name, child_ueis, state, child_uei
  FROM (
    SELECT r.rollup_uei, r.rollup_name, r.child_ueis, r.state, child_uei, r.total_obligated
    FROM ${BQ_TABLES.recipientsRollup} r, UNNEST(r.child_ueis) AS child_uei
  )
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY child_uei
    ORDER BY total_obligated DESC, rollup_uei
  ) = 1
),
joined AS (
  SELECT
    COALESCE(m.rollup_uei, s.recipient_uei) AS rollup_uei,
    COALESCE(m.rollup_name, s.recipient_name) AS rollup_name,
    m.child_ueis,
    COALESCE(m.state, s.recipient_state) AS state,
    s.*
  FROM scoped s
  LEFT JOIN rmap m ON m.child_uei = s.recipient_uei
),
base AS (
  SELECT
    rollup_uei,
    ANY_VALUE(rollup_name) AS rollup_name,
    ANY_VALUE(child_ueis) AS child_ueis,
    ANY_VALUE(state) AS state,
    COUNT(DISTINCT award_id) AS award_count,
    SUM(obligation_amount) AS total_obligated,
    MIN(action_date) AS first_award_date,
    MAX(action_date) AS last_award_date,
    COUNT(DISTINCT NULLIF(psc_code, '')) AS distinct_psc,
    COUNT(DISTINCT NULLIF(naics_code, '')) AS distinct_naics,
    COUNT(DISTINCT NULLIF(awarding_agency, '')) AS distinct_agencies,
    -- Real set-aside strings won. Award BEHAVIOR only — NOT certification (see migration note:
    -- inferring certs mislabeled SAIC as SDVOSB/8(a) off ~2% edge-case awards).
    ARRAY_AGG(DISTINCT NULLIF(set_aside, '') IGNORE NULLS) AS set_asides_won
  FROM joined
  GROUP BY rollup_uei
  HAVING COUNT(DISTINCT award_id) >= @minAwards AND SUM(obligation_amount) > 0
),
fy AS (
  SELECT rollup_uei, TO_JSON_STRING(ARRAY_AGG(STRUCT(CAST(fiscal_year AS STRING) AS fy, amt) ORDER BY fiscal_year)) AS fy_json
  FROM (SELECT rollup_uei, fiscal_year, ROUND(SUM(obligation_amount), 2) AS amt FROM joined GROUP BY 1, 2)
  GROUP BY rollup_uei
),
psc AS (
  SELECT rollup_uei, psc_code AS code, ANY_VALUE(psc_description) AS description,
         COUNT(DISTINCT award_id) AS awards, SUM(obligation_amount) AS obligated
  FROM joined WHERE psc_code IS NOT NULL AND psc_code != '' GROUP BY 1, 2
),
psc_tot AS (SELECT rollup_uei, SUM(obligated) AS t FROM psc GROUP BY 1),
psc_sh AS (
  SELECT p.*, SAFE_DIVIDE(p.obligated, t.t) AS share
  FROM psc p JOIN psc_tot t USING (rollup_uei)
),
psc_agg AS (
  SELECT rollup_uei,
    ARRAY_AGG(STRUCT(code, description, awards, ROUND(obligated, 2) AS obligated, ROUND(share, 4) AS share)
              ORDER BY obligated DESC LIMIT 5) AS top_pscs,
    MAX(share) AS specialty_score,
    -- Herfindahl over PSC dollar shares: catches a long tail that top-share alone hides.
    SUM(POW(share, 2)) AS psc_hhi
  FROM psc_sh GROUP BY 1
),
naics_agg AS (
  SELECT rollup_uei,
    ARRAY_AGG(STRUCT(code, description, awards, ROUND(obligated, 2) AS obligated)
              ORDER BY obligated DESC LIMIT 5) AS top_naics
  FROM (
    SELECT rollup_uei, naics_code AS code, ANY_VALUE(naics_description) AS description,
           COUNT(DISTINCT award_id) AS awards, SUM(obligation_amount) AS obligated
    FROM joined WHERE naics_code IS NOT NULL AND naics_code != '' GROUP BY 1, 2
  ) GROUP BY 1
),
ag AS (
  SELECT rollup_uei, awarding_agency AS agency,
         COUNT(DISTINCT award_id) AS awards, SUM(obligation_amount) AS obligated
  FROM joined WHERE awarding_agency IS NOT NULL AND awarding_agency != '' GROUP BY 1, 2
),
ag_tot AS (SELECT rollup_uei, SUM(obligated) AS t FROM ag GROUP BY 1),
ag_agg AS (
  SELECT a.rollup_uei,
    ARRAY_AGG(STRUCT(a.agency, a.awards, ROUND(a.obligated, 2) AS obligated,
                     ROUND(SAFE_DIVIDE(a.obligated, t.t), 4) AS share)
              ORDER BY a.obligated DESC LIMIT 5) AS top_agencies,
    MAX(SAFE_DIVIDE(a.obligated, t.t)) AS agency_concentration
  FROM ag a JOIN ag_tot t USING (rollup_uei) GROUP BY 1
)
SELECT
  b.rollup_uei, b.rollup_name, b.child_ueis, b.state,
  IFNULL(p.top_pscs, []) AS top_pscs,
  IFNULL(n.top_naics, []) AS top_naics,
  IFNULL(g.top_agencies, []) AS top_agencies,
  b.set_asides_won, b.award_count, ROUND(b.total_obligated, 2) AS total_obligated,
  b.first_award_date, b.last_award_date, f.fy_json,
  b.distinct_psc, b.distinct_naics, b.distinct_agencies,
  ROUND(p.specialty_score, 4) AS specialty_score,
  CASE WHEN p.specialty_score >= 0.8 THEN 'specialist'
       WHEN p.specialty_score >= 0.5 THEN 'focused'
       WHEN p.specialty_score IS NOT NULL THEN 'diversified' END AS specialty_tier,
  ROUND(p.psc_hhi, 4) AS psc_hhi,
  ROUND(g.agency_concentration, 4) AS agency_concentration
FROM base b
LEFT JOIN psc_agg p USING (rollup_uei)
LEFT JOIN naics_agg n USING (rollup_uei)
LEFT JOIN ag_agg g USING (rollup_uei)
LEFT JOIN fy f USING (rollup_uei)
ORDER BY b.total_obligated DESC
${limit ? `LIMIT ${limit}` : ''}`;
}

/** BQ returns fy as a JSON string of [{fy,amt}] — reshape to {"2024": 123.45}. */
function parseFyTotals(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const arr = JSON.parse(json) as Array<{ fy: string; amt: number }>;
    return Object.fromEntries(arr.map((r) => [r.fy, Number(r.amt) || 0]));
  } catch { return {}; }
}

/** BQ DATE comes back as {value:'YYYY-MM-DD'} or a string depending on the driver. */
function dateStr(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const val = (v as { value?: string }).value;
  return val ? val.slice(0, 10) : null;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const sinceFy = parseInt(arg('since-fy') || '2021', 10);
  const minAwards = parseInt(arg('min-awards') || '3', 10);
  const limitArg = arg('limit');
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dry && (!url || !key)) { console.error('❌ Supabase env missing'); process.exit(1); }

  console.log(`Building capability profiles — sinceFy=${sinceFy} minAwards=${minAwards}${limit ? ` limit=${limit}` : ''}${dry ? ' (DRY — no write)' : ''}`);
  const t0 = Date.now();
  const rows = await bqQuery<Record<string, unknown>>({
    query: buildQuery(sinceFy, minAwards, limit),
    params: { sinceFy, minAwards },
    // 12GB ceiling ≈ $0.07/build. The FY2021+ aggregate dry-ran at 4.84GB, but the child-UEI
    // dedupe (QUALIFY over all 317K mappings) pushed it just past 8GB, which failed hard —
    // proof the ceiling works. 12GB leaves room for a widened fiscal-year window while still
    // hard-stopping a runaway scan. This is a ONCE-A-MONTH batch build, not a request path.
    maximumBytesBilled: String(12 * 1024 * 1024 * 1024),
  });
  console.log(`✅ BQ returned ${rows.length} profiles in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const mapped: ProfileRow[] = rows.map((r) => ({
    rollup_uei: String(r.rollup_uei),
    rollup_name: String(r.rollup_name ?? '').trim() || String(r.rollup_uei),
    child_ueis: (r.child_ueis as string[] | null) ?? null,
    state: (r.state as string | null) || null,
    top_pscs: (r.top_pscs as ProfileRow['top_pscs']) ?? [],
    top_naics: (r.top_naics as ProfileRow['top_naics']) ?? [],
    top_agencies: (r.top_agencies as ProfileRow['top_agencies']) ?? [],
    set_asides_won: (r.set_asides_won as string[] | null) ?? null,
    award_count: Number(r.award_count) || 0,
    total_obligated: Number(r.total_obligated) || 0,
    first_award_date: dateStr(r.first_award_date),
    last_award_date: dateStr(r.last_award_date),
    fy_totals: parseFyTotals((r.fy_json as string) ?? null),
    distinct_psc: Number(r.distinct_psc) || 0,
    distinct_naics: Number(r.distinct_naics) || 0,
    distinct_agencies: Number(r.distinct_agencies) || 0,
    specialty_score: r.specialty_score == null ? null : Number(r.specialty_score),
    specialty_tier: (r.specialty_tier as string | null) || null,
    psc_hhi: r.psc_hhi == null ? null : Number(r.psc_hhi),
    agency_concentration: r.agency_concentration == null ? null : Number(r.agency_concentration),
  }));

  // Distribution check — must reproduce the measured population (69.6% / 20.0% / 10.4% for
  // FY2023+). A wild deviation means the scorer or the rollup join is wrong, so print it
  // BEFORE writing rather than discovering it in the UI.
  const tiers = mapped.reduce<Record<string, number>>((acc, m) => {
    const k = m.specialty_tier || 'null'; acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});
  const pct = (n: number) => `${((100 * n) / mapped.length).toFixed(1)}%`;
  console.log(`\ntier distribution: specialist ${tiers.specialist || 0} (${pct(tiers.specialist || 0)}) · focused ${tiers.focused || 0} (${pct(tiers.focused || 0)}) · diversified ${tiers.diversified || 0} (${pct(tiers.diversified || 0)}) · null ${tiers.null || 0}`);
  const noPsc = mapped.filter((m) => !m.top_pscs.length).length;
  const noName = mapped.filter((m) => !m.rollup_name).length;
  console.log(`sanity: ${noPsc} rows with NO top_pscs · ${noName} with no name`);

  console.log('\nsample (top 3 by obligated):');
  for (const m of mapped.slice(0, 3)) {
    console.log(`  ${m.rollup_name} [${m.state}] — ${m.specialty_tier} ${m.specialty_score} · ${m.award_count} awards · $${(m.total_obligated / 1e6).toFixed(1)}M`);
    console.log(`     top PSC: ${m.top_pscs[0]?.description ?? '—'} (${m.top_pscs[0]?.awards ?? 0} awards)`);
  }

  if (dry) { console.log('\n(dry run — nothing written)'); process.exit(0); }

  const sb = createClient(url!, key!, { auth: { persistSession: false } });
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const batch = mapped.slice(i, i + CHUNK).map((m) => ({ ...m, built_at: new Date().toISOString() }));
    const { error } = await sb.from('contractor_capability_profiles').upsert(batch, { onConflict: 'rollup_uei' });
    if (error) { console.error(`❌ upsert failed at row ${i}: ${error.message}`); process.exit(1); }
    written += batch.length;
    if (i % 5000 === 0 || written === mapped.length) console.log(`  upserted ${written}/${mapped.length}`);
  }

  const { count } = await sb.from('contractor_capability_profiles').select('*', { count: 'exact', head: true });
  console.log(`\n✅ wrote ${written} profiles · table now holds ${count} rows · ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min total`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message || e); process.exit(1); });
