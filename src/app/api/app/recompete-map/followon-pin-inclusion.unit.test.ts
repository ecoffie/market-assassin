/**
 * Captured follow-ons must ALWAYS pin on the recompete-map (Eric 2026-07-28). They expire the latest
 * (3-5yr out), so the expiry-ascending sort + MAX_PINS cap buries them at a broad zoom — yet they're
 * the freshest intelligence. The route fetches them separately and merges any the capped set missed,
 * deduped by contract_id. These tests pin that logic (source-level; the query itself is integration).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('recompete-map always includes captured follow-ons', () => {
  it('runs a separate follow-on fetch scoped to data_source=usaspending_followon + same bbox/filters', () => {
    expect(route).toContain("eq('data_source', 'usaspending_followon')");
    expect(route).toContain('followOnQ');
  });
  it('merges follow-ons deduped by contract_id (never double-pins one already in the capped set)', () => {
    expect(route).toContain('const seen = new Set(rows.map(cid))');
    expect(route).toContain('!seen.has(cid(r))');
    expect(route).toContain('[...rows, ...extraFollowOns].map(toPin)');
  });
});
