/**
 * Players rebuild — gate + persisted build record.
 *
 * REQUIRED PRODUCTION SEQUENCE (Eric, 2026-10-04):
 *   BQ awards repair → awards reconciliation → Players rebuild → Players reconciliation.
 *
 * The gate enforces the first two from evidence, not from a flag: the rebuild is REFUSED while the
 * awards cohort-completeness check (the same classifier `verify:oracles --only freshness` uses)
 * reports anything but `complete`. On 2026-10-04 it reports holes (DoD 2026-02/03 at ~0%), so a
 * rebuild today is refused — Players built from that warehouse would publish the hole as fact.
 * There is deliberately no override.
 *
 * The build record lives in Supabase `data_sources` row `bq_players`, in a marker block like the
 * awards ingest clocks, and carries: source awards watermark | Players rebuild watermark | status.
 */
import type { CohortCompleteness } from '@/lib/awards-ingest/cohort-completeness';

export const PLAYERS_DATA_SOURCE_KEY = 'bq_players' as const;

export type PlayersBuildStatus =
  | 'refused_incomplete_warehouse' // gate said no; nothing was built
  | 'failed'                       // the CREATE or its read-back failed
  | 'built_unreconciled'           // table built and read back; reconciliation not yet passed
  | 'reconciled';                  // `--reconcile --go` passed against truth → eligible for PLAYERS_SOURCE=canonical

export interface PlayersBuildRecord {
  status: PlayersBuildStatus;
  /** awards MAX(action_date) the attempt saw (the source watermark). */
  sourceActionMax: string | null;
  /** source_action_max read back FROM the built table — the Players rebuild watermark. */
  playersSourceActionMax: string | null;
  playersBuiltAt: string | null;
  rows: number | null;
  reconciledAt: string | null;
  detail: string;
  attemptedAt: string;
}

export function decidePlayersRebuild(completeness: CohortCompleteness): { allowed: boolean; reason: string } {
  if (completeness.status === 'complete') return { allowed: true, reason: 'awards cohort completeness: complete' };
  return {
    allowed: false,
    reason: `awards cohort completeness is "${completeness.status}" — repair and reconcile the awards warehouse first`,
  };
}

const OPEN = '[players-build:v1]';
const CLOSE = '[/players-build]';

export function encodePlayersBuildRecord(notes: string | null | undefined, rec: PlayersBuildRecord): string {
  const base = (notes || '').replace(new RegExp(`\\n*\\${OPEN}[\\s\\S]*?\\${CLOSE.replace('/', '\\/')}`), '').trimEnd();
  return `${base}${base ? '\n\n' : ''}${OPEN}\n${JSON.stringify(rec)}\n${CLOSE}`;
}

export function decodePlayersBuildRecord(notes: string | null | undefined): PlayersBuildRecord | null {
  if (!notes) return null;
  const i = notes.indexOf(OPEN);
  const j = notes.indexOf(CLOSE);
  if (i < 0 || j < i) return null;
  try { return JSON.parse(notes.slice(i + OPEN.length, j).trim()) as PlayersBuildRecord; } catch { return null; }
}

/** The data_sources row the first real build creates (only under --go). */
export const PLAYERS_DATA_SOURCE_ROW = {
  key: PLAYERS_DATA_SOURCE_KEY,
  name: 'BQ Proven Players (players_naics_recipients)',
  category: 'built',
  built_from: 'awards × recipients → scripts/players-rebuild.ts (src/lib/players/dataset.ts)',
  refresh_cadence: 'after each successful awards ingest',
  is_active: true,
} as const;
