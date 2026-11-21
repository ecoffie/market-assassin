/**
 * Runs an Ask Mindy recipe (recipes.ts) through an injected tool executor. Not wired into the chat route.
 *
 * - Steps whose `needs` are met run together (Promise.all), wave by wave: independent calls are parallel,
 *   dependent ones wait. A cycle or an unknown dependency is a contract error, thrown before any call.
 * - A step that cannot be filled from what is known is `skipped` with its reason. Nothing is invented.
 * - A tool that throws or returns ok:false is `unavailable`, never an empty result or a zero.
 * - A step whose tool does not exist yet is `missing_tool`, carrying its Data Core requirement.
 * - An unbuilt recipe returns `not_implemented` without calling anything.
 */
import { RECIPES, isImplemented, type PriorResults, type RecipeContext, type RecipeId, type RecipeStep } from './recipes';

export type StepOutcome =
  | { state: 'ok'; value: unknown }
  | { state: 'unavailable'; reason: string }
  | { state: 'skipped'; reason: string }
  | { state: 'missing_tool'; reason: string };

export interface StepRecord {
  id: string;
  tool: string | null;
  wave: number;
  args?: Record<string, unknown>;
  outcome: StepOutcome;
}

export type RecipeRun =
  | { recipe: RecipeId; status: 'not_implemented' }
  | { recipe: RecipeId; status: 'ran'; steps: StepRecord[]; results: PriorResults };

/** Calls one MCP tool. Implementations must reject or return { ok:false } on failure, never a fake empty. */
export type ToolExecutor = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

/** Orders steps into waves; throws on an unknown dependency or a cycle. */
export function planWaves(steps: readonly RecipeStep[]): RecipeStep[][] {
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) for (const n of s.needs ?? []) {
    if (!ids.has(n)) throw new Error(`recipe step "${s.id}" needs unknown step "${n}"`);
  }
  const done = new Set<string>();
  const waves: RecipeStep[][] = [];
  let left = [...steps];
  while (left.length) {
    const ready = left.filter((s) => (s.needs ?? []).every((n) => done.has(n)));
    if (!ready.length) throw new Error(`recipe has a dependency cycle among: ${left.map((s) => s.id).join(', ')}`);
    waves.push(ready);
    for (const s of ready) done.add(s.id);
    left = left.filter((s) => !done.has(s.id));
  }
  return waves;
}

function failed(value: unknown): string | null {
  if (value && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
    const v = value as { error?: unknown; error_category?: unknown };
    return String(v.error_category ?? v.error ?? 'tool returned ok:false');
  }
  return null;
}

export async function runRecipe(recipeId: RecipeId, ctx: RecipeContext, exec: ToolExecutor): Promise<RecipeRun> {
  if (!isImplemented(recipeId)) return { recipe: recipeId, status: 'not_implemented' };
  const waves = planWaves(RECIPES[recipeId].steps);
  const results: Record<string, StepOutcome> = {};
  const steps: StepRecord[] = [];

  for (let w = 0; w < waves.length; w++) {
    const frozen: PriorResults = { ...results };
    const records = await Promise.all(waves[w].map(async (step): Promise<StepRecord> => {
      if (!step.tool) {
        return { id: step.id, tool: null, wave: w, outcome: { state: 'missing_tool', reason: step.requirement ?? 'tool not available' } };
      }
      const planned = step.args ? step.args(ctx, frozen) : { args: {} };
      if ('skip' in planned) return { id: step.id, tool: step.tool, wave: w, outcome: { state: 'skipped', reason: planned.skip } };
      try {
        const value = await exec(step.tool, planned.args);
        const why = failed(value);
        return { id: step.id, tool: step.tool, wave: w, args: planned.args, outcome: why ? { state: 'unavailable', reason: why } : { state: 'ok', value } };
      } catch (e) {
        return { id: step.id, tool: step.tool, wave: w, args: planned.args, outcome: { state: 'unavailable', reason: (e as Error)?.message || 'tool call failed' } };
      }
    }));
    for (const r of records) { results[r.id] = r.outcome; steps.push(r); }
  }
  return { recipe: recipeId, status: 'ran', steps, results };
}
