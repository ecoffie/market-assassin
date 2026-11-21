/**
 * Ask Mindy regression set (spec section 9), version 1. Loads the versioned fixture and checks an answer
 * against the machine-checkable rules (`globalProhibited`). Grader behaviors (graderMustInclude /
 * graderMustNotInclude) are for a human or a later model grader: they are never auto-passed here.
 */
import set from './__fixtures__/regression-set.v1.json';
import type { AskMindyProfile, RecipeId } from './recipes';

export interface RegressionCase {
  id: string;
  question: string;
  profile: string;
  expectedRecipe: RecipeId;
  expectedVia?: 'rule' | 'model' | 'fallback';
  expectProfileFirst?: boolean;
  expectedIdentifiers?: Record<string, string>;
  notImplementedYet?: boolean;
  graderMustInclude?: string[];
  graderMustNotInclude?: string[];
}

export const REGRESSION_VERSION: number = set.version;
export const REGRESSION_CASES: readonly RegressionCase[] = set.cases as RegressionCase[];

/** The case's profile with the fixture's notes (keys starting with "_") removed. */
export function profileFor(c: RegressionCase): AskMindyProfile {
  const raw = (set.profiles as Record<string, Record<string, unknown>>)[c.profile];
  if (!raw) throw new Error(`regression case ${c.id}: unknown profile "${c.profile}"`);
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_'))) as AskMindyProfile;
}

export interface ProhibitedHit { id: string; why: string; match: string }

/** Machine-checkable violations in an answer (empty array = none found). */
export function prohibitedHits(answer: string): ProhibitedHit[] {
  const hits: ProhibitedHit[] = [];
  for (const rule of set.globalProhibited) {
    const m = answer.match(new RegExp(rule.pattern, rule.flags));
    if (m) hits.push({ id: rule.id, why: rule.why, match: m[0] });
  }
  return hits;
}
