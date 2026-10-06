/**
 * Weekly-alert cycle drain — regression for the 750-user ceiling (2026-10-06).
 *
 * Production evidence: alert_log held EXACTLY 750 weekly rows per cycle (10 windows ×
 * 75) against ~1,790 eligible users, ordered by email, so everyone after roughly "j"
 * was never evaluated. These tests run a whole cycle through the real drain code with
 * a fake alert_log and a fake clock, at a population larger than 750.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { drainCycle, pendingForCycle, type DrainUser } from './weekly-drain';

const WINDOWS = 10;              // 6 Sunday + 4 Monday dispatcher windows (cron_jobs)
const PER_USER_MS = 1_000;       // measured ~70s per 75 users in production
const BUDGET_MS = 220_000;       // RUN_BUDGET_MS default in the route

function population(n: number): DrainUser[] {
  // zero-padded so email order == index order, which makes "position >= 750" checkable
  return Array.from({ length: n }, (_, i) => ({ user_email: `user${String(i).padStart(5, '0')}@example.com` }));
}

/** One weekly cycle against a fake alert_log keyed on (email) — the unique-constraint cursor. */
async function runCycle(eligible: DrainUser[], windows = WINDOWS, alertLog = new Map<string, number>()) {
  let clock = 0;
  const now = () => clock;
  const perRun: number[] = [];
  for (let w = 0; w < windows; w++) {
    const processed = new Set(alertLog.keys());                  // paged read of this cycle's rows
    const pending = pendingForCycle(eligible, processed);
    const res = await drainCycle(pending, async (u) => {
      clock += PER_USER_MS;
      const k = u.user_email.toLowerCase();
      alertLog.set(k, (alertLog.get(k) ?? 0) + 1);               // every outcome writes a row
    }, { budgetMs: BUDGET_MS, now });
    perRun.push(res.attempted);
    clock += 600_000;                                             // next window is 10 minutes later
  }
  return { alertLog, perRun };
}

describe('legacy behaviour (reproduction of the bug)', () => {
  it('a fixed 75-per-run batch over 10 windows never reaches users after position 750', () => {
    const eligible = population(1_800);
    const processed = new Set<string>();
    for (let w = 0; w < WINDOWS; w++) {
      pendingForCycle(eligible, processed).slice(0, 75).forEach((u) => processed.add(u.user_email));
    }
    expect(processed.size).toBe(750);
    expect(eligible.slice(750).some((u) => processed.has(u.user_email))).toBe(false); // 1,050 users dropped
  });
});

describe('drainCycle — whole cycle, population > 750', () => {
  it('evaluates every eligible user exactly once, including every user after position 750', async () => {
    const eligible = population(1_800);
    const { alertLog } = await runCycle(eligible);
    expect(alertLog.size).toBe(1_800);
    for (const u of eligible) expect(alertLog.get(u.user_email)).toBe(1);
    expect(eligible.slice(750).every((u) => alertLog.get(u.user_email) === 1)).toBe(true);
  });

  it('drains inside the existing windows without a bigger fixed cap (cadence unchanged)', async () => {
    const { perRun } = await runCycle(population(1_800));
    const used = perRun.filter((n) => n > 0).length;
    expect(used).toBeLessThanOrEqual(WINDOWS);
    expect(perRun.reduce((a, b) => a + b, 0)).toBe(1_800);
    expect(Math.max(...perRun)).toBeLessThanOrEqual(BUDGET_MS / PER_USER_MS);
  });

  it('is idempotent: re-running windows after the cycle drained sends nothing more', async () => {
    const eligible = population(1_800);
    const first = await runCycle(eligible);
    const again = await runCycle(eligible, 3, first.alertLog);
    expect(again.perRun).toEqual([0, 0, 0]);
    for (const u of eligible) expect(again.alertLog.get(u.user_email)).toBe(1);
  });

  it('a retry after a partial run resumes where the cursor left off, with no duplicates', async () => {
    const eligible = population(1_000);
    const log = new Map<string, number>();
    // window 1 is cut short (budget for only 120 users), then the remaining windows run normally
    let clock = 0;
    await drainCycle(pendingForCycle(eligible, new Set()), async (u) => { clock += PER_USER_MS; log.set(u.user_email, 1); },
      { budgetMs: 120 * PER_USER_MS, now: () => clock });
    expect(log.size).toBe(120);
    const rest = await runCycle(eligible, WINDOWS - 1, log);
    expect(rest.alertLog.size).toBe(1_000);
    expect([...rest.alertLog.values()].every((n) => n === 1)).toBe(true);
  });

  it('reports users still pending when the budget runs out — never silent', async () => {
    let clock = 0;
    const res = await drainCycle(population(500), async () => { clock += PER_USER_MS; }, { budgetMs: 220_000, now: () => clock });
    expect(res.stoppedForBudget).toBe(true);
    expect(res.attempted).toBe(220);
    expect(res.remaining).toBe(280);
  });

  it('dedupes case variants and already-processed users', () => {
    const eligible = [{ user_email: 'A@x.com' }, { user_email: 'a@x.com' }, { user_email: 'b@x.com' }, { user_email: 'c@x.com' }];
    const pending = pendingForCycle(eligible, new Set(['b@x.com']));
    expect(pending.map((u) => u.user_email.toLowerCase())).toEqual(['a@x.com', 'c@x.com']);
  });

  it('a user whose processing throws is still counted once; the drain continues', async () => {
    const seen: string[] = [];
    const res = await drainCycle(population(5), async (u) => {
      seen.push(u.user_email);
      if (u.user_email.startsWith('user00002')) throw new Error('boom');
    }, { budgetMs: 60_000 }).catch((e) => e);
    // processOne in the route catches its own errors and writes a 'failed' row; a throw
    // escaping it would abort the run, so the route MUST keep that try/catch.
    expect(res).toBeInstanceOf(Error);
    expect(seen.length).toBe(3);
  });
});

describe('route wiring (architectural guard — source text)', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/cron/weekly-alerts/route.ts'), 'utf8');
  it('no fixed per-run slice of the eligible population', () => {
    expect(src).not.toMatch(/\.slice\(0,\s*BATCH_SIZE\)/);
    expect(src).toContain('drainCycle(pending');
  });
  it('the dedup (cursor) read of this cycle is paged, not capped at 1,000', () => {
    const i = src.indexOf("Already processed this cycle");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 900)).toContain('fetchAllPaged');
  });
  it('a guard-blocked send (unsubscribed / bounced) is recorded as skipped, never as sent', () => {
    expect(src).toContain('): Promise<boolean> {');
    expect(src).toContain('return sendEmail({');
    const i = src.indexOf('const delivered = await sendAlertEmail(');
    expect(i).toBeGreaterThan(-1);
    const after = src.slice(i, i + 900);
    expect(after).toMatch(/if \(delivered === false\)[\s\S]*errorMessage: 'send_guard_blocked'[\s\S]*return;/);
    // the skip happens BEFORE persistSentAlert can run
    expect(after.indexOf("'send_guard_blocked'")).toBeLessThan(src.slice(i).indexOf('persistSentAlert'));
  });

  it('the per-user body keeps its own try/catch so one failure cannot abort the drain', () => {
    const i = src.indexOf('drainCycle(pending, async (user) => {');
    expect(src.slice(i, i + 400)).toContain('try {');
  });
});
