/**
 * Data-age alarm thresholds (Agent 4 / Eric, 2026-11-25). Each cited dataset's own clock vs its threshold; unknown is
 * never fresh. sam_entities (synced_at 2026-08-25) must FIRE on 2026-11-25.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_SYNC_CHECKS, classifyLiveSync } from './live-sync-checks';

const NOW = Date.parse('2026-11-25T13:05:00Z');
const check = (key: string) => {
  const c = LIVE_SYNC_CHECKS.find((x) => x.key === key);
  if (!c) throw new Error(`missing check ${key}`);
  return c;
};
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe('thresholds per dataset', () => {
  it.each([
    ['sam_entities_registrations', 'sam_entities', 'synced_at', 35],
    ['sam_opportunities_new', 'sam_opportunities', 'created_at', 2],
    ['recompete_opportunities_sync', 'recompete_opportunities', 'last_synced_at', 2],
    ['agency_forecasts_sync', 'agency_forecasts', 'last_synced_at', 7],
    ['federal_contacts_sync', 'federal_contacts', 'updated_at', 3],
    ['sam_events_reread', 'sam_events', 'extracted_at', 2],
  ])('%s reads %s.%s with threshold %id', (key, table, column, days) => {
    expect(check(key)).toMatchObject({ table, column, staleDays: days });
    expect(classifyLiveSync(check(key), { timestamp: daysAgo(days) }, NOW).status).toBe('fresh');
    expect(classifyLiveSync(check(key), { timestamp: daysAgo(days + 1) }, NOW).status).toBe('stale');
  });

  it('sam_entities synced 2026-08-25 FIRES on 2026-11-25 (about 92 days, threshold 35)', () => {
    const v = classifyLiveSync(check('sam_entities_registrations'), { timestamp: '2026-08-25T00:11:01Z' }, NOW);
    expect(v.status).toBe('stale');
    expect(v.status === 'stale' && v.ageDays).toBeGreaterThan(90);
  });
});

describe('unknown is never fresh', () => {
  it('a read error is unreadable, with the reason', () => {
    expect(classifyLiveSync(check('sam_entities_registrations'), { error: { message: 'statement timeout' }, timestamp: null }, NOW))
      .toEqual({ status: 'unreadable', error: 'statement timeout' });
  });
  it('an empty table or a missing / garbled timestamp is no_timestamp', () => {
    expect(classifyLiveSync(check('sam_opportunities_new'), { timestamp: null }, NOW).status).toBe('no_timestamp');
    expect(classifyLiveSync(check('sam_opportunities_new'), { timestamp: 'not a date' }, NOW).status).toBe('no_timestamp');
  });
  it('the route alerts on unreadable and no_timestamp, not only on stale', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/cron/check-data-freshness/route.ts'), 'utf8');
    expect(route).toMatch(/const \{ data: latest, error: readErr \} = await sb/);
    expect(route).toMatch(/v\.status === 'unreadable'\) \{\s*\n\s*stale\.push/);
    expect(route).toMatch(/v\.status === 'no_timestamp'\) \{\s*\n\s*stale\.push/);
    expect(route).toMatch(/v\.status === 'stale'\) \{\s*\n\s*stale\.push/);
  });
});
