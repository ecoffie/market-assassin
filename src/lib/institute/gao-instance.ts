/**
 * Living GAO source — control-plane instance identity + clock stamping.
 *
 * Gold master: Decision Makers buyer-contact clocks
 * (`src/lib/gov-contacts/buyer-contact-run.ts`). Five clocks, each a different
 * fact. A successful poll is NOT data advancement.
 *
 * Retires the notes-sentinel (`[gao-ingest-clocks:v1]` in data_sources.notes) as
 * the authority. The sentinel remains readable for deploy-window compat.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ManualSourceState } from '@/lib/data-core/manual-source-ops';

export const GAO_SOURCE_KEY = 'institute_gao';
export const GAO_DATASET_KEY = 'strategic_intelligence';
export const GAO_DISCOVERY_URL = 'https://www.gao.gov/rss/reports.xml';
export const GAO_RUNBOOK_PATH = 'docs/runbooks/institute-gao.md';

/** Five clocks — never conflate any two. */
export interface GaoInstanceClocks {
  last_poll: string | null;
  last_successful_check: string | null;
  last_verified_ingest: string | null;
  last_data_advance: string | null;
  last_source_advance: string | null;
}

export interface GaoClockStampInput {
  /** ISO timestamp of this attempt. Always written to last_poll when we actually fetched. */
  pollAt: string;
  /** True when the RSS fetch completed and yielded parseable documents. */
  pollOk: boolean;
  /** True when the full feed was processed without partial budget cut / ingest failures. */
  verifiedComplete: boolean;
  /**
   * True only when held Institute rows OR derived pain points actually changed
   * this run (inserts). Job success with zero mutations does NOT advance this.
   */
  dataAdvanced: boolean;
  /**
   * Newest defensible GAO publication date observed in the feed (YYYY-MM-DD or ISO).
   * NEVER synthesized from Mindy ingest time. Null when poll failed / no dates.
   */
  sourceAdvanceAt: string | null;
  /** Exact count of institute_sources where source_type=gao_report. Null = unmeasured. */
  heldPopulation: number | null;
  /**
   * RSS window size is NOT an exact upstream corpus population — leave null.
   * (GAO RSS is a recent-window feed, not a complete catalogue.)
   */
  upstreamPopulation?: number | null;
  /** Fraction of held GAO docs with resolved canonical_agency (0..1), or null. */
  resolutionRate?: number | null;
  /** Prior resolution rate from the instance (for degradation detection). */
  priorResolutionRate?: number | null;
}

export interface GaoClockStampResult {
  clocks: Record<string, unknown>;
  sourceState: ManualSourceState;
  alertCandidates: GaoAlertCandidate[];
}

export type GaoAlertKind =
  | 'rss_unreachable'
  | 'poll_failure'
  | 'source_advance_without_held'
  | 'derived_pipeline_failure'
  | 'agency_resolution_degraded';

export interface GaoAlertCandidate {
  kind: GaoAlertKind;
  fingerprintParts: string[];
  subject: string;
  bodyLines: string[];
}

/**
 * Build the patch for data_source_instances. Pure — no I/O.
 *
 * last_poll              — every real RSS check attempt that reached the network
 * last_successful_check  — only a successful complete feed read
 * last_verified_ingest   — successful verified canonical reconciliation
 * last_data_advance      — only when held Institute / derived data actually changes
 * last_source_advance    — newest defensible GAO publication date (never Mindy time)
 */
export function buildGaoClockPatch(input: GaoClockStampInput): GaoClockStampResult {
  const clocks: Record<string, unknown> = {
    last_poll: input.pollAt,
    updated_at: input.pollAt,
    // Upstream population deliberately NULL — RSS is a window, not a corpus.
    upstream_population: input.upstreamPopulation ?? null,
  };
  if (input.heldPopulation !== null && input.heldPopulation !== undefined) {
    clocks.held_population = input.heldPopulation;
  }

  const alertCandidates: GaoAlertCandidate[] = [];

  if (!input.pollOk) {
    clocks.source_state = 'unreachable' satisfies ManualSourceState;
    clocks.intervention_state = 'required';
    alertCandidates.push({
      kind: 'rss_unreachable',
      fingerprintParts: [GAO_SOURCE_KEY, 'rss_unreachable', input.pollAt.slice(0, 10)],
      subject: '[GAO] RSS unreachable / poll failure',
      bodyLines: [
        'The living GAO Institute collector could not read https://www.gao.gov/rss/reports.xml.',
        'This is NOT "0 new reports" and NOT upstream_quiet.',
        `Runbook: ${GAO_RUNBOOK_PATH}`,
      ],
    });
    return { clocks, sourceState: 'unreachable', alertCandidates };
  }

  // Successful complete feed read.
  clocks.last_successful_check = input.pollAt;

  if (input.verifiedComplete) {
    clocks.last_verified_ingest = input.pollAt;
  }

  if (input.dataAdvanced) {
    clocks.last_data_advance = input.pollAt;
  }

  // Source advance is the GOVERNMENT's publication watermark — only move forward.
  if (input.sourceAdvanceAt) {
    clocks.last_source_advance = toTimestamptz(input.sourceAdvanceAt);
  }

  // source_state: current when we successfully checked; content_stale only when
  // upstream published something newer than we held AND we failed to advance held.
  let sourceState: ManualSourceState = 'current';
  if (input.sourceAdvanceAt && !input.dataAdvanced && input.verifiedComplete) {
    // A quiet day with no new held rows is normal (idempotent re-read of the same
    // feed window). Only alert when the feed watermark is NEWER than our prior
    // held max — that comparison is done by the caller via alertCandidates below.
    sourceState = 'current';
  }
  if (!input.verifiedComplete) {
    sourceState = 'content_stale';
    clocks.intervention_state = 'required';
    alertCandidates.push({
      kind: 'derived_pipeline_failure',
      fingerprintParts: [GAO_SOURCE_KEY, 'derived_pipeline_failure', input.pollAt.slice(0, 10)],
      subject: '[GAO] Verified ingest incomplete / pipeline failure',
      bodyLines: [
        'GAO RSS was readable but the Institute reconciliation did not complete cleanly',
        '(partial budget cut, ingest failures, or blocked history).',
        `Runbook: ${GAO_RUNBOOK_PATH}`,
      ],
    });
  }

  // Agency-resolution degradation: material drop vs prior measured rate.
  if (
    input.resolutionRate !== null && input.resolutionRate !== undefined
    && input.priorResolutionRate !== null && input.priorResolutionRate !== undefined
    && input.priorResolutionRate > 0
    && input.resolutionRate < input.priorResolutionRate - 0.15
  ) {
    alertCandidates.push({
      kind: 'agency_resolution_degraded',
      fingerprintParts: [
        GAO_SOURCE_KEY,
        'agency_resolution_degraded',
        String(Math.round(input.resolutionRate * 100)),
      ],
      subject: '[GAO] Agency resolution rate degraded',
      bodyLines: [
        `Resolution rate fell from ${pct(input.priorResolutionRate)} to ${pct(input.resolutionRate)}.`,
        'Unresolved reports stay unresolved — do not force-map. Investigate the resolver / feed shape.',
        `Runbook: ${GAO_RUNBOOK_PATH}`,
      ],
    });
  }

  clocks.source_state = sourceState;
  if (!clocks.intervention_state) clocks.intervention_state = 'none_required';

  return { clocks, sourceState, alertCandidates };
}

/**
 * Detect "source advanced but held did not" — caller supplies the prior
 * last_source_advance and whether this run inserted any Institute rows.
 */
export function sourceAdvanceWithoutHeldAlert(opts: {
  priorSourceAdvance: string | null;
  newSourceAdvance: string | null;
  evidenceInserted: number;
  pollAt: string;
}): GaoAlertCandidate | null {
  if (!opts.newSourceAdvance) return null;
  if (opts.evidenceInserted > 0) return null;
  if (!opts.priorSourceAdvance) return null;
  const prior = Date.parse(opts.priorSourceAdvance);
  const next = Date.parse(opts.newSourceAdvance);
  if (!Number.isFinite(prior) || !Number.isFinite(next)) return null;
  if (next <= prior) return null;
  return {
    kind: 'source_advance_without_held',
    fingerprintParts: [
      GAO_SOURCE_KEY,
      'source_advance_without_held',
      opts.newSourceAdvance.slice(0, 10),
    ],
    subject: '[GAO] Source advanced but held Institute state did not',
    bodyLines: [
      `GAO publication watermark moved ${opts.priorSourceAdvance.slice(0, 10)} → ${opts.newSourceAdvance.slice(0, 10)},`,
      'but this run inserted 0 Institute rows. Ingest may be stuck or the new items failed identity.',
      `Runbook: ${GAO_RUNBOOK_PATH}`,
    ],
  };
}

export async function measureGaoHeldPopulation(sb: SupabaseClient): Promise<number | null> {
  const { count, error } = await sb
    .from('institute_sources')
    .select('*', { count: 'exact', head: true })
    .eq('source_type', 'gao_report');
  if (error || count === null || count === undefined) return null;
  return count;
}

export async function measureGaoResolutionRate(sb: SupabaseClient): Promise<number | null> {
  const held = await measureGaoHeldPopulation(sb);
  if (held === null || held === 0) return null;
  const { count, error } = await sb
    .from('institute_sources')
    .select('*', { count: 'exact', head: true })
    .eq('source_type', 'gao_report')
    .not('canonical_agency', 'is', null);
  if (error || count === null || count === undefined) return null;
  return count / held;
}

export async function stampGaoInstance(
  sb: SupabaseClient,
  input: GaoClockStampInput,
  extraAlerts: GaoAlertCandidate[] = [],
): Promise<{ stamped: boolean; sourceState: ManualSourceState; alerts: GaoAlertCandidate[] }> {
  const { clocks, sourceState, alertCandidates } = buildGaoClockPatch(input);
  const { error } = await sb
    .from('data_source_instances')
    .update(clocks)
    .eq('source_key', GAO_SOURCE_KEY);
  if (error) throw new Error(`institute_gao: cannot stamp instance — ${error.message}`);
  return {
    stamped: true,
    sourceState,
    alerts: [...alertCandidates, ...extraAlerts],
  };
}

function toTimestamptz(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`;
  return v;
}

function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}
