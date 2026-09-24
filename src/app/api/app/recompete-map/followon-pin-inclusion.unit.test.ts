/**
 * Captured follow-ons must ALWAYS pin on the recompete-map (Eric 2026-07-28). They expire the latest
 * (3-5yr out), so the expiry-ascending sort + MAX_PINS cap buries them at a broad zoom — yet they're
 * the freshest intelligence. The route fetches them separately and merges any the capped set missed,
 * deduped by contract_id. These tests pin that logic (source-level; the query itself is integration).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Since Recompete Gate 2 the route's reads + response builder live in recompete-map-paths.ts.
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8')
  + readFileSync(join(__dirname, '../../../../lib/recompete/recompete-map-paths.ts'), 'utf8');

describe('recompete-map always includes captured follow-ons', () => {
  it('runs a separate follow-on fetch scoped to data_source=usaspending_followon + same bbox/filters', () => {
    // Gate 1 (2026-09-24): the follow-on read lives in map-follow-ons.ts and is planner-independent
    // (candidates first, then the SAME filters on those ids). Behavior: deterministic-page.unit.test.ts.
    const lib = readFileSync(join(__dirname, '../../../../lib/recompete/map-follow-ons.ts'), 'utf8');
    expect(lib).toContain("export const FOLLOW_ON_SOURCE = 'usaspending_followon';");
    expect(lib).toContain(".eq('data_source', FOLLOW_ON_SOURCE).in('contract_id', chunk)");
    expect(route).toContain('fetchFollowOnRows({');
    expect(route).toContain('applyPlan: (q) => applyFilters(q),');
    expect(route).toContain('bbox, cols: RECOMPETE_PIN_COLS, cap: MAX_PINS,');
  });
  it('merges follow-ons deduped by contract_id (never double-pins one already in the capped set)', () => {
    expect(route).toContain('const seen = new Set(rows.map(cid))');
    expect(route).toContain('!seen.has(cid(x))');
    expect(route).toContain('[...rows, ...extraFollowOns].map(toPin)');
  });
  it('uses the shared toPin so map + by-id cannot drift', () => {
    expect(route).toMatch(/from '(@\/lib\/recompete|\.)\/map-pin'/);
  });
});
