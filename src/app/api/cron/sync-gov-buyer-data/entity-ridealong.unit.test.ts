/**
 * SAM entity registrations had no cron row. The only producer was an unawaited
 * fetch at the end of the opportunity sync, and the tile stayed UNKNOWN on a
 * 7-day synced_at because cadenceHours was null.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entityRidealongDue, entitySliceCheckpoint, ENTITY_RIDEALONG_STALE_MS } from './route';

const NOW = Date.parse('2026-11-18T19:53:00Z');

describe('entityRidealongDue', () => {
  it('a missing checkpoint is due', () => {
    expect(entityRidealongDue(null, NOW)).toBe(true);
    expect(entityRidealongDue(undefined, NOW)).toBe(true);
    expect(entityRidealongDue('not-a-date', NOW)).toBe(true);
  });

  it('a checkpoint from the last few hours is not due', () => {
    expect(entityRidealongDue(new Date(NOW - 60 * 60 * 1000).toISOString(), NOW)).toBe(false);
  });

  it('the measured 7-day gap is due', () => {
    const sevenDays = new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(entityRidealongDue(sevenDays, NOW)).toBe(true);
    expect(ENTITY_RIDEALONG_STALE_MS).toBe(20 * 60 * 60 * 1000);
  });
});

describe('entitySliceCheckpoint', () => {
  it('a successful slice advances last_synced_at and last_page', () => {
    const patch = entitySliceCheckpoint({
      ok: true, done: false, nextPage: 6, totalCount: 40, entitiesUpserted: 10,
      error: null, nowIso: '2026-11-18T20:00:00.000Z',
    });
    expect(patch.last_synced_at).toBe('2026-11-18T20:00:00.000Z');
    expect(patch.last_page).toBe(6);
    expect(patch.status).toBe('in_progress');
  });

  it('a failed slice does not move the ridealong clock or the page cursor', () => {
    const patch = entitySliceCheckpoint({
      ok: false, done: false, nextPage: 6, totalCount: 40, entitiesUpserted: 10,
      error: 'sam 429', nowIso: '2026-11-18T20:00:00.000Z',
    });
    expect(patch).toEqual({ status: 'error', last_error: 'sam 429' });
    expect(patch).not.toHaveProperty('last_synced_at');
    expect(patch).not.toHaveProperty('last_page');
  });
});

describe('contacts job does not pretend to be the entity cron', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-gov-buyer-data/route.ts'), 'utf8');

  it('pull=entities does not write sync-decision-makers', () => {
    expect(src).toContain("pull !== 'entities'");
    expect(src).toContain('maxSlices: 1');
    expect(src).toContain('entityRidealongDue');
  });
});
