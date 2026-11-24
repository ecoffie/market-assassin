/**
 * FIND replay gate (scripts/mcp-find-replay-diff.ts): every change between two FIND replay snapshots must be
 * EXPLAINED by a classification written for THIS comparison, or the gate fails.
 *
 * A horizon's signature is { status, matched_count, top (hash of the ordered top-N ids), evidence (hash of
 * evidence_counts) }. A change is explained only by a classification keyed by fixture + horizon whose `before` and
 * `after` signatures equal the observed ones EXACTLY. So a reviewed change cannot quietly absorb a later one
 * (janitorial Coming soon 59 → 70 under an old "janitorial is re-ranked" note fails), and a classification is
 * written per comparison, never reused from an earlier phase.
 *
 * A fixture present in only one snapshot always fails: a removed or added fixture is never a silent pass.
 */
import { createHash } from 'node:crypto';

export type ReplayClass = 'bug_correction' | 'intentional_canonical_change' | 'unexpected_regression';
export const REPLAY_HORIZONS = ['open_now', 'coming_back', 'coming_soon'] as const;
export type ReplayHorizon = typeof REPLAY_HORIZONS[number];

export interface HorizonSnapshot { status?: string; matched_count?: number | null; evidence_counts?: unknown; error?: string | null; items?: Array<{ id: string }> }
export type ReplaySnapshot = Record<string, { horizons?: Partial<Record<string, HorizonSnapshot>> }>;

export interface HorizonSignature { status: string | null; matched_count: number | null; top: string; evidence: string }
export interface HorizonClassification { cls: ReplayClass; why: string; before: HorizonSignature; after: HorizonSignature }
/** fixture → horizon → classification. Loaded from a file written for one comparison. */
export type ReplayClassification = Record<string, Partial<Record<ReplayHorizon, HorizonClassification>>>;

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12);

export function horizonSignature(h: HorizonSnapshot | undefined | null): HorizonSignature | null {
  if (!h) return null;
  return {
    status: h.status ?? null,
    matched_count: typeof h.matched_count === 'number' ? h.matched_count : null,
    top: hash((h.items ?? []).map((x) => String(x.id))),
    evidence: hash(h.evidence_counts ?? null),
  };
}

const sameSig = (a: HorizonSignature | null | undefined, b: HorizonSignature | null | undefined) =>
  !!a && !!b && a.status === b.status && a.matched_count === b.matched_count && a.top === b.top && a.evidence === b.evidence;

export interface ReplayChange {
  fixture: string;
  horizon: ReplayHorizon | null;
  before: HorizonSignature | null;
  after: HorizonSignature | null;
  verdict: 'explained' | 'unexplained' | 'regression';
  cls?: ReplayClass;
  why: string;
}

export interface ReplayDiffResult { fixtures: number; changes: ReplayChange[]; unexplained: number; regressions: number; pass: boolean }

export function diffReplaySnapshots(oldSnap: ReplaySnapshot, newSnap: ReplaySnapshot, classification: ReplayClassification): ReplayDiffResult {
  const changes: ReplayChange[] = [];
  const fixtures = [...new Set([...Object.keys(oldSnap), ...Object.keys(newSnap)])].sort();
  for (const fixture of fixtures) {
    const inOld = fixture in oldSnap;
    const inNew = fixture in newSnap;
    if (!inOld || !inNew) {
      changes.push({ fixture, horizon: null, before: null, after: null, verdict: 'unexplained', why: inOld ? 'fixture missing from the new snapshot' : 'fixture exists only in the new snapshot' });
      continue;
    }
    for (const horizon of REPLAY_HORIZONS) {
      const before = horizonSignature(oldSnap[fixture]?.horizons?.[horizon]);
      const after = horizonSignature(newSnap[fixture]?.horizons?.[horizon]);
      if (before && after && sameSig(before, after)) continue;
      const c = classification[fixture]?.[horizon];
      if (!before || !after) {
        changes.push({ fixture, horizon, before, after, verdict: 'unexplained', why: `horizon missing from the ${before ? 'new' : 'old'} snapshot` });
        continue;
      }
      if (!c) {
        changes.push({ fixture, horizon, before, after, verdict: 'unexplained', why: 'no classification for this fixture + horizon' });
        continue;
      }
      if (!sameSig(c.before, before) || !sameSig(c.after, after)) {
        changes.push({ fixture, horizon, before, after, verdict: 'unexplained', cls: c.cls, why: 'classified, but the observed change differs from the classified before → after signature' });
        continue;
      }
      changes.push({ fixture, horizon, before, after, verdict: c.cls === 'unexpected_regression' ? 'regression' : 'explained', cls: c.cls, why: c.why });
    }
  }
  const unexplained = changes.filter((c) => c.verdict === 'unexplained').length;
  const regressions = changes.filter((c) => c.verdict === 'regression').length;
  return { fixtures: fixtures.length, changes, unexplained, regressions, pass: unexplained === 0 && regressions === 0 };
}

/** A classification skeleton for the unexplained changes (reviewers fill cls + why; signatures are exact). */
export function classificationTemplate(result: ReplayDiffResult): ReplayClassification {
  const out: ReplayClassification = {};
  for (const c of result.changes) {
    if (c.verdict !== 'unexplained' || !c.horizon || !c.before || !c.after) continue;
    (out[c.fixture] ??= {})[c.horizon] = { cls: 'unexpected_regression', why: 'TODO: classify with evidence', before: c.before, after: c.after };
  }
  return out;
}
