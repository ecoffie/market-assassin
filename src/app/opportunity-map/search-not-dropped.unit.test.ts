/**
 * Search must not be silently dropped when a fetch is in flight (Eric 2026-07-28: "search doesn't
 * work"). The original fix queued a re-fetch behind a busy flag; that queue then let SUPERSEDED
 * requests paint (the 2026-09-24 "Start fresh" defect). Maps P0 replaced it with NEWEST ACTION WINS:
 * every fetchView() is scheduled, calls in one tick collapse into one round, and a new round runs
 * immediately — it is never dropped and never waits behind an older one. Behavior is proven in
 * newest-action-wins.unit.test.ts; this file guards the shape against a regression to either
 * failure mode.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('search is never dropped, and never waits behind a stale fetch', () => {
  it('the old drop-the-request behavior is gone', () => {
    expect(route).not.toContain('if(busy)return;');
  });
  it('no busy queue either — a new round is never held behind an in-flight one', () => {
    expect(route).not.toContain('if(busy){ pendingFetch=true; return; }');
    expect(route).not.toContain('function afterFetch()');
  });
  it('fetchView only schedules, and the scheduled round always runs with the CURRENT state', () => {
    expect(route).toContain('function fetchView(opts){');
    // Maps P1: the scheduled run may wait one frame (so an acknowledgement paints first) — it still only
    // schedules, and _fetchViewNow reads the state AT RUN TIME.
    expect(route).toContain('var run=function(){ _fvTimer=0; var t0=_fvT0; _fvT0=0; _fetchViewNow(t0); };');
    expect(route).toContain('requestAnimationFrame(function(){ _fvTimer=setTimeout(run,0); });');
    expect(route).toContain('else _fvTimer=setTimeout(run,0);');
  });
  it('every response is generation-checked before it can paint', () => {
    expect(route).toContain('if(gen!==_fetchGen)return;');
    expect(route).toContain('if(cgen!==_fetchGen)return;');
  });
});
