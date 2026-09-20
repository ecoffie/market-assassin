/**
 * Proposal drafting is the highest-stakes consumer of the strategic corpus: it
 * writes into a document the customer sends to the government. Before this
 * change, `formatAgencyContextForPrompt` fed the drafting model:
 *
 *   **Stated strategic priorities:**
 *   - $6.2B allocated for hypersonic weapons development in FY2025-2026
 *
 * "Stated" asserts the agency said it. Measured: 2,500 priorities, 0 with a
 * source URL. 8 of 10 DoD priorities carried a dollar figure.
 */
import { describe, it, expect } from 'vitest';
import { buildAgencyContext, formatAgencyContextForPrompt } from './agency-context';

const AGENCIES = [
  'Department of Defense',
  'Department of Veterans Affairs',
  'National Aeronautics and Space Administration',
  'General Services Administration',
];

describe('a generated proposal cannot assert an unsourced agency statement', () => {
  for (const agency of AGENCIES) {
    it(`${agency}: no unsourced dollar figure reaches the drafting prompt`, () => {
      const ctx = buildAgencyContext('', agency);
      // The claim lists themselves must be dollar-free…
      for (const claim of [...ctx.painPoints, ...ctx.priorities]) {
        expect(claim).not.toMatch(/\$\s?[\d,.]+\s*(B|M|K|T|billion|million|trillion)\b/i);
      }
    });
  }

  it('the prompt never calls legacy content "stated" or "current"', () => {
    const p = formatAgencyContextForPrompt(buildAgencyContext('', 'Department of Defense'));
    expect(p).not.toMatch(/\*\*Stated strategic priorities/i);
    expect(p).not.toMatch(/Current pain points the agency is solving for/i);
  });

  it('the prompt labels the corpus as unsourced and forbids citing it', () => {
    const p = formatAgencyContextForPrompt(buildAgencyContext('', 'Department of Defense'));
    expect(p).toMatch(/unsourced context/i);
    expect(p).toMatch(/do NOT cite as agency statements/i);
    expect(p).toMatch(/never write them as facts the agency published/i);
  });

  it('the ONE numeric claim that survives is the one that can be cited', () => {
    const p = formatAgencyContextForPrompt(buildAgencyContext('', 'Department of Defense'));
    const dollars = p.match(/\$[\d,.]+B/g) ?? [];
    // Budget trend (FY25 → FY26) only — and it carries its source line.
    expect(dollars.length).toBeGreaterThan(0);
    const budgetLineIdx = p.indexOf('**Budget trend:**');
    expect(budgetLineIdx).toBeGreaterThan(-1);
    for (const d of dollars) expect(p.indexOf(d)).toBeGreaterThan(budgetLineIdx);
    expect(p).toMatch(/_Source: .*whitehouse\.gov.*as of \d{4}-\d{2}-\d{2}_/);
  });

  it('context still carries real themes — this removed attribution, not usefulness', () => {
    const ctx = buildAgencyContext('', 'Department of Defense');
    expect(ctx.painPoints.length).toBeGreaterThan(0);
    expect(ctx.priorities.length).toBeGreaterThan(0);
    expect(ctx.priorities.join(' ')).toMatch(/hypersonic|Pacific Deterrence|JADC2|Space Force/i);
  });
});
