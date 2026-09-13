/**
 * Three clocks for the GAO signal. Reuses the awards-ingest separation
 * (src/lib/awards-ingest/clocks.ts) — run-clock and source-clock are DIFFERENT
 * facts, and a successful poll must never be reported as fresh data.
 *
 *   lastPoll              — when Mindy last CHECKED GAO
 *   lastSourceAdvance     — newest GAO publication date OBSERVED
 *   lastIntelligenceChange— when GAO evidence last CHANGED Mindy's interpretation
 *
 * All three can legitimately differ. Polled today + newest report 2 days old +
 * last claim change 3 days ago is HEALTHY, not stale.
 *
 * Stored in data_sources.notes between sentinels, exactly like the awards clocks,
 * so no schema change is needed.
 */
export interface GaoClocks {
  lastPoll: string;                      // ISO timestamp
  lastSourceAdvance: string | null;      // ISO date (max publication_date seen)
  lastIntelligenceChange: string | null; // ISO timestamp of the newest intelligence_changes row
}

export type GaoFreshness =
  | { status: 'healthy'; pollAgeDays: number; sourceAgeDays: number | null }
  | { status: 'upstream_quiet'; pollAgeDays: number; sourceAgeDays: number }
  | { status: 'ingest_broken'; pollAgeDays: number | null; sourceAgeDays: number | null }
  | { status: 'unmeasured'; pollAgeDays: null; sourceAgeDays: null };

const START = '[gao-ingest-clocks:v1]';
const END = '[/gao-ingest-clocks]';
const PATTERN = /\n?\[gao-ingest-clocks:v1\]\n([\s\S]*?)\n\[\/gao-ingest-clocks\]\n?/;

/** GAO publishes on business days; a week of silence is normal, two is not. */
export const GAO_POLL_STALE_DAYS = 3;
export const GAO_SOURCE_QUIET_DAYS = 14;

export function encodeGaoClocks(notes: string | null, clocks: GaoClocks): string {
  const human = (notes ?? '').replace(PATTERN, '\n').trim();
  const block = `${START}\n${JSON.stringify(clocks)}\n${END}`;
  return human ? `${human}\n\n${block}` : block;
}

export function decodeGaoClocks(notes: string | null | undefined): GaoClocks | null {
  const m = notes?.match(PATTERN);
  if (!m) return null;
  try {
    const p = JSON.parse(m[1]) as Partial<GaoClocks>;
    return typeof p.lastPoll === 'string' && Number.isFinite(Date.parse(p.lastPoll))
      ? { lastPoll: p.lastPoll, lastSourceAdvance: p.lastSourceAdvance ?? null, lastIntelligenceChange: p.lastIntelligenceChange ?? null }
      : null;
  } catch { return null; }
}

const ageDays = (v: string, now: number): number | null => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
};

/**
 * ⚠️ A SUCCESSFUL POLL IS NOT DATA ADVANCEMENT. `upstream_quiet` means we are
 * polling fine and the government simply has not published — a HEALTHY-ish state
 * that must read differently from a broken ingest.
 */
export function classifyGaoFreshness(input: { clocks: GaoClocks | null; now?: string; pollFailed?: boolean }): GaoFreshness {
  if (input.pollFailed) return { status: 'ingest_broken', pollAgeDays: null, sourceAgeDays: null };
  if (!input.clocks) return { status: 'unmeasured', pollAgeDays: null, sourceAgeDays: null };
  const now = Date.parse(input.now ?? new Date().toISOString());
  const pollAge = ageDays(input.clocks.lastPoll, now);
  if (pollAge === null) return { status: 'unmeasured', pollAgeDays: null, sourceAgeDays: null };
  if (pollAge > GAO_POLL_STALE_DAYS) return { status: 'ingest_broken', pollAgeDays: pollAge, sourceAgeDays: null };
  const srcAge = input.clocks.lastSourceAdvance ? ageDays(input.clocks.lastSourceAdvance, now) : null;
  if (srcAge !== null && srcAge > GAO_SOURCE_QUIET_DAYS) return { status: 'upstream_quiet', pollAgeDays: pollAge, sourceAgeDays: srcAge };
  return { status: 'healthy', pollAgeDays: pollAge, sourceAgeDays: srcAge };
}
