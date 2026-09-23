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

/**
 * lastSourceAdvance — the newest DEFENSIBLE publication date of legislative source
 * material this run held. Only a document's own publication/version date counts.
 *
 * ⚠️ NOT `sourceWatermark`. The collector's per-document `sourceWatermark` falls back
 * to Congress's bill-record `updateDate` when a version is undated (it is persisted as
 * `institute_sources.source_watermark` and means "record activity", not publication).
 * Measured 2026-09-23: 119-S1071-ENR is undated; its bill record was edited on
 * 2026-09-22, and that metadata edit advanced this clock to 2026-09-22 — "healthy,
 * 1 day old" — when the newest dated legislative text was 2026-07-30.
 *
 * Undated documents stay held and provenanced; they simply contribute NOTHING here.
 * No dated document at all → null (unknown), never an invented date.
 */
export function legislativeSourceAdvance(docs: Array<{ publicationDate: string | null }>): string | null {
  return docs
    .map((d) => d.publicationDate)
    .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d))
    .sort()
    .at(-1) ?? null;
}

/**
 * The control-plane view (`data_source_instances`) of ONE successful execution.
 *
 * The route used to stamp only the `data_sources.notes` sentinel, so every run left
 * the control plane at its seed-time clocks — measured 2026-09-23: notes lastPoll
 * 2026-09-23T00:57Z, control plane last_poll 2026-09-20T12:59Z. Both views are now
 * written from the SAME execution's values (same pollAt, same source advance).
 *
 * Four clocks, never collapsed:
 *   last_poll / last_successful_check  polled        — Congress was checked
 *   last_source_advance                source advanced — newest dated legislative publication
 *   last_verified_ingest               reconciliation completed with no failures
 *   last_data_advance                  ingested      — Mindy's corpus actually changed
 *   (intelligence changed lives in the notes sentinel: lastIntelligenceChange)
 *
 * Deliberately NOT written: source_state / intervention_state / manual_action_type —
 * the operator-owned parked state is cleared by a human, never by a run.
 */
export function legislationInstancePatch(input: {
  pollAt: string;
  coverageComplete: boolean;
  corpusChanged: boolean;
  sourceAdvance: string | null;
}): Record<string, string | null> {
  const patch: Record<string, string | null> = {
    last_poll: input.pollAt,
    last_verified_ingest: input.pollAt,
    last_source_advance: input.sourceAdvance
      ? (/^\d{4}-\d{2}-\d{2}$/.test(input.sourceAdvance) ? `${input.sourceAdvance}T00:00:00.000Z` : input.sourceAdvance)
      : null,
    updated_at: input.pollAt,
  };
  if (input.coverageComplete) patch.last_successful_check = input.pollAt;
  if (input.corpusChanged) patch.last_data_advance = input.pollAt;
  return patch;
}
