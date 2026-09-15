/**
 * MCP tool: get_agency_intel — a target-research read on a federal agency.
 *
 * Prefers living sourced GAO rows (Institute → agency_pain_points_db) via the
 * shared reader. Legacy JSON is returned only as LEGACY_MANUAL with provenance
 * unavailable — never as if it has the same evidentiary status as a cited GAO
 * report. No fabricated source URLs.
 */
import { getAgency, type UnifiedAgencyResult } from '@/lib/agency-hierarchy/unified-search';
import { getAgencySpending, type AgencySpending } from '@/lib/agency-hierarchy/spending-stats';
import {
  getAgencySourcedIntelligence,
  toCitation,
  type ClaimProvenance,
} from '@/lib/strategic-intel/sourced-pain-points';
import { mcpFlags } from '@/lib/mcp/flags';

export interface AgencyIntelInput {
  /** Agency name, abbreviation, or CGAC code, e.g. "VA", "Department of Defense", or "069". */
  agency: string;
  /** Optional fiscal year for spending (defaults to the current federal FY). */
  fiscal_year?: number;
}

export interface AgencyIntelCitation {
  claim: string;
  provenance: ClaimProvenance;
  source_type: string;
  source_url: string | null;
  document_number: string | null;
  published_at: string | null;
  institute_source_id: string | null;
  agency: string;
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
    /** Display strings — sourced claims carry citations; legacy are labeled. */
    painPoints: string[];
    priorities: string[];
    /** Structured citations — prefer this over painPoints for evidence work. */
    painPointCitations: AgencyIntelCitation[];
    priorityCitations: AgencyIntelCitation[];
    matchType: UnifiedAgencyResult['matchType'];
    hasSourcedIntelligence: boolean;
    provenanceNote: string;
  } | null;
  /** Live USASpending obligations for the FY (null when USASpending has no match). */
  spending: AgencySpending | null;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    has_spending: boolean;
    sourced_pain_points: number;
    legacy_pain_points: number;
  };
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
      _meta: {
        grounded: false, degraded: false, has_spending: false,
        sourced_pain_points: 0, legacy_pain_points: 0,
      },
    };
  }

  try {
    resolved = await getAgency(agencyQuery);
  } catch (err) {
    degraded = true;
    console.error('[mcp:get_agency_intel] agency resolve failed:', err);
  }

  // Shared reader is the authority for pain-point provenance — even when identity
  // resolved via hierarchy/alias without JSON coverage.
  let sourcedCount = 0;
  let legacyCount = 0;
  let painPointCitations: AgencyIntelCitation[] = [];
  let priorityCitations: AgencyIntelCitation[] = [];
  let painPoints: string[] = resolved?.painPoints ?? [];
  let priorities: string[] = resolved?.priorities ?? [];
  let hasSourced = false;
  let provenanceNote = 'No agency intelligence found.';

  if (resolved) {
    try {
      const bundle = await getAgencySourcedIntelligence(resolved.name);
      sourcedCount = bundle.meta.sourcedCount;
      legacyCount = bundle.meta.legacyCount;
      hasSourced = bundle.meta.provenanceAvailable;
      painPointCitations = bundle.painPoints.map(toCitation);
      priorityCitations = bundle.priorities.map(toCitation);
      painPoints = resolved.painPoints?.length
        ? resolved.painPoints
        : bundle.painPoints.map((p) => p.pain_point);
      priorities = resolved.priorities?.length
        ? resolved.priorities
        : bundle.priorities.map((p) => p.pain_point);
      provenanceNote = hasSourced
        ? `${sourcedCount} living GAO-sourced claim(s) with citations; ${legacyCount} legacy-manual fallback claim(s).`
        : legacyCount > 0
          ? `Provenance unavailable — ${legacyCount} legacy-manual claim(s) only. Do not treat as GAO fact.`
          : 'No pain-point claims for this agency.';
    } catch (err) {
      degraded = true;
      console.error('[mcp:get_agency_intel] sourced intel failed:', err);
      provenanceNote = 'Sourced reader failed; falling back to unresolved legacy strings if present.';
    }

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
          painPoints,
          priorities,
          painPointCitations,
          priorityCitations,
          matchType: resolved.matchType,
          hasSourcedIntelligence: hasSourced,
          provenanceNote,
        }
      : null,
    spending,
    _meta: {
      grounded,
      degraded,
      has_spending: !!spending,
      sourced_pain_points: sourcedCount,
      legacy_pain_points: legacyCount,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded && !resolved
        ? 'Agency lookup degraded; no grounded identity.'
        : hasSourced
          ? `Grounded agency intel with ${sourcedCount} cited GAO claim(s).`
          : grounded
            ? 'Agency identity grounded; pain points are legacy-manual (provenance unavailable).'
            : 'No agency matched.',
      how_to_use: 'Prefer painPointCitations[].source_url + document_number. Never invent a URL for LEGACY_MANUAL rows.',
      key_caveats: [
        'SOURCE_FACT = living Institute/GAO citation.',
        'LEGACY_MANUAL = static JSON; provenance unavailable.',
        'MINDY_INTERPRETATION = derived claim, not direct GAO wording.',
      ],
    };
  }

  return result;
}
