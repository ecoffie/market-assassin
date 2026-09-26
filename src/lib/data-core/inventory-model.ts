/**
 * DATA CORE INVENTORY MODEL — the pure half of /admin/data-inventory.
 *
 * The route measures; this file decides what the measurements MEAN. It is pure (no
 * I/O) so every semantic rule below is unit-tested against fixtures rather than
 * trusted.
 *
 * WHY IT EXISTS (audit: tasks/data-inventory-audit-2026-09-26.md). The previous page
 * had real live counts and exact arithmetic, and was still wrong:
 *   - the 203,761 "semantic-indexed" rows were rows OF the SAM corpus, added a second
 *     time to the headline — and 55,328 of them were empty-array "nothing to embed"
 *     sentinels, not vectors at all;
 *   - 38,064 recompete rows the product never serves were counted as recompetes;
 *   - 82,017 vendor POCs were counted as "decision makers";
 *   - 445 GovInfo GAO testimonies dated 1993-2000 — WITHHELD from customers — were
 *     labelled exclusive current GAO intelligence;
 *   - "46 distinct sources" counted label strings (SAM.gov appeared six times, OpenAI
 *     twice), and IG / CRS / NDAA were listed as if they were living feeds.
 *
 * THE CONTRACT. Every dataset declares ONE kind, and the kind decides what it may do:
 *
 *   source_corpus        — records we hold that came from an upstream. The ONLY kind
 *                          that enters the source-record totals.
 *   derived_intelligence — records we built from other records (contacts extracted
 *                          from notices, claims derived from GAO reports, decoded
 *                          offices). Real, but not additional underlying records.
 *   derived_index        — a representation of records we already count (vectors,
 *                          chunks). NEVER a record count.
 *   static_manual        — hand-authored / file-bundled. No producer, no clock.
 *   passthrough          — fetched live, not persisted. NEVER a record count.
 */

export type DatasetKind =
  | 'source_corpus'
  | 'derived_intelligence'
  | 'derived_index'
  | 'static_manual'
  | 'passthrough';

export type FreshnessState =
  | 'CURRENT'
  | 'STALE'
  | 'UNREACHABLE'
  | 'STATIC'
  | 'MANUAL'
  | 'PASSTHROUGH'
  | 'UNKNOWN';

export type SurfaceState = 'customer_readable' | 'internal_only' | 'withheld' | 'passthrough';

export interface CountPart {
  label: string;
  count: number | null;
  note?: string;
}

export interface ScheduledRun {
  at: string;
  status: string | null;
  httpStatus: number | null;
}

/**
 * Whether a scheduled collector has demonstrated it recurs on its own.
 * A manual refresh proves the code works; it does not prove the SCHEDULE works.
 */
export type RecurrenceState =
  | 'proven'                 // a scheduled run after the last manual refresh returned 2xx
  | 'ran_status_unrecorded'  // a scheduled run after it reported success but no HTTP status (#1593)
  | 'no_terminal_status'     // the latest run was dispatched and never recorded an outcome
  | 'not_yet_reproven'       // no scheduled run since the last manual refresh
  | 'failed'                 // the latest scheduled run failed
  | 'disabled'               // the cron row exists but is disabled
  | 'unscheduled'            // no cron_jobs row at all
  | 'unknown';

/** cron_job_runs statuses that mean "sent, outcome never written" — not a failure. */
const NON_TERMINAL = new Set(['dispatched', 'running', 'started', 'pending']);

export interface ScheduleTruth {
  job: string;
  cron: string | null;
  enabled: boolean | null;
  lastScheduledRun: ScheduledRun | null;
  /** A control-plane poll with no scheduled run at that time — i.e. a manual refresh. */
  lastManualRefresh: string | null;
  nextScheduled: string | null;
  recurrence: RecurrenceState;
}

export interface InstanceFreshness {
  sourceKey: string;
  state: FreshnessState;
  sourceState: string | null;
  interventionState: string | null;
  heldPopulation: number | null;
  lastDataAdvance: string | null;
}

export interface Freshness {
  state: FreshnessState;
  /** The data's own clock (last advance / last sync / file date). null = unknown. */
  asOf: string | null;
  /** Which clock `asOf` and `state` were read from — never implied. */
  basis: string;
  detail?: string;
  schedules?: ScheduleTruth[];
  instances?: InstanceFreshness[];
}

export interface CustomerSurface {
  state: SurfaceState;
  /** MCP tool names. Guarded against the live tool registry by a unit test. */
  tools: string[];
  /** In-app surfaces that are not MCP tools. */
  app?: string[];
  note?: string;
}

/**
 * A reference to a source that appears only as PROSE inside curated claims (e.g.
 * "per a GAO report…" in a hand-written pain point). `livingRecords` is how many
 * source documents of that type Mindy actually holds — 0 means the attribution is
 * not backed by any held document.
 */
export interface ProseAttribution {
  label: string;
  claims: number;
  livingRecords: number | null;
}

export interface InventoryDataset {
  key: string;
  label: string;
  kind: DatasetKind;
  /** Rows physically held. null = unmeasured (never a guessed 0). Passthrough is always null. */
  stored: number | null;
  /**
   * What ONE row is. 'transaction' (e.g. the USASpending award warehouse, one row per
   * award modification) is not semantically comparable to a notice, a forecast or a
   * report, so it is totalled SEPARATELY from owned source records. Default 'record'.
   */
  grain?: 'record' | 'transaction';
  unit: string;
  /** Rows a customer surface can actually read, when that differs from `stored`. */
  served?: { count: number | null; label: string; excluded: CountPart[] };
  breakdown?: CountPart[];
  /**
   * What this dataset adds to the persisted-source totals. Only a
   * source_corpus may be non-zero (enforced by computeTotals). null = unmeasured.
   */
  headlineContribution: number | null;
  headlineNote?: string;
  freshness: Freshness;
  surface: CustomerSurface;
  /** Upstream publisher ids (keys of UPSTREAM_PUBLISHERS). Empty for internal corpora. */
  upstreams: string[];
  provenance: string;
  proseAttributions?: ProseAttribution[];
  note?: string;
}

// ── Upstream publishers ────────────────────────────────────────────────────────
//
// A "source" is an UPSTREAM PUBLISHER / AUTHORITATIVE FEED — the organisation whose
// data we persist. It is NOT a label, a processing step (DoDAAC decode), a tool
// (OpenAI embeddings), or a second name for the same publisher. SAM opportunities,
// SOW text, descriptions, special notices and notice POCs are ONE publisher.
//
// Forecast issuers are added at request time from the measured `source_agency`
// values (see countUpstreamPublishers); they are publishers in their own right.
export const UPSTREAM_PUBLISHERS: Record<string, { name: string; kind: 'external' | 'internal' }> = {
  sam_gov: { name: 'SAM.gov (GSA IAE) — opportunities, notices, POCs, entities', kind: 'external' },
  usaspending: { name: 'USASpending.gov (Treasury) — awards, recipients', kind: 'external' },
  gao: { name: 'U.S. GAO — reports RSS', kind: 'external' },
  govinfo: { name: 'GovInfo (GPO) — historical GAO collection', kind: 'external' },
  congress_gov: { name: 'Congress.gov (Library of Congress) — bills, laws, committee reports', kind: 'external' },
  dla_dibbs: { name: 'DLA DIBBS', kind: 'external' },
  grants_gov: { name: 'Grants.gov', kind: 'external' },
  nih_reporter: { name: 'NIH RePORTER', kind: 'external' },
  darpa: { name: 'DARPA BAA', kind: 'external' },
  nsf_sbir: { name: 'NSF SBIR/STTR', kind: 'external' },
  sbir_gov: { name: 'SBIR.gov (SBA) — DoD topics', kind: 'external' },
  omb: { name: 'OMB budget request + agency CBJs', kind: 'external' },
  gsa_calc: { name: 'GSA CALC+', kind: 'external' },
  sec_edgar: { name: 'SEC EDGAR', kind: 'external' },
  federal_register: { name: 'Federal Register', kind: 'external' },
  govcon_giants: { name: 'GovCon Giants (internal teaching, podcast, proposal corpus)', kind: 'internal' },
};

export interface UpstreamCount {
  /** External publishers behind at least one persisted, non-empty dataset. */
  persisted: string[];
  /** Forecast issuing agencies with ≥1 held row (each is a publisher). */
  forecastIssuers: string[];
  /** External publishers reached only live (never persisted). */
  passthroughOnly: string[];
  /** Internal corpora — ours, not an upstream. Reported separately, never added. */
  internal: string[];
  /** persisted ∪ forecast issuers — the headline "upstream publishers" figure. */
  total: number;
}

/**
 * Count upstream publishers from what the inventory actually holds. A publisher
 * behind a dataset with 0 held rows (e.g. NSF SBIR) does not count as contributing.
 */
export function countUpstreamPublishers(
  datasets: InventoryDataset[],
  forecastIssuers: string[],
): UpstreamCount {
  const persisted = new Set<string>();
  const passthrough = new Set<string>();
  const internal = new Set<string>();
  for (const d of datasets) {
    for (const u of d.upstreams) {
      const pub = UPSTREAM_PUBLISHERS[u];
      if (!pub) continue;
      if (pub.kind === 'internal') { internal.add(u); continue; }
      if (d.kind === 'passthrough') { passthrough.add(u); continue; }
      if ((d.stored ?? 0) > 0) persisted.add(u);
    }
  }
  // Per-source slices of one dataset (research funding) can hold 0 rows while the
  // dataset overall is non-empty — the route passes those publishers via `upstreams`
  // only when their own slice is non-empty.
  for (const p of persisted) passthrough.delete(p);
  const issuers = [...new Set(forecastIssuers)].sort();
  return {
    persisted: [...persisted].sort(),
    forecastIssuers: issuers,
    passthroughOnly: [...passthrough].sort(),
    internal: [...internal].sort(),
    total: persisted.size + issuers.length,
  };
}

// ── Totals ─────────────────────────────────────────────────────────────────────

export interface InventoryTotals {
  /**
   * PRIMARY: Σ record-grain source_corpus contributions. Per-dataset counts — datasets are
   * NOT deduplicated against each other, so this is a sum, never a "unique" claim.
   */
  ownedSourceRecords: number;
  /** SECONDARY: Σ transaction-grain source_corpus contributions (the award warehouse). */
  transactionRows: number;
  /** TOTAL: ownedSourceRecords + transactionRows — persisted source ROWS of mixed grain. */
  persistedSourceRows: number;
  /** Source corpora whose contribution could not be measured — the totals are a floor. */
  unmeasuredSources: string[];
  /** Σ derived_intelligence stored — built FROM the sources; never in the source totals. */
  derivedRecords: number;
  /** Σ static_manual stored. */
  staticRecords: number;
  /** Σ derived_index stored — representations of records already counted. */
  indexedRepresentations: number;
  /** Number of passthrough capabilities (never a record count). */
  passthroughCapabilities: number;
}

export function computeTotals(datasets: InventoryDataset[]): InventoryTotals {
  const sum = (pred: (d: InventoryDataset) => boolean, pick: (d: InventoryDataset) => number | null) =>
    datasets.filter(pred).reduce((s, d) => s + (pick(d) ?? 0), 0);
  const isSource = (d: InventoryDataset) => d.kind === 'source_corpus';
  const isTxn = (d: InventoryDataset) => d.grain === 'transaction';
  const ownedSourceRecords = sum((d) => isSource(d) && !isTxn(d), (d) => d.headlineContribution);
  const transactionRows = sum((d) => isSource(d) && isTxn(d), (d) => d.headlineContribution);
  return {
    ownedSourceRecords,
    transactionRows,
    persistedSourceRows: ownedSourceRecords + transactionRows,
    unmeasuredSources: datasets.filter((d) => isSource(d) && d.headlineContribution == null).map((d) => d.key),
    derivedRecords: sum((d) => d.kind === 'derived_intelligence', (d) => d.stored),
    staticRecords: sum((d) => d.kind === 'static_manual', (d) => d.stored),
    indexedRepresentations: sum((d) => d.kind === 'derived_index', (d) => d.stored),
    passthroughCapabilities: datasets.filter((d) => d.kind === 'passthrough').length,
  };
}

/**
 * Structural invariants. The route returns these violations rather than throwing,
 * and the unit test asserts the real route produces none.
 */
export function inventoryViolations(datasets: InventoryDataset[]): string[] {
  const v: string[] = [];
  const keys = new Set<string>();
  for (const d of datasets) {
    if (keys.has(d.key)) v.push(`${d.key}: duplicate key`);
    keys.add(d.key);
    if (d.kind !== 'source_corpus' && d.headlineContribution) {
      v.push(`${d.key}: ${d.kind} may not contribute to the source-record totals`);
    }
    if (d.kind === 'passthrough') {
      if (d.stored !== null) v.push(`${d.key}: passthrough must not report a stored count`);
      if (d.freshness.state !== 'PASSTHROUGH') v.push(`${d.key}: passthrough freshness must be PASSTHROUGH`);
      if (d.surface.state !== 'passthrough') v.push(`${d.key}: passthrough surface must be passthrough`);
    }
    if (d.kind === 'source_corpus' && d.headlineContribution != null && d.stored != null
        && d.headlineContribution > d.stored) {
      v.push(`${d.key}: headline contribution exceeds stored rows`);
    }
    if (d.grain === 'transaction' && d.kind !== 'source_corpus') {
      v.push(`${d.key}: transaction grain is only meaningful on a source corpus`);
    }
    if (d.surface.state === 'withheld' && d.surface.tools.length > 0) {
      v.push(`${d.key}: a withheld dataset cannot list customer tools`);
    }
  }
  return v;
}

// ── Freshness ──────────────────────────────────────────────────────────────────

/** Control-plane `source_state` → display state. Unrecognised → UNKNOWN, never CURRENT. */
export function mapSourceState(sourceState: string | null | undefined): FreshnessState {
  switch (sourceState) {
    case 'current':
    case 'upstream_quiet': // healthy: we checked, the publisher has nothing new
      return 'CURRENT';
    case 'content_stale':
      return 'STALE';
    case 'unreachable':
      return 'UNREACHABLE';
    default:
      return 'UNKNOWN';
  }
}

const SEVERITY: FreshnessState[] = ['UNREACHABLE', 'STALE', 'UNKNOWN', 'CURRENT'];

/** A multi-feed dataset is only as fresh as its worst feed — never averaged away. */
export function worstState(states: FreshnessState[]): FreshnessState {
  for (const s of SEVERITY) if (states.includes(s)) return s;
  return 'UNKNOWN';
}

export function summarizeStates(states: FreshnessState[]): string {
  const counts = new Map<FreshnessState, number>();
  for (const s of states) counts.set(s, (counts.get(s) ?? 0) + 1);
  return SEVERITY.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s.toLowerCase()}`).join(' · ');
}

/**
 * Freshness from a data timestamp and the producer's cadence. With no known cadence
 * the age cannot be judged, so the state is UNKNOWN (the date is still shown).
 */
export function timestampState(
  asOf: string | null,
  cadenceHours: number | null,
  now: Date,
): FreshnessState {
  if (!asOf) return 'UNKNOWN';
  if (cadenceHours == null) return 'UNKNOWN';
  const ageH = (now.getTime() - new Date(asOf).getTime()) / 3_600_000;
  if (!Number.isFinite(ageH)) return 'UNKNOWN';
  // Two missed cycles (plus an hour of dispatcher jitter) before we call it stale.
  return ageH <= cadenceHours * 2 + 1 ? 'CURRENT' : 'STALE';
}

/**
 * Next fire time for the simple numeric crons this repo registers
 * ("M H * * *" daily, "M H * * D" weekly). Anything else → null (not guessed).
 */
export function nextCronRun(expr: string | null, from: Date): string | null {
  if (!expr) return null;
  const m = expr.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|\d)$/);
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  const dow = m[3] === '*' ? null : Number(m[3]) % 7;
  for (let add = 0; add <= 8; add++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + add, hour, minute));
    if (d.getTime() <= from.getTime()) continue;
    if (dow !== null && d.getUTCDay() !== dow) continue;
    return d.toISOString();
  }
  return null;
}

/**
 * Build the schedule truth for one cron job.
 *
 * `lastPoll` is the control plane's most recent poll. When it is LATER than the last
 * scheduled run (by more than a few minutes), something other than the scheduler
 * polled — a manual refresh. A manual refresh does not re-prove the schedule.
 */
export function scheduleTruth(input: {
  job: string;
  cron: string | null;
  enabled: boolean | null;
  lastScheduledRun: ScheduledRun | null;
  lastPoll: string | null;
  now: Date;
}): ScheduleTruth {
  const { job, cron, enabled, lastScheduledRun: run, lastPoll, now } = input;
  const runMs = run ? new Date(run.at).getTime() : null;
  const pollMs = lastPoll ? new Date(lastPoll).getTime() : null;
  const MANUAL_GAP_MS = 30 * 60 * 1000;
  const lastManualRefresh =
    pollMs != null && (runMs == null || pollMs - runMs > MANUAL_GAP_MS) ? lastPoll : null;

  let recurrence: RecurrenceState = 'unknown';
  if (cron == null && enabled == null) {
    recurrence = 'unscheduled';
  } else if (enabled === false) {
    recurrence = 'disabled';
  } else if (!run) {
    recurrence = 'not_yet_reproven';
  } else if (lastManualRefresh) {
    recurrence = 'not_yet_reproven';
  } else if (run.status && NON_TERMINAL.has(run.status)) {
    recurrence = 'no_terminal_status';
  } else if (run.status && run.status !== 'success') {
    recurrence = 'failed';
  } else if (run.httpStatus != null && run.httpStatus >= 200 && run.httpStatus < 300) {
    recurrence = 'proven';
  } else if (run.httpStatus != null) {
    recurrence = 'failed';
  } else if (run.status === 'success') {
    recurrence = 'ran_status_unrecorded';
  }

  return {
    job,
    cron,
    enabled,
    lastScheduledRun: run,
    lastManualRefresh,
    nextScheduled: enabled === false ? null : nextCronRun(cron, now),
    recurrence,
  };
}

// ── Registry debt ──────────────────────────────────────────────────────────────

export interface RegistryDebt {
  where: string;
  claimed: number;
  measured: number;
}

/**
 * The control plane (data_sources.record_count / data_source_instances.held_population)
 * carries its own counts. Where one disagrees with what this page just measured by
 * more than 1%, it is reported as DEBT — the page never adopts the registry figure.
 */
export function registryDebt(
  pairs: Array<{ where: string; claimed: number | null | undefined; measured: number | null | undefined }>,
): RegistryDebt[] {
  const out: RegistryDebt[] = [];
  for (const p of pairs) {
    if (p.claimed == null || p.measured == null) continue;
    const base = Math.max(p.measured, 1);
    if (Math.abs(p.claimed - p.measured) / base > 0.01) {
      out.push({ where: p.where, claimed: p.claimed, measured: p.measured });
    }
  }
  return out;
}

// ── Static files ───────────────────────────────────────────────────────────────

/**
 * Last-changed dates for bundled static datasets that carry no date of their own.
 * Guarded by a unit test against `git log -1` for each file, so this cannot drift
 * silently. (agency-budget-data.json carries its own `lastUpdated` and is read from
 * the file instead.)
 */
export const STATIC_FILE_AS_OF = {
  'src/data/agency-pain-points.json': '2026-09-22',
} as const;
