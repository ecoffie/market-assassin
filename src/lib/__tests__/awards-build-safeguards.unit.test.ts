/**
 * Awards serving-table build safeguards (2026-11-14).
 *
 * Context: the serving table was 78 days stale because nothing ran the build worker (jobs 5-12
 * queued since 2026-09-07), the build scoped awards by the parent UEI only (2,424 of the top
 * 12,000 contractors had no rows), and the size check compared against a version string no live
 * row ever had, so it always passed. docs/SEO-RECOVERY-2026-11.md has the measurements.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// ── a recording fake of the supabase query builder ──────────────────────────────────────────
type Op = { table: string; calls: Array<[string, unknown[]]> };
const fake = vi.hoisted(() => ({
  ops: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
  /** Return value per (table, first verb); a function gets the op for inspection. */
  respond: (() => ({ data: [], error: null })) as (op: { table: string; calls: Array<[string, unknown[]]> }) => unknown,
  alerts: [] as string[],
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const op: Op = { table, calls: [] };
      fake.ops.push(op);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'update', 'insert', 'eq', 'lt', 'gte', 'neq', 'in', 'order', 'limit', 'is', 'maybeSingle']) {
        b[m] = (...args: unknown[]) => { op.calls.push([m, args]); return b; };
      }
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(fake.respond(op)).then(res, rej);
      return b;
    },
  }),
}));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: vi.fn(async ({ subject }: { subject: string }) => { fake.alerts.push(subject); }) }));
vi.mock('@/lib/bigquery/client', () => ({ bqQuery: vi.fn() }));
vi.mock('@vercel/kv', () => ({ kv: { set: vi.fn(), get: vi.fn(), del: vi.fn() } }));

import {
  BUILD_QUERY, evaluatePlausibility, overrideRejection, TOLERANCE, SIZE_OVERRIDE_MAX_AGE_DAYS,
  type SizeOverride,
} from '../awards-refresh';
import {
  supersedeOlderQueued, claimNextJob, alertOnQueuedJobs, QUEUED_ALERT_HOURS,
} from '../awards-build-jobs';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  fake.ops = []; fake.alerts = [];
  fake.respond = () => ({ data: [], error: null });
});
const has = (op: Op, verb: string, ...args: unknown[]) =>
  op.calls.some(([m, a]) => m === verb && JSON.stringify(a) === JSON.stringify(args));

// ── 1. the build reads the same UEIs as the live contracts page ─────────────────────────────
describe('BUILD_QUERY: parent and child UEIs', () => {
  it('scopes awards by every child UEI, de-duplicated, keyed by the rollup UEI', () => {
    expect(BUILD_QUERY).toMatch(/SELECT rollup_uei, child_ueis FROM/);
    expect(BUILD_QUERY).toMatch(/SELECT DISTINCT e\.rollup_uei, u AS uei FROM elig e, UNNEST\(e\.child_ueis\) AS u/);
    expect(BUILD_QUERY).toMatch(/SELECT u\.rollup_uei AS recipient_uei, a\.\* EXCEPT \(recipient_uei\)/);
    expect(BUILD_QUERY).toMatch(/JOIN elig_ueis u ON a\.recipient_uei = u\.uei/);
  });
  it('no longer joins on the parent UEI alone (2,424 contractors had no rows)', () => {
    expect(BUILD_QUERY).not.toMatch(/e\.rollup_uei = a\.recipient_uei/);
  });
  it('matches the live reader: same child_ueis set and the same displayed-action filter', () => {
    const reader = readFileSync('src/lib/bigquery/recipients.ts', 'utf8');
    expect(reader).toMatch(/WHERE recipient_uei IN UNNEST\(@ueis\)\s+AND obligation_amount > 0/);
    expect(BUILD_QUERY).toMatch(/COUNTIF\(obligation_amount > 0\) AS displayed_action_count/);
    expect(BUILD_QUERY).toMatch(/FROM scoped WHERE obligation_amount > 0/);
  });
});

// ── 2. size check + one-time override ───────────────────────────────────────────────────────
const LIVE = { recipients: 9613, pages: 23434 };
const NEXT = { recipients: 12000, pages: 30978 };
const NOW = new Date('2026-11-15T12:00:00Z');
const override = (o: Partial<SizeOverride> = {}): SizeOverride => ({
  source_version: '2026-11-04',
  authorized_by: 'eric',
  authorized_at: '2026-11-15T10:00:00Z',
  reason: 'child-UEI build fix: +25% contractors, +32% pages',
  expected: { recipients: [11900, 12100], pages: [30500, 31500] },
  ...o,
});
const JOB = (size_override?: unknown) => ({ source_version: '2026-11-04', size_override });

describe('size check (plausibility)', () => {
  it('passes a build within ±10% on both counts', () => {
    const r = evaluatePlausibility(LIVE, { recipients: 9800, pages: 24000 }, JOB(), NOW);
    expect(r).toMatchObject({ ok: true, usedOverride: false });
  });

  it('refuses the child-UEI build without an override, recording old and new counts', () => {
    const r = evaluatePlausibility(LIVE, NEXT, JOB(), NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/recipients moved 24\.8% \(9613 → 12000\)/);
    expect(r.reason).toMatch(/pages moved 32\.2% \(23434 → 30978\)/);
    expect(r.record).toMatchObject({ live: LIVE, next: NEXT, override: null });
  });

  it('checks recipients too, not only pages (the old check compared pages only)', () => {
    const r = evaluatePlausibility(LIVE, { recipients: 12000, pages: 23500 }, JOB(), NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/recipients moved/);
  });

  it('a valid override for THIS job, with the new counts in range, lets it through and is recorded', () => {
    const o = override();
    const r = evaluatePlausibility(LIVE, NEXT, JOB(o), NOW);
    expect(r).toMatchObject({ ok: true, usedOverride: true });
    expect(r.record.override).toEqual(o);
    expect(r.record.driftPct.recipients).toBeCloseTo(24.83, 1);
  });

  it('refuses an override that names another source version', () => {
    expect(evaluatePlausibility(LIVE, NEXT, JOB(override({ source_version: '2026-10-30' })), NOW).ok).toBe(false);
  });

  it('refuses an override without authorized_by, reason, a valid date, or ranges', () => {
    for (const bad of [
      override({ authorized_by: ' ' }),
      override({ reason: '' }),
      override({ authorized_at: 'yesterday' }),
      { ...override(), expected: undefined },
    ]) {
      expect(evaluatePlausibility(LIVE, NEXT, JOB(bad), NOW).ok).toBe(false);
    }
  });

  it(`refuses a stale (> ${SIZE_OVERRIDE_MAX_AGE_DAYS} days) or future-dated override`, () => {
    expect(overrideRejection(override({ authorized_at: '2026-11-01T00:00:00Z' }), '2026-11-04', NOW)).toMatch(/older than/);
    expect(overrideRejection(override({ authorized_at: '2026-11-20T00:00:00Z' }), '2026-11-04', NOW)).toMatch(/future/);
  });

  it('refuses when the build lands outside the authorized ranges', () => {
    const r = evaluatePlausibility(LIVE, { recipients: 15000, pages: 30978 }, JOB(override()), NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/outside the authorized ranges/);
  });

  it('cannot become the default: the next job without its own override is held to ±10% again', () => {
    expect(evaluatePlausibility(LIVE, NEXT, JOB(override()), NOW).ok).toBe(true);
    const nextWeek = { source_version: '2026-11-11', size_override: null };
    expect(evaluatePlausibility(NEXT, { recipients: 16000, pages: 41000 }, nextWeek, NOW).ok).toBe(false);
    expect(TOLERANCE).toMatchObject({ recipientsPct: 10, pagesPct: 10 });
  });

  it('a first build (nothing live) needs no override', () => {
    expect(evaluatePlausibility(null, NEXT, JOB(), NOW).ok).toBe(true);
  });

  it('reads the live size through the active pointer, never DATA_VERSION', () => {
    const src = readFileSync('src/lib/awards-refresh.ts', 'utf8');
    const fn = src.slice(src.indexOf('export async function readLiveGenerationSize'), src.indexOf('export async function checkPlausibility'));
    expect(fn).toMatch(/from\('awards_active_version'\)/);
    expect(fn).not.toMatch(/DATA_VERSION/);
    expect(fn).not.toMatch(/lifecycle/);
  });
});

// ── 3. queue: supersession, one build at a time, newest first, queued alert ────────────────
describe('build queue', () => {
  it('supersedeOlderQueued marks only OLDER QUEUED jobs, records the newer job, never deletes', async () => {
    fake.respond = () => ({ data: null, count: 2, error: null });
    const n = await supersedeOlderQueued({ id: 12, created_at: '2026-11-09T11:00:32Z' });
    expect(n).toBe(2);
    const op = fake.ops[0];
    expect(op.table).toBe('awards_build_jobs');
    const upd = op.calls.find(([m]) => m === 'update')![1][0] as Record<string, unknown>;
    expect(upd).toMatchObject({ status: 'superseded', superseded_by: 12 });
    // An exact count, never the returned payload (capped at 1,000 rows by PostgREST).
    expect(op.calls.find(([m]) => m === 'update')![1][1]).toEqual({ count: 'exact' });
    expect(has(op, 'eq', 'status', 'queued')).toBe(true);
    expect(has(op, 'lt', 'created_at', '2026-11-09T11:00:32Z')).toBe(true);
    expect(has(op, 'neq', 'id', 12)).toBe(true);
    expect(op.calls.some(([m]) => m === 'delete')).toBe(false);
  });

  it('a supersede failure is alerted, not thrown', async () => {
    fake.respond = () => ({ data: null, error: { message: 'check constraint' } });
    expect(await supersedeOlderQueued({ id: 12, created_at: 'x' })).toBe(0);
    expect(fake.alerts).toContain('Awards build queue: supersede failed');
  });

  it('claimNextJob refuses to start a second build while another holds a live lease', async () => {
    fake.respond = (op) => (op.calls.some(([m, a]) => m === 'eq' && a[1] === 'running')
      ? { data: [{ id: 11 }], error: null } : { data: [], error: null });
    expect(await claimNextJob('w1')).toBeNull();
    expect(fake.ops).toHaveLength(1); // never even looked for candidates
  });

  it('claimNextJob claims the NEWEST queued job', async () => {
    fake.respond = (op) => {
      if (op.calls.some(([m, a]) => m === 'eq' && a[1] === 'running')) return { data: [], error: null };
      if (op.calls.some(([m]) => m === 'update')) return { data: { id: 12, status: 'running' }, error: null };
      return { data: [{ id: 12, status: 'queued', attempts: 0, locked_at: null }], error: null };
    };
    const job = await claimNextJob('w1');
    expect(job).toMatchObject({ id: 12 });
    const list = fake.ops[1];
    expect(has(list, 'order', 'created_at', { ascending: false })).toBe(true);
  });

  it(`alerts when a job has been queued longer than ${QUEUED_ALERT_HOURS}h`, async () => {
    fake.respond = () => ({ data: [{ id: 12, source_version: '2026-11-04', created_at: '2026-11-09T11:00:32Z' }], error: null });
    const now = new Date('2026-11-14T12:00:00Z');
    expect(await alertOnQueuedJobs(now)).toBe(1);
    expect(fake.alerts).toContain('Awards build job waiting with no worker');
    const op = fake.ops[0];
    expect(has(op, 'eq', 'status', 'queued')).toBe(true);
    expect(has(op, 'lt', 'created_at', new Date(now.getTime() - 36 * 3600_000).toISOString())).toBe(true);
  });

  it('no queued-job alert when nothing is waiting', async () => {
    expect(await alertOnQueuedJobs()).toBe(0);
    expect(fake.alerts).toHaveLength(0);
  });

  it('the daily refresh runs the queued-job watchdog', () => {
    expect(readFileSync('src/app/api/cron/awards-refresh/route.ts', 'utf8')).toMatch(/await alertOnQueuedJobs\(\);/);
  });
});

// ── 4. worker + legacy script ───────────────────────────────────────────────────────────────
describe('worker', () => {
  const src = readFileSync('src/app/api/cron/awards-build-worker/route.ts', 'utf8');
  it('a size-check refusal is terminal (no automatic 17 GiB retries) and keeps the counts', () => {
    expect(src).toMatch(/const exhausted = terminal \|\| job\.attempts >= MAX_ATTEMPTS;/);
    expect(src).toMatch(/fail\('plausibility', p\.reason \?\? 'implausible delta', true, \{ plausibility: p\.record \}\)/);
  });
  it('passes the job (and only its own override) to the size check', () => {
    expect(src).toMatch(/checkPlausibility\(\{ recipients: v\.recipients, pages: v\.pages \}, job\)/);
  });
  it('records old/new counts and override use on promote, then supersedes older queued jobs', () => {
    expect(src).toMatch(/plausibility: p\.record, usedSizeOverride: p\.usedOverride/);
    expect(src).toMatch(/await supersedeOlderQueued\(job\)/);
  });
  it('still validates, promotes atomically through the RPC, and reads back', () => {
    expect(src).toMatch(/validateGeneration\(stagingVersion\)/);
    expect(src).toMatch(/rpc\('promote_awards_version'/);
    expect(src).toMatch(/p_expected_previous: pointerAtStart/);
    expect(src).toMatch(/fail\('readback'/);
  });
});

it('the legacy script that could not promote is retired', () => {
  expect(existsSync('scripts/build-awards-serving-pages.ts')).toBe(false);
});
