/**
 * Specialty-source advancement — the per-SOURCE reader.
 *
 * `aggregated_opportunities` has ONE dataset-level clock. Healthy NIH traffic
 * holds it near today, so the dataset reads fresh while two of its three sources
 * are dead. Measured on production 2026-09-20 over 30 days:
 *
 *   snapshot-multisite-darpa  30 runs · 30 success · HTTP 200 → last wrote 168d ago
 *   snapshot-multisite-nsf    30 runs · 30 success · HTTP 200 → NEVER wrote a row
 *   snapshot-multisite-nih    30 runs · 30 'dispatched' · NULL → outcome never reported
 *
 * 60 green checkmarks over two corpses. Job success is not data advancement.
 *
 * Classification lives in SQL (`research_source_advancement` /
 * `research_expected_sources`) and is NOT mirrored here — one rule, one place.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AdvancementState = 'current' | 'content_stale' | 'dormant' | 'never_advanced';

export interface SourceAdvancement {
  source: string;
  rowsHeld: number;
  lastScrapedAt: string | null;
  latestSourceDate: string | null;
  daysSinceScrape: number | null;
  state: AdvancementState;
}

const STATES: AdvancementState[] = ['current', 'content_stale', 'dormant', 'never_advanced'];
const asState = (s: unknown): AdvancementState =>
  STATES.includes(s as AdvancementState) ? (s as AdvancementState) : 'never_advanced';

/**
 * Per-source advancement, INCLUDING sources that have never produced a row.
 *
 * A `GROUP BY` over the table cannot see a configured-but-silent source — the
 * absence is invisible exactly where it matters — so the expected-source list is
 * joined in. `nsf_sbir` appears here with 0 rows; it would be missing entirely
 * from a table-only query.
 */
export async function getResearchSourceAdvancement(
  db: SupabaseClient,
): Promise<SourceAdvancement[]> {
  const [{ data: adv, error: advErr }, { data: exp, error: expErr }] = await Promise.all([
    db.rpc('research_source_advancement'),
    db.rpc('research_expected_sources'),
  ]);
  if (advErr) throw new Error(`research_source_advancement: ${advErr.message}`);
  if (expErr) throw new Error(`research_expected_sources: ${expErr.message}`);

  const bySource = new Map<string, SourceAdvancement>();
  for (const r of (adv ?? []) as Record<string, unknown>[]) {
    bySource.set(String(r.source), {
      source: String(r.source),
      rowsHeld: Number(r.rows_held),
      lastScrapedAt: (r.last_scraped_at as string) ?? null,
      latestSourceDate: (r.latest_source_date as string) ?? null,
      daysSinceScrape: r.days_since_scrape == null ? null : Number(r.days_since_scrape),
      state: asState(r.advancement_state),
    });
  }
  // Expected-but-never-observed sources are ADDED, never dropped.
  for (const e of (exp ?? []) as Record<string, unknown>[]) {
    const key = String(e.source);
    if (!bySource.has(key)) {
      bySource.set(key, {
        source: key,
        rowsHeld: Number(e.rows_held ?? 0),
        lastScrapedAt: null,
        latestSourceDate: null,
        daysSinceScrape: null,
        state: 'never_advanced',
      });
    }
  }
  return [...bySource.values()].sort((a, b) => b.rowsHeld - a.rowsHeld);
}

/** Sources that need a human: dormant or never observed. */
export function needsIntervention(rows: SourceAdvancement[]): SourceAdvancement[] {
  return rows.filter((r) => r.state === 'dormant' || r.state === 'never_advanced');
}

/**
 * The honest headline for a multi-source corpus.
 *
 * NEVER reports the dataset as healthy because its busiest source is moving —
 * that is the exact masking this module exists to prevent.
 */
export function corpusHeadline(rows: SourceAdvancement[]): {
  healthy: boolean;
  total: number;
  advancing: number;
  dead: number;
  summary: string;
} {
  const advancing = rows.filter((r) => r.state === 'current' || r.state === 'content_stale').length;
  const dead = rows.filter((r) => r.state === 'dormant' || r.state === 'never_advanced').length;
  return {
    healthy: dead === 0,
    total: rows.length,
    advancing,
    dead,
    summary:
      dead === 0
        ? `${advancing}/${rows.length} sources advancing`
        : `${dead} of ${rows.length} sources NOT advancing (${rows
            .filter((r) => r.state === 'dormant' || r.state === 'never_advanced')
            .map((r) => `${r.source}:${r.state}`)
            .join(', ')})`,
  };
}

export type ProducerState =
  | 'running_advancing'
  | 'running_not_advancing'
  | 'running_never_advanced'
  | 'parked_historical'
  | 'parked_never_advanced';

export interface ProducerStatus {
  source: string;
  jobName: string;
  jobEnabled: boolean;
  rowsHeld: number;
  lastScrapedAt: string | null;
  daysSinceScrape: number | null;
  state: ProducerState;
}

const PRODUCER_STATES: ProducerState[] = [
  'running_advancing', 'running_not_advancing', 'running_never_advanced',
  'parked_historical', 'parked_never_advanced',
];

/**
 * Producer schedule state BESIDE data advancement.
 *
 * `running_not_advancing` and `running_never_advanced` are the false-green
 * conditions: a job still scheduled while its source produces nothing. DARPA sat
 * in the first for 168 days and NSF in the second forever, each reporting
 * HTTP 200 daily.
 *
 * An unrecognised state degrades to `running_never_advanced` — the most alarming
 * reading — so a vocabulary change can never quietly present as healthy.
 */
export async function getResearchProducerStatus(db: SupabaseClient): Promise<ProducerStatus[]> {
  const { data, error } = await db.rpc('research_producer_status');
  if (error) throw new Error(`research_producer_status: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    source: String(r.source),
    jobName: String(r.job_name),
    jobEnabled: r.job_enabled === true,
    rowsHeld: Number(r.rows_held ?? 0),
    lastScrapedAt: (r.last_scraped_at as string) ?? null,
    daysSinceScrape: r.days_since_scrape == null ? null : Number(r.days_since_scrape),
    state: PRODUCER_STATES.includes(r.producer_state as ProducerState)
      ? (r.producer_state as ProducerState)
      : 'running_never_advanced',
  }));
}

/** Producers still scheduled while their source produces nothing. */
export function falseGreenProducers(rows: ProducerStatus[]): ProducerStatus[] {
  return rows.filter(
    (r) => r.state === 'running_not_advancing' || r.state === 'running_never_advanced',
  );
}

/** A parked producer is NEVER healthy, whatever its last job status said. */
export function isHealthyProducer(r: ProducerStatus): boolean {
  return r.state === 'running_advancing';
}
