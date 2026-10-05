/**
 * Prepaid (off-Stripe) monthly entitlements — schedule boundaries + grant behaviour.
 *
 * The grant simulation drives the REAL catchUpPrepaidMonths/dueMonths/monthlyGrantKey
 * against an in-memory model of mcp_credit_topups (one row per claimed key, exactly the
 * ON CONFLICT DO NOTHING semantics of mcp_apply_credit). The SQL itself is exercised in
 * prepaid-entitlements.pglite.unit.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => { throw new Error('no DB in unit test'); } }));
vi.mock('./credits', () => ({ applyCreditOnce: () => { throw new Error('use injected grant'); } }));

import {
  catchUpPrepaidMonths, dueMonths, monthlyGrantKey, monthsInWindow, scheduleFromAccessWindow,
  validatePrepaidSchedule, type PrepaidEntitlement,
} from './prepaid-entitlements';

const EMAIL = 'delmarbennett@revoconstruction.com';
const ACCESS = { accessStartsOn: '2026-10-05', accessEndsOn: '2027-04-05' };
const SCHEDULE = scheduleFromAccessWindow(ACCESS.accessStartsOn, ACCESS.accessEndsOn);
const ENT: PrepaidEntitlement = { id: 'e1', userEmail: EMAIL, monthlyCredits: 1500, ...SCHEDULE, ...ACCESS };

describe('schedule derived from the access window', () => {
  it('6-month access 2026-10-05 → 2027-04-05 grants Oct 2026..Mar 2027, never April', () => {
    expect(SCHEDULE).toEqual({ firstMonth: '2026-10', lastMonth: '2027-03' });
    expect(monthsInWindow(SCHEDULE.firstMonth, SCHEDULE.lastMonth)).toEqual([
      '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
    ]);
  });

  it('the recorded access end date matches the schedule', () => {
    expect(validatePrepaidSchedule({ ...SCHEDULE, ...ACCESS, monthlyCredits: 1500 })).toEqual([]);
  });

  it('rejects an access end that does not fall in the month after the last grant', () => {
    const base = { ...SCHEDULE, accessStartsOn: ACCESS.accessStartsOn, monthlyCredits: 1500 };
    expect(validatePrepaidSchedule({ ...base, accessEndsOn: '2027-04-01' })).toEqual([]); // earliest valid
    expect(validatePrepaidSchedule({ ...base, accessEndsOn: '2027-04-30' })).toEqual([]); // latest valid
    expect(validatePrepaidSchedule({ ...base, accessEndsOn: '2027-03-31' })).not.toEqual([]); // March unpaid tail
    expect(validatePrepaidSchedule({ ...base, accessEndsOn: '2027-05-01' })).not.toEqual([]); // an unpaid April
    expect(validatePrepaidSchedule({ ...base, accessEndsOn: ACCESS.accessEndsOn, firstMonth: '2026-11' })).not.toEqual([]);
  });
});

describe('dueMonths boundaries', () => {
  it.each([
    ['2026-09', []],
    ['2026-10', ['2026-10']],
    ['2026-11', ['2026-10', '2026-11']],
    ['2027-03', ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']],
    ['2027-04', ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']],
    ['2028-01', ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']],
  ])('as of %s', (current, expected) => {
    expect(dueMonths(ENT, current)).toEqual(expected);
  });
});

// ---- grant simulation ------------------------------------------------------------------

/** Model of mcp_credit_topups: a claimed key is never applied again. */
function ledger(preclaimed: string[] = []) {
  const claims = new Map<string, number>(preclaimed.map((k) => [k, 1500]));
  return {
    claims,
    apply: async (key: string, _email: string, credits: number) => {
      if (claims.has(key)) return { applied: false };
      claims.set(key, credits);
      return { applied: true };
    },
    // Same match as isMonthClaimed: exact key or a sponsored ceiling claim on it.
    isClaimed: async (email: string, month: string) => {
      const key = monthlyGrantKey(email, month);
      return [...claims.keys()].some((k) => k === key || k.startsWith(`${key}:c`));
    },
    total: () => [...claims.entries()].filter(([k]) => k.startsWith(`pro:${EMAIL}:`) && !k.includes(':c')).reduce((a, [, v]) => a + v, 0),
  };
}

/** One run of the cron for this entitlement: current month via the shared key, then catch-up. */
async function cronRun(l: ReturnType<typeof ledger>, day: string) {
  const month = day.slice(0, 7);
  if (dueMonths(ENT, month).includes(month)) await l.apply(monthlyGrantKey(EMAIL, month), EMAIL, ENT.monthlyCredits);
  return catchUpPrepaidMonths([ENT], month, { isClaimed: l.isClaimed, grant: l.apply });
}

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const OCT_KEY = monthlyGrantKey(EMAIL, '2026-10');

describe('grant behaviour', () => {
  it('uses the exact key October was granted under', () => {
    expect(OCT_KEY).toBe('pro:delmarbennett@revoconstruction.com:2026-10');
    expect(monthlyGrantKey(' DelmarBennett@RevoConstruction.com ', '2026-10')).toBe(OCT_KEY);
  });

  it('October already granted: daily runs (each twice) through mid-2027 add exactly Nov..Mar', async () => {
    const l = ledger([OCT_KEY]);
    for (const d of days('2026-10-05', '2027-06-30')) { await cronRun(l, d); await cronRun(l, d); }
    expect([...l.claims.keys()].sort()).toEqual([
      '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
    ].map((m) => monthlyGrantKey(EMAIL, m)));
    expect(l.total() - 1500).toBe(7500); // five new grants of 1,500
  });

  it('nothing is granted before the window or for the month access ends in', async () => {
    const l = ledger();
    await cronRun(l, '2026-09-30');
    expect(l.claims.size).toBe(0);
    const l2 = ledger([OCT_KEY]);
    for (const d of days('2026-10-05', '2027-03-31')) await cronRun(l2, d);
    const before = l2.claims.size;
    await cronRun(l2, '2027-04-01');
    await cronRun(l2, '2027-04-05');
    expect(l2.claims.size).toBe(before);
    expect(l2.claims.has(monthlyGrantKey(EMAIL, '2027-04'))).toBe(false);
  });

  it('missed runs across month boundaries are recovered once, without duplicates', async () => {
    const l = ledger([OCT_KEY]);
    // The job is down from Nov 20 through Feb 9 — December and January get no run at all.
    for (const d of days('2026-10-05', '2027-03-31').filter((d) => d < '2026-11-20' || d >= '2027-02-10')) {
      await cronRun(l, d);
    }
    expect(l.claims.size).toBe(6);
    const recovered = await catchUpPrepaidMonths([ENT], '2027-03', { isClaimed: l.isClaimed, grant: l.apply });
    expect(recovered.granted).toEqual([]);
    expect(recovered.alreadyClaimed).toBe(5);
  });

  it('a job that only resumes after the window still pays every owed month, then stops', async () => {
    const l = ledger([OCT_KEY]);
    const r = await cronRun(l, '2027-05-02');
    expect(r.granted.map((g) => g.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
    expect((await cronRun(l, '2027-05-03')).granted).toEqual([]);
  });

  it('a later Stripe Pro subscription that claimed a month first is not double-credited', async () => {
    const l = ledger([OCT_KEY]);
    // The Stripe invoice path / route claims January under the same key on Jan 1.
    await l.apply(monthlyGrantKey(EMAIL, '2027-01'), EMAIL, 1500);
    for (const d of days('2026-10-05', '2027-04-30')) await cronRun(l, d);
    expect(l.claims.size).toBe(6);
    expect(l.total()).toBe(9000);
  });

  it('catch-up never stacks on a month another source claimed under a ceiling key', async () => {
    const l = ledger([OCT_KEY, `${monthlyGrantKey(EMAIL, '2026-11')}:c8000`]);
    const r = await catchUpPrepaidMonths([ENT], '2026-12', { isClaimed: l.isClaimed, grant: l.apply });
    expect(r.granted).toEqual([]);
    expect(l.claims.has(monthlyGrantKey(EMAIL, '2026-11'))).toBe(false);
  });

  it('a claim-check failure is an error for that month, never a grant', async () => {
    const l = ledger([OCT_KEY]);
    const r = await catchUpPrepaidMonths([ENT], '2026-12', {
      isClaimed: async () => { throw new Error('db down'); }, grant: l.apply,
    });
    expect(r.granted).toEqual([]);
    expect(r.errors).toHaveLength(2); // October and November, both reported, neither granted
  });
});
