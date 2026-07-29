/**
 * M-Scale oracle — the SHARED verification logic for the three branded Mindy numbers, callable from
 * BOTH the CLI (scripts/verify-m-scale.mjs) and the admin API (/api/admin/verify-m-scale) so an
 * independent tester (3rd-party QA) can re-run the EXACT SAME checks without prod credentials.
 *
 * One source of truth on purpose: if the CLI and the route each hand-rolled the oracle, they'd drift
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
 *      · none @ $0), mirrored + boundary-tested. (Grounded firm-distribution lives in the CLI/route,
 *      not here, since it needs a raw SQL RPC.)
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
  const expected: Record<string, number> = {
    'NAICS Match': 25, 'Set-Aside': 25, 'Agency Experience': 15,
    'Contract Size': 15, 'Capability Match': 10, 'Contract Vehicle': 8,
  };
  const expectedTotal = Object.values(expected).reduce((a, b) => a + b, 0); // 98
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
