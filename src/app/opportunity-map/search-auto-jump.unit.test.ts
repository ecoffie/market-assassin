/**
 * A search whose matches are all outside the current viewport must JUMP the map to them (Eric
 * 2026-07-28: searched "tavares" while viewing Europe → "0 in view · 4 match", empty map). Zillow
 * moves the map to search results; so does this now. Fires once per query (not on every pan).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('search auto-jumps the map to off-screen results', () => {
  it('maybeJumpToSearch zooms to national when a search has matches but 0 are in view', () => {
    expect(route).toContain('function maybeJumpToSearch()');
    expect(route).toContain('(INVIEW||0)>0 || (TOTAL||0)===0) return false'); // only jump when 0-in-view AND matches exist
    expect(route).toContain('map.setView([38,-96], 4');
  });
  it('fires ONCE per query (guarded by _searchJumpedFor), not on every subsequent pan', () => {
    expect(route).toContain('if(_searchJumpedFor===Q) return false');
    expect(route).toContain("_searchJumpedFor=Q");
  });
  it('both fetch handlers (opps + contacts) call maybeJumpToSearch after rendering', () => {
    const calls = (route.match(/maybeJumpToSearch\(\)/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(3); // 1 def + 2 call sites
  });
  it('contacts INVIEW reflects real pins-in-view (so the jump + count hint are correct)', () => {
    expect(route).toContain('INVIEW=(d.pins||[]).length');
  });
});
