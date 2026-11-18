/**
 * SAM entity registrations had no cron row. The only producer was an unawaited
 * fetch at the end of the opportunity sync, and the tile stayed UNKNOWN on a
 * 7-day synced_at because cadenceHours was null.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entityRidealongDue, ENTITY_RIDEALONG_STALE_MS } from './route';

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

describe('contacts job does not pretend to be the entity cron', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-gov-buyer-data/route.ts'), 'utf8');

  it('pull=entities does not write sync-decision-makers', () => {
    expect(src).toContain("pull !== 'entities'");
    expect(src).toContain('maxSlices: 1');
    expect(src).toContain('entityRidealongDue');
  });
});
