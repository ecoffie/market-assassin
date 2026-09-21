/**
 * Explore is INTENT search — the box invites natural-language queries ("Show me Army, Navy, VA"),
 * NOT identifier lookup (Eric 2026-08-03: "since we are in the explore map I don't think we should
 * say show contract # or uei, it should be show me army, navy VA"). Two surfaces carried the old
 * identifier framing: the input PLACEHOLDER and the empty-state hint. This locks both to the NL
 * framing so a regression can't reintroduce "Contract #, company, UEI".
 *
 * (Contract#/company/UEI still RESOLVE if typed — nothing was narrowed in the parser; only the
 * teaching copy changed.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// Strip line comments so a comment that QUOTES the old phrase (explaining the fix) doesn't
// false-trigger the absence assertion.
const code = route.replace(/^\s*\/\/.*$/gm, '');

describe('Explore search prompt — natural-language, not identifier lookup', () => {
  it('placeholder invites an NL query (Army/Navy/VA), not "Contract #, company, UEI"', () => {
    expect(code).toContain('placeholder="Show me Army, Navy, VA opportunities');
    // the old identifier-lookup placeholder must be gone from the rendered input
    expect(code).not.toContain('placeholder="Contract #, company, UEI, or market');
  });

  it('empty-state seeds clickable NL example queries (not a passive "will appear here")', () => {
    // real, clickable example rows through the same data-act="run" → runSearch → parseSearchIntent path
    expect(code).toContain("'Show me Army opportunities'");
    expect(code).toContain("'Biggest VA contractors in Florida'"); // a Network-routed example too
    expect(code).toContain('Try a search');
    // the passive placeholder-copy is gone
    expect(code).not.toContain('Your recent and saved searches will appear here.');
  });

  it('the example rows use the proven run-path (data-act="run" → runSearch)', () => {
    // the empty-state chips must be the same button shape the recents rows use, so the click
    // handler (act==='run' → runSearch) already carries them into the NL parser
    expect(code).toContain('data-act="run" data-q="\'+esc(q)+\'"');
    expect(code).toContain("else if(act==='run'){ runSearch(el.getAttribute('data-q')||''); }");
  });
});
