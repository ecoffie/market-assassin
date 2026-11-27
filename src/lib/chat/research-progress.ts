/**
 * Research progress for an Ask Mindy turn (Mindy Day 11/28: research mode runs Claude over the Mindy catalog for
 * several minutes). Every {type:'progress', message} event is a STEP; an optional `phase` ('writing' | 'checking')
 * is a headline instead. Steps are de-duplicated (parallel calls to the same tool say the same line) and capped,
 * so a long run reads as a calm, growing list — never a wall of warnings, and never frozen.
 *
 * Kept separate from 'notice' events, which are real warnings (a source unavailable, an answer cut off).
 */

export type ResearchStep = { text: string; count: number };
export type ResearchProgress = {
  steps: ResearchStep[];
  /** The step count including duplicates (what the customer would call "how much it looked at"). */
  total: number;
  headline: string | null;
  startedAt: number;
  lastEventAt: number;
};

export const RESEARCH_STEP_CAP = 40;
/** After this long with no new event, reassure the customer the turn is still alive. */
export const STILL_WORKING_MS = 20_000;
export const STILL_WORKING_TEXT = 'Still working. Research answers can take a few minutes.';
const PHASES = new Set(['writing', 'checking']);

export function startProgress(now: number): ResearchProgress {
  return { steps: [], total: 0, headline: null, startedAt: now, lastEventAt: now };
}

function clean(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function addProgress(p: ResearchProgress, evt: { message?: unknown; phase?: unknown }, now: number): ResearchProgress {
  const text = clean(evt.message);
  if (!text) return p;
  if (typeof evt.phase === 'string' && PHASES.has(evt.phase)) return { ...p, headline: text, lastEventAt: now };
  const i = p.steps.findIndex((s) => s.text === text);
  let steps: ResearchStep[];
  if (i >= 0) steps = p.steps.map((s, j) => (j === i ? { ...s, count: s.count + 1 } : s));
  else steps = [...p.steps, { text, count: 1 }].slice(-RESEARCH_STEP_CAP);
  return { ...p, steps, total: p.total + 1, headline: null, lastEventAt: now };
}

/** "0:07", "3:42", "12:05". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The line shown while running: the phase headline, else the latest step. */
export function currentLine(p: ResearchProgress): string {
  return p.headline ?? p.steps[p.steps.length - 1]?.text ?? 'Starting research.';
}

export function stepCountLabel(n: number): string {
  return n === 1 ? '1 step' : `${n} steps`;
}

/** The collapsed line once the answer is in. */
export function summaryLine(p: ResearchProgress, finishedAt: number): string {
  return `Researched · ${stepCountLabel(p.total)} · ${formatElapsed(finishedAt - p.startedAt)}`;
}
