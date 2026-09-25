/**
 * SHARED STRATEGIC READER — legislation family.
 *
 * Reads Mindy's living legislative corpus (`institute_sources`, written weekly by
 * /api/cron/institute-legislation-sync) and returns it for ONE agency as source
 * evidence: measure → version → stage → law status → link. READ ONLY — no Congress
 * call, no ingest, no interpretation.
 *
 * ⚠️ WHY THIS EXISTS (Strategic Evidence audit, 2026-09-25).
 * The corpus was collected, versioned and health-checked (#1559 → #1644) and then
 * read by NOTHING: the only customer reader of `institute_sources` filtered
 * `source='gao'`. Meanwhile get_agency_intel served FY2026 NDAA claims from static
 * JSON with `source_url: null` while the enacted public law sat in this table with
 * a URL. Evidence Mindy owns must reach the customer as evidence.
 *
 * WHAT IT MAY SAY — and what it must not:
 *  - A version's STAGE and LEGAL WEIGHT come from the stored `legislativeStage` and
 *    `lawStatusAtIngestion`. A House-passed or Senate-reported version is NOT law;
 *    only ENACTED_LAW rows are law. A committee report is report language, not law.
 *  - Mindy holds NO bill or report TEXT (`abstract` is null for every legislative
 *    row). Nothing here may say what a version provides, requires or directs.
 *  - Coverage is NDAA-titled measures in one Congress. Absence of any other
 *    legislation — appropriations included — is NOT_ESTABLISHED, never "none".
 *  - Agency linkage is department grain (a title rule). A component query (Navy)
 *    is answered at its parent department and SAYS so; it is never attributed to
 *    the component.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveAgency } from '@/lib/strategic-intel/agency-resolver';
import { LEGISLATIVE_SOURCE_TYPES, type LegislativeStage, type LawStatusAtIngestion, type MeasureRole } from '@/lib/institute/legislation';
import { decodeDiscoveryCursor } from '@/lib/institute/legislation-discovery';
import { classifyLegislationFreshness } from '@/lib/institute/legislation-clocks';

const SOURCE_KEY = 'institute_legislation';
/** One PostgREST page. A full page means the held population was truncated. */
const HELD_ROW_CEILING = 1000;

export type LegislativeEvidenceClass =
  | 'ENACTED_LAW'                    // the enacted text: public law / enrolled bill of a measure that became law
  | 'LEGISLATIVE_ACTIVITY_NOT_LAW'   // introduced / reported / passed-chamber text, or superseded by enactment
  | 'COMMITTEE_REPORT_LANGUAGE';     // a committee report (errata are their own record)

export type AgencyLinkGrain = 'department' | 'parent_department';

export interface LegislativeVersion {
  document_number: string;
  source_type: string;
  evidence_class: LegislativeEvidenceClass;
  version: string | null;
  stage: LegislativeStage | 'committee_report';
  law_status: LawStatusAtIngestion | 'not_applicable';
  /** The government's date for this text. Null = undated upstream, never guessed. */
  source_date: string | null;
  source_url: string;
  /** Committee reports only. */
  citation?: string | null;
  is_conference_report?: boolean;
  /** How this row reaches the agency: its own resolution, or inherited from the bill it reports on. */
  agency_link: 'own_resolution' | 'inherited_from_associated_bill';
}

export interface LegislativeMeasure {
  measure_key: string;              // '119-HR8800'
  bill: string;                     // 'H.R. 8800'
  congress: number | null;
  chamber: string | null;
  title: string | null;
  role: MeasureRole | 'unknown';
  /** Authorization vehicles only — the FY the measure authorizes. */
  fiscal_year: number | null;
  /** Amending bills only — the prior act's FY. */
  amends_fiscal_year: number | null;
  /** Most advanced stage ESTABLISHED by a held version. */
  most_advanced_stage: LegislativeStage | null;
  became_law: boolean;
  law_number: string | null;
  latest_action: { date: string | null; text: string | null };
  versions: LegislativeVersion[];
  committee_reports: LegislativeVersion[];
}

export interface LegislativeVehicle {
  fiscal_year: number;
  /** 'enacted' only when a held measure for this FY became law. Never a forecast. */
  status: 'enacted' | 'not_enacted';
  enacted_by: { bill: string; law_number: string | null; source_url: string | null } | null;
  measures: LegislativeMeasure[];
}

export interface LegislativeCoverage {
  /** Did the newest discovery pass cover its whole window? */
  status: 'complete' | 'partial' | 'unknown';
  scope: string;
  congress: number | null;
  last_complete_discovery_at: string | null;
  last_poll: string | null;
  /** Newest dated legislative text held. */
  last_source_advance: string | null;
  freshness: 'healthy' | 'upstream_quiet' | 'ingest_broken' | 'unmeasured';
  held_rows_truncated: boolean;
}

export interface LegislativeEvidence {
  status: 'grounded' | 'empty' | 'not_established' | 'unavailable';
  requested: string;
  /** The department the measures are linked to (null when not established). */
  linked_agency: string | null;
  grain: AgencyLinkGrain | null;
  vehicles: LegislativeVehicle[];
  other_measures: LegislativeMeasure[];
  coverage: LegislativeCoverage | null;
  /** What this evidence CANNOT establish. Hosts must carry these, not fill them. */
  not_established: string[];
  host_rules: string[];
}

// ── pure helpers ──────────────────────────────────────────────────────────────
interface HeldRow {
  source_type: string;
  document_number: string;
  title: string;
  source_url: string;
  publication_date: string | null;
  canonical_agency: string | null;
  raw: Record<string, unknown> | null;
}

const STAGE_ORDER: Record<string, number> = {
  introduced: 1, reported: 2, passed_chamber: 3, enrolled: 4, enacted: 5,
};

const BILL_PREFIX: Record<string, string> = {
  HR: 'H.R.', S: 'S.', HJRES: 'H.J.Res.', SJRES: 'S.J.Res.', HCONRES: 'H.Con.Res.', SCONRES: 'S.Con.Res.', HRES: 'H.Res.', SRES: 'S.Res.',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function billLabel(billType: string, billNumber: string | number): string {
  const t = String(billType).toUpperCase();
  return `${BILL_PREFIX[t] ?? t} ${billNumber}`;
}

function measureKeyOf(row: HeldRow): string | null {
  const r = row.raw ?? {};
  if (row.source_type === 'committee_report') {
    const b = r.associatedBill as { congress?: unknown; type?: unknown; number?: unknown } | null | undefined;
    return b && b.type && b.number ? `${b.congress ?? r.congress}-${String(b.type).toUpperCase()}${b.number}` : null;
  }
  return r.billType && r.billNumber ? `${r.congress}-${String(r.billType).toUpperCase()}${r.billNumber}` : null;
}

function evidenceClassOf(row: HeldRow): LegislativeEvidenceClass {
  if (row.source_type === 'committee_report') return 'COMMITTEE_REPORT_LANGUAGE';
  const law = str(row.raw?.lawStatusAtIngestion);
  return row.source_type === 'enacted_law' && law === 'enacted' ? 'ENACTED_LAW' : 'LEGISLATIVE_ACTIVITY_NOT_LAW';
}

function toVersion(row: HeldRow, link: LegislativeVersion['agency_link']): LegislativeVersion {
  const r = row.raw ?? {};
  const isReport = row.source_type === 'committee_report';
  return {
    document_number: row.document_number,
    source_type: row.source_type,
    evidence_class: evidenceClassOf(row),
    version: isReport ? null : str(r.legislativeVersion),
    stage: isReport ? 'committee_report' : ((str(r.legislativeStage) as LegislativeStage) ?? 'other'),
    law_status: isReport ? 'not_applicable' : ((str(r.lawStatusAtIngestion) as LawStatusAtIngestion) ?? 'not_enacted'),
    source_date: row.publication_date ? String(row.publication_date).slice(0, 10) : null,
    source_url: row.source_url,
    ...(isReport ? { citation: str(r.citation), is_conference_report: r.isConferenceReport === true } : {}),
    agency_link: link,
  };
}

const byDateAsc = (a: LegislativeVersion, b: LegislativeVersion) =>
  (a.source_date ?? '9999').localeCompare(b.source_date ?? '9999') || a.document_number.localeCompare(b.document_number);

/**
 * Group held rows into measures for ONE department. Pure: no I/O.
 * A measure is included when any of its own rows resolves to the department;
 * its committee reports (incl. unresolved errata) come with it, marked inherited.
 */
export function groupLegislativeEvidence(rows: HeldRow[], department: string): {
  vehicles: LegislativeVehicle[];
  other_measures: LegislativeMeasure[];
} {
  const bills = rows.filter((r) => r.source_type !== 'committee_report');
  const linkedKeys = new Set(
    bills.filter((r) => r.canonical_agency === department).map(measureKeyOf).filter((k): k is string => !!k),
  );

  const measures = new Map<string, LegislativeMeasure>();
  for (const row of bills) {
    const key = measureKeyOf(row);
    if (!key || !linkedKeys.has(key)) continue;
    const r = row.raw ?? {};
    let m = measures.get(key);
    if (!m) {
      m = {
        measure_key: key,
        bill: billLabel(String(r.billType), String(r.billNumber)),
        congress: num(r.congress),
        chamber: str(r.chamber),
        title: str(r.billTitle),
        role: (str(r.measureRole) as MeasureRole) ?? 'unknown',
        fiscal_year: num(r.fiscalYear),
        amends_fiscal_year: num(r.amendsFiscalYear),
        most_advanced_stage: null,
        became_law: false,
        law_number: null,
        latest_action: { date: null, text: null },
        versions: [],
        committee_reports: [],
      };
      measures.set(key, m);
    }
    m.versions.push(toVersion(row, row.canonical_agency === department ? 'own_resolution' : 'inherited_from_associated_bill'));
    if (r.becameLaw === true) m.became_law = true;
    m.law_number = m.law_number ?? str(r.lawNumber);
    const actionDate = str(r.latestActionDate);
    if (actionDate && (!m.latest_action.date || actionDate > m.latest_action.date)) {
      m.latest_action = { date: actionDate, text: str(r.latestActionText) };
    }
    const stage = str(r.legislativeStage);
    if (stage && STAGE_ORDER[stage] && (!m.most_advanced_stage || STAGE_ORDER[stage] > STAGE_ORDER[m.most_advanced_stage])) {
      m.most_advanced_stage = stage as LegislativeStage;
    }
  }

  for (const row of rows) {
    if (row.source_type !== 'committee_report') continue;
    const key = measureKeyOf(row);
    const m = key ? measures.get(key) : undefined;
    if (!m) continue;
    m.committee_reports.push(toVersion(row, row.canonical_agency === department ? 'own_resolution' : 'inherited_from_associated_bill'));
  }

  const all = [...measures.values()];
  for (const m of all) { m.versions.sort(byDateAsc); m.committee_reports.sort(byDateAsc); }

  const byFy = new Map<number, LegislativeMeasure[]>();
  const other: LegislativeMeasure[] = [];
  for (const m of all) {
    if (m.role === 'authorization_vehicle' && m.fiscal_year) {
      byFy.set(m.fiscal_year, [...(byFy.get(m.fiscal_year) ?? []), m]);
    } else {
      other.push(m);
    }
  }

  const vehicles: LegislativeVehicle[] = [...byFy.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([fy, ms]) => {
      const law = ms.find((m) => m.became_law);
      const enactedText = law?.versions.find((v) => v.evidence_class === 'ENACTED_LAW' && v.stage === 'enacted')
        ?? law?.versions.find((v) => v.evidence_class === 'ENACTED_LAW');
      return {
        fiscal_year: fy,
        status: law ? 'enacted' : 'not_enacted',
        enacted_by: law ? { bill: law.bill, law_number: law.law_number, source_url: enactedText?.source_url ?? null } : null,
        measures: ms.sort((a, b) => a.bill.localeCompare(b.bill)),
      };
    });

  other.sort((a, b) => (b.latest_action.date ?? '').localeCompare(a.latest_action.date ?? ''));
  return { vehicles, other_measures: other };
}

/** Coverage from the control plane + the discovery cursor. Pure. */
export function legislativeCoverage(input: {
  instance: { last_poll: string | null; last_verified_ingest: string | null; last_source_advance: string | null } | null;
  notes: string | null;
  heldRowsTruncated: boolean;
  now?: string;
}): LegislativeCoverage {
  const cursor = decodeDiscoveryCursor(input.notes);
  const inst = input.instance;
  let status: LegislativeCoverage['status'] = 'unknown';
  if (inst?.last_poll && inst.last_verified_ingest) {
    status = Date.parse(inst.last_verified_ingest) >= Date.parse(inst.last_poll) ? 'complete' : 'partial';
  } else if (inst?.last_poll) {
    status = 'partial';
  }
  if (input.heldRowsTruncated) status = 'partial';
  const lastSource = inst?.last_source_advance ? String(inst.last_source_advance).slice(0, 10) : null;
  const freshness = classifyLegislationFreshness({
    clocks: inst?.last_poll ? { lastPoll: inst.last_poll, lastSourceAdvance: lastSource, lastIntelligenceChange: null } : null,
    now: input.now,
  }).status;
  return {
    status,
    scope: cursor
      ? `Measures titled "National Defense Authorization Act" in the ${cursor.congress}th Congress`
      : 'Measures titled "National Defense Authorization Act" (Congress not established)',
    congress: cursor?.congress ?? null,
    last_complete_discovery_at: cursor?.lastCompleteDiscoveryAt ?? null,
    last_poll: inst?.last_poll ?? null,
    last_source_advance: lastSource,
    freshness,
    held_rows_truncated: input.heldRowsTruncated,
  };
}

const TEXT_NOT_HELD =
  'Bill and committee-report TEXT is not held by Mindy — what any version provides, requires or directs is NOT_ESTABLISHED. Cite the version and link to its text.';
const SCOPE_ONLY_NDAA =
  'Only NDAA-titled measures are tracked. Other legislation, including appropriations, is NOT_ESTABLISHED — never report it as absent.';

export function hostRules(grain: AgencyLinkGrain | null, requested: string, linked: string | null, coverage: LegislativeCoverage | null): string[] {
  const rules = [
    'Only ENACTED_LAW is law. A reported or passed-chamber version is legislative activity, not law — say which chamber and stage.',
    'COMMITTEE_REPORT_LANGUAGE is report language, not statute. Errata are separate records.',
    'Name the bill and version for every statement (e.g. "the House-passed H.R. 8800"), never "the NDAA requires".',
    'Do not predict what Congress will do next; report the latest recorded action with its date.',
  ];
  if (grain === 'parent_department' && linked) {
    rules.push(`These measures are linked to ${linked}. Mindy does not attribute them to ${requested} specifically — say so.`);
  }
  if (coverage && coverage.status !== 'complete') {
    rules.push('Discovery coverage is not complete — absence of a measure or version is NOT_ESTABLISHED, not "does not exist".');
  }
  return rules;
}

// ── read ──────────────────────────────────────────────────────────────────────
function sb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Resolve the department the legislative corpus can speak for.
 * Order: the query itself (toptier) → its ESTABLISHED parent department → none.
 * An unresolved agency is not guessed onto a department.
 */
export function legislativeAgencyGrain(query: string, parentAgency: string | null | undefined): {
  department: string | null;
  grain: AgencyLinkGrain | null;
} {
  const direct = resolveAgency({ agencyName: query });
  if (direct.resolved && direct.canonicalAgency) return { department: direct.canonicalAgency, grain: 'department' };
  if (parentAgency) {
    const parent = resolveAgency({ agencyName: parentAgency });
    if (parent.resolved && parent.canonicalAgency) return { department: parent.canonicalAgency, grain: 'parent_department' };
  }
  return { department: null, grain: null };
}

export async function getLegislativeEvidenceForAgency(
  input: { query: string; parentAgency?: string | null },
  opts: { client?: SupabaseClient; now?: string } = {},
): Promise<LegislativeEvidence> {
  const requested = String(input.query ?? '').trim();
  const { department, grain } = legislativeAgencyGrain(requested, input.parentAgency);
  const base = { requested, linked_agency: department, grain, vehicles: [], other_measures: [] };

  if (!department) {
    return {
      ...base,
      status: 'not_established',
      coverage: null,
      not_established: [
        `"${requested}" is not linked to a department Mindy's legislative corpus is attributed to.`,
        TEXT_NOT_HELD,
      ],
      host_rules: hostRules(null, requested, null, null),
    };
  }

  const client = opts.client ?? sb();
  const [rowsRes, instRes, notesRes] = await Promise.all([
    client
      .from('institute_sources')
      .select('source_type,document_number,title,source_url,publication_date,canonical_agency,raw')
      .in('source_type', [...LEGISLATIVE_SOURCE_TYPES])
      .order('document_number', { ascending: true })
      .limit(HELD_ROW_CEILING),
    client
      .from('data_source_instances')
      .select('last_poll,last_verified_ingest,last_source_advance')
      .eq('source_key', SOURCE_KEY)
      .maybeSingle(),
    client.from('data_sources').select('notes').eq('key', SOURCE_KEY).maybeSingle(),
  ]);
  // The corpus read decides the answer; a failure is UNAVAILABLE, never "no legislation".
  if (rowsRes.error) throw new Error(`getLegislativeEvidenceForAgency: ${rowsRes.error.message}`);
  const rows = (rowsRes.data ?? []) as HeldRow[];
  // Clock reads only shape coverage; a failure there makes coverage UNKNOWN, not complete.
  const coverage = instRes.error || notesRes.error
    ? { ...legislativeCoverage({ instance: null, notes: null, heldRowsTruncated: rows.length >= HELD_ROW_CEILING, now: opts.now }), status: 'unknown' as const }
    : legislativeCoverage({
        instance: instRes.data as never,
        notes: (notesRes.data as { notes?: string | null } | null)?.notes ?? null,
        heldRowsTruncated: rows.length >= HELD_ROW_CEILING,
        now: opts.now,
      });

  const grouped = groupLegislativeEvidence(rows, department);
  const count = grouped.vehicles.length + grouped.other_measures.length;
  return {
    ...base,
    ...grouped,
    status: count > 0 ? 'grounded' : 'empty',
    coverage,
    not_established: [TEXT_NOT_HELD, SCOPE_ONLY_NDAA],
    host_rules: hostRules(grain, requested, department, coverage),
  };
}
