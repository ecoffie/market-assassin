/**
 * Clocks for the LEGISLATIVE signal. Same three-clock separation as the GAO clocks
 * (src/lib/institute/source-clocks.ts) with its own sentinel, because the two sources
 * live in different data_sources rows and have very different natural rhythms.
 *
 *   lastPoll              — when Mindy last CHECKED Congress
 *   lastSourceAdvance     — newest legislative action/publication date OBSERVED
 *   lastIntelligenceChange— when legislative evidence last CHANGED an interpretation
 *
 * ⚠️ CONGRESS IS QUIET FOR LONG STRETCHES BY DESIGN — recesses, and the months
 * between a chamber passing a bill and conference. GAO's 14-day quiet threshold would
 * scream "upstream_quiet" through every August recess and train everyone to ignore it.
 * 45 days is a real anomaly for an active NDAA cycle; anything shorter is noise.
 *
 * ⚠️ QUIET IS NOT BROKEN AND BROKEN IS NOT QUIET. `upstream_quiet` means we polled
 * successfully and Congress did nothing. `ingest_broken` means WE are failing. The
 * FY27 incident is precisely what happens when those two collapse into one silence.
 */
export interface LegislationClocks {
  lastPoll: string;
  lastSourceAdvance: string | null;
  lastIntelligenceChange: string | null;
}

export type LegislationFreshness =
  | { status: 'healthy'; pollAgeDays: number; sourceAgeDays: number | null }
  | { status: 'upstream_quiet'; pollAgeDays: number; sourceAgeDays: number }
  | { status: 'ingest_broken'; pollAgeDays: number | null; sourceAgeDays: number | null }
  | { status: 'unmeasured'; pollAgeDays: null; sourceAgeDays: null };

const START = '[legislation-ingest-clocks:v1]';
const END = '[/legislation-ingest-clocks]';
const PATTERN = /\n?\[legislation-ingest-clocks:v1\]\n([\s\S]*?)\n\[\/legislation-ingest-clocks\]\n?/;

/** Weekly cron: two missed cycles is broken. */
export const LEGISLATION_POLL_STALE_DAYS = 15;
/** Recess-tolerant. See the header note. */
export const LEGISLATION_SOURCE_QUIET_DAYS = 45;

export function encodeLegislationClocks(notes: string | null, clocks: LegislationClocks): string {
  const human = (notes ?? '').replace(PATTERN, '\n').trim();
  const block = `${START}\n${JSON.stringify(clocks)}\n${END}`;
  return human ? `${human}\n\n${block}` : block;
}

export function decodeLegislationClocks(notes: string | null | undefined): LegislationClocks | null {
  const m = notes?.match(PATTERN);
  if (!m) return null;
  try {
    const p = JSON.parse(m[1]) as Partial<LegislationClocks>;
    return typeof p.lastPoll === 'string' && Number.isFinite(Date.parse(p.lastPoll))
      ? {
          lastPoll: p.lastPoll,
          lastSourceAdvance: p.lastSourceAdvance ?? null,
          lastIntelligenceChange: p.lastIntelligenceChange ?? null,
        }
      : null;
  } catch {
    return null;
  }
}

const ageDays = (v: string, now: number): number | null => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
};

export function classifyLegislationFreshness(input: {
  clocks: LegislationClocks | null;
  now?: string;
  pollFailed?: boolean;
}): LegislationFreshness {
  if (input.pollFailed) return { status: 'ingest_broken', pollAgeDays: null, sourceAgeDays: null };
  if (!input.clocks) return { status: 'unmeasured', pollAgeDays: null, sourceAgeDays: null };
  const now = Date.parse(input.now ?? new Date().toISOString());
  const pollAge = ageDays(input.clocks.lastPoll, now);
  if (pollAge === null) return { status: 'unmeasured', pollAgeDays: null, sourceAgeDays: null };
  if (pollAge > LEGISLATION_POLL_STALE_DAYS) return { status: 'ingest_broken', pollAgeDays: pollAge, sourceAgeDays: null };
  const srcAge = input.clocks.lastSourceAdvance ? ageDays(input.clocks.lastSourceAdvance, now) : null;
  if (srcAge !== null && srcAge > LEGISLATION_SOURCE_QUIET_DAYS) {
    return { status: 'upstream_quiet', pollAgeDays: pollAge, sourceAgeDays: srcAge };
  }
  return { status: 'healthy', pollAgeDays: pollAge, sourceAgeDays: srcAge };
}
