/**
 * Decision Makers runner — dry-mode purity, single-owner concurrency, clock discipline,
 * and the wiring invariants that keep the checkpoint honest.
 *
 * The chainable Supabase mock RECORDS every write attempt, so "dry writes nothing" is proven
 * by the absence of recorded writes rather than asserted from reading the code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/ops-alert-dedup', () => ({
  shouldSendAlert: vi.fn(async () => ({ send: true, reason: 'new' })),
  fingerprint: (p: unknown[]) => p.join('|'),
}));

import { runDecisionMakersSync } from './buyer-contact-run';
import { sendOpsAlert } from '@/lib/ops-alert';
import { shouldSendAlert } from '@/lib/ops-alert-dedup';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const RUN = strip(readFileSync(join(process.cwd(), 'src/lib/gov-contacts/buyer-contact-run.ts'), 'utf8'));
const ROUTE = strip(readFileSync(join(process.cwd(), 'src/app/api/cron/sync-gov-buyer-data/route.ts'), 'utf8'));
const SAMSYNC = strip(readFileSync(join(process.cwd(), 'src/app/api/cron/sync-sam-opportunities/route.ts'), 'utf8'));

interface Writes { table: string; op: 'update' | 'upsert' | 'insert' | 'delete'; payload: unknown }

/** A notice that yields exactly one contact row. */
const notice = (id: string, createdAt: string) => ({
  notice_id: id, solicitation_number: 'W1', department: 'ARMY', office: null,
  sub_tier: 'ARMY', posted_date: '2026-05-01', created_at: createdAt,
  points_of_contact: [{ fullName: `Person ${id}`, email: `${id}@army.mil`, type: 'primary' }],
});

function makeDb(opts: { notices?: ReturnType<typeof notice>[]; leaseTaken?: boolean } = {}) {
  const writes: Writes[] = [];
  const notices = opts.notices ?? [notice('a', '2026-01-01T00:00:00.000Z')];

  function builder(table: string) {
    const state: Record<string, unknown> = { table };
    const self: Record<string, unknown> = {};
    const chain = () => self;
    for (const m of ['select', 'eq', 'neq', 'not', 'gte', 'or', 'in', 'order', 'range', 'limit', 'maybeSingle']) {
      self[m] = (...args: unknown[]) => {
        if (m === 'select') state.select = args[0];
        if (m === 'maybeSingle') return resolve();
        return chain();
      };
    }
    self.update = (payload: unknown) => { writes.push({ table, op: 'update', payload }); state.op = 'update'; return chain(); };
    self.upsert = (payload: unknown) => { writes.push({ table, op: 'upsert', payload }); state.op = 'upsert'; return chain(); };

    function resolve() {
      if (table === 'decision_makers_sync_state') {
        if (state.op === 'update') {
          // Lease acquire returns a row only when the lease is free; null when taken.
          return Promise.resolve({ data: opts.leaseTaken ? null : { lane: 'backfill' }, error: null });
        }
        return Promise.resolve({
          data: [
            { lane: 'backfill', cursor_created_at: null, cursor_notice_id: null, pass_completed_at: null, pass_number: 1, notices_scanned: 0, contacts_inserted: 0, contacts_updated: 0, contacts_unchanged: 0 },
            { lane: 'refresh', cursor_created_at: null, cursor_notice_id: null, pass_completed_at: null, pass_number: 1, notices_scanned: 0, contacts_inserted: 0, contacts_updated: 0, contacts_unchanged: 0 },
          ],
          error: null,
        });
      }
      if (table === 'sam_opportunities') return Promise.resolve({ data: notices, count: notices.length, error: null });
      if (table === 'federal_contacts') return Promise.resolve({ data: [], count: 165156, error: null });
      if (table === 'data_source_instances') {
        return Promise.resolve({ data: { last_successful_check: null, last_data_advance: null, last_verified_ingest: null }, error: null });
      }
      return Promise.resolve({ data: [], count: 0, error: null });
    }
    self.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => resolve().then(res, rej);
    return self;
  }

  const db = {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: 257227, error: null }),
    __writes: writes,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db as any;
}

beforeEach(() => vi.clearAllMocks());

describe('dry mode = ZERO persistent writes', () => {
  it('records no update/upsert against ANY table', async () => {
    const db = makeDb();
    const run = await runDecisionMakersSync(db, { dry: true, backfillPages: 1, refreshPages: 1, pageSize: 500 });
    expect(run.dry).toBe(true);
    expect(db.__writes).toHaveLength(0);
  });

  it('takes no lease, and says so instead of implying it held the lock', async () => {
    const db = makeDb();
    const run = await runDecisionMakersSync(db, { dry: true, backfillPages: 1, refreshPages: 1 });
    expect(run.lockAcquired).toBe(false);
    expect(db.__writes.filter((w: Writes) => w.table === 'decision_makers_sync_state')).toHaveLength(0);
  });

  it('writes no clocks and touches no alert state', async () => {
    const db = makeDb();
    const run = await runDecisionMakersSync(db, { dry: true, backfillPages: 1, refreshPages: 1 });
    expect(run.clocksWritten).toEqual({});
    expect(shouldSendAlert).not.toHaveBeenCalled();
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it('reports coverage from the PERSISTED cursor, never its own unsaved position', async () => {
    // Otherwise a rehearsal overstates traversal by exactly the pages it read.
    expect(RUN).toMatch(/const cursorForCoverage = dry \? startCursor : \(endCursor \?\? startCursor\)/);
    const db = makeDb();
    const run = await runDecisionMakersSync(db, { dry: true, backfillPages: 1, refreshPages: 1 });
    // The mock starts with a null cursor, so a dry run must still report zero traversal.
    expect(run.coverage?.visitedNotices).toBe(0);
  });

  it('still MEASURES — a dry run reports coverage and populations', async () => {
    const run = await runDecisionMakersSync(makeDb(), { dry: true, backfillPages: 1, refreshPages: 1 });
    expect(run.coverage).not.toBeNull();
    expect(run.heldPopulation).toBe(165156);
    expect(run.upstreamPopulation).toBe(257227);
  });
});

describe('one checkpoint owner', () => {
  it('a second run finds the lease taken and stops before reading a single page', async () => {
    const db = makeDb({ leaseTaken: true });
    const run = await runDecisionMakersSync(db, { backfillPages: 5 });
    expect(run.lockAcquired).toBe(false);
    expect(run.lanes).toHaveLength(0);
    expect(run.errors.join(' ')).toContain('lease');
    // Only the (failed) acquire attempt was written — no cursor, no clocks.
    expect(db.__writes.filter((w: Writes) => w.table === 'data_source_instances')).toHaveLength(0);
  });

  it('acquires with ONE conditional update, so two runs cannot both win', () => {
    expect(RUN).toMatch(/\.update\(\{ lease_owner[\s\S]{0,200}\.or\(`lease_expires_at\.is\.null,lease_expires_at\.lt\./);
  });

  it('reads the lease receipt as a row, never as a counted RETURNING payload', () => {
    const acq = RUN.slice(RUN.indexOf('async function acquireLease'), RUN.indexOf('async function releaseLease'));
    expect(acq).toMatch(/\.maybeSingle\(\)/);
    expect(acq).not.toMatch(/data\?\.length/);
  });

  it('releases only its OWN lease', () => {
    expect(RUN).toMatch(/\.eq\('lease_owner', owner\)/);
  });
});

describe('clock discipline', () => {
  it('advances last_data_advance only when rows actually mutated', async () => {
    const db = makeDb();
    const run = await runDecisionMakersSync(db, { backfillPages: 1, refreshPages: 1 });
    // The mock holds no existing rows, so every extracted row is an INSERT.
    expect(run.stats.inserted).toBeGreaterThan(0);
    expect(run.clocksWritten.last_data_advance).toBeTruthy();
  });

  it('never fabricates last_source_advance — this source is DERIVED from sam_opportunities', () => {
    expect(RUN).not.toMatch(/clocks\.last_source_advance/);
    expect(RUN).not.toMatch(/last_source_advance:/);
  });

  it('gates last_successful_check / last_verified_ingest on a failure-free run', () => {
    expect(RUN).toMatch(/if \(verified\) \{ clocks\.last_successful_check[\s\S]{0,80}last_verified_ingest/);
  });

  it('gates last_data_advance on real mutations', () => {
    expect(RUN).toMatch(/if \(advanced\) clocks\.last_data_advance/);
  });

  it('an unmeasured upstream stays NULL rather than collapsing to 0', () => {
    expect(RUN).toMatch(/if \(out\.upstreamPopulation !== null\) clocks\.upstream_population/);
    expect(RUN).not.toMatch(/upstreamPopulation \?\? 0/);
  });

  it('a NULL count is UNKNOWN, never zero', () => {
    expect(RUN).toMatch(/count == null/);
    expect(RUN).not.toMatch(/count \?\? 0/);
    expect(RUN).toMatch(/count: 'exact', head: true/);
  });
});

describe('the drain cannot skip', () => {
  it('a failed page BREAKS without advancing the cursor', () => {
    const backfill = RUN.slice(RUN.indexOf('async function runBackfillLane'));
    expect(backfill).toMatch(/if \(error\) \{ stats\.apiFailures\+\+; break; \}/);
    // …and the break sits BEFORE the cursor advance, not after.
    expect(backfill.indexOf('apiFailures++; break;')).toBeLessThan(backfill.indexOf('cursor = advanceCursor'));
  });

  it('the cursor advances only AFTER the batch is written', () => {
    const backfill = RUN.slice(RUN.indexOf('async function runBackfillLane'));
    expect(backfill.indexOf('await processNotices')).toBeLessThan(backfill.indexOf('cursor = advanceCursor'));
  });

  it('orders the keyset by created_at then notice_id — never posted_date, never offset', () => {
    const backfill = RUN.slice(RUN.indexOf('async function runBackfillLane'), RUN.indexOf('// ───────────────────────── the run'));
    expect(backfill).toMatch(/\.order\('created_at', \{ ascending: true \}\)[\s\S]{0,80}\.order\('notice_id', \{ ascending: true \}\)/);
    expect(backfill).not.toMatch(/posted_date/);
    expect(backfill).not.toMatch(/\.range\(/);
  });

  it('never moves the cursor backwards', () => {
    expect(RUN).toMatch(/if \(moved && endCursor\)/);
    expect(RUN).toMatch(/cursorIsAhead\(startCursor, endCursor\)/);
  });
});

describe('two lanes', () => {
  it('runs REFRESH before BACKFILL so a budget cut protects live notices', () => {
    expect(RUN.indexOf('await runRefreshLane')).toBeLessThan(RUN.indexOf('await runBackfillLane'));
  });

  it('the refresh lane is bounded by a window, not by the whole corpus', () => {
    const refresh = RUN.slice(RUN.indexOf('async function runRefreshLane'), RUN.indexOf('async function runBackfillLane'));
    expect(refresh).toMatch(/\.gte\('updated_at', since\)/);
  });

  it('reports both lanes separately so coverage debt is attributable', async () => {
    const run = await runDecisionMakersSync(makeDb(), { backfillPages: 1, refreshPages: 1 });
    expect(run.lanes.map((l) => l.lane)).toEqual(['refresh', 'backfill']);
  });
});

describe('alerting', () => {
  it('alert delivery failure is itself reported, not swallowed', () => {
    expect(RUN).toMatch(/deliveryOk: res\.ok/);
    expect(RUN).toMatch(/if \(!res\.ok\) errors\.push/);
  });

  it('dedup runs before the send, and both sit inside the !dry guard', () => {
    const guarded = RUN.slice(RUN.indexOf('if (health.alert && !dry)'));
    expect(guarded.indexOf('shouldSendAlert')).toBeLessThan(guarded.indexOf('sendOpsAlert'));
  });

  it('a suppressed alert reports suppression rather than claiming it fired', async () => {
    vi.mocked(shouldSendAlert).mockResolvedValueOnce({ send: false, reason: 'suppressed' });
    const db = makeDb();
    // Force an alerting state: no prior check + incomplete coverage → unmeasured… but a
    // successful run stamps the check, so drive the assertion off the healthy path instead.
    const run = await runDecisionMakersSync(db, { backfillPages: 1, refreshPages: 1 });
    expect(run.alert).not.toBeNull();
    expect(run.alert?.fired).toBe(false);
  });
});

describe('production authority', () => {
  it('the contacts pull no longer runs from the unawaited sync-sam-opportunities fetch', () => {
    expect(SAMSYNC).toMatch(/sync-gov-buyer-data\?pull=entities/);
    expect(SAMSYNC).not.toMatch(/sync-gov-buyer-data\?pull=both/);
    expect(SAMSYNC).not.toMatch(/sync-gov-buyer-data\?pull=contacts/);
  });

  it('the route delegates to the registered runner instead of sweeping the head itself', () => {
    expect(ROUTE).toMatch(/runDecisionMakersSync\(/);
    // The old head-window sweep is gone: no page budget, no key construction, and the route
    // never touches federal_contacts itself. (points_of_contact still appears in the
    // UNRELATED sam_entities mapping, so asserting on that string would be a false guard.)
    expect(ROUTE).not.toMatch(/GOV_BUYER_CONTACT_PAGES_PER_RUN/);
    expect(ROUTE).not.toMatch(/source_row_key/);
    expect(ROUTE).not.toMatch(/from\('federal_contacts'\)/);
  });

  it('dry=1 also suppresses the entity pull, so the flag means one thing everywhere', () => {
    expect(ROUTE).toMatch(/pull === 'entities'\) && !dry/);
  });

  it('accepts the cron DISPATCHER bearer — without it a scheduled fire 401s', () => {
    // The dispatcher sends `authorization: Bearer $CRON_SECRET` and never `x-vercel-cron`.
    // The first real scheduled fire returned 401 because this branch did not exist.
    expect(ROUTE).toMatch(/auth === `Bearer \$\{process\.env\.CRON_SECRET\}`/);
    expect(ROUTE).toMatch(/!isVercelCron && !isDispatcher && password !== ADMIN_PASSWORD/);
  });

  it('an unset CRON_SECRET cannot authenticate an empty bearer', () => {
    expect(ROUTE).toMatch(/Boolean\(process\.env\.CRON_SECRET\) && auth ===/);
  });
});
