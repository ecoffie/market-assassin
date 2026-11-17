/**
 * Internal test accounts (INTERNAL_TEST_EMAILS env) must never receive a scheduled alert or
 * briefing. Source pin: both crons filter the fetched audience through
 * isInternalTestAccount before batching, and only the daily cron's explicit ?testEmail=
 * run may still reach them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(__dirname, p), 'utf8');

describe('scheduled alerts skip internal test accounts', () => {
  it('daily alerts filter the audience unless an explicit testEmail run', () => {
    const s = src('daily-alerts/route.ts');
    expect(s).toContain("import { isInternalTestAccount } from '@/lib/mindy/campaign-exclusions';");
    expect(s).toContain('if (!options?.testEmail) users = users.filter((u) => !isInternalTestAccount(u.user_email));');
    // The filter runs before the audience is counted and batched.
    expect(s.indexOf('!isInternalTestAccount(u.user_email)')).toBeLessThan(s.indexOf('const totalEligible = users.length;'));
  });

  it('weekly alerts filter the audience before batching', () => {
    const s = src('weekly-alerts/route.ts');
    expect(s).toContain("import { isInternalTestAccount } from '@/lib/mindy/campaign-exclusions';");
    expect(s).toContain('allUsers = allUsers.filter((u) => !isInternalTestAccount(u.user_email));');
    expect(s.indexOf('!isInternalTestAccount(u.user_email)')).toBeLessThan(s.indexOf('loadVaultEligibility('));
  });

  for (const route of ['send-briefings-fast/route.ts', 'send-weekly-fast/route.ts']) {
    it(`${route} drops test accounts unless an explicit ?email= QA run`, () => {
      const s = src(route);
      expect(s).toContain("import { isInternalTestAccount } from '@/lib/mindy/campaign-exclusions';");
      expect(s).toContain('if (!testEmail) usersToProcess = usersToProcess.filter(u => !isInternalTestAccount(u.email));');
      expect(s.indexOf('!isInternalTestAccount(u.email)')).toBeLessThan(s.indexOf('briefing_log'));
    });
  }
});
