import { describe, expect, it } from 'vitest';
import {
  SAVED_SEARCH_ALERT_BATCH_SIZE,
  SAVED_SEARCH_ALERT_ROUTE_TIMEOUT_MS,
  SAVED_SEARCH_ALERT_ROW_CEILING,
  SAVED_SEARCH_ALERT_TIME_BUDGET_MS,
  processingFailureCount,
  runSavedSearchAlertDrain,
  shouldContinueSavedSearchDrain,
  type SavedSearchAlertDueRow,
} from './alert-drain';

function dueRow(id: number, lastAlertedAt: string | null = null): SavedSearchAlertDueRow {
  return {
    id: `search-${String(id).padStart(3, '0')}`,
    user_email: `owner${id}@example.com`,
    name: `Daily ${id}`,
    mode: 'open',
    filters: { naics: '541512' },
    alert_frequency: 'daily',
    last_seen_notice_ids: [],
    total_alerts_sent: 0,
    last_alerted_at: lastAlertedAt,
  };
}

function sortOldestDue(rows: SavedSearchAlertDueRow[]): SavedSearchAlertDueRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.last_alerted_at ? Date.parse(a.last_alerted_at) : Number.NEGATIVE_INFINITY;
    const tb = b.last_alerted_at ? Date.parse(b.last_alerted_at) : Number.NEGATIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

function productionShapedStore(rows: SavedSearchAlertDueRow[]) {
  const evaluated: string[] = [];
  const stamped: string[] = [];

  return {
    evaluated,
    stamped,
    fetchDueBatch: async ({
      limit,
      excludeIds,
    }: {
      limit: number;
      excludeIds: readonly string[];
    }) => {
      const excluded = new Set(excludeIds);
      return {
        rows: sortOldestDue(rows.filter((row) => !excluded.has(row.id))).slice(0, limit),
      };
    },
    evaluate: async (row: SavedSearchAlertDueRow) => {
      evaluated.push(row.id);
      stamped.push(row.id);
      row.last_alerted_at = `2026-08-30T11:00:${String(evaluated.length).padStart(2, '0')}Z`;
      return { noMatches: 1 };
    },
    countRemaining: async ({ excludeIds }: { excludeIds: readonly string[] }) => {
      const excluded = new Set(excludeIds);
      return rows.filter((row) => !excluded.has(row.id)).length;
    },
  };
}

describe('saved-search alert drain ceilings', () => {
  it('keeps the time budget below the 290s route timeout', () => {
    expect(SAVED_SEARCH_ALERT_TIME_BUDGET_MS).toBeLessThan(SAVED_SEARCH_ALERT_ROUTE_TIMEOUT_MS);
    expect(SAVED_SEARCH_ALERT_BATCH_SIZE).toBe(50);
    expect(SAVED_SEARCH_ALERT_ROW_CEILING).toBeGreaterThanOrEqual(55);
  });

  it('stops before fetching when the row ceiling or time budget is already spent', () => {
    expect(shouldContinueSavedSearchDrain({
      fetchedCount: 50,
      processed: 400,
      rowCeiling: 400,
      elapsedMs: 1_000,
      timeBudgetMs: 240_000,
    })).toEqual({ continue: false, stopReason: 'row_ceiling' });

    expect(shouldContinueSavedSearchDrain({
      fetchedCount: 50,
      processed: 10,
      rowCeiling: 400,
      elapsedMs: 240_000,
      timeBudgetMs: 240_000,
    })).toEqual({ continue: false, stopReason: 'time_budget' });
  });
});

describe('one daily invocation evaluates the production-shaped audience', () => {
  it('evaluates all 55 due daily schedules in one invocation across bounded batches', async () => {
    const rows = Array.from({ length: 55 }, (_, i) => dueRow(i + 1, i < 50 ? '2026-08-29T11:00:00Z' : null));
    const expectedOrder = sortOldestDue(rows).map((row) => row.id);
    const store = productionShapedStore(rows);

    const result = await runSavedSearchAlertDrain({
      dueFrequencies: ['daily'],
      fetchDueBatch: store.fetchDueBatch,
      evaluate: store.evaluate,
      countRemaining: store.countRemaining,
      batchSize: 50,
      rowCeiling: SAVED_SEARCH_ALERT_ROW_CEILING,
      timeBudgetMs: SAVED_SEARCH_ALERT_TIME_BUDGET_MS,
    });

    expect(result.outcome).toBe('success');
    expect(result.success).toBe(true);
    expect(result.stopReason).toBe('drained');
    expect(result.batches).toBe(2);
    expect(result.processed).toBe(55);
    expect(result.remaining).toBe(0);
    expect(store.evaluated).toHaveLength(55);
    expect(store.stamped).toHaveLength(55);
    expect(store.evaluated).toEqual(expectedOrder);
    expect(new Set(store.evaluated).size).toBe(55);
  });
});

describe('larger backlog stays bounded and honest', () => {
  it('exits at the row ceiling, keeps oldest-due order, and never self-reports success', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => dueRow(i + 1, `2026-08-01T00:${String(i % 60).padStart(2, '0')}:00Z`));
    const store = productionShapedStore(rows);
    const oldest = sortOldestDue(rows).map((row) => row.id);

    const result = await runSavedSearchAlertDrain({
      dueFrequencies: ['daily'],
      fetchDueBatch: store.fetchDueBatch,
      evaluate: store.evaluate,
      countRemaining: store.countRemaining,
      batchSize: 50,
      rowCeiling: 80,
      timeBudgetMs: SAVED_SEARCH_ALERT_TIME_BUDGET_MS,
    });

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('partial');
    expect(result.stopReason).toBe('row_ceiling');
    expect(result.processed).toBe(80);
    expect(result.batches).toBe(2);
    expect(result.remaining).toBe(120);
    expect(result.errorSummary).toContain('capacity_exhausted=1');
    expect(result.errorSummary).toContain('backlog=120');
    expect(store.evaluated).toEqual(oldest.slice(0, 80));
    expect(store.stamped).toEqual(oldest.slice(0, 80));
    expect(store.evaluated).not.toEqual(expect.arrayContaining(oldest.slice(80)));
  });

  it('stops on the time budget before the next batch and reports leftover backlog', async () => {
    const rows = Array.from({ length: 55 }, (_, i) => dueRow(i + 1));
    const store = productionShapedStore(rows);
    let now = 0;

    const result = await runSavedSearchAlertDrain({
      dueFrequencies: ['daily'],
      fetchDueBatch: store.fetchDueBatch,
      evaluate: async (row) => {
        const counts = await store.evaluate(row);
        if (store.evaluated.length >= 50) now = 1_000;
        return counts;
      },
      countRemaining: store.countRemaining,
      nowMs: () => now,
      batchSize: 50,
      rowCeiling: 400,
      timeBudgetMs: 1_000,
    });

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('partial');
    expect(result.stopReason).toBe('time_budget');
    expect(result.processed).toBe(50);
    expect(result.remaining).toBe(5);
    expect(result.errorSummary).toContain('backlog=5');
    expect(store.evaluated).toHaveLength(50);
  });
});

describe('action-item failures do not red the job', () => {
  it('processingFailureCount ignores suppressions and invalid_saved_naics', () => {
    expect(processingFailureCount({
      recipient_suppressed: 3,
      invalid_saved_naics: 2,
      opportunity_query_failed: 1,
    })).toBe(1);
    expect(processingFailureCount({
      recipient_suppressed: 3,
      invalid_saved_naics: 2,
    })).toBe(0);
  });

  it('recipient_suppressed / invalid_saved_naics alone → success (still listed in failuresByClass)', async () => {
    const rows = [dueRow(1), dueRow(2), dueRow(3)];
    const byId: Record<string, 'suppressed' | 'invalid' | 'ok'> = {
      'search-001': 'suppressed',
      'search-002': 'invalid',
      'search-003': 'ok',
    };
    const store = productionShapedStore(rows);
    const result = await runSavedSearchAlertDrain({
      dueFrequencies: ['daily'],
      fetchDueBatch: store.fetchDueBatch,
      evaluate: async (row) => {
        store.evaluated.push(row.id);
        const kind = byId[row.id];
        if (kind === 'suppressed') return { failureClass: 'recipient_suppressed' };
        if (kind === 'invalid') return { failureClass: 'invalid_saved_naics', invalidNaics: ['999999'] };
        return { noMatches: 1 };
      },
      countRemaining: store.countRemaining,
    });
    expect(result.outcome).toBe('success');
    expect(result.success).toBe(true);
    expect(result.failuresByClass).toEqual({
      recipient_suppressed: 1,
      invalid_saved_naics: 1,
    });
    expect(result.errorSummary).toContain('recipient_suppressed=1');
  });

  it('an attributed per-search processing failure beside action items → partial (the rest evaluated)', async () => {
    const rows = [dueRow(1), dueRow(2)];
    const store = productionShapedStore(rows);
    const result = await runSavedSearchAlertDrain({
      dueFrequencies: ['daily'],
      fetchDueBatch: store.fetchDueBatch,
      evaluate: async (row) => {
        store.evaluated.push(row.id);
        return row.id === 'search-001'
          ? { failureClass: 'recipient_suppressed' }
          : { failureClass: 'opportunity_query_failed' };
      },
      countRemaining: store.countRemaining,
    });
    expect(result.outcome).toBe('partial');
    expect(result.success).toBe(false);
    expect(result.failuresByClass).toEqual({
      recipient_suppressed: 1,
      opportunity_query_failed: 1,
    });
  });

  it('EVERY evaluated search failing processing → error (nothing was delivered)', async () => {
    const rows = [dueRow(1), dueRow(2)];
    const store = productionShapedStore(rows);
    const result = await runSavedSearchAlertDrain({
      dueFrequencies: ['daily'],
      fetchDueBatch: store.fetchDueBatch,
      evaluate: async (row) => { store.evaluated.push(row.id); return { failureClass: 'opportunity_query_failed' }; },
      countRemaining: store.countRemaining,
    });
    expect(result.outcome).toBe('error');
    expect(result.failuresByClass).toEqual({ opportunity_query_failed: 2 });
  });

  it('a run-level failure (the due-search read failed) → error', async () => {
    const result = await runSavedSearchAlertDrain({
      dueFrequencies: ['daily'],
      fetchDueBatch: async () => ({ rows: [], error: { message: 'boom' } }),
      evaluate: async () => ({}),
      countRemaining: async () => 0,
    });
    expect(result.outcome).toBe('error');
    expect(result.failuresByClass).toHaveProperty('saved_search_query_failed');
  });
});
