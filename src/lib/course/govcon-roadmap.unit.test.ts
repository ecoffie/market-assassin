import { describe, expect, it } from 'vitest';
import { ACTION_PLAN_STEPS } from '@/lib/learn/action-plan';
import { COURSE_LESSONS, ROADMAP_STAGES, nextLesson, stageFromAnswers, stageSteps } from './govcon-roadmap';

describe('GovCon roadmap course', () => {
  it('places every Action Plan step in exactly one stage', () => {
    const placed = ROADMAP_STAGES.flatMap((s) => s.steps);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(ACTION_PLAN_STEPS.map((s) => s.id).sort());
    for (const s of ROADMAP_STAGES) expect(() => stageSteps(s)).not.toThrow();
  });

  it('numbers stages 0..6 in order with unique slugs', () => {
    expect(ROADMAP_STAGES.map((s) => s.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const slugs = COURSE_LESSONS.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(nextLesson('start-here')?.slug).toBe('context');
    expect(nextLesson('free-bonus')).toBeNull();
  });

  it('only links Mindy to internal pages', () => {
    for (const s of ROADMAP_STAGES) for (const m of s.mindy) expect(m.href.startsWith('/')).toBe(true);
  });

  it('picks the first unmet rung of the ladder', () => {
    expect(stageFromAnswers({})).toBe(0);
    expect(stageFromAnswers({ sam: 'unsure', basics: 'yes' })).toBe(0);
    expect(stageFromAnswers({ sam: 'yes', basics: 'yes' })).toBe(1);
    expect(stageFromAnswers({ sam: 'yes', basics: 'yes', buyers: 'yes' })).toBe(2);
    expect(stageFromAnswers({ sam: 'yes', basics: 'yes', buyers: 'yes', bid: 'yes' })).toBe(3);
    const won = { sam: 'yes', basics: 'yes', buyers: 'yes', bid: 'yes', win: 'yes' };
    expect(stageFromAnswers({ ...won, revenue: 'none' })).toBe(4);
    expect(stageFromAnswers({ ...won, revenue: 'under1m' })).toBe(5);
    expect(stageFromAnswers({ ...won, revenue: 'over1m' })).toBe(6);
  });
});
