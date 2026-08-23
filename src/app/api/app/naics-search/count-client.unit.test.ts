import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Head-counts must go through getCountClient().
 *
 * The Supabase read replica rejects EVERY HTTP HEAD request with a 400, and supabase-js
 * issues a HEAD for `{ count: 'exact', head: true }`. So a head-count through
 * getReadClient() works locally (no replica → falls through to primary) and fails silently
 * in production (replica configured).
 *
 * That is exactly what happened on 2026-08-23: /api/app/naics-search shipped with
 * getReadClient(), passed every local test, and returned NO counts on production —
 * "324110 Petroleum Refineries | open None" for the code a customer had just reported as
 * missing.
 *
 * It was visible only because the route BINDS the error instead of writing `count ?? 0`.
 * A coalesced zero would have rendered "0 open" — telling Hector we have no fuel contracts,
 * which is the precise lie this route was built to fix.
 */
// Relative to THIS file, not process.cwd() — under a git worktree cwd resolves to the main
// checkout and the test would read a different copy of the route than the one being changed.
const SRC = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('naics-search count client', () => {
  // Strip comments before asserting — the file explains this trap in prose, and matching
  // prose would fail on its own documentation.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('uses getCountClient, never getReadClient, for head-counts', () => {
    expect(CODE).toContain('getCountClient()');
    expect(CODE).not.toContain('getReadClient(');
  });

  it('binds the error rather than coalescing a failed count to zero', () => {
    // `?? 0` is fine INSIDE the error-checked branch (a successful count of nothing is 0).
    // What must never appear is a bare coalesce with no error bound.
    expect(CODE).toMatch(/r\.error\s*\?\s*undefined\s*:\s*\(r\.count\s*\?\?\s*0\)/);
  });
});
