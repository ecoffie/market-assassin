/**
 * STRUCTURAL GUARD — added after a runtime-only defect that typecheck and 3,227 tests missed.
 *
 * An edit injected the DEFECT-10 caveat INTO buildQuery(), referencing `sizeCounts` and
 * `unresolvedExceptions` ~170 lines before they are declared. `const` is not hoisted, so every
 * call threw ReferenceError and assess_market_depth returned degraded:true for EVERY market —
 * including a 3-firm control. TypeScript did not flag it (the identifiers exist in scope) and
 * no unit test executes that branch.
 *
 * These assertions read the SOURCE, which is normally the weak pattern Task 0 warned about.
 * Justified here precisely because the failure is invisible to both the typechecker and the
 * existing suite: it is about WHERE code sits, not what it computes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'market-research.ts'), 'utf8');

describe('market-research.ts structure', () => {
  it('sizeCounts is DECLARED before any use', () => {
    const decl = SRC.indexOf('const sizeCounts =');
    expect(decl).toBeGreaterThan(-1);
    // every other mention must come after the declaration
    let i = SRC.indexOf('sizeCounts');
    expect(i).toBe(decl + 'const '.length);
  });

  it('unresolvedExceptions is DECLARED before any use', () => {
    const decl = SRC.indexOf('const unresolvedExceptions =');
    const firstUse = SRC.indexOf('unresolvedExceptions');
    expect(decl).toBeGreaterThan(-1);
    expect(firstUse).toBe(decl + 'const '.length);
  });

  it('buildQuery() contains no caveat push — it builds a query, nothing else', () => {
    const start = SRC.indexOf('const buildQuery = ()');
    const end = SRC.indexOf('POOL_TARGET', start);
    expect(start).toBeGreaterThan(-1);
    expect(SRC.slice(start, end)).not.toContain('caveats.push');
  });

  it('the exception caveat sits after sizeCounts is computed', () => {
    expect(SRC.indexOf('const sizeCounts ='))
      .toBeLessThan(SRC.indexOf('SBA SIZE-STANDARD EXCEPTIONS APPLY'));
  });
});
