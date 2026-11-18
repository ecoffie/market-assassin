/**
 * Gateway CSV ingest — dry-run by default; apply only when explicitly authorized.
 *
 * NEVER deletes. NEVER touches source_type != gsa_gateway_csv. NEVER --replace.
 * Scoped to exactly one --agency per run.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertGatewayHeaders } from './gateway-forecast';
import {
  GATEWAY_CSV_SOURCE_OWNED_FIELDS,
  GATEWAY_CSV_SOURCE_TYPE,
  gatewayCsvPlanIsSemanticallySane,
  gatewayCsvPlanReconciles,
  isGatewayCsvAgency,
  parseGatewayCsvRecordsForAgency,
  planGatewayCsvReconciliation,
  type GatewayCsvAgency,
  type GatewayCsvReconcilePlan,
  type GatewayCsvRow,
  type GatewayCsvSourceField,
} from './gateway-csv-reconcile';

/** Minimal RFC4180 reader — Gateway descriptions contain commas and newlines. */
export function parseGatewayCsvText(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    out.push(row);
  }
  const headers = out.shift() ?? [];
  const rows = out
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { headers, rows };
}

export interface GatewayPacketFile {
  file: string;
  sha256: string;
  mtime: string;
  rows: Record<string, string>[];
}

export function loadGatewayPacketDir(dir: string): {
  files: GatewayPacketFile[];
  hardFail: boolean;
  missingHeaders: string[];
} {
  const names = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .sort();
  const files: GatewayPacketFile[] = [];
  let hardFail = false;
  const missingHeaders: string[] = [];
  for (const f of names) {
    const path = join(dir, f);
    const raw = readFileSync(path);
    const { headers, rows } = parseGatewayCsvText(raw.toString('utf8'));
    const check = assertGatewayHeaders(headers);
    if (!check.ok) {
      hardFail = true;
      missingHeaders.push(...check.missing.map((m) => `${f}:${m}`));
    }
    files.push({
      file: f,
      sha256: createHash('sha256').update(raw).digest('hex'),
      mtime: statSync(path).mtime.toISOString(),
      rows,
    });
  }
  return { files, hardFail, missingHeaders };
}

export interface GatewayCsvIngestResult {
  ok: boolean;
  failure?: string;
  agency: GatewayCsvAgency;
  applied: boolean;
  packetFiles: number;
  packetRows: number;
  wrongAgency: number;
  plan: GatewayCsvReconcilePlan | null;
  beforeCsvCount: number | null;
  afterCsvCount: number | null;
  insertAttempted: number;
  inserted: number;
  updateAttempted: number;
  updated: number;
  /** Provenance echo for dry-run / apply reports. */
  packetSha256: string[];
}

async function loadHeldCsv(
  sb: SupabaseClient,
  agency: GatewayCsvAgency,
): Promise<Map<string, Partial<Record<GatewayCsvSourceField, unknown>>>> {
  const map = new Map<string, Partial<Record<GatewayCsvSourceField, unknown>>>();
  const select = ['external_id', ...GATEWAY_CSV_SOURCE_OWNED_FIELDS].join(',');
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('agency_forecasts')
      .select(select)
      .eq('source_agency', agency)
      .eq('source_type', GATEWAY_CSV_SOURCE_TYPE)
      .order('external_id')
      .range(from, from + 999);
    if (error) throw new Error(`held_csv_read: ${error.message}`);
    if (!data?.length) break;
    for (const r of data as unknown as Array<Record<string, unknown>>) {
      map.set(String(r.external_id), r as Partial<Record<GatewayCsvSourceField, unknown>>);
    }
    if (data.length < 1000) break;
  }
  return map;
}

async function loadHeldOtherIds(sb: SupabaseClient, agency: GatewayCsvAgency): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('agency_forecasts')
      .select('external_id,source_type')
      .eq('source_agency', agency)
      .neq('source_type', GATEWAY_CSV_SOURCE_TYPE)
      .order('external_id')
      .range(from, from + 999);
    if (error) throw new Error(`held_other_read: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) ids.add(String(r.external_id));
    if (data.length < 1000) break;
  }
  return ids;
}

async function countCsv(sb: SupabaseClient, agency: GatewayCsvAgency): Promise<number | null> {
  const { count, error } = await sb
    .from('agency_forecasts')
    .select('id', { count: 'exact', head: true })
    .eq('source_agency', agency)
    .eq('source_type', GATEWAY_CSV_SOURCE_TYPE);
  if (error) return null;
  return count;
}

function rowToInsertPayload(
  row: GatewayCsvRow,
  packetMeta: { sha256: string[]; files: string[] },
  now: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    source_agency: row.source_agency,
    source_type: GATEWAY_CSV_SOURCE_TYPE,
    external_id: row.external_id,
    last_synced_at: now,
  };
  for (const f of GATEWAY_CSV_SOURCE_OWNED_FIELDS) {
    if (f in row) payload[f] = row[f] ?? null;
  }
  payload.raw_data = {
    gateway_packet_sha256: packetMeta.sha256,
    gateway_packet_files: packetMeta.files,
    source_changed_at: row.source_changed_at ?? null,
    source_row: row.raw ?? null,
  };
  return payload;
}

/**
 * Plan (and optionally apply) a one-agency Gateway CSV refresh.
 * `apply` defaults false. Callers must gate CLI apply behind `--i-authorize-apply`.
 */
export async function runGatewayCsvIngest(
  sb: SupabaseClient,
  opts: {
    agency: string;
    dir: string;
    apply?: boolean;
  },
): Promise<GatewayCsvIngestResult> {
  const apply = opts.apply === true;
  if (!isGatewayCsvAgency(opts.agency)) {
    return {
      ok: false,
      failure: `agency_not_allowed:${opts.agency}`,
      agency: opts.agency as GatewayCsvAgency,
      applied: false,
      packetFiles: 0,
      packetRows: 0,
      wrongAgency: 0,
      plan: null,
      beforeCsvCount: null,
      afterCsvCount: null,
      insertAttempted: 0,
      inserted: 0,
      updateAttempted: 0,
      updated: 0,
      packetSha256: [],
    };
  }
  const agency = opts.agency;

  const packet = loadGatewayPacketDir(opts.dir);
  if (!packet.files.length) {
    return {
      ok: false,
      failure: 'no_csv_in_dir',
      agency,
      applied: false,
      packetFiles: 0,
      packetRows: 0,
      wrongAgency: 0,
      plan: null,
      beforeCsvCount: null,
      afterCsvCount: null,
      insertAttempted: 0,
      inserted: 0,
      updateAttempted: 0,
      updated: 0,
      packetSha256: [],
    };
  }
  if (packet.hardFail) {
    return {
      ok: false,
      failure: `header_drift:${packet.missingHeaders.join(',')}`,
      agency,
      applied: false,
      packetFiles: packet.files.length,
      packetRows: packet.files.reduce((n, f) => n + f.rows.length, 0),
      wrongAgency: 0,
      plan: null,
      beforeCsvCount: null,
      afterCsvCount: null,
      insertAttempted: 0,
      inserted: 0,
      updateAttempted: 0,
      updated: 0,
      packetSha256: packet.files.map((f) => f.sha256),
    };
  }

  // Richest copy per Listing ID across slices (same rule as oracle-forecasts).
  const best = new Map<string, Record<string, string>>();
  const richness = (r: Record<string, string>) =>
    Object.values(r).filter((v) => String(v ?? '').trim()).length;
  for (const f of packet.files) {
    for (const rec of f.rows) {
      const lid = Object.entries(rec).find(([h]) =>
        h.toLowerCase().replace(/^content:\s*/, '').trim() === 'listing id',
      )?.[1];
      if (!lid?.trim()) continue;
      const k = lid.trim().replace(/_/g, '-').toUpperCase();
      const prev = best.get(k);
      if (!prev || richness(rec) > richness(prev)) best.set(k, rec);
    }
  }
  const records = [...best.values()];
  const parsed = parseGatewayCsvRecordsForAgency(records, agency);

  let heldCsv: Map<string, Partial<Record<GatewayCsvSourceField, unknown>>>;
  let heldOther: Set<string>;
  try {
    heldCsv = await loadHeldCsv(sb, agency);
    heldOther = await loadHeldOtherIds(sb, agency);
  } catch (e) {
    return {
      ok: false,
      failure: (e as Error).message,
      agency,
      applied: false,
      packetFiles: packet.files.length,
      packetRows: records.length,
      wrongAgency: parsed.wrongAgency,
      plan: null,
      beforeCsvCount: null,
      afterCsvCount: null,
      insertAttempted: 0,
      inserted: 0,
      updateAttempted: 0,
      updated: 0,
      packetSha256: packet.files.map((f) => f.sha256),
    };
  }

  const beforeCsvCount = await countCsv(sb, agency);
  const plan = planGatewayCsvReconciliation({
    agency,
    upstream: parsed.upstream,
    heldCsv,
    heldOtherIds: heldOther,
  });
  plan.wrongAgency = parsed.wrongAgency;

  const acct = gatewayCsvPlanReconciles(plan);
  if (!acct.ok) {
    return {
      ok: false,
      failure: `accounting:${acct.problems.join(';')}`,
      agency,
      applied: false,
      packetFiles: packet.files.length,
      packetRows: records.length,
      wrongAgency: parsed.wrongAgency,
      plan,
      beforeCsvCount,
      afterCsvCount: beforeCsvCount,
      insertAttempted: 0,
      inserted: 0,
      updateAttempted: 0,
      updated: 0,
      packetSha256: packet.files.map((f) => f.sha256),
    };
  }
  const sane = gatewayCsvPlanIsSemanticallySane(plan, heldCsv.size);
  if (!sane.ok) {
    return {
      ok: false,
      failure: `semantic:${sane.problems.join(';')}`,
      agency,
      applied: false,
      packetFiles: packet.files.length,
      packetRows: records.length,
      wrongAgency: parsed.wrongAgency,
      plan,
      beforeCsvCount,
      afterCsvCount: beforeCsvCount,
      insertAttempted: 0,
      inserted: 0,
      updateAttempted: 0,
      updated: 0,
      packetSha256: packet.files.map((f) => f.sha256),
    };
  }

  const result: GatewayCsvIngestResult = {
    ok: true,
    agency,
    applied: false,
    packetFiles: packet.files.length,
    packetRows: records.length,
    wrongAgency: parsed.wrongAgency,
    plan,
    beforeCsvCount,
    afterCsvCount: beforeCsvCount,
    insertAttempted: 0,
    inserted: 0,
    updateAttempted: 0,
    updated: 0,
    packetSha256: packet.files.map((f) => f.sha256),
  };

  if (!apply) return result;

  // ── APPLY (explicit only) — upsert CSV rows; never delete. ──
  const now = new Date().toISOString();
  const meta = {
    sha256: packet.files.map((f) => f.sha256),
    files: packet.files.map((f) => f.file),
  };
  result.applied = true;
  result.insertAttempted = plan.toInsert.length;
  for (let i = 0; i < plan.toInsert.length; i += 200) {
    const batch = plan.toInsert
      .slice(i, i + 200)
      .map((r) => rowToInsertPayload(r, meta, now));
    const { count, error } = await sb
      .from('agency_forecasts')
      .upsert(batch, { onConflict: 'source_agency,external_id', count: 'exact' });
    if (error) {
      result.ok = false;
      result.failure = `insert:${error.message}`;
      break;
    }
    result.inserted += count ?? batch.length;
  }

  result.updateAttempted = plan.toUpdate.length;
  for (const u of plan.toUpdate) {
    const { count, error } = await sb
      .from('agency_forecasts')
      .update(
        {
          ...u.patch,
          last_synced_at: now,
          raw_data: {
            gateway_packet_sha256: meta.sha256,
            gateway_packet_files: meta.files,
            updated_fields: u.changedFields,
          },
        },
        { count: 'exact' },
      )
      .eq('source_agency', agency)
      .eq('source_type', GATEWAY_CSV_SOURCE_TYPE)
      .eq('external_id', u.externalId);
    if (error) {
      result.ok = false;
      result.failure = `update:${error.message}`;
      break;
    }
    result.updated += count ?? 0;
  }

  result.afterCsvCount = await countCsv(sb, agency);
  return result;
}

/** Pure plan helper for unit tests (no DB). */
export function planFromRecords(
  agency: GatewayCsvAgency,
  records: Record<string, string>[],
  heldCsv: Map<string, Partial<Record<GatewayCsvSourceField, unknown>>>,
  heldOtherIds?: Set<string>,
): { plan: GatewayCsvReconcilePlan; wrongAgency: number } {
  const parsed = parseGatewayCsvRecordsForAgency(records, agency);
  const plan = planGatewayCsvReconciliation({
    agency,
    upstream: parsed.upstream,
    heldCsv,
    heldOtherIds,
  });
  plan.wrongAgency = parsed.wrongAgency;
  return { plan, wrongAgency: parsed.wrongAgency };
}
