/**
 * NO-FABRICATION / HONEST-NULL invariants (Eric's real-run praise 2026-07-28, memory
 * `mcp_tool_strengths_to_protect`). The single most important property of Mindy's retrieval tools:
 * every hole is an HONEST empty (grounded:false, zero rows), NEVER an invented result — a made-up
 * incumbent or POC sends a real capture down a wrong, expensive path. These invariants were untested,
 * so a refactor could quietly erode them. This is a SOURCE-assertion guard (the tools hit live APIs,
 * so we assert the structural properties that make them non-fabricating rather than call them):
 *   - `grounded` is gated on a REAL row count / match — never hardcoded true.
 *   - `degraded` (upstream error) is a SEPARATE signal from a genuine empty (so "errored" ≠ "no data").
 *   - `_meta` always ships with both flags.
 * Defends `mcp_tool_strengths_to_protect` #4/#5/#7. If you change one of these tools and this test
 * fails, you likely regressed the honest-null discipline — that is the thing to protect, not the test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

const HONEST_NULL_TOOLS = [
  // hasUpstream = has a live API/cache that can ERROR (→ a real degraded state distinct from empty).
  // federal-osbp reads curated STATIC data, so it has no degraded state — grounded/empty only.
  { file: 'contractor-award-history.ts', hasUpstream: true, groundOn: /grounded\s*=\s*!!history\s*&&\s*\(history\.summary\?\.awardCount\s*\?\?\s*0\)\s*>\s*0/ },
  { file: 'sam-entity.ts', hasUpstream: true, groundOn: /grounded\s*=\s*matchCount\s*>\s*0/ },
  { file: 'federal-osbp.ts', hasUpstream: false, groundOn: /grounded\s*=\s*resolvedOffice\s*!==\s*null\s*\|\|\s*related\.length\s*>\s*0/ },
];

describe('honest-null invariant — grounded is gated on a real result, never fabricated', () => {
  for (const t of HONEST_NULL_TOOLS) {
    const src = read(t.file);
    it(`${t.file}: grounded is computed from a real count/match (not hardcoded true)`, () => {
      expect(src).toMatch(t.groundOn);
      // grounded must never be unconditionally true in the result object.
      expect(src).not.toMatch(/grounded:\s*true\s*,(?!\s*\/\/)/);
    });
    it(`${t.file}: degraded (upstream error) is a SEPARATE signal from empty`, () => {
      // Both flags must exist as distinct concepts so "the API errored" is never reported as "this
      // firm has no history". A tool with a live upstream must set degraded=true on an error; a
      // static-data tool has no degraded state (only grounded/empty).
      expect(src).toMatch(/degraded:/);
      if (t.hasUpstream) expect(src, `${t.file} has a live upstream → must flag degraded on error`).toMatch(/degraded\s*=\s*true/);
    });
    it(`${t.file}: _meta always ships grounded + degraded`, () => {
      expect(src).toMatch(/_meta:\s*{[\s\S]*grounded[\s\S]*degraded/);
    });
  }
});

describe('honest-null invariant — the empty/miss branch says "none", never invents', () => {
  it('contractor-award-history: the no-history hint states the honest miss (new/inactive filer)', () => {
    const src = read('contractor-award-history.ts');
    expect(src).toMatch(/no cached award history|new\/inactive filer/i);
  });
  it('federal-osbp: an unrecognized office returns match:none, grounded:false — not a guessed office', () => {
    const src = read('federal-osbp.ts');
    expect(src).toMatch(/grounded:\s*false,\s*degraded:\s*false,\s*match:\s*'none'/);
  });
});
