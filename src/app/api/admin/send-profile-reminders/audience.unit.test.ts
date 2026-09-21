/**
 * Guards the profile-reminder audience filter.
 *
 * THE BUG (found 2026-08-04): this route mailed 5,080 "users needing a profile." Only
 * ~571 of them were people. 4,576 rows came from a one-time bulk push
 * (invitation_source='bootcamp-batch-enroll') and had, across the entire cohort, ZERO
 * searches and ZERO clicks — 4,706 had never received a single alert.
 *
 * It converted at 3% (10 of 364 reminded). The message was never the problem; the list
 * was. And because every one of those rows has is_active=true, any audience gated on
 * is_active inherits the contamination silently.
 *
 * The subtle part, and the reason this file exists: a flat source exclusion is WRONG.
 * 67 bulk-added rows did go on to engage. Provenance does not determine personhood —
 * engagement does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/admin/send-profile-reminders/route.ts'),
  'utf8'
);

// Mirrors isRealUser() in the route. Kept in sync by the "same rule" test below.
const BULK = 'bootcamp-batch-enroll';
type Row = {
  invitation_source?: string | null;
  alerts_enabled?: boolean | null;
  total_alerts_sent?: number | null;
  search_count?: number | null;
  last_click_at?: string | null;
};
const engaged = (u: Row) =>
  u.alerts_enabled === true ||
  (u.total_alerts_sent ?? 0) > 0 ||
  (u.search_count ?? 0) > 0 ||
  !!u.last_click_at;
const isRealUser = (u: Row) => u.invitation_source !== BULK || engaged(u);

describe('who counts as a person', () => {
  it('suppresses a never-engaged bulk row', () => {
    expect(isRealUser({
      invitation_source: BULK,
      alerts_enabled: false, total_alerts_sent: 0, search_count: 0, last_click_at: null,
    })).toBe(false);
  });

  it('KEEPS a bulk row that later engaged — provenance is not personhood', () => {
    // 67 real users would have been dropped by a flat source exclusion.
    expect(isRealUser({ invitation_source: BULK, alerts_enabled: true })).toBe(true);
    expect(isRealUser({ invitation_source: BULK, total_alerts_sent: 12 })).toBe(true);
    expect(isRealUser({ invitation_source: BULK, search_count: 1 })).toBe(true);
    expect(isRealUser({ invitation_source: BULK, last_click_at: '2026-07-30T00:00:00Z' })).toBe(true);
  });

  it('keeps every organic signup regardless of engagement', () => {
    // Someone who signed up themselves is a person even before they do anything.
    expect(isRealUser({ invitation_source: null })).toBe(true);
    expect(isRealUser({ invitation_source: 'partner_mdeat' })).toBe(true);
    expect(isRealUser({})).toBe(true);
  });

  it('treats null/undefined counters as no engagement, not as truthy', () => {
    expect(isRealUser({
      invitation_source: BULK,
      total_alerts_sent: null, search_count: null, alerts_enabled: null, last_click_at: null,
    })).toBe(false);
  });
});

describe('the route wires it up', () => {
  it('filters the audience through isRealUser', () => {
    expect(SRC).toContain('needsProfile.filter(isRealUser)');
  });

  it('selects the columns the filter reads — or it silently keeps everyone', () => {
    // If invitation_source is not selected it is undefined, !== BULK is true, and the
    // filter becomes a no-op that still passes every unit test above.
    for (const col of ['invitation_source', 'alerts_enabled', 'total_alerts_sent', 'search_count', 'last_click_at']) {
      expect(SRC, `${col} must be in the select`).toMatch(new RegExp(`select\\([^)]*${col}`));
    }
  });

  it('uses the same rule as this test', () => {
    expect(SRC).toContain("u.invitation_source !== BULK_ENROLL_SOURCE || hasEverEngaged(u)");
    expect(SRC).toContain("const BULK_ENROLL_SOURCE = 'bootcamp-batch-enroll'");
  });

  it('REPORTS what it suppressed — a silent filter hides the opposite bug', () => {
    // If suppressedBulkRows ever reads 0 on a real run, the bulk rows are back in.
    expect(SRC).toContain('const suppressedBulkRows =');
    expect(SRC.match(/suppressedBulkRows,/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
