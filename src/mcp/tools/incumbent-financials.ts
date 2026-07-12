/**
 * MCP tool: get_incumbent_financials — turn an incumbent company NAME into a
 * competitive financial read via SEC EDGAR (revenue, net income, gross margin,
 * public float, employees, latest 10-K).
 *
 * WHY: a public incumbent's financial shape predicts how it competes. A multi-
 * billion slow mover sub-contracts set-asides differently than a lean commercial
 * firm. EDGAR is the public-filers financial ground truth; this is a net-new
 * source for the Mindy Data Core (PRD §5a). Pair with the contractor-profile tool
 * (Tier-2) for their federal award totals — EDGAR alone does NOT break out
 * government-vs-commercial revenue.
 *
 * Transport-agnostic pure function — same pattern as winning-playbook.ts / pricing-
 * intel.ts. The stdio entrypoint AND the hosted HTTP edge both wrap this.
 *
 * Data-first (Eric, 2026-07-12): `_meta` (grounded/degraded/counts) ALWAYS ships.
 * `_ai_hint` is OPTIONAL and TOGGLED OFF by default (mcpFlags.aiHint). When
 * enabled, every fact traces to the returned EDGAR data — it explicitly CANNOT
 * claim a gov-vs-commercial revenue split (EDGAR filers don't report that unless
 * they volunteer a segment; any "gov dependence" is an estimate, not data).
 *
 * credits: 2 (multi-endpoint — tickers + facts + submissions — but all free).
 */
import { getIncumbentFinancialsFromEdgar, EdgarIntel } from '@/lib/edgar';
import { mcpFlags } from '@/lib/mcp/flags';

export interface IncumbentFinancialsInput {
  /** Company name, e.g. "Leidos". */
  company_name: string;
  /** Optional fiscal year to highlight (defaults to the most recent reported). */
  as_of_year?: number;
}

export interface IncumbentFinancialsResult {
  queried: { company_name: string; as_of_year?: number };
  /** The full EDGAR read (pass-through so the agent can cite sub-fields). */
  edgar: EdgarIntel | null;
  _ai_hint?: {
    summary: string;
    how_to_use: string;
    key_caveats: string[];
  };
  _meta: {
    grounded: boolean; // a public filer with at least revenue OR a 10-K on file
    degraded: boolean; // upstream ERRORED (EDGAR unreachable) — NOT a genuine no-match
    fiscal_years: number;
    has_10k: boolean;
    validation_error?: string;
  };
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function buildHint(
  degraded: boolean,
  grounded: boolean,
  edgar: EdgarIntel | null,
  query: string,
): IncumbentFinancialsResult['_ai_hint'] {
  if (degraded) {
    return {
      summary:
        `SEC EDGAR could not be reached (upstream error) for "${query}". This is a TEMPORARY SYSTEM ISSUE — NOT a sign no filing exists. Tell the user financial data is briefly unavailable and to retry; do NOT state that no filing was found or invent figures.`,
      how_to_use:
        'Upstream error — tell the user EDGAR is temporarily unavailable and to retry; do NOT claim no filing exists or generate financial figures.',
      key_caveats: ['EDGAR was unreachable (system error) — this is NOT a real no-match.'],
    };
  }
  if (grounded && edgar) {
    const fy = edgar.financials[0];
    const c = edgar.company;
    const float = edgar.public_float_usd != null ? fmtUsd(edgar.public_float_usd) : null;
    const emp = edgar.employees != null ? `~${edgar.employees.toLocaleString()} employees` : null;
    const extras = [float ? `public float ~${float}` : null, emp].filter(Boolean).join('; ');
    return {
      summary:
        `${c.name} (CIK ${c.cik}${c.ticker ? `, ${c.ticker}` : ''}${c.sic_description ? `, SIC ${c.sic_description}` : ''}) reported ${fy.fy} revenue of ${fmtUsd(fy.revenue)}${fy.net_income != null ? ` and net income ${fmtUsd(fy.net_income)}` : ''}${fy.gross_margin_pct != null ? `, gross margin ${fmtPct(fy.gross_margin_pct)}` : ''}. ${edgar.financials.length} fiscal year(s) on file; latest 10-K filed ${edgar.latest_10k_filed ?? 'n/a'}.${extras ? ` ${extras}.` : ''}`,
      how_to_use:
        'Use this as a competitive read on the incumbent: a public, multi-billion, gov-leaning incumbent behaves differently (slower, compliance-heavy, sub-friendly for set-aside teammates) than a lean commercial firm. Pair with the contractor-profile tool for their federal award totals — EDGAR does not break out government-vs-commercial revenue.',
      key_caveats: [
        'EDGAR does not break out government-vs-commercial revenue unless the filer volunteers a segment; any "gov dependence" is an estimate, not a reported figure.',
        'Financials are as-reported annual; quarterly is in the filings list but not summarized here.',
        `Name match score ${c.match_score.toFixed(2)} (1 = exact). If this is the wrong entity, retry with the legal name or ticker.`,
      ],
    };
  }
  return {
    summary:
      `No SEC EDGAR filing found for "${query}" (likely a private contractor — EDGAR only indexes public filers). Do NOT invent revenue or financial figures. Tell the user Mindy has no EDGAR data for this company and suggest the contractor-profile tool for their federal award history instead.`,
    how_to_use:
      'No public filing — state that plainly. For a private contractor, pivot to the contractor-profile tool (federal award totals from USASpending/SAM) rather than generating financials.',
    key_caveats: ['Private contractors have no EDGAR filing — grounded=false here is expected, not an error.'],
  };
}

/**
 * Run the EDGAR financial lookup. Pure function — no transport, no auth.
 * Never fabricates: private company / no CIK match → grounded=false with an
 * explicit "no filing (likely private)" signal; the agent must not invent numbers.
 */
export async function getIncumbentFinancials(
  input: IncumbentFinancialsInput,
): Promise<IncumbentFinancialsResult> {
  const companyName = String(input.company_name || '').trim();
  const asOfYear = typeof input.as_of_year === 'number' ? input.as_of_year : undefined;
  const queried = { company_name: companyName, as_of_year: asOfYear };

  if (companyName.length < 2) {
    return {
      queried,
      edgar: null,
      _meta: { grounded: false, degraded: false, fiscal_years: 0, has_10k: false, validation_error: 'no_input' },
    };
  }

  let edgar: EdgarIntel | null = null;
  let fetchErrored = false;
  try {
    edgar = await getIncumbentFinancialsFromEdgar(companyName);
  } catch (err) {
    fetchErrored = true;
    console.error('[mcp:get_incumbent_financials] EDGAR failed:', err);
  }

  // If EDGAR errored mid-flight (after a CIK match), treat as degraded. A clean
  // null (no match) is NOT degraded — it's a genuine private-company miss.
  const degraded = fetchErrored;
  const grounded = !!(edgar && (edgar.financials.length > 0 || edgar.latest_10k_url));

  // If as_of_year requested, surface that fy first (re-sort financials so the
  // requested year leads when present).
  if (edgar && asOfYear) {
    const idx = edgar.financials.findIndex((f) => f.fy === asOfYear);
    if (idx > 0) {
      const [yr] = edgar.financials.splice(idx, 1);
      edgar.financials.unshift(yr);
    }
  }

  const result: IncumbentFinancialsResult = {
    queried,
    edgar,
    _meta: {
      grounded,
      degraded,
      fiscal_years: edgar?.financials.length ?? 0,
      has_10k: !!edgar?.latest_10k_url,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = buildHint(degraded, grounded, edgar, companyName);
  }

  return result;
}