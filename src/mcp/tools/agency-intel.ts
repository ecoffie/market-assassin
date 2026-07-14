/**
 * MCP tool: get_agency_intel — a target-research read on a federal agency.
 *
 * "What does this agency buy, how much, and what do they care about?" Resolves
 * an agency by name / abbreviation / CGAC code, then returns its identity +
 * hierarchy, GovCon pain points & priorities, and — when available — real
 * USASpending obligations for the fiscal year with its top NAICS categories.
 * The "size up a buyer before I pursue them" lookup.
 *
 * Reuses src/lib/agency-hierarchy/unified-search.ts:getAgency (identity + pain
 * points) and src/lib/agency-hierarchy/spending-stats.ts:getAgencySpending
 * (live USASpending obligations). Public data (commodity, metered). credits: 1.
 * `_meta` always ships; `_ai_hint` OFF by default.
 */
import { getAgency, type UnifiedAgencyResult } from '@/lib/agency-hierarchy/unified-search';
import { getAgencySpending, type AgencySpending } from '@/lib/agency-hierarchy/spending-stats';
import { mcpFlags } from '@/lib/mcp/flags';

export interface AgencyIntelInput {
  /** Agency name, abbreviation, or CGAC code, e.g. "VA", "Department of Defense", or "069". */
  agency: string;
  /** Optional fiscal year for spending (defaults to the current federal FY). */
  fiscal_year?: number;
}

export interface AgencyIntelResult {
  queried: { agency: string; fiscal_year?: number };
  /** Resolved agency identity + GovCon intel (null when no agency matched). */
  agency: {
    name: string;
    shortName: string | null;
    cgacCode: string | null;
    level: UnifiedAgencyResult['level'];
    parent: string | null;
    painPoints: string[];
    priorities: string[];
    matchType: UnifiedAgencyResult['matchType'];
  } | null;
  /** Live USASpending obligations for the FY (null when USASpending has no match). */
  spending: AgencySpending | null;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; has_spending: boolean };
}

export async function getAgencyIntel(input: AgencyIntelInput): Promise<AgencyIntelResult> {
  const agencyQuery = String(input.agency ?? '').trim();
  const fiscalYear = Number.isInteger(input.fiscal_year) ? Number(input.fiscal_year) : undefined;

  let resolved: UnifiedAgencyResult | null = null;
  let spending: AgencySpending | null = null;
  let degraded = false;

  if (!agencyQuery) {
    return {
      queried: { agency: agencyQuery },
      agency: null,
      spending: null,
      _meta: { grounded: false, degraded: false, has_spending: false },
    };
  }

  try {
    resolved = await getAgency(agencyQuery);
  } catch (err) {
    degraded = true;
    console.error('[mcp:get_agency_intel] agency resolve failed:', err);
  }

  // Only chase live spending once we have a resolved agency name to query on.
  if (resolved) {
    try {
      spending = await getAgencySpending(resolved.name, fiscalYear);
    } catch (err) {
      degraded = true;
      console.error('[mcp:get_agency_intel] spending fetch failed:', err);
    }
  }

  const grounded = !!resolved;
  const result: AgencyIntelResult = {
    queried: { agency: agencyQuery, ...(fiscalYear ? { fiscal_year: fiscalYear } : {}) },
    agency: resolved
      ? {
          name: resolved.name,
          shortName: resolved.shortName,
          cgacCode: resolved.cgacCode,
          level: resolved.level,
          parent: resolved.parent,
          painPoints: resolved.painPoints ?? [],
          priorities: resolved.priorities ?? [],
          matchType: resolved.matchType,
        }
      : null,
    spending,
    _meta: { grounded, degraded, has_spending: !!spending },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded && !resolved
        ? 'Agency lookup errored — retry; do NOT state the agency does not exist.'
        : grounded
        ? spending
          ? `${resolved!.name} obligated $${Math.round(spending.totalObligations).toLocaleString()} in FY${spending.fiscalYear} across ${spending.contractCount.toLocaleString()} contracts. Top NAICS: ${(spending.topNaics[0]?.code ?? 'n/a')}.`
          : `${resolved!.name} resolved (${resolved!.painPoints.length} pain points on file), but USASpending returned no obligation total for the requested FY.`
        : `No agency matched "${agencyQuery}". Try the full name or a CGAC code.`,
      how_to_use: grounded
        ? 'Lead pursuit framing with the pain points & priorities (what to say), and use the spending total + top NAICS to gauge budget and where the money actually goes.'
        : 'No grounded agency; say it was not found rather than guessing an agency.',
      key_caveats: [
        'Pain points/priorities are curated GovCon intel, not an official agency statement.',
        'Spending is USASpending obligations for the stated fiscal year; a null spending block means USASpending had no match, not that the agency spent $0.',
      ],
    };
  }

  return result;
}
