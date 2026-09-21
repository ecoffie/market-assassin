/**
 * Search must not be silently dropped when a fetch is in flight (Eric 2026-07-28: "search doesn't
 * work"). Typing a query fires fetchView() debounced; if a prior fetch was still running, the old
 * `if(busy)return` no-op'd and the search never fired. Now it marks a pending re-fetch that runs on
 * completion with the CURRENT state, so the latest search always wins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('search is queued, not dropped, when a fetch is in flight', () => {
  it('a busy fetchView marks pendingFetch instead of no-op returning', () => {
    expect(route).toContain('if(busy){ pendingFetch=true; return; }');
    expect(route).not.toContain('if(busy)return;'); // the old drop-the-request behavior is gone
  });
  it('afterFetch re-runs fetchView when a request came in while busy', () => {
    expect(route).toContain('function afterFetch()');
    expect(route).toContain('if(pendingFetch)');
    expect(route).toContain('fetchView();');
  });
  it('afterFetch() is called at EVERY fetch-completion site (then + catch, both endpoints)', () => {
    const calls = (route.match(/afterFetch\(\)/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(5); // 1 def + 4 call sites (2 then, 2 catch)
  });
});
