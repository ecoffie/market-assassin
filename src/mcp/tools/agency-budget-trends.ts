/**
 * MCP tool: get_agency_budget_trends — an agency's discretionary budget authority and
 * the FY2025→FY2026 trend (growing / declining / flat). "Where is the money moving"
 * BEFORE it shows up as awards. Pure lookup of the curated src/data/agency-budget-data.json
 * (OMB FY2026 request + agency Congressional Budget Justifications — official figures).
 *
 * No LLM, no network. Honest: figures are DISCRETIONARY budget authority only (not total
 * obligations); FY2025=Enacted, FY2026=President's Request (a request can change in
 * appropriations). grounded=false = agency not in the 47-agency toptier set — do NOT
 * invent a number. tier: metered, credits: 1. `_meta` always ships; `_ai_hint` OFF.
 */
import budgetData from '@/data/agency-budget-data.json';
import agencyAliases from '@/data/agency-aliases.json';
import { mcpFlags } from '@/lib/mcp/flags';

export interface AgencyBudgetTrendsInput {
  /** Agency name or abbreviation, e.g. "VA", "Department of Defense", "NASA". */
  agency: string;
}

interface BudgetYear { budgetAuthority: number; obligated: number; outlays: number }
interface BudgetEntry {
  toptierCode: string;
  fy2025?: BudgetYear;
  fy2026?: BudgetYear;
  change?: { amount: number; percent: number; trend: string };
}

export interface AgencyBudgetTrendsResult {
  agency: string | null;
  toptier_code: string | null;
  fiscal_years: number[];
  fy2025_budget_authority: number | null;
  fy2026_budget_authority: number | null;
  change_amount: number | null;
  change_percent: number | null;
  trend: string | null;
  source: string;
  last_updated: string;
  /** Close name matches when no exact hit. */
  candidates: string[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    trend: string | null;
    match_type: 'exact' | 'alias' | 'contains' | 'none';
  };
}

const AGENCIES = (budgetData as { agencies: Record<string, BudgetEntry> }).agencies || {};
const META = budgetData as { lastUpdated?: string; source?: string; fiscalYears?: number[] };

function expandAlias(s: string): string {
  const aliases = (agencyAliases as { aliases?: Record<string, string> }).aliases || {};
  const up = s.trim().toUpperCase();
  return aliases[up] || aliases[s.trim()] || s.trim();
}

/** Acronym from a name's significant-word initials: "National Aeronautics and Space
 *  Administration" → "NASA" (skips of/the/and/for/&). Resolves NASA/EPA/GSA/NSF/… whose
 *  alias entries point to the abbreviation, not the JSON's full key. */
function acronymOf(name: string): string {
  const skip = new Set(['OF', 'THE', 'AND', 'FOR', '&', '-']);
  return name
    .toUpperCase()
    .replace(/[^A-Z\s&-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !skip.has(w))
    .map((w) => w[0])
    .join('');
}

function usd(n: number): string {
  const b = n / 1e9;
  return b >= 1 ? `$${b.toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;
}

export function getAgencyBudgetTrends(input: AgencyBudgetTrendsInput): AgencyBudgetTrendsResult {
  const raw = (input.agency || '').trim();
  const base: Omit<AgencyBudgetTrendsResult, '_meta' | 'candidates'> = {
    agency: null,
    toptier_code: null,
    fiscal_years: META.fiscalYears || [2025, 2026],
    fy2025_budget_authority: null,
    fy2026_budget_authority: null,
    change_amount: null,
    change_percent: null,
    trend: null,
    source: META.source || 'OMB FY2026 request + agency CBJs',
    last_updated: META.lastUpdated || '',
  };

  if (!raw) {
    return { ...base, candidates: [], _meta: { grounded: false, degraded: false, trend: null, match_type: 'none' } };
  }

  const names = Object.keys(AGENCIES);
  let matchType: AgencyBudgetTrendsResult['_meta']['match_type'] = 'none';
  let key: string | undefined;

  // 1. exact (case-insensitive)
  key = names.find((n) => n.toLowerCase() === raw.toLowerCase());
  if (key) matchType = 'exact';

  // 2. alias-expanded exact
  if (!key) {
    const expanded = expandAlias(raw);
    key = names.find((n) => n.toLowerCase() === expanded.toLowerCase());
    if (key) matchType = 'alias';
  }

  // 2.5 acronym match (NASA, EPA, GSA, NSF, SEC, FCC, …) — for names keyed in full.
  if (!key) {
    const q = raw.toUpperCase().replace(/[^A-Z]/g, '');
    if (q.length >= 2 && q.length <= 6) {
      key = names.find((n) => acronymOf(n) === q);
      if (key) matchType = 'alias';
    }
  }

  // 3. contains either direction (guard 1-token over-match)
  if (!key && raw.length >= 4) {
    const expanded = expandAlias(raw).toLowerCase();
    key = names.find((n) => {
      const nl = n.toLowerCase();
      return nl.includes(raw.toLowerCase()) || nl.includes(expanded) || raw.toLowerCase().includes(nl);
    });
    if (key) matchType = 'contains';
  }

  if (!key) {
    // Offer close candidates so the agent can retry with an exact name.
    const rl = raw.toLowerCase();
    const candidates = names.filter((n) => n.toLowerCase().split(/\s+/).some((w) => w.length >= 4 && rl.includes(w))).slice(0, 5);
    return { ...base, candidates, _meta: { grounded: false, degraded: false, trend: null, match_type: 'none' } };
  }

  const e = AGENCIES[key];
  const result: AgencyBudgetTrendsResult = {
    ...base,
    agency: key,
    toptier_code: e.toptierCode ?? null,
    fy2025_budget_authority: e.fy2025?.budgetAuthority ?? null,
    fy2026_budget_authority: e.fy2026?.budgetAuthority ?? null,
    change_amount: e.change?.amount ?? null,
    change_percent: e.change?.percent ?? null,
    trend: e.change?.trend ?? null,
    candidates: [],
    _meta: { grounded: true, degraded: false, trend: e.change?.trend ?? null, match_type: matchType },
  };

  if (mcpFlags.aiHint) {
    const t = e.change?.trend || '';
    const dir = /declin|cut|decreas|down/i.test(t) ? 'DOWN' : /grow|increas|rising|up/i.test(t) ? 'UP' : 'FLAT';
    result._ai_hint = {
      summary:
        e.fy2025?.budgetAuthority != null && e.fy2026?.budgetAuthority != null
          ? `${key}: ${usd(e.fy2025.budgetAuthority)} (FY25 enacted) → ${usd(e.fy2026.budgetAuthority)} (FY26 request) — ${dir}${e.change?.amount != null ? ` ${usd(Math.abs(e.change.amount))}` : ''}. Discretionary budget authority.`
          : `${key} is in the budget set but a fiscal-year figure is missing.`,
      how_to_use:
        'A growing agency budget is a leading demand signal (more to spend → more solicitations); a declining one warns of tighter recompetes. Pair with get_agency_intel (actual obligations) and get_regulatory_demand for the fullest read.',
      key_caveats: [
        'DISCRETIONARY budget authority only — NOT total obligations or mandatory spending. Do not present it as "the agency\'s total budget."',
        'FY2026 is the President\'s REQUEST, not enacted — appropriations can move it. Data snapshot is from the source date; verify against current OMB for anything time-sensitive.',
      ],
    };
  }
  return result;
}
