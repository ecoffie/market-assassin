/**
 * GSA Acquisition Gateway CSV reconciliation — identity, diff, accounting.
 *
 * Canonical identity: (source_agency, GW-L:<Listing ID>) with source_type
 * `gsa_gateway_csv`. API twins (bare listing ids / GSA-AG-*) are reported, never
 * mutated. Absence upstream is reported only — this planner never deletes.
 */
import {
  gatewayAgencyCode,
  gatewayExternalId,
  parseGatewayRow,
  type GatewayForecastRow,
} from './gateway-forecast';

export const GATEWAY_CSV_SOURCE_TYPE = 'gsa_gateway_csv' as const;

/** Agencies this importer may write. NSF/STATE are adjacent — not first packet. */
export const GATEWAY_CSV_AGENCIES = ['DOI', 'USDA', 'VA', 'DOT', 'GSA', 'DOL'] as const;
export type GatewayCsvAgency = (typeof GATEWAY_CSV_AGENCIES)[number];

export function isGatewayCsvAgency(v: string): v is GatewayCsvAgency {
  return (GATEWAY_CSV_AGENCIES as readonly string[]).includes(v);
}

/**
 * Fields the CSV owns. Diff + update payload MUST share this list.
 * Excluded: map_*, created_at, last_synced_at (Mindy clocks / enrichment).
 */
export const GATEWAY_CSV_SOURCE_OWNED_FIELDS = [
  'title',
  'description',
  'department',
  'bureau',
  'contracting_office',
  'naics_code',
  'estimated_value_min',
  'estimated_value_max',
  'estimated_value_range',
  'fiscal_year',
  'anticipated_quarter',
  'solicitation_date',
  'set_aside_type',
  'contract_type',
  'procurement_method',
  'incumbent_name',
  'poc_name',
  'poc_email',
  'pop_city',
  'pop_state',
  'status',
  'source_url',
] as const;

export type GatewayCsvSourceField = (typeof GATEWAY_CSV_SOURCE_OWNED_FIELDS)[number];

export type GatewayCsvRow = Partial<Record<GatewayCsvSourceField, unknown>> & {
  external_id: string;
  source_agency: GatewayCsvAgency;
  /** Upstream ChangedDate when present — provenance only, not Mindy freshness. */
  source_changed_at?: string | null;
  raw?: Record<string, string>;
};

export interface GatewayCsvReconcilePlan {
  agency: GatewayCsvAgency;
  upstreamTotal: number;
  usableUpstream: number;
  matchedExisting: number;
  toInsert: GatewayCsvRow[];
  toUpdate: Array<{
    externalId: string;
    patch: Partial<Record<GatewayCsvSourceField, unknown>>;
    changedFields: string[];
  }>;
  unchanged: number;
  /** Held CSV ids not in this packet — REPORT ONLY, never delete. */
  absentUpstream: string[];
  /** Same Listing ID also held as source_type=api (or similar) — REPORT ONLY. */
  twinApiOverlap: string[];
  duplicateSourceIds: string[];
  parseRejected: number;
  /** Off-agency rows filtered before planning (set by ingest from parse bundle). */
  wrongAgency: number;
  conflicts: Array<{ externalId: string; reason: string }>;
}

function cmp(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}

/** Pull Solicitation Link / ChangedDate from the raw export record. */
function gwRawField(rec: Record<string, string>, canonical: 'sourceUrl' | 'changedDate'): string | undefined {
  for (const [h, v] of Object.entries(rec)) {
    const key = h
      .toLowerCase()
      .replace(/^content:\s*/, '')
      .replace(/[^a-z0-9 ()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (canonical === 'sourceUrl' && key.includes('solicitation link')) {
      const s = String(v ?? '').trim();
      return s || undefined;
    }
    if (canonical === 'changedDate' && (key === 'changeddate' || key === 'changed date')) {
      const s = String(v ?? '').trim();
      return s || undefined;
    }
  }
  return undefined;
}

export function toGatewayCsvDbRow(
  parsed: GatewayForecastRow,
  agency: GatewayCsvAgency,
): GatewayCsvRow | null {
  const external_id = gatewayExternalId(parsed);
  if (!external_id.startsWith('GW-L:')) {
    // Content-hash fallback refused — Listing ID is the identity contract.
    return null;
  }
  const code = gatewayAgencyCode(parsed.agency);
  if (code !== agency) return null;

  return {
    external_id,
    source_agency: agency,
    title: parsed.title,
    description: parsed.description ?? null,
    department: parsed.agency ?? null,
    bureau: parsed.organization ?? null,
    contracting_office: gatewayOfficeFromRaw(parsed.raw) ?? null,
    naics_code: parsed.naicsCode ?? null,
    estimated_value_min: parsed.estimatedValueMin ?? null,
    estimated_value_max: parsed.estimatedValueMax ?? null,
    estimated_value_range: parsed.estimatedValueRange ?? null,
    fiscal_year: parsed.awardFy ?? null,
    anticipated_quarter: parsed.awardQuarter ?? null,
    solicitation_date: parsed.solicitationDate ?? null,
    set_aside_type: parsed.setAside ?? null,
    contract_type: parsed.contractType ?? null,
    procurement_method: parsed.procurementMethod ?? null,
    incumbent_name: parsed.incumbentName ?? null,
    poc_name: parsed.pocName ?? null,
    poc_email: parsed.pocEmail ?? null,
    pop_city: parsed.popCity ?? null,
    pop_state: parsed.popState ?? null,
    status: parsed.requirementStatus || 'forecasted',
    source_url: parsed.raw ? gwRawField(parsed.raw, 'sourceUrl') ?? null : null,
    source_changed_at: parsed.raw ? gwRawField(parsed.raw, 'changedDate') ?? null : null,
    raw: parsed.raw,
  };
}

/** Read Funding Office from raw headers (gwFieldFor → office). */
export function gatewayOfficeFromRaw(rec: Record<string, string> | undefined): string | null {
  if (!rec) return null;
  for (const [h, v] of Object.entries(rec)) {
    const key = h
      .toLowerCase()
      .replace(/^content:\s*/, '')
      .replace(/[^a-z0-9 ()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (key === 'funding office' || key === 'contracting office organization') {
      const s = String(v ?? '').replace(/\s+/g, ' ').trim();
      return s || null;
    }
  }
  return null;
}

export function enrichGatewayCsvRow(row: GatewayCsvRow): GatewayCsvRow {
  return {
    ...row,
    contracting_office: gatewayOfficeFromRaw(row.raw) ?? row.contracting_office ?? null,
  };
}

/**
 * Strip GW-L: and normalize for twin comparison against bare api external_ids.
 */
export function listingIdFromGatewayExternalId(externalId: string): string {
  return externalId.replace(/^GW-L:/i, '').toUpperCase();
}

export function planGatewayCsvReconciliation(opts: {
  agency: GatewayCsvAgency;
  /** Parsed upstream rows for THIS agency only (null = parse reject). */
  upstream: Array<GatewayCsvRow | null>;
  /** Held rows with source_type=gsa_gateway_csv AND source_agency=agency. */
  heldCsv: Map<string, Partial<Record<GatewayCsvSourceField, unknown>>>;
  /** Held api (or other) external_ids for the same agency — twin report only. */
  heldOtherIds?: Set<string>;
}): GatewayCsvReconcilePlan {
  const { agency, upstream, heldCsv, heldOtherIds } = opts;
  const seen = new Set<string>();
  const duplicateSourceIds: string[] = [];
  let parseRejected = 0;
  const toInsert: GatewayCsvRow[] = [];
  const toUpdate: GatewayCsvReconcilePlan['toUpdate'] = [];
  const conflicts: GatewayCsvReconcilePlan['conflicts'] = [];
  let unchanged = 0;
  let matchedExisting = 0;
  const matchedIds = new Set<string>();

  for (const row of upstream) {
    if (!row) {
      parseRejected++;
      continue;
    }
    if (!row.external_id?.startsWith('GW-L:') || row.source_agency !== agency) {
      conflicts.push({
        externalId: row.external_id || '(missing)',
        reason: 'refused_identity_or_agency',
      });
      parseRejected++;
      continue;
    }
    const id = row.external_id;
    if (seen.has(id)) {
      duplicateSourceIds.push(id);
      continue;
    }
    seen.add(id);

    const existing = heldCsv.get(id);
    if (!existing) {
      toInsert.push(row);
      continue;
    }

    matchedExisting++;
    matchedIds.add(id);

    const patch: Partial<Record<GatewayCsvSourceField, unknown>> = {};
    const changedFields: string[] = [];
    for (const f of GATEWAY_CSV_SOURCE_OWNED_FIELDS) {
      if (!(f in row)) continue;
      if (cmp(row[f]) !== cmp(existing[f])) {
        patch[f] = row[f];
        changedFields.push(f);
      }
    }
    if (changedFields.length) toUpdate.push({ externalId: id, patch, changedFields });
    else unchanged++;
  }

  const absentUpstream = [...heldCsv.keys()].filter((id) => !matchedIds.has(id));

  const twinApiOverlap: string[] = [];
  if (heldOtherIds?.size) {
    for (const id of seen) {
      const bare = listingIdFromGatewayExternalId(id);
      if (heldOtherIds.has(bare) || heldOtherIds.has(id) || heldOtherIds.has(`GSA-AG-${bare}`)) {
        twinApiOverlap.push(id);
      }
    }
  }

  return {
    agency,
    upstreamTotal: upstream.length,
    usableUpstream: seen.size,
    matchedExisting,
    toInsert,
    toUpdate,
    unchanged,
    absentUpstream,
    twinApiOverlap,
    duplicateSourceIds,
    parseRejected,
    wrongAgency: 0,
    conflicts,
  };
}

export interface GatewayCsvReconcileCheck {
  ok: boolean;
  problems: string[];
}

export function gatewayCsvPlanReconciles(p: GatewayCsvReconcilePlan): GatewayCsvReconcileCheck {
  const problems: string[] = [];
  const accounted = p.usableUpstream + p.duplicateSourceIds.length + p.parseRejected;
  if (accounted !== p.upstreamTotal) {
    problems.push(
      `upstream accounting: ${p.usableUpstream} usable + ${p.duplicateSourceIds.length} dup + ${p.parseRejected} rejected = ${accounted} != ${p.upstreamTotal}`,
    );
  }
  if (p.toInsert.length + p.matchedExisting !== p.usableUpstream) {
    problems.push(
      `membership: ${p.toInsert.length} new + ${p.matchedExisting} matched != ${p.usableUpstream} usable`,
    );
  }
  if (p.toUpdate.length + p.unchanged !== p.matchedExisting) {
    problems.push(
      `matched split: ${p.toUpdate.length} changed + ${p.unchanged} unchanged != ${p.matchedExisting} matched`,
    );
  }
  return { ok: problems.length === 0, problems };
}

export function gatewayCsvPlanIsSemanticallySane(
  p: GatewayCsvReconcilePlan,
  heldCsvTotal: number,
): GatewayCsvReconcileCheck {
  const problems: string[] = [];
  if (heldCsvTotal > 0 && p.matchedExisting === 0 && p.usableUpstream > 0) {
    problems.push('matchedExisting = 0 against a non-empty CSV corpus — identity contract failed');
  }
  if (heldCsvTotal > 0 && p.toInsert.length === p.usableUpstream && p.usableUpstream > 0) {
    problems.push('every upstream row is NEW — identity contract failed');
  }
  if (heldCsvTotal > 0 && p.absentUpstream.length === heldCsvTotal && p.usableUpstream > 0) {
    problems.push('every held CSV row is absent upstream — identity contract failed');
  }
  return { ok: problems.length === 0, problems };
}

export interface GatewayCsvParseBundle {
  /** Rows for the selected agency (null = parse/identity reject). */
  upstream: Array<GatewayCsvRow | null>;
  wrongAgency: number;
  otherAgencySamples: string[];
}

/**
 * Parse raw CSV records for a forced `--agency` filter.
 * Off-agency rows are counted then omitted from `upstream` so accounting stays clean.
 */
export function parseGatewayCsvRecordsForAgency(
  records: Record<string, string>[],
  agency: GatewayCsvAgency,
): GatewayCsvParseBundle {
  const upstream: Array<GatewayCsvRow | null> = [];
  let wrongAgency = 0;
  const otherAgencySamples: string[] = [];
  for (const rec of records) {
    const parsed = parseGatewayRow(rec);
    if (!parsed) {
      upstream.push(null);
      continue;
    }
    parsed.raw = rec;
    const code = gatewayAgencyCode(parsed.agency);
    if (code !== agency) {
      wrongAgency++;
      if (otherAgencySamples.length < 5) {
        otherAgencySamples.push(`${code}: ${(parsed.title || '').slice(0, 40)}`);
      }
      continue;
    }
    const row = toGatewayCsvDbRow(parsed, agency);
    upstream.push(row ? enrichGatewayCsvRow(row) : null);
  }
  return { upstream, wrongAgency, otherAgencySamples };
}
