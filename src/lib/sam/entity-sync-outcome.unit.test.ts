import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SAM_ENTITY_JOB,
  entityPullStampsDecisionMakers,
  entitySyncOutcome,
} from './entity-sync-outcome';

const ROUTE = readFileSync(
  join(process.cwd(), 'src/app/api/cron/sync-gov-buyer-data/route.ts'),
  'utf8',
);
const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261119_sam_entities_incremental_cron.sql'),
  'utf8',
);

describe('incremental SAM entity sync', () => {
  it('does not stamp the contacts job from an entities-only pull', () => {
    expect(entityPullStampsDecisionMakers('entities')).toBe(false);
    expect(entityPullStampsDecisionMakers('contacts')).toBe(true);
    expect(entityPullStampsDecisionMakers('both')).toBe(true);
    expect(ROUTE).toContain('entityPullStampsDecisionMakers(pull)');
    expect(ROUTE).toContain('reportCronOutcome(SAM_ENTITY_JOB');
    expect(SAM_ENTITY_JOB).toBe('sync-sam-entities');
  });

  it('a slice error with nothing written is a failure, a quiet slice is not', () => {
    expect(entitySyncOutcome({ upserted: 10, errors: [] }).success).toBe(true);
    expect(entitySyncOutcome({ upserted: 0, errors: [] }).cronOutcome).toBe('success');
    const failed = entitySyncOutcome({ upserted: 0, errors: ['SAM 429'] });
    expect(failed.success).toBe(false);
    expect(failed.cronOutcome).toBe('error');
    expect(failed.disclosure).toBe('SAM 429');
    expect(entitySyncOutcome({ upserted: 4, errors: ['page 3'] }).cronOutcome).toBe('partial');
  });

  it('records a seed or checkpoint read error instead of a green empty slice', () => {
    expect(ROUTE).toMatch(/seedErr/);
    expect(ROUTE).toMatch(/sliceErr/);
  });

  it('the schedule migration stays disabled and does not delete or reload the corpus', () => {
    const sql = SQL.replace(/--.*$/gm, '');
    expect(sql).toMatch(/job_name = 'sync-sam-entities'|'\s*sync-sam-entities\s*'/);
    expect(sql).toMatch(/pull=entities/);
    expect(sql).toMatch(/false/);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/enabled\s*=\s*true/i);
  });
});
