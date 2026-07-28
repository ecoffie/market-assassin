/**
 * "Recommended" for OPEN opportunities = a relevance blend, NOT just "soonest deadline" (Eric
 * 2026-07-28). The default Open sort was `dueDate` asc — one dimension wearing the Recommended label,
 * the same gap the Companies sort had. `oppRecommendedScore` blends REAL opp fields (urgency window +
 * posting freshness + set-aside relevance + log-value + docs-available) so an actionable, biddable
 * opp rises over one that merely closes first. This extracts the pure fn from the template and proves it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

function extractFn(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// oppRecommendedScore depends on daysOut() + TODAY + dueDate(). Provide deterministic stand-ins that
// match the template semantics (TODAY pinned; daysOut = days until o.close from a YYYY-MM-DD string).
const harness = `
  const TODAY=new Date(2026,6,28,12,0,0); // 2026-07-28 noon
  function dueDate(o){ return o.src==='RECOMPETE'?o.exp:o.close; }
  function daysOut(o){ var d=String(dueDate(o)||'').slice(0,10); if(!d)return NaN; return Math.round((new Date(d+'T12:00:00')-TODAY)/864e5); }
`;
const oppRecommendedScore = new Function(
  `${harness}${extractFn(tmpl, 'oppRecommendedScore')}; return oppRecommendedScore;`,
)() as (o: Record<string, unknown>) => number;

// helper: a date N days from the pinned TODAY (2026-07-28)
function plusDays(n: number): string {
  const d = new Date(2026, 6, 28, 12, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('oppRecommendedScore — relevance, not just soonest deadline', () => {
  it('an opp in the actionable window (~3 wks out) outranks a due-in-1-day one you can barely start', () => {
    const actionable = oppRecommendedScore({ src: 'SAM', close: plusDays(21), posted: plusDays(-5), set: 'SDVOSB', est: 5_000_000, docs: true });
    const dueTomorrow = oppRecommendedScore({ src: 'SAM', close: plusDays(1), posted: plusDays(-40), set: 'None', est: 0, docs: false });
    expect(actionable).toBeGreaterThan(dueTomorrow);
  });

  it('a recently-posted opp beats an otherwise-identical stale one', () => {
    const fresh = oppRecommendedScore({ src: 'SAM', close: plusDays(20), posted: plusDays(-2), set: 'None', est: 1e6, docs: false });
    const stale = oppRecommendedScore({ src: 'SAM', close: plusDays(20), posted: plusDays(-55), set: 'None', est: 1e6, docs: false });
    expect(fresh).toBeGreaterThan(stale);
  });

  it('a set-aside opp gets a boost over an identical open-competition one', () => {
    const sa = oppRecommendedScore({ src: 'SAM', close: plusDays(20), posted: plusDays(-3), set: 'WOSB', est: 1e6, docs: false });
    const open = oppRecommendedScore({ src: 'SAM', close: plusDays(20), posted: plusDays(-3), set: 'None', est: 1e6, docs: false });
    expect(sa).toBeGreaterThan(open);
  });

  it('an already-closed opp scores near the bottom', () => {
    const closed = oppRecommendedScore({ src: 'SAM', close: plusDays(-3), posted: plusDays(-30), set: 'SDVOSB', est: 1e7, docs: true });
    const openWindow = oppRecommendedScore({ src: 'SAM', close: plusDays(15), posted: plusDays(-30), set: 'None', est: 0, docs: false });
    expect(openWindow).toBeGreaterThan(closed);
  });

  it('never NaN on missing fields (no deadline, no value, no posted date)', () => {
    const s = oppRecommendedScore({ src: 'SAM' });
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe('the Open Recommended blend is wired for the default sort only', () => {
  it('sortRows default scores open opps but RECOMPETE keeps deadline order', () => {
    const body = extractFn(tmpl, 'sortRows');
    expect(body).toContain('oppRecommendedScore(a)');
    expect(body).toContain("a.src!=='RECOMPETE'");
    // explicit sorts untouched
    expect(body).toContain("case 'value'");
    expect(body).toContain("case 'az'");
  });
  it('the served template-html.ts carries the same blend (sync guard)', () => {
    const ts = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');
    expect(ts).toContain('oppRecommendedScore');
  });
});
