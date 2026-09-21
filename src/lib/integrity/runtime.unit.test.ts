import { describe, it, expect } from 'vitest';
import {
  checkRelation, checkRelations, classifyOperation, isOperationalSuccess, operationResponse,
  checkClassifier,
  type CountingClient,
} from './runtime';

/**
 * PHASE 2 RULE (Eric): "every new control should be proven against the ACTUAL production
 * incident that created the class. If the control can't reproduce and block the original
 * failure shape, it doesn't count as coverage."
 *
 * So each block below replays a real incident rather than a synthetic case.
 */

/** A fake PostgREST that reproduces the exact response shapes we measured on 2026-08-23. */
function fakeDb(shape: Record<string, { count: number | null; error: string | null }>): CountingClient {
  return {
    from(table: string) {
      return {
        select: async () => {
          const r = shape[table] ?? { count: null, error: null }; // unknown table = missing
          return { count: r.count, error: r.error ? { message: r.error } : null };
        },
      };
    },
  };
}

describe('INT-003 — missing relation masquerading as empty', () => {
  // MEASURED 2026-08-23: a missing relation answers count=null / HTTP 204 / error=null,
  // while a genuinely empty table answers count=0 / HTTP 200.
  const db = fakeDb({
    forecast_sources: { count: 11, error: null },              // the REAL table
    forecast_coverage_dashboard: { count: null, error: null },  // the phantom one
    empty_but_real: { count: 0, error: null },
    locked_down: { count: null, error: 'permission denied' },
  });

  it('BLOCKS the original incident: forecast_coverage_dashboard is reported missing, not empty', async () => {
    const r = await checkRelation(db, 'forecast_coverage_dashboard');
    expect(r.state).toBe('missing');
    expect(r.rows).toBeNull();          // NOT 0 — that zero is what shipped "0 sources / 80% gap"
    expect(r.detail).toMatch(/INT-003/);
  });

  it('does NOT flag a table that genuinely exists and is empty', async () => {
    const r = await checkRelation(db, 'empty_but_real');
    expect(r.state).toBe('exists');
    expect(r.rows).toBe(0);             // a MEASURED zero is legitimate
  });

  it('separates unreadable (a real error) from missing (no error at all)', async () => {
    expect((await checkRelation(db, 'locked_down')).state).toBe('unreadable');
    expect((await checkRelation(db, 'forecast_coverage_dashboard')).state).toBe('missing');
  });

  it('confirms the real table the incident should have used', async () => {
    const r = await checkRelation(db, 'forecast_sources');
    expect(r.state).toBe('exists');
    expect(r.rows).toBe(11);            // the figure the admin should have seen
  });

  it('reports only the relations that are not established', async () => {
    const bad = await checkRelations(db, ['forecast_sources', 'forecast_coverage_dashboard', 'empty_but_real']);
    expect(bad.map((b) => b.table)).toEqual(['forecast_coverage_dashboard']);
  });
});

describe('INT-006 — no work performed, but the operation reports success', () => {
  it('BLOCKS the original incident: weekly-digest had an audience and did nothing', () => {
    // The real shape: every user's plan rows came back null (the table does not exist),
    // the loop `continue`d on all of them, and the route returned success: true.
    const evidence = { audience: 900, affected: 0, missingSource: 900 };
    expect(classifyOperation(evidence)).toBe('blocked');
    expect(isOperationalSuccess(classifyOperation(evidence))).toBe(false);
    expect(operationResponse(evidence).success).toBe(false);
  });

  it('classifies "had work, did none" as no_op — not success', () => {
    expect(classifyOperation({ audience: 500, affected: 0 })).toBe('no_op');
    expect(operationResponse({ audience: 500, affected: 0 }).success).toBe(false);
  });

  it('an empty audience IS a legitimate success', () => {
    expect(classifyOperation({ audience: 0, affected: 0 })).toBe('succeeded');
  });

  it('all-legitimately-skipped is a success (deduped, opted out, already sent)', () => {
    expect(classifyOperation({ audience: 75, affected: 0, skipped: 75 })).toBe('succeeded');
  });

  it('unfinished work is partial, not success', () => {
    expect(classifyOperation({ audience: 100, affected: 40, skipped: 10 })).toBe('partial');
    expect(isOperationalSuccess('partial')).toBe(false);
  });

  it('real work done across the whole audience is a success', () => {
    expect(classifyOperation({ audience: 100, affected: 90, skipped: 10 })).toBe('succeeded');
  });

  it('only "succeeded" is ever treated as success', () => {
    for (const o of ['no_op', 'partial', 'blocked', 'failed'] as const) {
      expect(isOperationalSuccess(o), o).toBe(false);
    }
    expect(isOperationalSuccess('succeeded')).toBe(true);
  });

  it('surfaces missingSource in the response so a dead feature cannot look healthy', () => {
    const r = operationResponse({ audience: 900, affected: 0, missingSource: 900 });
    expect(r).toMatchObject({ success: false, outcome: 'blocked', missingSource: 900 });
  });
});

describe('INT-004 — legacy classification logic on current data', () => {
  // The REAL taxonomy from feature-usage, and the REAL data shape that broke it.
  const LEGACY_PATTERNS = {
    market_research: ['market-assassin', 'market-research'],
    opportunity_hunter: ['opportunity-hunter'],
    contractors: ['contractor-database'],
  };

  it('BLOCKS the original incident: legacy URL patterns vs the consolidated /app route', () => {
    // After the app consolidated, EVERY path in the table was literally "/app" — 7,374 of
    // them — so the legacy patterns matched nothing and the dashboard reported 0 views for
    // every feature while 7,887 panel views sat in the table.
    const live = Array.from({ length: 200 }, () => '/app');
    const h = checkClassifier('feature-usage', live, LEGACY_PATTERNS);

    expect(h.healthy).toBe(false);
    expect(h.matched).toBe(0);
    expect(h.coverage).toBe(0);
    // and it names the stale vocabulary, so the fix is obvious
    expect(h.deadPatterns).toContain('market-assassin');
    expect(h.deadPatterns).toContain('opportunity-hunter');
  });

  it('passes once the classifier reads the field the product actually emits', () => {
    // The fix did not rewrite the taxonomy — it read `panel` instead of a legacy URL.
    const CURRENT = { alerts: ['alerts'], pipeline: ['pipeline'], vault: ['vault'] };
    const live = [
      ...Array.from({ length: 80 }, () => '/app alerts'),
      ...Array.from({ length: 60 }, () => '/app pipeline'),
      ...Array.from({ length: 40 }, () => '/app vault'),
      ...Array.from({ length: 20 }, () => '/app settings'), // legitimately unclassified
    ];
    const h = checkClassifier('feature-usage', live, CURRENT);
    expect(h.healthy).toBe(true);
    expect(h.coverage).toBeGreaterThan(0.8);
  });

  it('reports dead patterns even while overall coverage is healthy', () => {
    const h = checkClassifier('mixed', ['/app alerts', '/app alerts'], {
      a: ['alerts'], gone: ['a-page-that-no-longer-exists'],
    });
    expect(h.healthy).toBe(true);
    expect(h.deadPatterns).toEqual(['a-page-that-no-longer-exists']);
  });

  it('does NOT claim health from an empty sample — that would be INT-002 all over again', () => {
    const h = checkClassifier('empty', [], LEGACY_PATTERNS);
    expect(h.sampled).toBe(0);
    expect(h.detail).toMatch(/coverage unknown/);
  });
});
