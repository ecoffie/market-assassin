/**
 * MCP tool: get_agency_intel — a target-research read on a federal agency.
 *
 * Prefers living sourced GAO rows (Institute → agency_pain_points_db) via the
 * shared reader. Legacy JSON is returned only as LEGACY_MANUAL with provenance
 * unavailable — never as if it has the same evidentiary status as a cited GAO
 * report. No fabricated source URLs.
 */
import { getAgency, type UnifiedAgencyResult } from '@/lib/agency-hierarchy/unified-search';
import { getAgencySpendingDetail } from '@/lib/usaspending/agency-spending-detail';
import {
  resolveIdentitySpendingGrain,
  type CommandSpendingStatus,
  type RequestedIdentity,
  type SpendingScope,
} from '@/lib/gov-contacts/agency-identity';
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

export interface AgencyIntelSpending {
  scope: SpendingScope;
  scope_name: string | null;
  fiscal_year: number;
  toptier_code: string | null;
  /** REQUESTED grain only. Null for PARENT_SERVICE / NOT_ESTABLISHED. */
  totalObligations: number | null;
  parent_service_total: number | null;
  set_aside_share: number | null;
  recipient_small_business_share: number | null;
}

export interface AgencyIntelResult {
  queried: { agency: string; fiscal_year?: number };
  requested_identity: RequestedIdentity;
  command_spending: { status: CommandSpendingStatus };
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
  /** Live USASpending obligations, labeled by spending.scope. */
  spending: AgencyIntelSpending | null;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    has_spending: boolean;
    spending_scope: SpendingScope;
    sourced_pain_points: number;
    legacy_pain_points: number;
  };
}

export async function getAgencyIntel(input: AgencyIntelInput): Promise<AgencyIntelResult> {
  const agencyQuery = String(input.agency ?? '').trim();
  const fiscalYear = Number.isInteger(input.fiscal_year) ? Number(input.fiscal_year) : undefined;

  const grain = resolveIdentitySpendingGrain(agencyQuery);
  let resolved: UnifiedAgencyResult | null = null;
  let spending: AgencyIntelSpending | null = null;
  let degraded = false;

  if (!agencyQuery) {
    return {
      queried: { agency: agencyQuery },
      requested_identity: { command: null, service: null, parent: null },
      command_spending: { status: 'NOT_APPLICABLE' },
      agency: null,
      spending: null,
      _meta: {
        grounded: false, degraded: false, has_spending: false,
        spending_scope: 'NOT_ESTABLISHED',
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

  if (!resolved && grain.established && grain.displayName) {
    resolved = {
      name: grain.displayName,
      shortName: grain.identity.command,
      cgacCode: null,
      fpdsCodes: [],
      parent: grain.identity.service || grain.identity.parent,
      parentPath: [grain.identity.parent, grain.identity.service, grain.displayName].filter(Boolean).join(' > '),
      level: grain.identity.command ? 'agency' : 'department',
      children: [],
      painPoints: [],
      priorities: [],
      relatedContractors: [],
      matchType: 'exact',
      matchScore: 100,
      sources: ['directory'],
    };
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
      const lookupNames = [resolved.shortName, resolved.name].filter((n): n is string => !!n);
      let bundle = await getAgencySourcedIntelligence(resolved.name);
      for (const lookupName of lookupNames) {
        const next = await getAgencySourcedIntelligence(lookupName);
        if (next.painPoints.length || next.priorities.length) {
          bundle = next;
          break;
        }
      }
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
      const detail = await getAgencySpendingDetail({ agency: agencyQuery, fiscalYear });
      if (detail.degraded) degraded = true;
      const parentService = detail.spending.scope === 'PARENT_SERVICE';
      spending = {
        scope: detail.spending.scope,
        scope_name: detail.spending.scope_name,
        fiscal_year: detail.fiscal_year,
        toptier_code: detail.toptier_code,
        totalObligations: parentService || detail.spending.scope === 'NOT_ESTABLISHED'
          ? null
          : detail.total_obligated,
        parent_service_total: parentService ? detail.spending.total : null,
        set_aside_share: detail.set_aside_share,
        recipient_small_business_share: detail.recipient_small_business_share,
      };
    } catch (err) {
      degraded = true;
      console.error('[mcp:get_agency_intel] spending fetch failed:', err);
    }
  }

  const grounded = !!resolved;
  const result: AgencyIntelResult = {
    queried: { agency: agencyQuery, ...(fiscalYear ? { fiscal_year: fiscalYear } : {}) },
    requested_identity: grain.established ? grain.identity : { command: null, service: null, parent: null },
    command_spending: { status: grain.established ? grain.commandSpending : 'NOT_APPLICABLE' },
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
      has_spending: typeof spending?.totalObligations === 'number' && spending.totalObligations > 0,
      spending_scope: spending?.scope ?? grain.spendingScope,
      sourced_pain_points: sourcedCount,
      legacy_pain_points: legacyCount,
    },
  };

  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: degraded && !resolved
        ? 'Agency lookup degraded; no grounded identity.'
        : grain.commandSpending === 'NOT_ESTABLISHED' && grounded
          ? `${resolved?.name} identity is established. Command-level spending is NOT_ESTABLISHED.`
          : hasSourced
            ? `Grounded agency intel with ${sourcedCount} cited GAO claim(s).`
            : grounded
              ? 'Agency identity grounded; pain points are legacy-manual (provenance unavailable).'
              : 'No agency matched.',
      how_to_use:
        'Prefer painPointCitations[].source_url + document_number. Never invent a URL for LEGACY_MANUAL rows. spending.scope names whose dollars spending.totalObligations is — PARENT_SERVICE is the military department, not the command.',
      key_caveats: [
        'SOURCE_FACT = living Institute/GAO citation.',
        'LEGACY_MANUAL = static JSON; provenance unavailable.',
        'MINDY_INTERPRETATION = derived claim, not direct GAO wording.',
        'Never attribute PARENT_SERVICE totals to the requested command.',
      ],
    };
  }

  return result;
}
