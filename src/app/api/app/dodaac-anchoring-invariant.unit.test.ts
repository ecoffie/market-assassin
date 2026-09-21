/**
 * DoDAAC office-anchoring invariant (Eric's #1 real-run standout, memory
 * `mcp_tool_strengths_to_protect`). When a contact query is anchored to a specific buying office by a
 * valid DoDAAC (a target's office_code, e.g. W912PL LA District, N00174 Indian Head), it must return
 * REAL POCs at THAT office — NOT the whole-DoD firehose. The memory's rule: "a card jumping to 8,000+
 * is the bug, not the fix." NEVER regress to a dept-wide fallback when a valid DoDAAC is present.
 *
 * Source-assertion guard (the route hits Supabase, so we assert the structural properties that keep
 * the anchoring precise):
 *   - a valid DoDAAC filters solicitation_number by that office prefix + sets an "anchored" flag,
 *   - the anchored flag SUPPRESSES the dept-wide keyword fallback,
 *   - the office ILIKE (which fails on the ~always-NULL office column) is SKIPPED when anchored,
 *   - DoDAAC validity is a strict 6-char shape (a junk code must NOT anchor, or it'd match nothing
 *     and silently drop to a worse path).
 * If this test fails, the office-anchoring likely regressed toward the dept-wide fallback.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'federal-contacts/route.ts'), 'utf8');

describe('DoDAAC office-anchoring — precise, never dept-wide (memory: mcp_tool_strengths_to_protect #1)', () => {
  it('a valid DoDAAC filters solicitation_number by the office prefix', () => {
    expect(src).toMatch(/if\s*\(validDodaac\)\s*{[\s\S]*ilike\('solicitation_number',\s*`\$\{validDodaac\}%`\)/);
  });

  it('anchoring sets a flag that SUPPRESSES the dept-wide fallback', () => {
    // the fallback branches must be gated on !anchoredByDodaac — so an anchored query never falls
    // through to the whole-department keyword match.
    expect(src).toContain('anchoredByDodaac = true');
    expect(src).toMatch(/if\s*\(agency\s*&&\s*!anchoredByDodaac\)/);
  });

  it('the office ILIKE is skipped when anchored (the office column is ~always NULL)', () => {
    // office && !validDodaac — anchoring bypasses the office filter that would exclude the real POCs.
    expect(src).toMatch(/if\s*\(office\s*&&\s*!validDodaac\)\s*q\s*=\s*q\.ilike\('office'/);
  });

  it('sub-agency narrowing is skipped when a DoDAAC pins the office', () => {
    // the auto-narrow block is guarded by !validDodaac so it can't drop the office's own POCs.
    expect(src).toMatch(/if\s*\(!validDodaac\)\s*{/);
  });

  it('DoDAAC validity is a strict 6-char shape — junk does NOT anchor', () => {
    // a letter + 5 alphanumerics; anything else → '' → the anchored path never engages on junk.
    expect(src).toMatch(/validDodaac\s*=\s*\/\^\[A-Z\]\[A-Z0-9\]\{5\}\$\/\.test\(dodaacRaw\)\s*\?\s*dodaacRaw\s*:\s*''/);
  });
});

// Pure-logic mirror of the DoDAAC shape check, so the exact acceptance set is pinned.
describe('DoDAAC shape acceptance (mirror of the route guard)', () => {
  const isValidDodaac = (s: string) => /^[A-Z][A-Z0-9]{5}$/.test(s.trim().toUpperCase());
  it('accepts real 6-char DoDAACs', () => {
    for (const c of ['W912PL', 'N00174', 'W15QKN', 'W912BV', 'HR0011']) expect(isValidDodaac(c), c).toBe(true);
  });
  it('rejects junk that must not anchor (too short/long, dept names, empty)', () => {
    for (const c of ['', 'DOD', 'W912', 'W912PLX', 'DEPT OF DEFENSE', '123456']) {
      expect(isValidDodaac(c), c).toBe(false);
    }
  });
});
