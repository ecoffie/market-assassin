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
  calls: ToolCall[];
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

export async function buildSection9(req: Requirement, primaryNaics: string | undefined): Promise<Section9> {
  const calls: ToolCall[] = [];

  // ---- 1. award rows ----
  const searchArgs: Record<string, unknown> = {
    ...(primaryNaics ? { naics: primaryNaics } : {}),
    ...(req.psc ? { psc: req.psc } : {}),
    ...(req.agency ? { agency: req.agency } : {}),
    ...(req.place_of_performance_state ? { state: req.place_of_performance_state, state_scope: 'pop' } : {}),
    include_idv: true,
    limit: 25,
  };
  let pastCall = await callTool('search_past_contracts', searchArgs);
  calls.push(pastCall);

  // AGENCY-SCOPE FALLBACK — recorded, never silent.
  // Measured on the DHA JOMIS run: `agency: "Defense Health Agency"` returns
  // grounded:false / count 0 for NAICS 541512, while the same NAICS unscoped is
  // grounded with real rows. The agency string simply does not match the awarding
  // agency values USASpending reports, so an agency-scoped empty is a FILTER
  // artifact, not evidence that the market has no history. Reporting "Unknown"
  // there would be as misleading as reporting zero. We therefore retry WITHOUT the
  // agency filter and state plainly that the scope was widened — the reader must
  // know the rows are market-wide for the code, not this agency's own history.
  let scopeNote = '';
  const agencyScoped = 'agency' in searchArgs;
  const emptyish = pastCall.ok && metaGrounded(pastCall.result) === false && metaDegraded(pastCall.result) !== true;
  if (agencyScoped && emptyish) {
    const widened: Record<string, unknown> = { ...searchArgs };
    delete widened.agency;
    const retry = await callTool('search_past_contracts', widened);
    calls.push(retry);
    if (retry.ok && metaGrounded(retry.result) === true) {
      pastCall = retry;
      // Rebuild searchArgs from `widened` rather than mutating in place: the FIRST
      // call's recorded evidence must keep the agency filter it actually used, or
      // the appendix shows two identical queries and the reader cannot see that the
      // scope was widened. Provenance has to describe what really ran.
      for (const k of Object.keys(searchArgs)) delete (searchArgs as Record<string, unknown>)[k];
      Object.assign(searchArgs, widened);
      scopeNote =
        ` Scope note: no awards matched when filtered to "${req.agency}", so the search was widened to the NAICS/PSC market. ` +
        'These rows are market-wide for the code and are NOT limited to the requiring activity.';
    }
  }

  const awards: AwardRow[] = [];
  let awardsFinding: GroundedField<string>;

  if (!pastCall.ok) {
    awardsFinding = unknownFromError(new Error(pastCall.error ?? 'call failed'), pastCall.evidence);
  } else if (metaDegraded(pastCall.result) === true) {
    awardsFinding = degraded('search_past_contracts reported degraded upstream data', [pastCall.evidence]);
  } else if (metaGrounded(pastCall.result) === false) {
    // Ungrounded ≠ empty market. This is Unknown.
    awardsFinding = unknown('search_past_contracts returned grounded:false — award history could not be established', [pastCall.evidence]);
  } else {
    const raw = (pastCall.result as { awards?: unknown; results?: unknown; contracts?: unknown });
    const rows = (Array.isArray(raw.awards) ? raw.awards : Array.isArray(raw.results) ? raw.results : Array.isArray(raw.contracts) ? raw.contracts : []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const url = str(row, ['usaSpendingUrl', 'usaspending_link', 'usaspendingUrl']);
      const ev = evidence(pastCall.evidence.source, { ...searchArgs, award: str(row, ['awardId', 'piid', 'contract_number']) ?? null }, url);
      awards.push({
        contractNumber: fieldFrom(row, ['awardId', 'piid', 'contract_number', 'generatedId'], 'the source did not report a contract number', ev),
        recipient: fieldFrom(row, ['recipientName', 'recipient', 'recipient_name'], 'the source did not report a recipient', ev),
        awardType: fieldFrom(row, ['awardType', 'contractType', 'type_of_contract_pricing', 'pricingType'], 'the source did not report a contract type', ev),
        // USASpending's spending_by_award endpoint does not return extent-competed
        // or offer counts. That is MISSING, never zero.
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
        ...(url ? { usaSpendingUrl: url } : {}),
      });
    }
    awardsFinding = rows.length > 0
      ? value(`${rows.length} award row(s) returned for the stated filters.${scopeNote}`, pastCall.evidence)
      // Grounded AND empty is a real, reportable finding — distinct from a failure.
      : { state: 'true_zero', value: 0, label: 'No matching award history found for the stated filters', evidence: pastCall.evidence };
  }

  // ---- 2. predecessor: prefer get_solicitation_incumbent, then find_predecessor_award ----
  let predecessor: GroundedField<string> = unknown('no predecessor lookup was possible for this requirement');
  let predecessorStatus: PredecessorStatus = 'unknown';
  let predecessorChecks: ConsistencyCheck[] = [];
  let predecessorCandidate: Record<string, unknown> | undefined;
  let predecessorSource: Section9['predecessorSource'];

  const evaluate = (
    candidate: Record<string, unknown>,
    grounded: boolean | undefined,
    degradedFlag: boolean | undefined,
    ev: ReturnType<typeof evidence>,
    source: NonNullable<Section9['predecessorSource']>,
  ) => {
    predecessorCandidate = candidate;
    predecessorSource = source;
    const checks: ConsistencyCheck[] = [
      checkGrounding(grounded, degradedFlag),
      checkAgencyConsistency(
        { agency: req.agency, subAgency: req.sub_agency },
        {
          awardingAgency: candidate.awardingAgency as string | undefined,
          awardingSubAgency: candidate.awardingSubAgency as string | undefined,
          awardingOffice: candidate.awardingOffice as string | undefined,
        },
      ),
      checkNaicsConsistency(primaryNaics, candidate.naicsCode as string | undefined),
      checkTitleSimilarity(req.title, `${candidate.description ?? ''} ${candidate.recipientName ?? ''}`),
      checkTraceability(candidate as { usaSpendingUrl?: string; awardId?: string }),
    ];
    predecessorChecks = checks;

    const conf = String(candidate.matchConfidence ?? '');
    // matchConfidence is recorded but NEVER sufficient on its own — the live DHA
    // probe returned a grounded Army award for a DHA requirement.
    if (conf) checks.push({ name: 'tool-reported confidence (recorded, not decisive)', passed: conf === 'high', detail: `matchConfidence=${conf}` });

    const failed = checks.filter((c) => !c.passed && c.name !== 'tool-reported confidence (recorded, not decisive)');
    const name = String(candidate.recipientName ?? 'unnamed candidate');
    if (failed.length === 0) {
      predecessor = value(`Likely predecessor: ${name} (${String(candidate.awardId ?? candidate.piid ?? 'id unknown')}) — inferred, not a certified contract lineage`, ev);
      predecessorStatus = 'established';
    } else {
      predecessor = degraded(
        `no sufficiently consistent predecessor award established — ${failed.map((f) => f.detail).join('; ')}`,
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
  }

  // Corroboration path — only when the primary path established nothing.
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
  }

  return { awards, awardsFinding, predecessorStatus, predecessor, predecessorChecks, predecessorCandidate, predecessorSource, calls };
}
