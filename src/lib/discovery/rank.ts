/**
 * Stage 5 of Canonical Discovery — RANKING. Runs only over records the eligibility predicate
 * admitted; it can reorder, never admit.
 *
 * ORDER: breadth of ELIGIBLE concepts matched first (decision 2: breadth ranks), then
 * score = Σ over matched concepts of (class weight × best position weight)
 *   class weight: distinctive 1 · generic from the corpus-measured COMMON_TERM_WEIGHT (else 0.25–0.35)
 *   position:     title 3 · sow 1.5 · description 1 · any other field 1
 * Breadth (how many of the query's concepts a record carries) is what lifts a real multi-capability
 * match above a record that happens to mention one word — Andre's "cyber cloud compliance network
 * server" is the reference case. Word-bounded via the SAME regexes that decide eligibility.
 */
import { conceptHit, type Concept } from './matcher';
import type { DiscoveryPlan } from './plan';

const POSITION: Record<string, number> = { title: 3, sow_text: 1.5, description: 1 };

export interface ScoredRecord<T> {
  row: T;
  score: number;
  matched: string[];
  /** Eligible concepts matched — the primary sort key. */
  breadth: number;
}

export function rankingConcepts(plan: DiscoveryPlan): Concept[] {
  const out: Concept[] = [];
  const seen = new Set<string>();
  for (const a of plan.matcher.alternatives) for (const c of [...a.eligible, ...a.rankOnly]) {
    if (seen.has(c.label)) continue;
    seen.add(c.label);
    out.push(c);
  }
  return out;
}

export function rankRecords<T extends Record<string, unknown>>(plan: DiscoveryPlan, rows: T[], fields: string[]): ScoredRecord<T>[] {
  const concepts = rankingConcepts(plan);
  const eligibleLabels = new Set(plan.matcher.alternatives.flatMap((a) => a.eligible.map((c) => c.label)));
  const scored = rows.map((row, i) => {
    let score = 0;
    let breadth = 0;
    const matched: string[] = [];
    for (const c of concepts) {
      let best = 0;
      for (const f of fields) {
        const v = row[f];
        if (typeof v === 'string' && v && conceptHit(c, v)) best = Math.max(best, POSITION[f] ?? 1);
      }
      if (best) { score += c.weight * best; matched.push(c.label); if (eligibleLabels.has(c.label)) breadth++; }
    }
    return { row, score, matched, breadth, i };
  });
  scored.sort((a, b) => b.breadth - a.breadth || b.score - a.score || a.i - b.i);
  return scored.map(({ i: _i, ...r }) => r);
}
