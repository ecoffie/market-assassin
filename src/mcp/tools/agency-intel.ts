/**
 * MCP tool: get_agency_intel — a target-research read on a federal agency.
 *
 * Pain points are ONLY cited GAO / Inspector General findings (SOURCE_FACT: an Institute source id and
 * a source URL, with the report number and date when the source carries them). Ask Mindy Backend Spec
 * (Nov 21 2026): "Return only sourced GAO and Inspector General items, with report number and date."
 * Legacy static-JSON claims and unsourced interpretations are WITHHELD and counted
 * (_meta.withheld_unsourced_pain_points) — before this, `painPoints` showed the legacy JSON strings
 * whenever the agency had any, even when cited findings existed. No fabricated source URLs.
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
  formatPainPointForDisplay,
  getAgencySourcedIntelligence,
  toCitation,
  type ClaimProvenance,
} from '@/lib/strategic-intel/sourced-pain-points';
import { mcpFlags } from '@/lib/mcp/flags';
import {
  getLegislativeEvidenceForAgency,
  type LegislativeEvidence,
} from '@/lib/strategic-intel/legislative-evidence';
import { readIncreasingPrograms, type ProgramAnswer } from '@/lib/budget-intel/read';

export interface AgencyIntelInput {
  /** Agency name, abbreviation, or CGAC code, e.g. "VA", "Department of Defense", or "069". */
  agency?: string;
  /** Optional fiscal year for spending (defaults to the current federal FY). */
  fiscal_year?: number;
  /**
   * When set, also list live federal-account obligations whose name matches
   * and whose stored trend is growing or surging. Does not change search ranking.
   */
  program_keyword?: string;
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
  recommendation: string | null;
  resolution_status: 'open' | 'closed' | 'unknown';
  resolution_flag: 'historical' | 'confirmed_unresolved' | 'unknown';
  source_identifier: string | null;
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
    /** Display strings for the cited findings in painPointCitations, in the same order. Nothing unsourced. */
    painPoints: string[];
    priorities: string[];
    /** Cited GAO / IG findings only (provenance SOURCE_FACT) — prefer this over painPoints for evidence work. */
    painPointCitations: AgencyIntelCitation[];
    priorityCitations: AgencyIntelCitation[];
    matchType: UnifiedAgencyResult['matchType'];
    hasSourcedIntelligence: boolean;
    provenanceNote: string;
    /** live_table, static_file, or static_file_live_unmeasured. */
    priorityBasis?: string;
  } | null;
  /** Federal-account obligations. Null when program_keyword was not asked. */
  program_activity?: ProgramAnswer | null;
  /** Live USASpending obligations, labeled by spending.scope. */
  spending: AgencyIntelSpending | null;
  /**
   * Mindy's living legislative corpus for the department (NDAA-titled measures):
   * measure → version → stage → law status → link. Source evidence, not interpretation.
   * Statutory text is NOT held. Null only when the agency query was empty.
   */
  legislation: LegislativeEvidence | null;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    has_spending: boolean;
    spending_scope: SpendingScope;
    sourced_pain_points: number;
    legacy_pain_points: number;
    /** Claims NOT returned because they carry no GAO / IG citation (legacy static file + unsourced interpretations). */
    withheld_unsourced_pain_points: number;
    legislation_status: LegislativeEvidence['status'] | 'not_applicable';
    legislative_measures: number;
  };
}

export async function getAgencyIntel(input: AgencyIntelInput): Promise<AgencyIntelResult> {
  const agencyQuery = String(input.agency ?? '').trim();
  const fiscalYear = Number.isInteger(input.fiscal_year) ? Number(input.fiscal_year) : undefined;

  const grain = resolveIdentitySpendingGrain(agencyQuery);
  let resolved: UnifiedAgencyResult | null = null;
  let spending: AgencyIntelSpending | null = null;
  let degraded = false;

  if (!agencyQuery && !String(input.program_keyword ?? '').trim()) {
    return {
      queried: { agency: agencyQuery },
      requested_identity: { command: null, service: null, parent: null },
      command_spending: { status: 'NOT_APPLICABLE' },
      agency: null,
      spending: null,
      legislation: null,
      program_activity: null,
      _meta: {
        grounded: false, degraded: false, has_spending: false,
        spending_scope: 'NOT_ESTABLISHED',
        sourced_pain_points: 0, legacy_pain_points: 0, withheld_unsourced_pain_points: 0,
        legislation_status: 'not_applicable', legislative_measures: 0,
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
  let withheldUnsourced = 0;
  // Never seeded from resolved.painPoints: that is the legacy static file, not a cited finding.
  let painPoints: string[] = [];
  let priorities: string[] = resolved?.priorities ?? [];
  let hasSourced = false;
  let provenanceNote = 'No agency intelligence found.';
  let priorityBasis: string | undefined;

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
      // Only cited findings are returned. SOURCE_FACT already requires an Institute id + URL.
      const cited = bundle.painPoints.filter((p) => p.provenance === 'SOURCE_FACT' && !!p.source_url);
      const citedRows = cited
        .map((p) => ({ citation: toCitation(p), display: formatPainPointForDisplay(p) }))
        .filter((r) => r.citation.claim.length > 0 && r.display.trim().length > 0);
      const legacyStrings = (resolved.painPoints ?? []).filter((s) => s.trim().length > 0).length;
      withheldUnsourced = (bundle.painPoints.length - cited.length) + (bundle.painPoints.length ? 0 : legacyStrings);
      sourcedCount = citedRows.length;
      legacyCount = bundle.meta.legacyCount;
      hasSourced = citedRows.length > 0;
      if (bundle.meta.sourcedReadFailed) degraded = true;
      painPointCitations = citedRows.map((r) => r.citation);
      priorityCitations = bundle.priorities.map(toCitation).filter((c) => c.claim.length > 0);
      painPoints = citedRows.map((r) => r.display);
      priorities = (bundle.meta.priorityBasis === 'live_table'
        ? bundle.priorities.map(formatPainPointForDisplay)
        : resolved.priorities?.length
          ? resolved.priorities
          : bundle.priorities.map(formatPainPointForDisplay)
      ).filter((s) => s.trim().length > 0);
      priorityBasis = bundle.meta.priorityBasis;
      const priorityLabel = priorityBasis ? ` Priorities shown: ${priorityBasis}.` : '';
      const withheldLabel = withheldUnsourced ? ` ${withheldUnsourced} unsourced claim(s) withheld (no GAO or Inspector General citation).` : '';
      provenanceNote = bundle.meta.sourcedReadFailed
        ? `The cited-findings reader failed, so GAO / Inspector General findings are unavailable for this call (not none).${withheldLabel}${priorityLabel}`
        : hasSourced
          ? `${sourcedCount} cited finding(s) from GAO reports or Inspector General recommendations, each with its source link.${withheldLabel}${priorityLabel}`
          : `No cited GAO or Inspector General finding for this agency.${withheldLabel} Do not state a pain point for it.${priorityLabel}`;
    } catch (err) {
      degraded = true;
      console.error('[mcp:get_agency_intel] sourced intel failed:', err);
      painPoints = [];
      painPointCitations = [];
      provenanceNote = 'The cited-findings reader failed, so GAO / Inspector General findings are unavailable for this call (not none).';
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

  // Legislation: the department's held NDAA record. A component (Navy) is answered at
  // its ESTABLISHED parent department and labelled parent_department — never
  // attributed to the component. A failed corpus read is UNAVAILABLE, never "none".
  let legislation: LegislativeEvidence;
  try {
    legislation = await getLegislativeEvidenceForAgency({
      query: agencyQuery,
      parentAgency: grain.established ? (grain.identity.parent || grain.identity.service) : null,
    });
  } catch (err) {
    degraded = true;
    console.error('[mcp:get_agency_intel] legislative evidence failed:', err);
    legislation = {
      status: 'unavailable', requested: agencyQuery, linked_agency: null, grain: null,
      vehicles: [], other_measures: [], coverage: null,
      not_established: ['Legislative corpus read failed — legislation is UNKNOWN for this call, not absent.'],
      host_rules: ['Do not state that no legislation exists; the read failed.'],
    };
  }
  const legislativeMeasures = legislation.vehicles.reduce((n, v) => n + v.measures.length, 0)
    + legislation.other_measures.length;

  let programActivity: ProgramAnswer | null = null;
  const programKeyword = String(input.program_keyword ?? '').trim();
  if (programKeyword) {
    try {
      programActivity = await readIncreasingPrograms({
        keyword: programKeyword,
        agency: agencyQuery || null,
      });
      if (programActivity.shown === 'unavailable' && programActivity.shown_reason === 'live_table_unmeasured') {
        degraded = true;
      }
    } catch (err) {
      degraded = true;
      console.error('[mcp:get_agency_intel] program activity read failed:', err);
      programActivity = {
        shown: 'unavailable',
        shown_reason: 'live_table_unmeasured',
        keyword: programKeyword,
        agencies: null,
        amount_basis: 'obligations',
        note: 'budget_programs could not be read. This is not a finding that no agency has growing federal-account obligations.',
      };
    }
  }

  const grounded = !!resolved || programActivity?.shown === 'live_table';
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
          priorityBasis,
        }
      : null,
    spending,
    legislation,
    program_activity: programActivity,
    _meta: {
      grounded,
      degraded,
      has_spending: typeof spending?.totalObligations === 'number' && spending.totalObligations > 0,
      spending_scope: spending?.scope ?? grain.spendingScope,
      sourced_pain_points: sourcedCount,
      legacy_pain_points: legacyCount,
      withheld_unsourced_pain_points: withheldUnsourced,
      legislation_status: legislation.status,
      legislative_measures: legislativeMeasures,
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
              ? 'Agency identity grounded; no cited GAO or Inspector General finding, so state no pain point.'
              : 'No agency matched.',
      how_to_use:
        'Cite each pain point with painPointCitations[].document_number, published_at and source_url. Only cited findings are returned; never add one from memory. spending.scope names whose dollars spending.totalObligations is — PARENT_SERVICE is the military department, not the command.',
      key_caveats: [
        'SOURCE_FACT = living Institute/GAO citation.',
        'Unsourced claims (legacy static file, interpretations) are withheld and only counted in _meta.withheld_unsourced_pain_points.',
        'Never attribute PARENT_SERVICE totals to the requested command.',
        'legislation: only ENACTED_LAW is law; bill/report text is not held — obey legislation.host_rules.',
      ],
    };
  }

  return result;
}
