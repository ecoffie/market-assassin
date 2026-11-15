import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dibbsFreshness, dibbsFreshnessNotice } from './freshness';

/** DIBBS panel freshness (Agent 3, 2026-11-14): a parked feed is disclosed with the data's own last-sync date. */
const NOW = new Date('2026-11-14T21:00:00Z');
describe('dibbsFreshness', () => {
  it('parked sync: "Paused · last updated Nov 2, 2026" from the newest scraped_at', () => {
    const f = dibbsFreshness('2026-11-02T06:10:00Z', NOW, false);
    expect(f).toMatchObject({ paused: true, stale: true, daysSinceSync: 12 });
    expect(dibbsFreshnessNotice(f)).toMatch(/^Paused · last updated Nov 2, 2026\./);
    expect(dibbsFreshnessNotice(f)).toMatch(/may be out of date/);
  });
  it('unknown last sync stays unknown (never hidden, never "today")', () => {
    const f = dibbsFreshness(null, NOW, false);
    expect(f.lastSyncedAt).toBeNull();
    expect(dibbsFreshnessNotice(f)).toMatch(/last update date unavailable/);
  });
  it('a running, current feed shows nothing; a running but stale feed says "Not updating"', () => {
    expect(dibbsFreshnessNotice(dibbsFreshness('2026-11-14T03:00:00Z', NOW, true))).toBeNull();
    expect(dibbsFreshnessNotice(dibbsFreshness('2026-11-05T03:00:00Z', NOW, true))).toMatch(/^Not updating/);
  });
  it('the API derives it from data and the panel renders it', () => {
    const api = readFileSync(join(process.cwd(), 'src/app/api/app/dibbs/route.ts'), 'utf8');
    const panel = readFileSync(join(process.cwd(), 'src/components/app/panels/DibbsPanel.tsx'), 'utf8');
    expect(api).toContain("freshness: dibbsFreshness(lastSyncedAt)");
    expect(api).toContain(".order('scraped_at', { ascending: false }).limit(1)");
    expect(panel).toContain('dibbsFreshnessNotice(freshness)');
  });
});
