import { describe, expect, it } from 'vitest';
import {
  proMonthlyAccountKey,
  proMonthlyCreditKeys,
  proMonthlyLegacyEmailKey,
} from './pro-monthly-keys';

describe('proMonthlyCreditKeys — Stripe retry across email change', () => {
  const accountId = '82261438-aaaa-bbbb-cccc-ddddeeeeffff';
  const month = '2026-09';

  it('primary key is account-scoped (survives email change)', () => {
    expect(proMonthlyAccountKey(accountId, month)).toBe(`pro:acct:${accountId}:${month}`);
  });

  it('includes legacy email keys so a pre-rename grant still blocks', () => {
    const keys = proMonthlyCreditKeys({
      accountId,
      month,
      emails: ['ereck@harrisonplus.com', 'ereck@serviceopsgroup.com'],
    });
    expect(keys[0]).toBe(proMonthlyAccountKey(accountId, month));
    expect(keys).toContain(proMonthlyLegacyEmailKey('ereck@harrisonplus.com', month));
    expect(keys).toContain(proMonthlyLegacyEmailKey('ereck@serviceopsgroup.com', month));
  });

  it('prove: retry after email change shares the account key → exactly-once', () => {
    const beforeChange = proMonthlyCreditKeys({
      accountId,
      month,
      emails: ['old@example.com'],
    });
    const afterChange = proMonthlyCreditKeys({
      accountId,
      month,
      emails: ['new@example.com'],
    });
    // Intersection must include the account key — applyCreditOnce inserts ALL
    // keys on first grant, so the second call sees the account key already present.
    const shared = beforeChange.filter((k) => afterChange.includes(k));
    expect(shared).toEqual([proMonthlyAccountKey(accountId, month)]);
    // Legacy keys differ (would double-grant if used alone).
    expect(beforeChange).toContain(proMonthlyLegacyEmailKey('old@example.com', month));
    expect(afterChange).toContain(proMonthlyLegacyEmailKey('new@example.com', month));
    expect(beforeChange).not.toContain(proMonthlyLegacyEmailKey('new@example.com', month));
  });

  it('dedupes duplicate emails', () => {
    const keys = proMonthlyCreditKeys({
      accountId,
      month,
      emails: ['A@X.com', 'a@x.com', ''],
    });
    expect(keys).toEqual([
      proMonthlyAccountKey(accountId, month),
      proMonthlyLegacyEmailKey('a@x.com', month),
    ]);
  });
});
