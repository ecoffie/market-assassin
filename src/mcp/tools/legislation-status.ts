/**
 * MCP tool: get_legislation_status — status + document metadata for federal legislation
 * Mindy holds (the NDAA corpus in institute_sources, read through the #1699 shared reader).
 *
 * ⚠️ WHY THIS EXISTS (fresh-host production test, 2026-09-25). "What is the status of the
 * FY2027 NDAA?" in a new claude.ai chat with the Mindy connector ON went straight to web
 * search: Mindy held the answer, but no tool was shaped for a Congress question, and the
 * agency-scoped `legislation` section inside get_agency_intel was never considered.
 *
 * WHAT IT MAY SAY
 *  - Stage and law status from stored VERSION CODES only (legislation-stages.ts).
 *    Reported is not passed; passed (one chamber, or both in differing forms) is not law;
 *    only a PUBLIC LAW record is the enacted authority.
 *  - "Latest stored action as of <last poll>" — the collector stores ONE latest action per
 *    bill and no action history or recorded votes.
 *  - Absence per coverage: complete → NOT_FOUND_IN_COVERED_CORPUS (scope stated);
 *    partial / unknown / another Congress → NOT_ESTABLISHED. Never "does not exist".
 *
 * WHAT IT MUST NOT SAY
 *  - Anything a bill contains, requires or directs: Mindy holds NO bill text. A content
 *    question returns `content_status: NOT_HELD`. No title search, no pain points, no
 *    committee-report metadata dressed up as statute.
 *
 * Pure read: no Congress API, no web, no LLM, no writes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readLegislativeCorpus,
  groupLegislativeEvidence,
  type LegislativeCoverage,
  type LegislativeMeasure,
  type LegislativeVersion,
} from '@/lib/strategic-intel/legislative-evidence';
import { stageForCode, type LegislationStage } from '@/lib/strategic-intel/legislation-stages';
import {
  parseLegislationQuery,
  fiscalYearsForCongress,
  type ContentRequest,
  type LegislationQuery,
} from '@/lib/strategic-intel/legislation-query';
import { mcpFlags } from '@/lib/mcp/flags';

export interface LegislationStatusInput {
  /** e.g. "FY2027 NDAA", "H.R. 8800", "S 4784", "PL 119-60", "S. Rept. 119-127". */
  query: string;
}

export type ResolutionOutcome = 'FOUND' | 'NOT_FOUND_IN_COVERED_CORPUS' | 'NOT_ESTABLISHED';

export interface StatusVersion {
  document_number: string;
  version_code: string | null;
  version: string | null;
  stage: LegislationStage;
  display: string;
  law_status: string;
  evidence_class: LegislativeVersion['evidence_class'];
  source_date: string | null;
  source_url: string;
}

export interface StatusReport {
  document_number: string;
  citation: string | null;
  document_kind: 'committee_report';
  is_errata: boolean;
  is_conference_report: boolean;
  law_status: 'not_applicable';
  source_date: string | null;
  source_url: string;
}

export interface StatusDocument {
  bill: string;
  congress: number | null;
  chamber_of_origin: string | null;
  title: string | null;
  role: LegislativeMeasure['role'];
  fiscal_year: number | null;
  amends_fiscal_year: number | null;
  current_stage: LegislationStage;
  current_stage_display: string;
  progress: {
    house: LegislationStage | null;
    senate: LegislationStage | null;
    enrolled: boolean;
    enacted: boolean;
  };
  law_number: string | null;
  latest_stored_action: { date: string | null; text: string | null };
  versions: StatusVersion[];
  committee_reports: StatusReport[];
}

export interface ChamberSummary {
  bill: string;
  stage: LegislationStage;
  display: string;
  latest_stored_action: { date: string | null; text: string | null };
}

export interface LegislationStatusResult {
  query: string;
  resolution: {
    kind: LegislationQuery['kind'];
    matched: string | null;
    outcome: ResolutionOutcome;
    note: string | null;
  };
  subject: { label: string | null; fiscal_year: number | null; congress: number | null };
  overall_status: {
    enacted: boolean;
    law_number: string | null;
    enacted_by: { bill: string; law_number: string | null; source_url: string | null; source_date: string | null } | null;
    by_chamber: { house: ChamberSummary | null; senate: ChamberSummary | null } | null;
  } | null;
  documents: StatusDocument[];
  coverage: LegislativeCoverage | null;
  limitations: string[];
  content_request: ContentRequest | null;
  content_status: 'NOT_HELD' | 'NOT_REQUESTED';
  host_rules: string[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    source_count: number;
    as_of: string | null;
    resolution_kind: LegislationQuery['kind'];
  };
}

const LIMITATIONS = ['bill_text_not_held', 'action_history_not_held', 'ndaa_titled_measures_only'];

export const LEGISLATION_HOST_RULES = [
  'Answer covered status questions from these stored records and give their as-of date (_meta.as_of).',
  'Keep the House and Senate bills separate — never describe them as one merged bill.',
  'REPORTED is not passed. Say "reported by committee", not "passed".',
  'Passing one chamber — or both in differing forms — is not law. Only overall_status.enacted=true, backed by a PUBLIC_LAW record, is law.',
  'A committee report is report language, not law; errata are corrections to a report, not bills.',
  'Say "latest stored action as of <date>" — never "complete legislative history". Mindy stores one latest action per bill, not votes or action history.',
  'When content_status is NOT_HELD: say Mindy holds this bill\'s status but not its text, then stop. Do not describe provisions from memory, pain points or report titles; label any outside source as not Mindy evidence.',
  'When resolution.outcome is NOT_ESTABLISHED or NOT_FOUND_IN_COVERED_CORPUS, never say the bill does not exist — state the scope that was covered.',
  'Do not predict passage or timing, and do not add political commentary.',
];

function toStatusVersion(v: LegislativeVersion): StatusVersion {
  const s = stageForCode(v.version_code, v.version);
  return {
    document_number: v.document_number,
    version_code: v.version_code,
    version: v.version,
    stage: s.stage,
    display: s.display,
    law_status: v.law_status,
    evidence_class: v.evidence_class,
    source_date: v.source_date,
    source_url: v.source_url,
  };
}

function toStatusReport(v: LegislativeVersion): StatusReport {
  return {
    document_number: v.document_number,
    citation: v.citation ?? null,
    document_kind: 'committee_report',
    is_errata: /-ERRATA$/i.test(v.document_number) || /errat/i.test(v.citation ?? ''),
    is_conference_report: v.is_conference_report === true,
    law_status: 'not_applicable',
    source_date: v.source_date,
    source_url: v.source_url,
  };
}

function toDocument(m: LegislativeMeasure, reports: LegislativeVersion[] = m.committee_reports): StatusDocument {
  const versions = m.versions.map(toStatusVersion);
  let top = stageForCode(null);
  let house: { stage: LegislationStage; rank: number } | null = null;
  let senate: { stage: LegislationStage; rank: number } | null = null;
  for (const v of m.versions) {
    const s = stageForCode(v.version_code, v.version);
    if (s.rank > top.rank) top = s;
    if (s.chamber === 'House' && s.rank > (house?.rank ?? -1)) house = { stage: s.stage, rank: s.rank };
    if (s.chamber === 'Senate' && s.rank > (senate?.rank ?? -1)) senate = { stage: s.stage, rank: s.rank };
  }
  // Enacted is established by an ENACTED_LAW record (the public law / signed enrolled text),
  // never by a passed or reported version.
  const enacted = m.versions.some((v) => v.evidence_class === 'ENACTED_LAW');
  return {
    bill: m.bill,
    congress: m.congress,
    chamber_of_origin: m.chamber,
    title: m.title,
    role: m.role,
    fiscal_year: m.fiscal_year,
    amends_fiscal_year: m.amends_fiscal_year,
    current_stage: top.stage,
    current_stage_display: top.display,
    progress: {
      house: house?.stage ?? null,
      senate: senate?.stage ?? null,
      enrolled: m.versions.some((v) => stageForCode(v.version_code).stage === 'ENROLLED'),
      enacted,
    },
    law_number: m.law_number,
    latest_stored_action: m.latest_action,
    versions,
    committee_reports: reports.map(toStatusReport),
  };
}

function chamberSummary(docs: StatusDocument[], chamber: 'House' | 'Senate'): ChamberSummary | null {
  const own = docs.filter((d) => d.chamber_of_origin === chamber);
  if (own.length === 0) return null;
  const best = own.reduce((a, b) =>
    stageRank(b.current_stage) > stageRank(a.current_stage) ? b : a);
  return {
    bill: best.bill,
    stage: best.current_stage,
    display: best.current_stage_display,
    latest_stored_action: best.latest_stored_action,
  };
}

const RANK: Record<LegislationStage, number> = {
  OTHER: 0, INTRODUCED: 1, REPORTED_IN_HOUSE: 2, REPORTED_IN_SENATE: 2, HOUSE_PASSED: 3, SENATE_PASSED: 3,
  HOUSE_PASSED_WITH_AMENDMENT: 4, ENROLLED: 5, PUBLIC_LAW: 6,
};
const stageRank = (s: LegislationStage) => RANK[s] ?? 0;

function overallFor(docs: StatusDocument[], measures: LegislativeMeasure[], byChamber: boolean) {
  const lawDoc = docs.find((d) => d.progress.enacted);
  const lawMeasure = lawDoc ? measures.find((m) => m.bill === lawDoc.bill) : undefined;
  const authority = lawMeasure?.versions.find((v) => v.evidence_class === 'ENACTED_LAW' && v.stage === 'enacted')
    ?? lawMeasure?.versions.find((v) => v.evidence_class === 'ENACTED_LAW');
  return {
    enacted: !!lawDoc,
    law_number: lawDoc?.law_number ?? null,
    enacted_by: lawDoc
      ? { bill: lawDoc.bill, law_number: lawDoc.law_number, source_url: authority?.source_url ?? null, source_date: authority?.source_date ?? null }
      : null,
    by_chamber: byChamber ? { house: chamberSummary(docs, 'House'), senate: chamberSummary(docs, 'Senate') } : null,
  };
}

function missOutcome(coverage: LegislativeCoverage | null, inScope: boolean): ResolutionOutcome {
  if (!inScope) return 'NOT_ESTABLISHED';
  return coverage?.status === 'complete' ? 'NOT_FOUND_IN_COVERED_CORPUS' : 'NOT_ESTABLISHED';
}

function scopeNote(coverage: LegislativeCoverage | null, what: string, inScope: boolean): string {
  if (!inScope) {
    return `${what} is outside the Congress Mindy's legislative corpus covers (${coverage?.scope ?? 'NDAA-titled measures'}). NOT_ESTABLISHED — not evidence that it does not exist.`;
  }
  return coverage?.status === 'complete'
    ? `${what} was not found among ${coverage.scope} (discovery complete as of ${coverage.last_complete_discovery_at ?? 'unknown'}). Mindy tracks NDAA-titled measures only — this is not evidence the item does not exist elsewhere.`
    : `${what} is not in the held corpus and discovery coverage is ${coverage?.status ?? 'unknown'} — NOT_ESTABLISHED.`;
}

export async function getLegislationStatus(
  input: LegislationStatusInput,
  opts: { client?: SupabaseClient; now?: string } = {},
): Promise<LegislationStatusResult> {
  const query = String(input?.query ?? '').trim();
  const parsed = parseLegislationQuery(query);
  const q = parsed.query;
  const content_request = parsed.content_request;

  const base = (over: Partial<LegislationStatusResult>): LegislationStatusResult => {
    const docs = over.documents ?? [];
    const coverage = over.coverage ?? null;
    const result: LegislationStatusResult = {
      query,
      resolution: over.resolution ?? { kind: q.kind, matched: null, outcome: 'NOT_ESTABLISHED', note: null },
      subject: over.subject ?? { label: null, fiscal_year: null, congress: null },
      overall_status: over.overall_status ?? null,
      documents: docs,
      coverage,
      limitations: LIMITATIONS,
      content_request,
      content_status: content_request ? 'NOT_HELD' : 'NOT_REQUESTED',
      host_rules: LEGISLATION_HOST_RULES,
      _meta: {
        grounded: docs.length > 0,
        degraded: over._meta?.degraded ?? false,
        source_count: docs.reduce((n, d) => n + d.versions.length + d.committee_reports.length, 0),
        as_of: coverage?.last_poll ?? null,
        resolution_kind: q.kind,
      },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: result._meta.grounded
          ? `${result.subject.label}: ${result.overall_status?.enacted ? `enacted (PL ${result.overall_status.law_number})` : 'not enacted'} per stored records.`
          : `No stored record: ${result.resolution.outcome}.`,
        how_to_use: 'Quote stages from documents[].current_stage_display and dates from _meta.as_of. Obey host_rules.',
        key_caveats: ['Bill text is not held.', 'Latest stored action only — no action history or votes.'],
      };
    }
    return result;
  };

  if (q.kind === 'unresolved') {
    return base({
      resolution: {
        kind: 'unresolved', matched: null, outcome: 'NOT_ESTABLISHED',
        note: 'Could not identify an NDAA fiscal year, a bill number (H.R. / S.), a public law or a committee report in the query.',
      },
    });
  }

  let rows;
  let coverage: LegislativeCoverage;
  try {
    ({ rows, coverage } = await readLegislativeCorpus(opts));
  } catch (err) {
    console.error('[mcp:get_legislation_status] corpus read failed:', err);
    return base({
      resolution: {
        kind: q.kind, matched: null, outcome: 'NOT_ESTABLISHED',
        note: 'Mindy\'s legislative corpus could not be read — status is UNKNOWN for this call, not absent.',
      },
      _meta: { degraded: true } as LegislationStatusResult['_meta'],
    });
  }

  const { vehicles, other_measures } = groupLegislativeEvidence(rows, null);
  const measures = [...vehicles.flatMap((v) => v.measures), ...other_measures];
  const heldCongress = coverage.congress ?? measures.find((m) => m.congress)?.congress ?? null;
  const inCongress = (c: number | null) => c === null || heldCongress === null || c === heldCongress;

  if (q.kind === 'public_law') {
    const label = `PL ${q.congress}-${q.number}`;
    const m = measures.find((x) => x.law_number === `${q.congress}-${q.number}`);
    if (!m) {
      const inScope = inCongress(q.congress);
      return base({
        coverage,
        subject: { label, fiscal_year: null, congress: q.congress },
        resolution: { kind: q.kind, matched: label, outcome: missOutcome(coverage, inScope), note: scopeNote(coverage, label, inScope) },
      });
    }
    const doc = toDocument(m);
    return base({
      coverage,
      subject: { label: `${label} (${m.bill})`, fiscal_year: m.fiscal_year, congress: m.congress },
      resolution: { kind: q.kind, matched: label, outcome: 'FOUND', note: null },
      overall_status: overallFor([doc], [m], false),
      documents: [doc],
    });
  }

  if (q.kind === 'committee_report') {
    const prefix = q.chamber === 'House' ? 'HRPT' : 'SRPT';
    const label = `${q.chamber === 'House' ? 'H.' : 'S.'} Rept. ${q.congress}-${q.number}${q.errata ? ' (errata)' : ''}`;
    const base_id = `${q.congress}-${prefix}-${q.number}`;
    let hit: { m: LegislativeMeasure; r: LegislativeVersion } | null = null;
    for (const m of measures) {
      const r = m.committee_reports.find((x) =>
        q.errata ? x.document_number === `${base_id}-ERRATA` : x.document_number === base_id);
      if (r) { hit = { m, r }; break; }
    }
    if (!hit) {
      const inScope = inCongress(q.congress);
      return base({
        coverage,
        subject: { label, fiscal_year: null, congress: q.congress },
        resolution: { kind: q.kind, matched: label, outcome: missOutcome(coverage, inScope), note: scopeNote(coverage, label, inScope) },
      });
    }
    const related = hit.m.committee_reports
      .filter((x) => x.document_number !== hit!.r.document_number && x.document_number.startsWith(base_id))
      .map((x) => x.document_number);
    const doc = toDocument(hit.m, [hit.r]);
    return base({
      coverage,
      subject: { label, fiscal_year: hit.m.fiscal_year, congress: hit.m.congress },
      resolution: {
        kind: q.kind, matched: label, outcome: 'FOUND',
        note: `Committee report on ${hit.m.bill} — report language, not law.${related.length ? ` Related separate record(s): ${related.join(', ')}.` : ''}`,
      },
      overall_status: overallFor([doc], [hit.m], false),
      documents: [doc],
    });
  }

  if (q.kind === 'bill') {
    const congress = q.congress ?? heldCongress;
    const label = `${q.billType === 'HR' ? 'H.R.' : 'S.'} ${q.number}`;
    if (!inCongress(q.congress)) {
      return base({
        coverage,
        subject: { label, fiscal_year: null, congress: q.congress },
        resolution: { kind: q.kind, matched: label, outcome: 'NOT_ESTABLISHED', note: scopeNote(coverage, `${label} (${q.congress}th Congress)`, false) },
      });
    }
    const m = measures.find((x) => x.measure_key === `${congress}-${q.billType}${q.number}`);
    if (!m) {
      return base({
        coverage,
        subject: { label, fiscal_year: null, congress },
        resolution: { kind: q.kind, matched: label, outcome: missOutcome(coverage, true), note: scopeNote(coverage, label, true) },
      });
    }
    const doc = toDocument(m);
    if (q.reportsOnly) doc.versions = [];
    return base({
      coverage,
      subject: { label, fiscal_year: m.fiscal_year, congress: m.congress },
      resolution: { kind: q.kind, matched: label, outcome: 'FOUND', note: null },
      overall_status: overallFor([toDocument(m)], [m], false),
      documents: [doc],
    });
  }

  if (q.kind === 'fy_vehicle') {
    const label = `FY${q.fiscalYear} NDAA`;
    const congress = q.congress ?? heldCongress;
    const inScope = inCongress(q.congress) && (congress === null || fiscalYearsForCongress(congress).includes(q.fiscalYear));
    const v = vehicles.find((x) => x.fiscal_year === q.fiscalYear);
    if (!v || !inScope) {
      return base({
        coverage,
        subject: { label, fiscal_year: q.fiscalYear, congress },
        resolution: { kind: q.kind, matched: label, outcome: missOutcome(coverage, inScope), note: scopeNote(coverage, label, inScope) },
      });
    }
    const docs = v.measures.map((m) => toDocument(m));
    return base({
      coverage,
      subject: { label, fiscal_year: q.fiscalYear, congress },
      resolution: { kind: q.kind, matched: label, outcome: 'FOUND', note: null },
      overall_status: overallFor(docs, v.measures, true),
      documents: docs,
    });
  }

  // all_vehicles — "the NDAA", "which NDAA is currently law"
  if (!inCongress(q.congress)) {
    return base({
      coverage,
      subject: { label: 'NDAA', fiscal_year: null, congress: q.congress },
      resolution: { kind: q.kind, matched: 'NDAA', outcome: 'NOT_ESTABLISHED', note: scopeNote(coverage, `The NDAA (${q.congress}th Congress)`, false) },
    });
  }
  const docs = vehicles.flatMap((v) => v.measures.map((m) => toDocument(m)));
  const newestEnacted = vehicles.find((v) => v.status === 'enacted');
  return base({
    coverage,
    subject: { label: 'NDAA (all fiscal years held)', fiscal_year: null, congress: heldCongress },
    resolution: {
      kind: 'all_vehicles', matched: 'NDAA', outcome: docs.length ? 'FOUND' : missOutcome(coverage, true),
      note: newestEnacted
        ? `Most recent enacted NDAA held: FY${newestEnacted.fiscal_year} (${newestEnacted.enacted_by?.bill}, PL ${newestEnacted.enacted_by?.law_number}). Earlier NDAAs are outside the held Congress — NOT_ESTABLISHED here, not absent.`
        : null,
    },
    overall_status: newestEnacted ? overallFor(
      newestEnacted.measures.map((m) => toDocument(m)), newestEnacted.measures, false) : null,
    documents: docs,
  });
}
