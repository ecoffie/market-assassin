/**
 * The classification gate used to drop briefings-enabled users with a bare
 * .filter() — no counter, no log. These tests pin the drop REPORT and prove the
 * report never changes WHO is sent to.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/kv', () => ({
  kv: { get: vi.fn(async () => null), set: vi.fn(), del: vi.fn(), mget: vi.fn(async () => []) },
}));

import {
  classifyBriefingClassificationDrops,
  fetchBriefingAudienceCandidates,
  fetchBriefingAudienceCandidatesWithDrops,
  isBriefingEntitled,
  redactEmailForLog,
} from './rollout';
import { customerDropCount, describeBriefingClassificationDrops } from '../classification-drop-summary';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const PAST = '2026-01-01T00:00:00Z';
const FUTURE = '2027-06-01T00:00:00Z';

const ENABLED = [
  'paid@acme.com',           // lifetime → sent
  'beta@acme.com',           // beta_preview, null expiry → sent
  'free@acme.com',           // row exists, access free → not_entitling:free
  'none@acme.com',           // row exists, access none → not_entitling:none
  'expired@acme.com',        // 1_year expired → expired
  'norow@acme.com',          // no row → no_row
  'org-1234abcd-acme@clients.getmindy.ai', // coach workspace, no row
  'future@acme.com',         // subscription, future expiry → sent
];
const CLASSIFICATIONS = [
  { email: 'Paid@Acme.com', briefings_access: 'lifetime', briefings_expiry: null },
  { email: 'beta@acme.com', briefings_access: 'beta_preview', briefings_expiry: null },
  { email: 'free@acme.com', briefings_access: 'free', briefings_expiry: null },
  { email: 'none@acme.com', briefings_access: 'none', briefings_expiry: null },
  { email: 'expired@acme.com', briefings_access: '1_year', briefings_expiry: PAST },
  { email: 'future@acme.com', briefings_access: 'subscription', briefings_expiry: FUTURE },
  { email: 'not-enabled@acme.com', briefings_access: 'lifetime', briefings_expiry: null },
];

describe('classifyBriefingClassificationDrops', () => {
  const report = classifyBriefingClassificationDrops(ENABLED, CLASSIFICATIONS, NOW);

  it('counts a user WITH a free row as not_entitling, never no_row', () => {
    expect(report.notEntitling).toEqual({ free: 1, none: 1 });
    expect(report.noRow).toBe(1);
  });

  it('counts an expired entitling row as expired', () => {
    expect(report.expired).toBe(1);
  });

  it('counts a coach workspace address apart from the customer buckets', () => {
    expect(report.coachWorkspace).toBe(1);
    expect(report.droppedByClassification).toBe(5);
    expect(customerDropCount(report)).toBe(4);
  });

  it('samples are redacted, never raw emails', () => {
    const all = Object.values(report.samples).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(s).toMatch(/^sha256:[0-9a-f]{10}$/);
    expect(JSON.stringify(report)).not.toContain('free@acme.com');
    expect(report.samples['not_entitling:free']).toEqual([redactEmailForLog('free@acme.com')]);
  });

  it('agrees with isBriefingEntitled for every enabled user (same predicate)', () => {
    const byEmail = new Map(CLASSIFICATIONS.map(r => [r.email.toLowerCase(), r]));
    const notEntitled = ENABLED.filter(e => {
      const row = byEmail.get(e);
      return !row || !isBriefingEntitled(row, NOW);
    });
    expect(report.droppedByClassification).toBe(notEntitled.length);
  });

  it('caps samples per reason', () => {
    const many = Array.from({ length: 10 }, (_, i) => `u${i}@x.com`);
    const r = classifyBriefingClassificationDrops(many, [], NOW, 3);
    expect(r.noRow).toBe(10);
    expect(r.samples.no_row).toHaveLength(3);
  });

  it('wording names the split and does not claim "no row" for free users', () => {
    const text = describeBriefingClassificationDrops(report, 2);
    expect(text).toContain('4 briefings-enabled user(s)');
    expect(text).toContain('no_row 1');
    expect(text).toContain('not_entitling:free 1');
    expect(text).toContain('expired 1');
    expect(text).toContain('+1 coach workspace');
    expect(text).toContain('+2 test/healthcheck');
    expect(text).not.toMatch(/NO customer_classifications row/);
  });
});

/** Minimal PostgREST stand-in: every builder method chains; awaiting pages by range. */
function fakeSupabase(tables: Record<string, unknown[]>) {
  return {
    from(table: string) {
      let range: [number, number] = [0, 999];
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order']) builder[m] = () => builder;
      builder.range = (from: number, to: number) => { range = [from, to]; return builder; };
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: (tables[table] || []).slice(range[0], range[1] + 1), error: null });
      return builder;
    },
  } as never;
}

describe('fetchBriefingAudienceCandidates: reporting does not change who is sent to', () => {
  afterEach(() => vi.restoreAllMocks());

  const settings = ENABLED.map(email => ({
    user_email: email, naics_codes: ['541512'], keywords: [], agencies: [], location_states: [],
    business_type: null, timezone: null, sms_enabled: false, phone_number: null, aggregated_profile: null,
    briefings_enabled: true,
  }));
  const sb = () => fakeSupabase({ user_notification_settings: settings, customer_classifications: CLASSIFICATIONS });

  it('sends to exactly the entitled users, as before', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const users = await fetchBriefingAudienceCandidates(sb());
    // Independent of the report: enabled ∩ isBriefingEntitled(row), the pre-change rule.
    expect(users.map(u => u.email)).toEqual(['beta@acme.com', 'future@acme.com', 'paid@acme.com']);
    expect(users.every(u => u.hasPaidBriefingAccess)).toBe(true);
  });

  it('returns the drop report alongside the identical candidate list and logs it redacted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plain = await fetchBriefingAudienceCandidates(sb());
    const { candidates, drops } = await fetchBriefingAudienceCandidatesWithDrops(sb());
    expect(candidates).toEqual(plain);
    expect(drops.droppedByClassification).toBe(5);
    expect(drops.noRow).toBe(1);
    expect(drops.notEntitling).toEqual({ free: 1, none: 1 });
    expect(drops.expired).toBe(1);
    expect(drops.coachWorkspace).toBe(1);

    const line = warn.mock.calls.map(c => String(c[0])).find(l => l.includes('droppedByClassification=5'));
    expect(line).toBeDefined();
    expect(line).not.toContain('acme.com');
    expect(line).not.toContain('clients.getmindy.ai');
  });

  it('logs nothing when nobody is dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const only = fakeSupabase({
      user_notification_settings: settings.filter(s => s.user_email === 'paid@acme.com'),
      customer_classifications: CLASSIFICATIONS,
    });
    const { drops } = await fetchBriefingAudienceCandidatesWithDrops(only);
    expect(drops.droppedByClassification).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
