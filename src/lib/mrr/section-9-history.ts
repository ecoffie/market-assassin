/**
 * MRR Block 6 — §9 Procurement History.
 *
 * Award rows come from `search_past_contracts` and are rendered EXACTLY as the
 * source reports them — one row per award, no recipient roll-ups (corporate-family
 * duplication makes per-company totals unreliable; the data-readiness audit
 * measured Boeing as 8 UEIs and Lockheed as 5+3 inside a single top-100 page).
 *
 * ── The incumbent-consistency guard ────────────────────────────────────────────
 * Applied to BOTH `get_solicitation_incumbent` AND `find_predecessor_award`.
 * Measured on the live DHA JOMIS notice: get_solicitation_incumbent returns
 * `grounded_incumbent: true` for an Army NVESD night-vision sensor task order
 * under NAICS 541712 — an award that is not a DHA/JOMIS predecessor. So neither
 * `grounded` nor `matchConfidence` may authorize the "incumbent" label on its own.
 *
 * DEPARTMENT-LEVEL AGREEMENT IS NOT ENOUGH. A shared "Department of Defense"
 * parent does not make an Army or Air Force award a DHA predecessor; the check
 * compares at the SUB-AGENCY / component level when the requirement names one.
 */
import type { GroundedField, Requirement } from './types';
import { callTool, metaDegraded, metaGrounded, type ToolCall } from './mindy-client';
import { degraded, evidence, unknown, unknownFromError, value } from './grounding';
import {
  extractDodaac,
  marketScopeFromRequirement,
  matchesInstallation,
  retrievalManifest,
  type EvidenceClass,
  type MarketScope,
  type RetrievalManifest,
  type ScopeExpansionRecord,
} from './market-scope';
import { queryAwardsByAwardingOffice, type OfficeAwardLookup, type OfficeAwardRow } from './office-awards';
import { usaSpendingSubtierRewrite } from '@/lib/usaspending/awarding-agency-filter';

export interface AwardRow {
  contractNumber: GroundedField<string>;
  recipient: GroundedField<string>;
  awardType: GroundedField<string>;
  procurementMethod: GroundedField<string>;
  offerors: GroundedField<number>;
  amount: GroundedField<{ value: number; label: string }>;
  periodOfPerformance: GroundedField<string>;
  naics: GroundedField<string>;
  psc: GroundedField<string>;
  awardingAgency: GroundedField<string>;
  usaSpendingUrl?: string;
  evidenceClass: EvidenceClass;
  awardingOffice?: string;
}

export type PredecessorStatus = 'established' | 'degraded' | 'unknown';

export interface ConsistencyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Section9 {
  awards: AwardRow[];
  /** Renders when the search was grounded but empty — a FINDING, not a failure. */
  awardsFinding: GroundedField<string>;
  predecessorStatus: PredecessorStatus;
  predecessor: GroundedField<string>;
  /** Every check that ran, pass or fail — preserved for the appendix. */
  predecessorChecks: ConsistencyCheck[];
  /** The rejected candidate is KEPT for review, never silently dropped. */
  predecessorCandidate?: Record<string, unknown>;
  predecessorSource?: 'get_solicitation_incumbent' | 'find_predecessor_award';
  predecessorEvidenceClass?: EvidenceClass;
  scope: MarketScope;
  retrievalManifests: RetrievalManifest[];
  expansions: ScopeExpansionRecord[];
  calls: ToolCall[];
}

export interface BuildSection9Opts {
  officeAwardLookup?: OfficeAwardLookup;
}

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The rule is RELATIONAL, not a blocklist of names.
 *
 * A first attempt listed "Department of Veterans Affairs" as a department-level
 * token, which made a genuine VA requirement un-checkable — VA both IS a
 * department and IS the awarding activity, so blocklisting it discarded a check
 * that should have run. What actually must be rejected is narrower: agreement
 * that holds ONLY because both sides roll up to the same parent department while
 * the candidate names a DIFFERENT component. So we compare the requirement's most
 * specific activity against the candidate's most specific one.
 */
const DEPARTMENT_ONLY = /^(department|dept)\b/i;

/** True when the two component names denote different components of one department. */
function differentComponent(target: string, candidateSub: string, candidateAgency: string): boolean {
  if (!candidateSub) return false;
  // The candidate names a component (its sub-agency differs from its department)
  // and that component is not the requested activity.
  const candidateNamesComponent = !!candidateSub && candidateSub !== candidateAgency;
  return candidateNamesComponent && !candidateSub.includes(target) && !target.includes(candidateSub);
}

/**
 * Agency consistency. Passes only when the candidate's agency or sub-agency
 * genuinely corresponds to the requested activity — NOT when they merely share
 * a department.
 */
export function checkAgencyConsistency(
  requested: { agency: string; subAgency?: string },
  candidate: { awardingAgency?: string; awardingSubAgency?: string; awardingOffice?: string },
): ConsistencyCheck {
  const want = norm(requested.agency);
  const wantSub = norm(requested.subAgency);
  const gotAgency = norm(candidate.awardingAgency);
  const gotSub = norm(candidate.awardingSubAgency);
  const gotOffice = norm(candidate.awardingOffice);

  const haystack = [gotAgency, gotSub, gotOffice].filter(Boolean);
  if (haystack.length === 0) {
    return { name: 'agency consistency', passed: false, detail: 'candidate reported no awarding agency' };
  }

  // Use the most SPECIFIC name the requirement gives.
  const target = want || wantSub;
  if (!target) {
    return { name: 'agency consistency', passed: false, detail: 'requirement names no awarding activity' };
  }

  // Token-containment either direction handles "Defense Health Agency" vs "DEFENSE HEALTH AGENCY (DHA)".
  const hit = haystack.find((h) => h.includes(target) || target.includes(h));

  // A department-only match is NOT enough when the candidate names a different
  // component: DoD==DoD while the award is Army's does not make it a DHA predecessor.
  if (hit && DEPARTMENT_ONLY.test(hit) && differentComponent(target, gotSub, gotAgency)) {
    return {
      name: 'agency consistency',
      passed: false,
      detail: `candidate awarding activity "${[candidate.awardingSubAgency, candidate.awardingAgency].filter(Boolean).join(' / ')}" does not correspond to requested "${requested.agency}"; a shared department is not sufficient`,
    };
  }
  if (hit) return { name: 'agency consistency', passed: true, detail: `candidate agency "${hit}" matches requested "${target}"` };

  const shown = [candidate.awardingSubAgency, candidate.awardingAgency].filter(Boolean).join(' / ');
  return {
    name: 'agency consistency',
    passed: false,
    detail: `candidate awarding activity "${shown}" does not correspond to requested "${requested.agency}"; a shared department is not sufficient`,
  };
}

/** NAICS compatibility: exact, or same 4-digit industry group, else explained. */
export function checkNaicsConsistency(requestedNaics: string | undefined, candidateNaics: string | undefined): ConsistencyCheck {
  if (!requestedNaics || !candidateNaics) {
    return { name: 'NAICS consistency', passed: false, detail: `cannot compare (requirement=${requestedNaics ?? 'none'}, candidate=${candidateNaics ?? 'none'})` };
  }
  if (requestedNaics === candidateNaics) {
    return { name: 'NAICS consistency', passed: true, detail: `exact match on ${requestedNaics}` };
  }
  if (requestedNaics.slice(0, 4) === candidateNaics.slice(0, 4)) {
    return { name: 'NAICS consistency', passed: true, detail: `same 4-digit industry group (${requestedNaics} vs ${candidateNaics})` };
  }
  return { name: 'NAICS consistency', passed: false, detail: `requirement NAICS ${requestedNaics} vs candidate ${candidateNaics} — different industry` };
}

const STOP = new Set(['the','and','for','of','to','a','an','in','on','with','support','services','service','system','systems']);

/** Title/description similarity — meaningful token overlap, not a coincidence. */
export function checkTitleSimilarity(reqTitle: string, candidateText: string): ConsistencyCheck {
  const t = new Set(norm(reqTitle).split(' ').filter((w) => w.length > 3 && !STOP.has(w)));
  const c = new Set(norm(candidateText).split(' ').filter((w) => w.length > 3 && !STOP.has(w)));
  if (t.size === 0) return { name: 'title similarity', passed: false, detail: 'requirement title has no comparable tokens' };
  const shared = [...t].filter((w) => c.has(w));
  const ratio = shared.length / t.size;
  const passed = ratio >= 0.3;
  return {
    name: 'title similarity',
    passed,
    detail: `${shared.length}/${t.size} significant token(s) shared (${(ratio * 100).toFixed(0)}%)${shared.length ? `: ${shared.slice(0, 6).join(', ')}` : ''}`,
  };
}

export function checkGrounding(grounded: boolean | undefined, degradedFlag: boolean | undefined): ConsistencyCheck {
  const passed = grounded === true && degradedFlag !== true;
  return { name: 'grounded and not degraded', passed, detail: `grounded=${String(grounded)}, degraded=${String(degradedFlag)}` };
}

export function checkTraceability(candidate: { usaSpendingUrl?: string; awardId?: string; generatedId?: string; piid?: string }): ConsistencyCheck {
  const id = candidate.awardId ?? candidate.generatedId ?? candidate.piid;
  const passed = !!id && !!candidate.usaSpendingUrl;
  return { name: 'traceable award identifier and source link', passed, detail: passed ? `id=${id}` : `id=${id ?? 'none'}, url=${candidate.usaSpendingUrl ?? 'none'}` };
}

/**
 * Structured office identity — DoDAAC on the requested contracting office vs the
 * candidate's awarding office / PIID prefix. Not a keyword match on office name.
 * Returns null when the requirement did not carry a parseable DoDAAC (check skipped).
 */
export function checkOfficeConsistency(
  requestedCode: string | undefined,
  candidate: {
    awardingOffice?: string;
    awardingOfficeCode?: string;
    awardId?: string;
    piid?: string;
  },
): ConsistencyCheck | null {
  if (!requestedCode) return null;
  const got =
    extractDodaac(candidate.awardingOfficeCode) ||
    extractDodaac(candidate.awardingOffice) ||
    extractDodaac(String(candidate.awardId || candidate.piid || ''));
  if (got === requestedCode) {
    return {
      name: 'contracting office',
      passed: true,
      detail: `awarding office ${got} matches requested contracting office ${requestedCode}`,
    };
  }
  return {
    name: 'contracting office',
    passed: false,
    detail: `candidate office "${got ?? candidate.awardingOffice ?? 'none'}" does not match requested contracting office ${requestedCode}`,
  };
}

export function classifyAwardAgainstScope(
  scope: MarketScope,
  candidate: {
    awardingAgency?: string;
    awardingSubAgency?: string;
    awardingOffice?: string;
    awardingOfficeCode?: string;
    awardId?: string;
    piid?: string;
    description?: string;
    popCity?: string;
  },
): EvidenceClass {
  const office =
    extractDodaac(candidate.awardingOfficeCode) ||
    extractDodaac(candidate.awardingOffice) ||
    extractDodaac(String(candidate.awardId || candidate.piid || ''));
  const place = `${candidate.description ?? ''} ${candidate.popCity ?? ''} ${candidate.awardingOffice ?? ''}`;

  if (scope.contractingOfficeCode) {
    if (office === scope.contractingOfficeCode) return 'in_scope';
    if (scope.installation && matchesInstallation(scope.installation, place)) return 'contextual';
    return 'unresolved';
  }

  const agency = checkAgencyConsistency(
    { agency: scope.department ?? '', subAgency: scope.service },
    candidate,
  );
  if (agency.passed) return 'in_scope';
  if (scope.installation && matchesInstallation(scope.installation, place)) return 'contextual';
  return 'unresolved';
}

/** Amount label must be preserved EXACTLY — obligated ≠ current ≠ ceiling. */
function amountField(row: Record<string, unknown>, ev: ReturnType<typeof evidence>): GroundedField<{ value: number; label: string }> {
  // Label ordering matters: obligated, current and ceiling are DIFFERENT facts and
  // must never be interchanged. `awardAmount` from search_past_contracts is the
  // award's LIFETIME total to date (the tool's own `basis.award_amount` says so) —
  // a stock, not an annual figure — so it is labelled as such and never summed.
  const candidates: Array<[string, string]> = [
    ['obligated', 'obligated'],
    ['currentValue', 'current award amount'],
    ['ceiling', 'ceiling (base and all options)'],
    ['awardAmount', 'award lifetime total to date, as reported by USASpending'],
    ['total_obligated', 'obligated'],
  ];
  for (const [key, label] of candidates) {
    const v = row[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v === 0) return { state: 'true_zero', value: 0, label: `${label} reported as zero by the source`, evidence: ev };
      return value({ value: v, label }, ev);
    }
  }
  return unknown('the source did not report an award amount for this row', [ev]);
}

function str(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

function fieldFrom(row: Record<string, unknown>, keys: string[], missingReason: string, ev: ReturnType<typeof evidence>): GroundedField<string> {
  const v = str(row, keys);
  return v ? value(v, ev) : unknown(missingReason, [ev]);
}

function awardRowFromSource(
  row: Record<string, unknown>,
  ev: ReturnType<typeof evidence>,
  evidenceClass: EvidenceClass,
): AwardRow {
  const url = str(row, ['usaSpendingUrl', 'usaspending_link', 'usaspendingUrl']);
  const office = str(row, ['awardingOffice', 'awarding_office', 'awardingOfficeCode']);
  return {
    contractNumber: fieldFrom(row, ['awardId', 'piid', 'contract_number', 'generatedId'], 'the source did not report a contract number', ev),
    recipient: fieldFrom(row, ['recipientName', 'recipient', 'recipient_name'], 'the source did not report a recipient', ev),
    awardType: fieldFrom(row, ['awardType', 'contractType', 'type_of_contract_pricing', 'pricingType'], 'the source did not report a contract type', ev),
    procurementMethod: fieldFrom(row, ['procurementMethod', 'extentCompeted', 'extent_competed', 'setAside', 'set_aside'], 'the source did not report a procurement method / extent competed', ev),
    offerors: (() => {
      const v = row.offerors ?? row.numberOfOffers ?? row.number_of_offers_received;
      if (typeof v === 'number' && Number.isFinite(v)) {
        return v === 0
          ? ({ state: 'true_zero', value: 0, label: 'offers received, as reported by the source', evidence: ev } as GroundedField<number>)
          : value(v, ev);
      }
      return unknown('the source did not report the number of offerors', [ev]);
    })(),
    amount: amountField(row, ev),
    periodOfPerformance: (() => {
      const s = str(row, ['startDate', 'popStart', 'period_of_performance_start_date']);
      const e = str(row, ['endDate', 'popEnd', 'period_of_performance_current_end_date']);
      if (s || e) return value(`${s ?? 'Unknown'} → ${e ?? 'Unknown'}`, ev);
      return unknown('the source did not report a period of performance', [ev]);
    })(),
    naics: fieldFrom(row, ['naicsCode', 'naics', 'naics_code'], 'the source did not report a NAICS code', ev),
    psc: fieldFrom(row, ['pscCode', 'psc', 'psc_code'], 'the source did not report a PSC code', ev),
    awardingAgency: fieldFrom(row, ['awardingSubAgency', 'subAgency', 'awardingAgency', 'agency', 'awarding_agency'], 'the source did not report an awarding agency', ev),
    evidenceClass,
    ...(office ? { awardingOffice: office } : {}),
    ...(url ? { usaSpendingUrl: url } : {}),
  };
}

function officeRowAsSource(row: OfficeAwardRow): Record<string, unknown> {
  const gid = row.awardId || '';
  return {
    awardId: row.piid,
    piid: row.piid,
    recipientName: row.recipientName,
    awardAmount: row.awardAmount,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    agency: row.awardingAgency,
    subAgency: row.awardingSubAgency,
    awardingAgency: row.awardingAgency,
    awardingSubAgency: row.awardingSubAgency,
    awardingOffice: row.awardingOffice,
    awardingOfficeCode: row.awardingOfficeCode,
    naicsCode: row.naicsCode,
    pscCode: row.pscCode,
    awardType: row.awardType,
    popCity: row.popCity,
    popState: row.popState,
    usaSpendingUrl: gid
      ? `https://www.usaspending.gov/award/${gid}`
      : `https://www.usaspending.gov/keyword_search/${encodeURIComponent(row.piid)}`,
  };
}

export async function buildSection9(
  req: Requirement,
  primaryNaics: string | undefined,
  opts?: BuildSection9Opts,
): Promise<Section9> {
  const calls: ToolCall[] = [];
  const retrievalManifests: RetrievalManifest[] = [];
  const expansions: ScopeExpansionRecord[] = [];
  const scope = marketScopeFromRequirement(primaryNaics ? { ...req, naics: primaryNaics } : req);

  const awards: AwardRow[] = [];
  let awardsFinding: GroundedField<string>;

  const capabilityGapOffice =
    'search_past_contracts / USASpending spending_by_award cannot filter awarding-office or DoDAAC; office text is not used as a keyword. Buyer history uses bq.usaspending.awards.awarding_office_code when a parseable DoDAAC is present.';

  if (scope.contractingOfficeCode) {
    const lookup = opts?.officeAwardLookup ?? queryAwardsByAwardingOffice;
    const officeQuery = {
      officeCode: scope.contractingOfficeCode,
      ...(primaryNaics ? { naics: primaryNaics } : {}),
      ...(req.psc ? { psc: req.psc } : {}),
      ...(req.place_of_performance_state ? { popState: req.place_of_performance_state } : {}),
      limit: 25,
    };
    const officeResult = await lookup(officeQuery);
    const officeEv = evidence('bq.usaspending.awards awarding_office_code', officeQuery);
    calls.push({
      tool: 'bq.awards.awarding_office_code',
      args: officeQuery,
      evidence: officeEv,
      ok: officeResult.ok,
      ...(officeResult.ok ? { result: { count: officeResult.rows.length, asOf: officeResult.asOf } } : {}),
      ...(officeResult.error ? { error: officeResult.error } : {}),
    });

    const consumed: RetrievalManifest['consumed_scope'] = {
      contracting_office: scope.contractingOfficeCode,
    };
    if (primaryNaics) consumed.naics = primaryNaics;
    if (req.psc) consumed.psc = req.psc;
    if (req.place_of_performance_state) consumed.geography = req.place_of_performance_state;

    const unsupported: RetrievalManifest['unsupported_scope'] = {
      phrase: scope.phrase
        ? `phrase "${scope.phrase}" is not a warehouse award predicate`
        : 'phrase is not a warehouse award predicate',
    };
    if (scope.service) {
      unsupported.service = `${scope.service} is not an independent awarding-agency column; office ${scope.contractingOfficeCode} is the buyer predicate`;
    }
    if (scope.installation) {
      unsupported.installation = 'installation is not a warehouse awarding-office predicate; used only to classify place-of-performance context';
    }

    retrievalManifests.push(retrievalManifest({
      section: '9',
      tool: 'search_past_contracts',
      requested: scope,
      consumed: {},
      unsupported: { contracting_office: capabilityGapOffice },
      resultCount: null,
      grounded: null,
      source: 'Mindy MCP search_past_contracts',
      asOf: officeResult.retrievedAt,
      evidenceClass: 'unresolved',
    }));

    if (!officeResult.ok) {
      awardsFinding = unknown(
        `awarding-office history query failed: ${officeResult.error ?? 'unknown error'} — query failure is not a measured zero`,
        [officeEv],
      );
      retrievalManifests.push(retrievalManifest({
        section: '9',
        tool: 'bq.awards.awarding_office_code',
        requested: scope,
        consumed,
        unsupported,
        resultCount: null,
        grounded: null,
        source: 'bq.usaspending.awards',
        asOf: officeResult.retrievedAt,
        evidenceClass: 'unresolved',
        strictScopeResult: 'unknown',
      }));
    } else if (officeResult.rows.length === 0) {
      awardsFinding = {
        state: 'true_zero',
        value: 0,
        label: `No matching buyer-history awards for contracting office ${scope.contractingOfficeCode} under the stated NAICS/PSC/geography. Strict scope was not expanded.`,
        evidence: officeEv,
      };
      retrievalManifests.push(retrievalManifest({
        section: '9',
        tool: 'bq.awards.awarding_office_code',
        requested: scope,
        consumed,
        unsupported,
        resultCount: 0,
        grounded: true,
        source: 'bq.usaspending.awards',
        asOf: officeResult.retrievedAt,
        evidenceClass: 'in_scope',
        strictScopeResult: 'empty',
      }));
    } else {
      for (const row of officeResult.rows) {
        const src = officeRowAsSource(row);
        const klass = classifyAwardAgainstScope(scope, src);
        if (klass !== 'in_scope') continue;
        const url = typeof src.usaSpendingUrl === 'string' ? src.usaSpendingUrl : undefined;
        const ev = evidence(officeEv.source, { ...officeQuery, award: row.piid }, url);
        awards.push(awardRowFromSource(src, ev, 'in_scope'));
      }
      awardsFinding = value(
        `${awards.length} in-scope buyer-history award(s) for contracting office ${scope.contractingOfficeCode} (awarding_office_code predicate, not office-name keyword). These are BUYER / CONTRACTING HISTORY rows, not installation-context awards bought by another agency.`,
        officeEv,
      );
      retrievalManifests.push(retrievalManifest({
        section: '9',
        tool: 'bq.awards.awarding_office_code',
        requested: scope,
        consumed,
        unsupported,
        resultCount: awards.length,
        grounded: true,
        source: 'bq.usaspending.awards',
        asOf: officeResult.retrievedAt,
        evidenceClass: 'in_scope',
        strictScopeResult: 'populated',
      }));
    }
  } else {
    const searchArgs: Record<string, unknown> = {
      ...(primaryNaics ? { naics: primaryNaics } : {}),
      ...(req.psc ? { psc: req.psc } : {}),
      ...(req.agency ? { agency: req.agency } : {}),
      ...(req.place_of_performance_state ? { state: req.place_of_performance_state, state_scope: 'pop' } : {}),
      include_idv: true,
      limit: 25,
    };
    const pastCall = await callTool('search_past_contracts', searchArgs);
    calls.push(pastCall);

    const consumed: RetrievalManifest['consumed_scope'] = {};
    if (primaryNaics) consumed.naics = primaryNaics;
    if (req.psc) consumed.psc = req.psc;
    if (req.place_of_performance_state) consumed.geography = req.place_of_performance_state;
    if (req.agency) consumed.department = req.agency;

    const unsupported: RetrievalManifest['unsupported_scope'] = {
      contracting_office: req.office
        ? `office "${req.office}" is not a parseable DoDAAC and search_past_contracts cannot filter awarding office`
        : capabilityGapOffice,
    };
    if (scope.installation) {
      unsupported.installation = 'search_past_contracts has no installation predicate';
    }
    if (scope.phrase) {
      unsupported.phrase = `phrase "${scope.phrase}" is not a search_past_contracts predicate`;
    }
    if (scope.service) unsupported.service = `${scope.service} is not sent as a separate awarding-agency filter`;
    const rewrite = req.agency ? usaSpendingSubtierRewrite(req.agency) : null;
    if (rewrite) {
      unsupported.service = `${rewrite.requested} is not an independent USASpending awarding agency; filter consumed subtier ${rewrite.consumedSubtier}`;
      consumed.department = rewrite.consumedSubtier;
    }

    if (!pastCall.ok) {
      awardsFinding = unknownFromError(new Error(pastCall.error ?? 'call failed'), pastCall.evidence);
      retrievalManifests.push(retrievalManifest({
        section: '9',
        tool: 'search_past_contracts',
        requested: scope,
        consumed,
        unsupported,
        resultCount: null,
        grounded: null,
        source: pastCall.evidence.source,
        asOf: pastCall.evidence.retrievedAt,
        evidenceClass: 'unresolved',
        strictScopeResult: 'unknown',
      }));
    } else if (metaDegraded(pastCall.result) === true) {
      awardsFinding = degraded('search_past_contracts reported degraded upstream data', [pastCall.evidence]);
      retrievalManifests.push(retrievalManifest({
        section: '9',
        tool: 'search_past_contracts',
        requested: scope,
        consumed,
        unsupported,
        resultCount: null,
        grounded: false,
        source: pastCall.evidence.source,
        asOf: pastCall.evidence.retrievedAt,
        evidenceClass: 'unresolved',
        strictScopeResult: 'unknown',
      }));
    } else if (metaGrounded(pastCall.result) === false) {
      awardsFinding = unknown(
        'search_past_contracts returned grounded:false — award history could not be established. Strict agency/NAICS/PSC/geography filters were NOT removed.',
        [pastCall.evidence],
      );
      retrievalManifests.push(retrievalManifest({
        section: '9',
        tool: 'search_past_contracts',
        requested: scope,
        consumed,
        unsupported,
        resultCount: 0,
        grounded: false,
        source: pastCall.evidence.source,
        asOf: pastCall.evidence.retrievedAt,
        evidenceClass: 'unresolved',
        strictScopeResult: 'unknown',
      }));
    } else {
      const raw = (pastCall.result as { awards?: unknown; results?: unknown; contracts?: unknown });
      const rows = (Array.isArray(raw.awards) ? raw.awards : Array.isArray(raw.results) ? raw.results : Array.isArray(raw.contracts) ? raw.contracts : []) as Array<Record<string, unknown>>;
      for (const row of rows) {
        const url = str(row, ['usaSpendingUrl', 'usaspending_link', 'usaspendingUrl']);
        const ev = evidence(pastCall.evidence.source, { ...searchArgs, award: str(row, ['awardId', 'piid', 'contract_number']) ?? null }, url);
        const klass = classifyAwardAgainstScope(scope, {
          awardingAgency: str(row, ['awardingAgency', 'agency']),
          awardingSubAgency: str(row, ['awardingSubAgency', 'subAgency']),
          awardingOffice: str(row, ['awardingOffice', 'awarding_office']),
          awardId: str(row, ['awardId', 'piid']),
          description: str(row, ['description']),
          popCity: str(row, ['popCity', 'pop_city']),
        });
        if (klass !== 'in_scope') continue;
        awards.push(awardRowFromSource(row, ev, 'in_scope'));
      }
      awardsFinding = awards.length > 0
        ? value(`${awards.length} in-scope buyer-history award row(s) for the stated filters.`, pastCall.evidence)
        : {
            state: 'true_zero',
            value: 0,
            label: 'No matching award history found for the stated filters. Strict scope was not expanded.',
            evidence: pastCall.evidence,
          };
      retrievalManifests.push(retrievalManifest({
        section: '9',
        tool: 'search_past_contracts',
        requested: scope,
        consumed,
        unsupported,
        resultCount: awards.length,
        grounded: true,
        source: pastCall.evidence.source,
        asOf: pastCall.evidence.retrievedAt,
        evidenceClass: 'in_scope',
        strictScopeResult: awards.length > 0 ? 'populated' : 'empty',
      }));
    }
  }

  // ---- 2. predecessor: prefer get_solicitation_incumbent, then find_predecessor_award ----
  let predecessor: GroundedField<string> = unknown('no predecessor lookup was possible for this requirement');
  let predecessorStatus: PredecessorStatus = 'unknown';
  let predecessorChecks: ConsistencyCheck[] = [];
  let predecessorCandidate: Record<string, unknown> | undefined;
  let predecessorSource: Section9['predecessorSource'];
  let predecessorEvidenceClass: EvidenceClass | undefined;

  const evaluate = (
    candidate: Record<string, unknown>,
    grounded: boolean | undefined,
    degradedFlag: boolean | undefined,
    ev: ReturnType<typeof evidence>,
    source: NonNullable<Section9['predecessorSource']>,
  ) => {
    predecessorCandidate = candidate;
    predecessorSource = source;
    predecessorEvidenceClass = classifyAwardAgainstScope(scope, {
      awardingAgency: candidate.awardingAgency as string | undefined,
      awardingSubAgency: candidate.awardingSubAgency as string | undefined,
      awardingOffice: candidate.awardingOffice as string | undefined,
      awardingOfficeCode: candidate.awardingOfficeCode as string | undefined,
      awardId: (candidate.awardId ?? candidate.piid) as string | undefined,
      description: candidate.description as string | undefined,
      popCity: candidate.popCity as string | undefined,
    });

    const officeCheck = checkOfficeConsistency(scope.contractingOfficeCode, {
      awardingOffice: candidate.awardingOffice as string | undefined,
      awardingOfficeCode: candidate.awardingOfficeCode as string | undefined,
      awardId: candidate.awardId as string | undefined,
      piid: candidate.piid as string | undefined,
    });
    const agencyCheck = checkAgencyConsistency(
      { agency: scope.department || req.agency, subAgency: scope.service || req.sub_agency },
      {
        awardingAgency: candidate.awardingAgency as string | undefined,
        awardingSubAgency: candidate.awardingSubAgency as string | undefined,
        awardingOffice: candidate.awardingOffice as string | undefined,
      },
    );
    const checks: ConsistencyCheck[] = [
      checkGrounding(grounded, degradedFlag),
    ];
    if (officeCheck?.passed && !agencyCheck.passed) {
      checks.push({
        name: 'agency consistency',
        passed: true,
        detail:
          `contracting office ${scope.contractingOfficeCode} identifies the buyer; ` +
          `requested department/service (${scope.department ?? req.agency} / ${scope.service ?? 'n/a'}) ` +
          `need not equal the awarding-agency string`,
      });
    } else {
      checks.push(agencyCheck);
    }
    if (officeCheck) checks.push(officeCheck);
    checks.push(
      checkNaicsConsistency(primaryNaics, candidate.naicsCode as string | undefined),
      checkTitleSimilarity(req.title, `${candidate.description ?? ''} ${candidate.recipientName ?? ''}`),
      checkTraceability(candidate as { usaSpendingUrl?: string; awardId?: string }),
    );
    predecessorChecks = checks;

    const conf = String(candidate.matchConfidence ?? '');
    if (conf) checks.push({ name: 'tool-reported confidence (recorded, not decisive)', passed: conf === 'high', detail: `matchConfidence=${conf}` });

    const failed = checks.filter((c) => !c.passed && c.name !== 'tool-reported confidence (recorded, not decisive)');
    const name = String(candidate.recipientName ?? 'unnamed candidate');
    const classNote =
      predecessorEvidenceClass === 'contextual'
        ? ' INSTALLATION CONTEXT: work at the scoped installation bought by another agency — not buyer/contracting history for the scoped office.'
        : predecessorEvidenceClass === 'in_scope'
          ? ' Classified as in-scope buyer/contracting history.'
          : '';
    if (failed.length === 0 && predecessorEvidenceClass === 'in_scope') {
      predecessor = value(`Likely predecessor: ${name} (${String(candidate.awardId ?? candidate.piid ?? 'id unknown')}) — inferred, not a certified contract lineage.${classNote}`, ev);
      predecessorStatus = 'established';
    } else {
      predecessor = degraded(
        `no sufficiently consistent predecessor award established — ${failed.map((f) => f.detail).join('; ')}.${classNote}`,
        [ev],
      );
      predecessorStatus = 'degraded';
    }
  };

  if (req.solicitation_number || req.notice_id) {
    const args = {
      ...(req.solicitation_number ? { solicitation_number: req.solicitation_number } : {}),
      ...(req.notice_id ? { notice_id: req.notice_id } : {}),
    };
    const incCall = await callTool('get_solicitation_incumbent', args);
    calls.push(incCall);
    const meta = (incCall.result as { _meta?: Record<string, unknown> })?._meta ?? {};
    const inc = (incCall.result as { incumbent?: Record<string, unknown> })?.incumbent;
    if (!incCall.ok) {
      predecessor = unknownFromError(new Error(incCall.error ?? 'call failed'), incCall.evidence);
    } else if (inc) {
      const url = typeof inc.usaSpendingUrl === 'string' ? inc.usaSpendingUrl : undefined;
      evaluate(inc, meta.grounded_incumbent as boolean | undefined, meta.degraded as boolean | undefined,
        evidence(incCall.evidence.source, args, url), 'get_solicitation_incumbent');
    } else {
      predecessor = unknown('get_solicitation_incumbent resolved the notice but reported no incumbent award', [incCall.evidence]);
    }
    retrievalManifests.push(retrievalManifest({
      section: '9.predecessor',
      tool: 'get_solicitation_incumbent',
      requested: scope,
      consumed: {
        ...(req.solicitation_number ? { phrase: req.solicitation_number } : {}),
      },
      unsupported: {
        contracting_office: 'get_solicitation_incumbent does not take an awarding-office filter',
        ...(scope.installation ? { installation: 'not a solicitation-incumbent predicate' } : {}),
      },
      resultCount: inc ? 1 : 0,
      grounded: incCall.ok ? Boolean(inc) : null,
      source: incCall.evidence.source,
      asOf: incCall.evidence.retrievedAt,
      evidenceClass: predecessorEvidenceClass ?? 'unresolved',
    }));
  }

  if (predecessorStatus === 'unknown' && !req.solicitation_number && !req.notice_id) {
    const args = { agency_name: req.agency, naics_code: primaryNaics, title: req.title };
    const predCall = await callTool('find_predecessor_award', args);
    calls.push(predCall);
    const inc = (predCall.result as { incumbent?: Record<string, unknown> })?.incumbent;
    if (!predCall.ok) {
      predecessor = unknownFromError(new Error(predCall.error ?? 'call failed'), predCall.evidence);
    } else if (inc) {
      const url = typeof inc.usaSpendingUrl === 'string' ? inc.usaSpendingUrl : undefined;
      evaluate(inc, metaGrounded(predCall.result), metaDegraded(predCall.result),
        evidence(predCall.evidence.source, args, url), 'find_predecessor_award');
    } else {
      predecessor = unknown('find_predecessor_award returned no candidate award', [predCall.evidence]);
    }
    retrievalManifests.push(retrievalManifest({
      section: '9.predecessor',
      tool: 'find_predecessor_award',
      requested: scope,
      consumed: {
        ...(req.agency ? { department: req.agency } : {}),
        ...(primaryNaics ? { naics: primaryNaics } : {}),
      },
      unsupported: {
        contracting_office: 'find_predecessor_award has no awarding-office / DoDAAC argument',
        ...(scope.service ? { service: `${scope.service} is not a find_predecessor_award argument` } : {}),
        ...(scope.installation ? { installation: 'not a predecessor-tool predicate; used only to classify the candidate' } : {}),
        ...(scope.psc ? { psc: 'not passed to find_predecessor_award' } : {}),
      },
      resultCount: inc ? 1 : 0,
      grounded: predCall.ok ? Boolean(inc) : null,
      source: predCall.evidence.source,
      asOf: predCall.evidence.retrievedAt,
      evidenceClass: predecessorEvidenceClass ?? 'unresolved',
    }));
  }

  return {
    awards,
    awardsFinding,
    predecessorStatus,
    predecessor,
    predecessorChecks,
    predecessorCandidate,
    predecessorSource,
    predecessorEvidenceClass,
    scope,
    retrievalManifests,
    expansions,
    calls,
  };
}
