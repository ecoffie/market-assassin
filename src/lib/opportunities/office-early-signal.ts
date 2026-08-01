/**
 * Which BUYING OFFICES telegraph work before they buy it — ranked.
 *
 * THE PROBLEM THIS SOLVES
 * At department level, DoD is one undifferentiated blob: 24,217 active
 * opportunities, ~17% of them early-stage. True, and useless — it tells a
 * contractor nothing about where to spend relationship time.
 *
 * At OFFICE level the same data separates sharply. Measured 2026-07-31:
 *   SPE7M1 (DLA parts desk)   2,108 opps →     1 early  (0%)
 *   N00104 (NAVSUP WSS)       1,576 opps →   238 early (15%)
 *   N00019 (NAVAIR)              85 opps →    64 early (75%)
 *   N62742 (NAVFAC Pacific)      27 opps →    23 early (85%)
 * The biggest office by volume produces essentially NO early signal; small
 * program offices produce almost nothing else. Averaging them hides both facts.
 *
 * "Early" = Sources Sought + Presolicitation. Those post BEFORE a solicitation,
 * which is the window where a requirement can still be shaped — the thing
 * agency forecast pages were supposed to provide and mostly don't.
 *
 * Anchored on the 6-char DoDAAC that prefixes every DoD solicitation number
 * (W912PL = USACE LA District), then joined to dodaac_directory for the real
 * office name and its historical award volume. No LLM anywhere in this path.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OfficeSignalRow {
  dodaac: string;
  officeName: string | null;
  subAgency: string | null;
  /** Active opportunities at this office matching the caller's filters. */
  opportunities: number;
  /** Of those, Sources Sought + Presolicitation. */
  earlyStage: number;
  /** earlyStage / opportunities, 0-100. The ranking signal. */
  pctEarly: number;
  /** Lifetime award count from dodaac_directory — is this office actually busy? */
  lifetimeAwards: number | null;
  /** Lifetime obligated dollars — how big are its buys? */
  lifetimeObligated: number | null;
}

export interface OfficeSignalInput {
  /** NAICS codes to match (exact 6-digit, or ≤5-char prefix). */
  naicsCodes?: string[];
  /** Restrict to a department, e.g. "defense". Omit for government-wide. */
  department?: string;
  /** Minimum active opportunities before an office is ranked at all. */
  minOpportunities?: number;
  limit?: number;
}

export interface OfficeSignalResult {
  offices: OfficeSignalRow[];
  totals: { opportunities: number; earlyStage: number; distinctOffices: number };
  degraded: boolean;
}

/** Notice types that post BEFORE a solicitation exists. */
const EARLY_TYPES = ['sources sought', 'presolicitation'];

const isEarly = (t: string | null | undefined) => {
  const s = (t || '').toLowerCase();
  return EARLY_TYPES.some((e) => s.includes(e));
};

/** A DoD solicitation number starts with the 6-char DoDAAC of the buying office. */
const dodaacOf = (sol: string | null | undefined): string | null => {
  const s = (sol || '').trim().toUpperCase();
  return /^[A-Z0-9]{6}/.test(s) ? s.slice(0, 6) : null;
};

export async function rankOfficesByEarlySignal(
  supabase: SupabaseClient,
  input: OfficeSignalInput,
): Promise<OfficeSignalResult> {
  const limit = Math.min(Math.max(input.limit ?? 15, 1), 50);
  const minOpps = Math.max(input.minOpportunities ?? 3, 1);

  let q = supabase
    .from('sam_opportunities')
    .select('solicitation_number, notice_type, sub_tier, department')
    .eq('active', true)
    .limit(5000);

  const codes = (input.naicsCodes || []).map((c) => c.trim()).filter(Boolean);
  if (codes.length === 1) {
    const c = codes[0];
    q = c.length < 6 ? q.like('naics_code', `${c}%`) : q.eq('naics_code', c);
  } else if (codes.length > 1) {
    // Exact codes only in an .in() — prefixes need OR, handled below.
    const exact = codes.filter((c) => c.length === 6);
    const prefixes = codes.filter((c) => c.length < 6);
    if (prefixes.length) {
      q = q.or([
        ...exact.map((c) => `naics_code.eq.${c}`),
        ...prefixes.map((c) => `naics_code.like.${c}%`),
      ].join(','));
    } else {
      q = q.in('naics_code', exact);
    }
  }

  if (input.department) q = q.ilike('department', `%${input.department}%`);

  // Surface the error rather than returning a confident empty ranking — a
  // renamed column would otherwise read as "this office has no early signal".
  const { data, error } = await q;
  if (error) {
    console.error('[office-early-signal] opportunity read failed:', error.message);
    return { offices: [], totals: { opportunities: 0, earlyStage: 0, distinctOffices: 0 }, degraded: true };
  }

  const byOffice = new Map<string, { opps: number; early: number; subAgency: string | null }>();
  let totalOpps = 0;
  let totalEarly = 0;

  for (const row of data || []) {
    const dodaac = dodaacOf((row as { solicitation_number?: string }).solicitation_number);
    if (!dodaac) continue;
    const early = isEarly((row as { notice_type?: string }).notice_type);
    const cur = byOffice.get(dodaac) || { opps: 0, early: 0, subAgency: (row as { sub_tier?: string }).sub_tier ?? null };
    cur.opps += 1;
    if (early) cur.early += 1;
    byOffice.set(dodaac, cur);
    totalOpps += 1;
    if (early) totalEarly += 1;
  }

  const eligible = [...byOffice.entries()].filter(([, v]) => v.opps >= minOpps);
  if (!eligible.length) {
    return { offices: [], totals: { opportunities: totalOpps, earlyStage: totalEarly, distinctOffices: byOffice.size }, degraded: false };
  }

  // Decode DoDAAC → real office name + how busy it is historically.
  const { data: dir, error: dirErr } = await supabase
    .from('dodaac_directory')
    .select('dodaac, office_name, sub_agency, award_count, total_obligated')
    .in('dodaac', eligible.map(([d]) => d));
  if (dirErr) console.error('[office-early-signal] dodaac decode failed (names will be null):', dirErr.message);

  const decode = new Map((dir || []).map((d) => [String((d as { dodaac: string }).dodaac).toUpperCase(), d]));

  const offices: OfficeSignalRow[] = eligible.map(([dodaac, v]) => {
    const meta = decode.get(dodaac) as
      | { office_name?: string; sub_agency?: string; award_count?: number; total_obligated?: number }
      | undefined;
    return {
      dodaac,
      officeName: meta?.office_name ?? null,
      subAgency: meta?.sub_agency ?? v.subAgency,
      opportunities: v.opps,
      earlyStage: v.early,
      pctEarly: Math.round((v.early / v.opps) * 100),
      lifetimeAwards: meta?.award_count ?? null,
      lifetimeObligated: meta?.total_obligated ?? null,
    };
  });

  // Rank by COUNT of early-stage postings first, then by rate. Count before
  // rate on purpose: a 1-of-1 office is 100% early but is not a target, while
  // an office with 6 early postings is somewhere to invest.
  offices.sort((a, b) => b.earlyStage - a.earlyStage || b.pctEarly - a.pctEarly || b.opportunities - a.opportunities);

  return {
    offices: offices.slice(0, limit),
    totals: { opportunities: totalOpps, earlyStage: totalEarly, distinctOffices: byOffice.size },
    degraded: false,
  };
}
