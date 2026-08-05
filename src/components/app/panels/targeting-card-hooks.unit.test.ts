/**
 * TargetingCard — Rules of Hooks guard (Eric 2026-08-05, LIVE INCIDENT).
 *
 * PR #948 added `const [impressionSent] = useState(false)` + a `useEffect` AFTER the component's
 * `if (loading || !data) return null;` early return. On first render (loading=true) React returned
 * before those hooks; on the next render (data loaded) it ran them → React error #310 "rendered more
 * hooks than during the previous render" → the WHOLE /app dashboard crashed to the error boundary for
 * every signed-in user the moment their targeting loaded. A green build + tsc + the existing
 * source-assert tests all passed — a hooks-order violation is a RUNTIME error none of them catch.
 *
 * This test is the static guard the toolchain was missing: EVERY hook call in the component body must
 * appear BEFORE the `return null` guard. If a future edit drops a hook below the guard again, this
 * fails at unit-test time instead of crashing prod.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rawSrc = readFileSync(join(__dirname, 'TargetingCard.tsx'), 'utf8');

// Strip line + block comments FIRST — this file explains the #310 bug in prose that quotes the exact
// guard line and hook names, which would otherwise fool a substring scan (that ambiguity is itself a
// sibling-gate lesson). We blank comment lines (keep line numbers) and remove /* */ blocks.
const noBlock = rawSrc.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const src = noBlock
  .split('\n')
  .map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\/\/.*$/, '')))
  .join('\n');

describe('TargetingCard — every hook runs before the early-return guard (React #310 guard)', () => {
  // Slice the component body (from the default export to the file end) so we don't match the
  // helper functions / interfaces above it.
  const compStart = src.indexOf('export default function TargetingCard(');
  const body = src.slice(compStart);
  const lines = body.split('\n');

  it('the `if (loading || !data) return null;` guard exists', () => {
    expect(body).toMatch(/if \(loading \|\| !data\) return null;/);
  });

  it('NO hook call appears AFTER the early-return guard (the exact #310 shape from PR #948)', () => {
    const guardLine = lines.findIndex((l) => /if \(loading \|\| !data\) return null;/.test(l));
    expect(guardLine, 'guard must be present').toBeGreaterThan(-1);

    // A real hook CALL at statement position: `useState(`, `useEffect(`, `useCallback(`, etc.
    // (indented, not inside a comment). Comments mentioning "useEffect" don't match because the
    // token must be immediately followed by `(`. We scan every line below the guard.
    const HOOK = /^\s*(const\s+.*=\s*)?use(State|Effect|Callback|Memo|Ref|Reducer|Context|LayoutEffect)\s*\(/;
    const offenders: number[] = [];
    for (let i = guardLine + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // skip comment lines
      if (HOOK.test(line)) offenders.push(i + 1);
    }
    expect(
      offenders,
      `hook call(s) found AFTER the return-null guard (line-in-slice ${offenders.join(', ')}) — move them above the guard; a hook after an early return is React #310`,
    ).toEqual([]);
  });

  it('the impression hooks specifically sit ABOVE the guard', () => {
    const impressionState = body.indexOf('const [impressionSent, setImpressionSent] = useState(false)');
    const guard = body.indexOf('if (loading || !data) return null;');
    expect(impressionState, 'impressionSent useState must exist').toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(impressionState).toBeLessThan(guard); // hook BEFORE the return, not after
  });
});
