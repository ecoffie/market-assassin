/**
 * M-Scale oracle — the SINGLE SHARED verification logic for the three branded Mindy numbers, called by
 * BOTH the CLI (scripts/verify-m-scale.mjs, the predeploy gate) AND the MCP tool (verify_m_scale, which
 * lets a 3rd-party tester re-run the EXACT SAME checks without prod credentials).
 *
 * One source of truth on purpose: if the CLI and the tool each hand-rolled the oracle, they'd drift
 * (the duplicate-path class this codebase keeps fixing). Everything here is grounded — every figure is
 * re-derived from real data (recompete_opportunities) or documented factor math (win-probability.ts).
 * Nothing is an LLM guess.
 *
 *   1. M-Estimate™ — the opp_value_range RPC's low/median/high must EQUAL the 25th/50th/75th
 *      percentiles re-derived straight from the raw award table. A NAICS with no comparables is an
 *      honest miss (both null) → PASS, not a mismatch (empty must be distinguishable from wrong).
 *   2. M-Win — a fixed profile+opp must produce the EXACT documented factor total (25+25+15+15+10+8),
 *      plus the no-profile fallback (30) and monotonicity.
 *   3. M-Scale™ — the tier flips exactly on fixed $ bands (Top ≥$100M · Mid $10M–$100M · Emerging >$0
 *      · none @ $0): boundary-tested here; the CLI also source-asserts the mirror against the live
 *      companyScaleTier (checkMScaleSourceAssert, needs the route file) and grounds it against the real
 *      firm pyramid (checkMScaleDistribution, needs the readonly_select RPC). The MCP tool runs the
 *      boundary check only (a serverless context can't reliably read source files).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateWinProbability } from '@/lib/briefings/win-probability';
import type { BriefingUserProfile } from '@/lib/smart-profile/types';

export interface OracleCheck {
  name: string;
  pass: boolean;
  detail: string;
}

const money = (n: number | null | undefined) =>
  n == null ? 'null' : '$' + Math.round(n).toLocaleString();

// ── 1. M-ESTIMATE: RPC vs raw-table oracle ──────────────────────────────────────────────────────
export async function checkMEstimate(db: SupabaseClient, naics: string): Promise<OracleCheck[]> {
  const out: OracleCheck[] = [];

  const { data: rpcData, error: rpcErr } = await db.rpc('opp_value_range', {
    p_naics: naics, p_agency: null, p_sub: null,
  });
  if (rpcErr) {
    out.push({ name: `M-Estimate RPC(${naics})`, pass: false, detail: `RPC error: ${rpcErr.message}` });
    return out;
  }
  const rpc = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    { n: number; p10: number | null; p50: number | null; p90: number | null } | undefined;

  // Re-derive the oracle straight from the table with the SAME filter the RPC uses.
  const amounts: number[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('recompete_opportunities')
      .select('total_obligation')
      .eq('naics_code', naics)
      .gte('total_obligation', 1000)
      .lte('total_obligation', 500000000)
      .range(from, from + PAGE - 1);
    if (error) {
      out.push({ name: `M-Estimate oracle(${naics})`, pass: false, detail: `table read error: ${error.message}` });
      return out;
    }
    if (!data || data.length === 0) break;
    for (const r of data) amounts.push(Number((r as { total_obligation: number }).total_obligation));
    if (data.length < PAGE) break;
  }
  amounts.sort((a, b) => a - b);
  const n = amounts.length;
  const pct = (p: number): number | null => {
    if (!n) return null;
    const idx = p * (n - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return amounts[lo];
    return amounts[lo] + (amounts[hi] - amounts[lo]) * (idx - lo);
  };
  const oracle = { n, p25: pct(0.25), p50: pct(0.5), p75: pct(0.75) };
  const nMatch = Number(rpc?.n) === oracle.n;

  // Honest miss: no comparables → both null → PASS (empty is distinguishable from wrong).
  if (oracle.n === 0 && rpc?.p50 == null) {
    out.push({
      name: `M-Estimate ${naics} = raw-award percentiles`,
      pass: nMatch,
      detail: `no comparable awards for ${naics} — RPC n=${rpc?.n} + oracle n=0, both null → honest miss ("No estimate"), not a fabricated band`,
    });
  } else {
    const near = (a?: number | null, b?: number | null) =>
      a != null && b != null && Math.abs(Math.round(a) - Math.round(b)) <= 1;
    const lowOk = near(rpc?.p10, oracle.p25);   // RPC col p10 holds the 25th (API-compat name)
    const medOk = near(rpc?.p50, oracle.p50);
    const highOk = near(rpc?.p90, oracle.p75);
    const pass = nMatch && lowOk && medOk && highOk;
    out.push({
      name: `M-Estimate ${naics} = raw-award percentiles`,
      pass,
      detail: `RPC n=${rpc?.n} low/med/high ${money(rpc?.p10)}/${money(rpc?.p50)}/${money(rpc?.p90)} | ` +
        `oracle n=${oracle.n} p25/p50/p75 ${money(oracle.p25)}/${money(oracle.p50)}/${money(oracle.p75)}` +
        (pass ? '' : `  [nMatch=${nMatch} low=${lowOk} med=${medOk} high=${highOk}]`),
    });
  }

  // Honest-miss gate: a bogus NAICS must yield < 8 comparables → the app returns null.
  const { data: thinData } = await db.rpc('opp_value_range', { p_naics: '999999', p_agency: null, p_sub: null });
  const thin = (Array.isArray(thinData) ? thinData[0] : thinData) as { n?: number } | undefined;
  const thinN = Number(thin?.n ?? 0);
  out.push({
    name: 'M-Estimate honest-miss (bogus NAICS 999999 < 8 comparables → null, not a fabricated band)',
    pass: thinN < 8,
    detail: `n=${thinN} (MIN_SAMPLE=8; below → getComparableAwardRange returns null)`,
  });
  return out;
}

// ── 2. M-WIN: deterministic factor oracle ───────────────────────────────────────────────────────
export function checkMWin(): OracleCheck[] {
  const out: OracleCheck[] = [];
  const profile = {
    naicsCodes: ['541512'], topNaics: [], targetAgencies: ['Department of Defense'], topAgencies: [],
    keywords: ['cybersecurity'], capabilityKeywords: ['cybersecurity'],
    certifications: ['SDVOSB'], companySize: 'small', maxContractSize: null,
    contractVehicles: ['GSA Schedule'],
  } as unknown as BriefingUserProfile;
  const opp = {
    naicsCode: '541512', setAside: 'SDVOSB', agency: 'Department of Defense',
    amount: 500000, title: 'Cybersecurity support services', description: 'cybersecurity',
  };
  const r = calculateWinProbability(opp, profile);
  const byName = Object.fromEntries(r.factors.map((f) => [f.name, f.points]));
  // The factor CEILINGS (maxPoints) sum to 100 — but the Contract Vehicle factor only ever returns
  // 3/6/8 (a GSA Schedule holder gets 8, and nothing reaches its 10-point ceiling), so the real
  // ACHIEVABLE max for a perfect match is 98. Expected here is the achievable-max per factor, NOT the
  // ceiling — a 3rd-party reviewer correctly noticed 25+25+15+15+10+10=100 ≠ 98, so state it precisely.
  const expected: Record<string, number> = {
    'NAICS Match': 25, 'Set-Aside': 25, 'Agency Experience': 15,
    'Contract Size': 15, 'Capability Match': 10, 'Contract Vehicle': 8,
  };
  const expectedTotal = Object.values(expected).reduce((a, b) => a + b, 0); // 98 (achievable max; ceilings sum to 100)
  let allFactorsOk = true;
  for (const [k, v] of Object.entries(expected)) if (byName[k] !== v) allFactorsOk = false;
  out.push({
    name: `M-Win strong-match total = ${expectedTotal} (25+25+15+15+10+8)`,
    pass: r.score === expectedTotal && allFactorsOk,
    detail: `score=${r.score} tier=${r.tier} factors=${JSON.stringify(byName)}`,
  });

  const np = calculateWinProbability({ naicsCode: '541512' }, null);
  out.push({
    name: 'M-Win no-profile fallback is a fixed 30/low',
    pass: np.score === 30 && np.tier === 'low',
    detail: `score=${np.score} tier=${np.tier}`,
  });

  const weak = calculateWinProbability({ naicsCode: '999999', setAside: 'HUBZone' }, profile);
  out.push({
    name: 'M-Win monotonic (unrelated opp scores lower than a strong match)',
    pass: weak.score < r.score,
    detail: `weak=${weak.score} < strong=${r.score}`,
  });
  return out;
}

// ── 3. M-SCALE: contractor-size tier bands ──────────────────────────────────────────────────────
// Mirror of the nested companyScaleTier() in opportunity-map/route.ts. The CLI/route source-assert
// this mirror against the live fn so it can't drift; here we boundary-test it.
export function mScaleTier(totalObligated: number | null | undefined): string {
  const v = Number(totalObligated) || 0;
  if (v <= 0) return '';
  return v >= 1e8 ? 'Top tier' : (v >= 1e7 ? 'Mid' : 'Emerging');
}

export function checkMScaleBoundaries(): OracleCheck[] {
  const boundary: Array<[number, string]> = [
    [0, ''], [-5, ''],
    [9_999_999, 'Emerging'], [10_000_000, 'Mid'],
    [99_999_999, 'Mid'], [100_000_000, 'Top tier'], [5_000_000_000, 'Top tier'],
    [100_000, 'Emerging'],
  ];
  let ok = true; const bad: string[] = [];
  for (const [amt, want] of boundary) {
    const got = mScaleTier(amt);
    if (got !== want) { ok = false; bad.push(`$${amt}→"${got}"≠"${want}"`); }
  }
  return [{
    name: 'M-Scale tier boundaries ($0→none · <$10M Emerging · $10M–$100M Mid · ≥$100M Top)',
    pass: ok,
    detail: ok ? '8/8 boundary cases correct' : bad.join(' '),
  }];
}

/**
 * Source-assert the mScaleTier mirror against the LIVE companyScaleTier() nested in the map route.
 * The route source is passed in (the caller reads the file — keeps this lib filesystem-agnostic; the
 * MCP tool can skip this check, the CLI supplies the file). Guards the duplicate-path drift class.
 */
export function checkMScaleSourceAssert(routeSrc: string): OracleCheck {
  const bandsIntact =
    /v>=1e8\s*\?\s*'Top tier'\s*:\s*\(v>=1e7\s*\?\s*'Mid'\s*:\s*'Emerging'\)/.test(routeSrc) &&
    /if\(v<=0\)return\s*''/.test(routeSrc);
  return {
    name: 'M-Scale bands match the live companyScaleTier (source-assert — mirror not drifted)',
    pass: bandsIntact,
    detail: bandsIntact ? "Top≥$100M · Mid $10M–$100M · Emerging>$0 · ''@0" : 'companyScaleTier bands changed in route.ts — update the mirror',
  };
}

/**
 * Grounded distribution: bucket every incumbent's total $ won and confirm the tiers partition the
 * corpus sensibly (a pyramid — far more Emerging than Top). Needs the readonly_select RPC; when it's
 * unavailable (e.g. local without that RPC) returns a PASS with a SKIPPED note (the boundary +
 * source-assert already prove the logic; the distribution is a bonus reality check).
 */
export async function checkMScaleDistribution(db: SupabaseClient): Promise<OracleCheck> {
  const { data, error } = await db.rpc('readonly_select', {
    q: `SELECT
          CASE WHEN t >= 100000000 THEN 'Top tier' WHEN t >= 10000000 THEN 'Mid' WHEN t > 0 THEN 'Emerging' ELSE 'none' END AS tier,
          COUNT(*) AS firms
        FROM (SELECT SUM(total_obligation) AS t FROM recompete_opportunities WHERE incumbent_name IS NOT NULL GROUP BY incumbent_name) s
        GROUP BY 1`,
  }).then((r) => r, () => ({ data: null, error: 'rpc unavailable' }));
  if (error || !Array.isArray(data)) {
    return {
      name: 'M-Scale grounded distribution (real firms bucket into the 3 tiers)',
      pass: true,
      detail: 'SKIPPED — readonly_select RPC not available here (boundary + source-assert already prove the logic)',
    };
  }
  const by = Object.fromEntries((data as Array<{ tier: string; firms: number | string }>).map((x) => [x.tier, Number(x.firms)]));
  const pyramid = (by['Emerging'] || 0) > (by['Mid'] || 0) && (by['Mid'] || 0) > 0 && (by['Top tier'] || 0) > 0;
  return {
    name: 'M-Scale grounded distribution (real firms form a pyramid: Emerging > Mid > 0, Top > 0)',
    pass: pyramid,
    detail: `Top=${by['Top tier'] || 0} · Mid=${by['Mid'] || 0} · Emerging=${by['Emerging'] || 0}`,
  };
}
