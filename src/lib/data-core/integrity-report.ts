/**
 * DATA CORE INTEGRITY — the single reader that wires C1-C5 into one surface.
 *
 * Phase 3 (wiring only — no sixth control). C1, C4 and C5 were libraries with no
 * durable caller; C2 and C3 already ran as scripts. This module gives all five one
 * operational surface under /api/admin/platform-health.
 *
 * THE RULE THIS MODULE EXISTS TO OBEY:
 *   Platform Health RENDERS the controls. It must never become a second source of
 *   truth. Every value below is computed by a control or read from a control's
 *   machine-readable output — there are NO hand-entered counts, statuses, dates or
 *   labels anywhere in this file.
 *
 * Which is why C2 and C3 are SHELLED OUT TO rather than reimplemented: duplicating
 * their logic in TypeScript would create exactly the second source of truth the
 * rule forbids, and the two copies would drift (that drift is census class 5).
 */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import {
  classifyAdvancement, ADVANCEMENT_ORACLES, type AdvancementResult,
} from './advancement';
import {
  classifyProducer, LINEAGE_CLAIMS, type ProducerResult,
} from './producer-lineage';
import { measureCoverage, describeCoverage, type CoverageResult } from './coverage';
import { CONTRACTOR_STORES } from './contractor-corpus';
import {
  classifyFreshness, resolveAwardsIngestClocks, type AwardsFreshness,
} from '@/lib/awards-ingest';

/** Every surfaced status carries the evidence that produced it. */
export interface EvidencedStatus {
  key: string;
  status: string;
  /** Human-readable evidence. Must not assert more than the control knows. */
  evidence: string;
  control: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  measuredAt?: string | null;
}

export interface DataCoreIntegrity {
  advancement: {
    results: Array<AdvancementResult & { evidence: string; control: 'C1' }>;
    unmeasured: number;
  };
  producer: Array<ProducerResult & { evidence: string; control: 'C4' }>;
  coverage: Array<CoverageResult & { key: string; evidence: string; control: 'C5' }>;
  claims: {
    contradicted: Array<{ file: string; line: number; detail: string }>;
    unfalsifiable: number;
    total: number;
    state: 'measured' | 'unmeasured';
  };
  registry: {
    aligned: number; partially_aligned: number; contradictory: number;
    unregistered: number; unmeasured: number;
    contradictions: Array<{ key: string; detail: string }>;
    supabaseReadable: boolean;
    state: 'measured' | 'unmeasured';
  };
  /**
   * NOT a score. A plain statement of whether anything is unverified, so the UI
   * can refuse to paint an all-clear while a control could not measure.
   */
  anyUnmeasured: boolean;
  note: string;
}

/** Reads a control's --json output. A control that cannot run reports unmeasured. */
function readControlJson(script: string): unknown | null {
  try {
    // Concatenate the folder name. Turbopack traces join(cwd, 'scripts', x) as
    // a module import of ./ROOT/scripts and fails the production build.
    const scriptPath = process.cwd() + '/' + 'scr' + 'ipts' + '/' + script;
    const out = execFileSync('node', [scriptPath, '--json'], {
      encoding: 'utf8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch {
    // Non-zero exit is normal for C2 when it blocks; it still prints JSON first.
    return null;
  }
}

function readControlJsonTolerant(script: string): unknown | null {
  try {
    return readControlJson(script);
  } catch { return null; }
}

/** C1: read each oracle's own watermark from the live table. */
async function runAdvancement(): Promise<DataCoreIntegrity['advancement']> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const results: Array<AdvancementResult & { evidence: string; control: 'C1' }> = [];

  for (const oracle of ADVANCEMENT_ORACLES) {
    let observed: string | null = null;
    let lastBuilt: string | null = null;
    if (url && key) {
      try {
        const sb = createClient(url, key);
        const { data, error } = await sb
          .from(oracle.table)
          .select(oracle.column)
          .order(oracle.column, { ascending: false })
          .limit(1)
          .maybeSingle();
        // An error means we could not measure — NOT that the data is stale.
        // Narrow through `unknown`: PostgREST's row type can be an error shape, and
        // a blind cast here would be the swallowed-error pattern the gates exist to
        // catch. A non-string value stays null -> classifyAdvancement reports
        // `unmeasured`, which is the honest outcome.
        if (!error && data) {
          const row = data as unknown as Record<string, unknown>;
          const value = row[oracle.column];
          observed = typeof value === 'string' ? value : null;
        }
        const { data: ds } = await sb
          .from('data_sources').select('last_built').eq('key', oracle.key).maybeSingle();
        lastBuilt = (ds as { last_built?: string } | null)?.last_built ?? null;
      } catch { observed = null; }
    }
    const r = classifyAdvancement({ oracle, observed, lastBuilt });
    results.push({
      ...r,
      control: 'C1',
      // Evidence names the watermark that produced the classification.
      evidence: `${oracle.table}.${oracle.column} — ${r.detail}`,
    });
  }

  // BigQuery awards reuses the EXISTING clock reference rather than a new oracle.
  try {
    const sb = url && key ? createClient(url, key) : null;
    const { data } = sb
      ? await sb.from('data_sources').select('notes,last_built').eq('key', 'bq_awards').maybeSingle()
      : { data: null };
    const row = data as { notes?: string; last_built?: string } | null;
    const freshness: AwardsFreshness = classifyFreshness({
      clocks: resolveAwardsIngestClocks({ notes: row?.notes, lastBuilt: row?.last_built }),
    });
    const map: Record<AwardsFreshness['status'], AdvancementResult['status']> = {
      healthy: 'healthy', upstream_stale: 'upstream_stale',
      ingest_broken: 'ingest_broken', unmeasured: 'unmeasured',
    };
    results.push({
      key: 'bq_awards',
      status: map[freshness.status],
      dataAgeDays: freshness.sourceAgeDays ?? null,
      stampAgeDays: freshness.runAgeDays ?? null,
      stampAheadDays: null,
      stampAhead: false,
      detail: `awards ingest clocks: source ${freshness.sourceAgeDays ?? '?'}d, run ${freshness.runAgeDays ?? '?'}d`,
      control: 'C1',
      evidence:
        `BigQuery usaspending.awards via data_sources.bq_awards [awards-ingest-clocks:v1] — `
        + `source age ${freshness.sourceAgeDays ?? 'unknown'}d, run age ${freshness.runAgeDays ?? 'unknown'}d`,
    });
  } catch { /* leave bq_awards absent rather than guess a status */ }

  return { results, unmeasured: results.filter((r) => r.status === 'unmeasured').length };
}

/** C4: classify the three lineage claims whose canonical role is established. */
function runProducer(): DataCoreIntegrity['producer'] {
  return LINEAGE_CLAIMS.map((claim) => {
    const r = classifyProducer(claim);
    return { ...r, control: 'C4' as const, evidence: r.detail };
  });
}

/**
 * C5: the coverage measurements whose denominators are established by the P0
 * decisions. Every figure is measured here, never transcribed.
 */
function runCoverage(): DataCoreIntegrity['coverage'] {
  const out: DataCoreIntegrity['coverage'] = [];
  const push = (key: string, r: CoverageResult) =>
    out.push({ ...r, key, control: 'C5', evidence: describeCoverage(r) });

  // Contractor population — the canonical store; measured from the overlay-free source.
  const canonical = CONTRACTOR_STORES.find((s) => s.id === 'recipients_rollup_merged');
  push('contractor_population', measureCoverage({
    kind: 'population',
    storeId: 'recipients_rollup_merged',
    covered: null, denominator: null,
    basis: canonical?.census ?? 'canonical contractor population (BigQuery)',
    sourceUnavailable: true, // not queried from this route — unavailable, NOT 0
  }));

  // Contact enrichment — measured from the overlay artifact itself.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rows = require('@/data/contractors.json') as Array<Record<string, string>>;
    const withEmail = rows.filter((r) => (r.email || '').trim()).length;
    push('contact_enrichment', measureCoverage({
      kind: 'enrichment', storeId: 'contractors.json',
      covered: withEmail, denominator: rows.length,
      basis: 'email present in the curated overlay (contractors.json)',
    }));
  } catch {
    push('contact_enrichment', measureCoverage({
      kind: 'enrichment', storeId: 'contractors.json',
      covered: null, denominator: null, basis: 'curated overlay', sourceUnavailable: true,
    }));
  }

  // Editorial labels — measured from the editorial file, denominator from the agency set.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sat = require('@/data/agency-sat-friendliness.json') as { agencies: Record<string, unknown> };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pain = require('@/data/agency-pain-points.json') as { agencies: Record<string, unknown> };
    push('sat_editorial_labels', measureCoverage({
      kind: 'editorial',
      covered: Object.keys(sat.agencies).length,
      denominator: Object.keys(pain.agencies).length,
      basis: 'agencies carrying a hand-authored SAT label, over agencies in the pain-points set',
    }));
  } catch {
    push('sat_editorial_labels', measureCoverage({
      kind: 'editorial', covered: null, denominator: null,
      basis: 'editorial SAT labels', sourceUnavailable: true,
    }));
  }

  return out;
}

/** C2: consume the gate's own JSON. Never reimplement its classification. */
function runClaims(): DataCoreIntegrity['claims'] {
  const json = readControlJsonTolerant('audit-data-claims.mjs') as
    | { findings?: Array<{ file: string; line: number; kind: string; detail: string }> } | null;
  if (!json?.findings) {
    return { contradicted: [], unfalsifiable: 0, total: 0, state: 'unmeasured' };
  }
  return {
    contradicted: json.findings.filter((f) => f.kind === 'contradicted')
      .map((f) => ({ file: f.file, line: f.line, detail: f.detail })),
    unfalsifiable: json.findings.filter((f) => f.kind === 'unfalsifiable').length,
    total: json.findings.length,
    state: 'measured',
  };
}

/** C3: consume the report's own JSON. Never reimplement its reconciliation. */
function runRegistry(): DataCoreIntegrity['registry'] {
  const json = readControlJsonTolerant('registry-reconciliation.mjs') as
    | { supabaseReadable?: boolean; rows?: Array<{ key: string; status: string; contradiction: string | null }> }
    | null;
  const empty = {
    aligned: 0, partially_aligned: 0, contradictory: 0, unregistered: 0, unmeasured: 0,
    contradictions: [], supabaseReadable: false, state: 'unmeasured' as const,
  };
  if (!json?.rows) return empty;
  const tally = { aligned: 0, partially_aligned: 0, contradictory: 0, unregistered: 0, unmeasured: 0 };
  for (const r of json.rows) {
    if (r.status in tally) tally[r.status as keyof typeof tally] += 1;
  }
  return {
    ...tally,
    contradictions: json.rows.filter((r) => r.contradiction)
      .map((r) => ({ key: r.key, detail: r.contradiction as string })),
    supabaseReadable: json.supabaseReadable ?? false,
    state: 'measured',
  };
}

export async function getDataCoreIntegrity(): Promise<DataCoreIntegrity> {
  const [advancement, producer, coverage, claims, registry] = [
    await runAdvancement(), runProducer(), runCoverage(), runClaims(), runRegistry(),
  ];

  const anyUnmeasured =
    advancement.unmeasured > 0
    || producer.some((p) => p.status === 'producer_unmeasured')
    || coverage.some((c) => c.state === 'unmeasured' || c.state === 'unavailable')
    || claims.state === 'unmeasured'
    || registry.state === 'unmeasured'
    || !registry.supabaseReadable;

  return {
    advancement, producer, coverage, claims, registry, anyUnmeasured,
    note:
      'Rendered from controls C1-C5; no value here is hand-entered. NOT a score. '
      + 'anyUnmeasured=true means at least one control could not measure — an all-clear '
      + 'must not be shown. unmeasured is never stale, manual is never broken, missing is '
      + 'never stale, uncovered is never 0%.',
  };
}
