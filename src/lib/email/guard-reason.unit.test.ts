import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyGuardReason,
  guardReasonFromOpportunitiesData,
  summarizeGuardBlocks,
  sendGuardCheckFromRows,
} from './guard-reason';

describe('classifyGuardReason — every reason emailGuardBlock can return', () => {
  it('maps each guard reason to its class', () => {
    expect(classifyGuardReason('suppressed:hard_bounce')).toBe('suppressed');
    expect(classifyGuardReason('suppressed:unsubscribe')).toBe('suppressed');
    expect(classifyGuardReason('suppression_check_failed')).toBe('check_failed');
    expect(classifyGuardReason('synthetic_client_address')).toBe('synthetic');
    expect(classifyGuardReason('daily_cap:3/3')).toBe('daily_cap');
    expect(classifyGuardReason('daily_cap_promo_yield:2/2')).toBe('daily_cap');
  });
  it('a missing or unrecognised reason is unknown — never assumed to be suppression', () => {
    expect(classifyGuardReason(null)).toBe('unknown');
    expect(classifyGuardReason(undefined)).toBe('unknown');
    expect(classifyGuardReason('')).toBe('unknown');
    expect(classifyGuardReason('something_new')).toBe('unknown');
  });
});

describe('guardReasonFromOpportunitiesData — the shapes the alert crons write', () => {
  it('reads the daily skip context and the weekly context', () => {
    expect(guardReasonFromOpportunitiesData([{ opportunitiesCount: 4, guard_reason: 'suppressed:complaint' }])).toBe('suppressed:complaint');
    expect(guardReasonFromOpportunitiesData([{ alertSource: 'weekly', tier: 'free', reason: 'send_guard_blocked', guard_reason: 'synthetic_client_address' }])).toBe('synthetic_client_address');
  });
  it('legacy rows (no guard_reason, null reason, or an opportunity payload) have none', () => {
    expect(guardReasonFromOpportunitiesData([{ opportunitiesCount: 4 }])).toBeNull();
    expect(guardReasonFromOpportunitiesData([{ opportunitiesCount: 4, guard_reason: null }])).toBeNull();
    expect(guardReasonFromOpportunitiesData([{ noticeId: 'N1', title: 'x' }])).toBeNull();
    expect(guardReasonFromOpportunitiesData(null)).toBeNull();
    expect(guardReasonFromOpportunitiesData({})).toBeNull();
  });
});

const row = (guard_reason?: string | null) => ({ opportunities_data: [{ opportunitiesCount: 1, ...(guard_reason !== undefined ? { guard_reason } : {}) }] });

describe('sendGuardCheckFromRows — suppression is not a delivery failure', () => {
  it('40 suppressions alone are OK and say so', () => {
    const c = sendGuardCheckFromRows(Array.from({ length: 40 }, () => row('suppressed:hard_bounce')), 5);
    expect(c.ok).toBe(true);
    expect(c.lost).toBe(0);
    expect(c.value).toBe('0 lost · 40 suppressed');
    expect(c.detail).toContain('no alerts lost to processing');
    expect(c.detail).toContain('40 honored recipient suppression');
  });
  it('lost alerts (check failed / synthetic / unknown) count against the threshold', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row('suppression_check_failed')),
      ...Array.from({ length: 2 }, () => row('synthetic_client_address')),
      row(), // legacy row: no reason recorded
      row('suppressed:unsubscribe'),
    ];
    const c = sendGuardCheckFromRows(rows, 5);
    expect(c.breakdown).toEqual({ suppressed: 1, synthetic: 2, check_failed: 3, daily_cap: 0, unknown: 1 });
    expect(c.lost).toBe(6);
    expect(c.ok).toBe(false);
    expect(c.detail).toContain('3 suppression lookup failed');
    expect(c.detail).toContain('2 synthetic client address');
    expect(c.detail).toContain('1 reason not recorded');
  });
  it('no rows → no alerts blocked', () => {
    expect(sendGuardCheckFromRows([], 5)).toMatchObject({ ok: true, lost: 0, detail: 'no alerts blocked' });
  });
  it('summarizeGuardBlocks counts a daily-cap block if the exemption ever regresses', () => {
    expect(summarizeGuardBlocks([row('daily_cap:3/3')]).daily_cap).toBe(1);
  });
});

describe('daily_alert / weekly_alert are cap-exempt → the daily-cap bucket is structurally 0', () => {
  it('both types are in CAP_EXEMPT_TYPES, which returns before the cap count', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/send-email.ts'), 'utf8');
    const set = src.slice(src.indexOf('const CAP_EXEMPT_TYPES = new Set(['), src.indexOf(']);', src.indexOf('const CAP_EXEMPT_TYPES')));
    expect(set).toContain("'daily_alert'");
    expect(set).toContain("'weekly_alert'");
    const guard = src.slice(src.indexOf('async function emailGuardBlock'));
    expect(guard.indexOf('CAP_EXEMPT_TYPES.has(emailType)) return null')).toBeGreaterThan(-1);
    expect(guard.indexOf('CAP_EXEMPT_TYPES.has(emailType)) return null')).toBeLessThan(guard.indexOf("from('email_provider_sends')"));
  });
});
