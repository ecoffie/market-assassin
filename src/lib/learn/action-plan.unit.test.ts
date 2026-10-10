/**
 * Learn cites the Action Plan by stable step ID. ACTION_PLAN must equal docs/action-plan-2026.md exactly —
 * same IDs, titles, order, phases and cadence — so the Learn pages can never teach a different plan.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_PLAN, ACTION_PLAN_STEPS } from './action-plan';

const DOC = readFileSync(join(process.cwd(), 'docs/action-plan-2026.md'), 'utf8');

function parse() {
  const out: { n: number; name: string; cadence: string; steps: { id: string; title: string }[] }[] = [];
  let cur: (typeof out)[number] | null = null;
  for (const line of DOC.split('\n')) {
    const h = line.match(/^## Phase (\d) — (.+) · (ONCE|REPEAT)$/);
    if (h) { cur = { n: Number(h[1]), name: h[2], cadence: h[3], steps: [] }; out.push(cur); continue; }
    if (line.startsWith('## ')) { cur = null; continue; }
    const s = line.match(/^\| `(P\d-\d\d)` \| (.+) \|$/);
    if (s && cur) cur.steps.push({ id: s[1], title: s[2] });
  }
  return out;
}

describe('ACTION_PLAN mirrors docs/action-plan-2026.md', () => {
  it('identical phases, IDs, titles, order and cadence', () => {
    expect(ACTION_PLAN.map((p) => ({ n: p.n, name: p.name, cadence: p.cadence, steps: p.steps.map((s) => ({ ...s })) }))).toEqual(parse());
  });
  it('27 steps, unique IDs', () => {
    expect(ACTION_PLAN_STEPS).toHaveLength(27);
    expect(new Set(ACTION_PLAN_STEPS.map((s) => s.id)).size).toBe(27);
  });
});
