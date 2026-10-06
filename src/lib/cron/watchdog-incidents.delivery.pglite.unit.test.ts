/**
 * Delivery-failure matrix for watchdog incident notifications, on real Postgres (PGlite) with the
 * real migration. `delivered` is what Slack actually RECEIVED (the fake channel), `attempts` is
 * every post the watchdog tried. Each case shows what the NEXT watchdog pass does.
 *
 * Guarantee proven here: NOT exactly-once. At-least-once with a duplicate window when the outcome
 * of a post is unknown to the watchdog (timeout, or delivered-but-unconfirmed), bounded by
 * MAX_NOTIFY_ATTEMPTS; delayed-not-lost when the post definitely failed or the run died first.
 */
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  runWatchdogIncidents, MAX_NOTIFY_ATTEMPTS, PENDING_RETRY_LEASE_MS,
  type IncidentRow, type IncidentStore, type WatchdogObservation,
} from './watchdog-incidents';

const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20261005_ops_incidents.sql'), 'utf8');
const JSON_COLS = new Set(['processing_counts', 'notified_counts', 'suppression_counts']);
const ISO_COLS = ['opened_at', 'last_seen_at', 'resolved_at', 'last_notified_at'] as const;

async function freshDb() {
  const pg = new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await pg.exec(MIGRATION);
  return pg;
}

/** Same statements as the Supabase store. `failConfirm` makes the post-send confirm write fail. */
function pgStore(pg: PGlite, opts: { failConfirm?: () => boolean } = {}): IncidentStore {
  const vals = (row: Record<string, unknown>, cols: string[]) =>
    cols.map((c) => (JSON_COLS.has(c) ? JSON.stringify(row[c] ?? {}) : row[c] ?? null));
  return {
    async list(source) {
      const r = await pg.query<IncidentRow>('SELECT * FROM public.ops_incidents WHERE source = $1', [source]);
      return r.rows.map((x) => {
        const o = { ...x } as Record<string, unknown>;
        for (const c of ISO_COLS) o[c] = x[c] ? new Date(x[c] as string).toISOString() : null;
        return o as IncidentRow;
      });
    },
    async insertIfAbsent(row) {
      const cols = Object.keys(row).filter((c) => c !== 'updated_at');
      const r = await pg.query(
        `INSERT INTO public.ops_incidents (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
         ON CONFLICT (incident_key) DO NOTHING`, vals(row as Record<string, unknown>, cols));
      return (r.affectedRows ?? 0) === 1;
    },
    async compareAndSet(key, v, patch) {
      const isConfirm = patch.notify_pending === null && Object.keys(patch).length === 3 && 'notify_attempts' in patch;
      if (isConfirm && opts.failConfirm?.()) throw new Error('simulated: confirm write failed (connection reset)');
      const cols = Object.keys(patch).filter((c) => c !== 'updated_at');
      const r = await pg.query(
        `UPDATE public.ops_incidents SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
         WHERE incident_key = $${cols.length + 1} AND version = $${cols.length + 2}`,
        [...vals(patch as Record<string, unknown>, cols), key, v]);
      return (r.affectedRows ?? 0) === 1;
    },
  };
}

const EPA: WatchdogObservation = {
  key: 'failing:epa-source-watch', kind: 'failing', jobName: 'epa-source-watch', status: 'timeout',
  error: 'This operation was aborted', detail: 'last failed run 2026-10-04T14:50Z (timeout)',
};

type Mode = 'deliver' | 'reject' | 'throw' | 'slow-deliver';
/** A fake Slack channel: `delivered` = what landed in the channel. */
function slack() {
  const delivered: string[] = [];
  const attempts: string[] = [];
  let mode: Mode = 'deliver';
  return {
    delivered, attempts,
    set: (m: Mode) => { mode = m; },
    send: async (m: { subject: string; text: string }) => {
      attempts.push(m.subject);
      if (mode === 'reject') return { ok: false };                          // non-2xx / ok:false
      if (mode === 'throw') throw new Error('fetch failed (ECONNRESET)');
      if (mode === 'slow-deliver') {                                        // lands AFTER the watchdog gave up
        await new Promise((r) => setTimeout(r, 60));
        delivered.push(m.subject); return { ok: true };
      }
      delivered.push(m.subject); return { ok: true };
    },
  };
}

const T0 = Date.parse('2026-10-05T06:00:00Z');
const at = (ms: number) => new Date(T0 + ms);
const H3 = 3 * 3600_000;

async function pass(store: IncidentStore, s: ReturnType<typeof slack>, when: Date, obs: WatchdogObservation[] = [EPA]) {
  return runWatchdogIncidents({ store, source: 'dispatcher-watchdog', observations: obs, now: when, send: s.send, sendTimeoutMs: 20 });
}
async function row(pg: PGlite, key = 'failing:epa-source-watch') {
  return (await pg.query<IncidentRow>('SELECT * FROM public.ops_incidents WHERE incident_key = $1', [key])).rows[0];
}

describe('delivery-failure matrix (what the NEXT pass does)', () => {
  it('(i) Slack rejects (ok:false) → pending kept; not retried inside the lease; next pass delivers once', async () => {
    const pg = await freshDb(); const store = pgStore(pg); const s = slack();
    s.set('reject');
    const r1 = await pass(store, s, at(0));
    expect(r1.sendOutcome).toBe('rejected');
    expect((await row(pg)).notify_pending).toBe('opened');
    s.set('deliver');
    await pass(store, s, at(PENDING_RETRY_LEASE_MS - 60_000));     // overlapping/early pass: inside the lease
    expect(s.delivered).toEqual([]);
    const r3 = await pass(store, s, at(H3));
    expect(r3.claimed).toEqual([{ key: 'failing:epa-source-watch', event: 'opened' }]);
    expect(s.delivered).toEqual(['Cron watchdog: 1 opened']);       // delayed, not lost, no duplicate
    await pass(store, s, at(2 * H3));
    expect(s.delivered).toHaveLength(1);
    expect((await row(pg)).notify_pending).toBeNull();
  });

  it('(ii-a) Slack throws → same as a rejection: retried next pass, no duplicate', async () => {
    const pg = await freshDb(); const store = pgStore(pg); const s = slack();
    s.set('throw');
    expect((await pass(store, s, at(0))).sendOutcome).toBe('threw');
    s.set('deliver');
    await pass(store, s, at(H3));
    expect(s.delivered).toEqual(['Cron watchdog: 1 opened']);
  });

  it('(ii-b) Slack TIMES OUT but actually delivered → unknown outcome → next pass re-sends: DUPLICATE', async () => {
    const pg = await freshDb(); const store = pgStore(pg); const s = slack();
    s.set('slow-deliver');
    const r1 = await pass(store, s, at(0));
    expect(r1.sendOutcome).toBe('timeout');
    await new Promise((r) => setTimeout(r, 80));                    // the slow post lands
    expect(s.delivered).toEqual(['Cron watchdog: 1 opened']);
    s.set('deliver');
    await pass(store, s, at(H3));
    expect(s.delivered).toEqual(['Cron watchdog: 1 opened', 'Cron watchdog: 1 opened']); // duplicate, bounded
    await pass(store, s, at(2 * H3));
    expect(s.delivered).toHaveLength(2);
  });

  it('(iii) Slack succeeds, confirm write fails (twice in-pass) → next pass re-sends: DUPLICATE, then settles', async () => {
    const pg = await freshDb(); const s = slack();
    let failing = true;
    const store = pgStore(pg, { failConfirm: () => failing });
    const r1 = await pass(store, s, at(0));
    expect(r1.sent).toBe(true);
    expect(r1.confirmFailed).toEqual(['failing:epa-source-watch']);
    expect((await row(pg)).notify_pending).toBe('opened');
    failing = false;
    await pass(store, s, at(H3));
    expect(s.delivered).toEqual(['Cron watchdog: 1 opened', 'Cron watchdog: 1 opened']);
    await pass(store, s, at(2 * H3));
    expect(s.delivered).toHaveLength(2);
    expect((await row(pg)).notify_pending).toBeNull();
  });

  it(`(iii-b) confirm write fails FOREVER → bounded: ${MAX_NOTIFY_ATTEMPTS} deliveries, then abandoned (no 3-hourly loop)`, async () => {
    const pg = await freshDb(); const s = slack();
    const store = pgStore(pg, { failConfirm: () => true });
    const abandoned: unknown[] = [];
    for (let i = 0; i < MAX_NOTIFY_ATTEMPTS + 3; i++) abandoned.push(...(await pass(store, s, at(i * H3))).abandoned);
    expect(s.delivered).toHaveLength(MAX_NOTIFY_ATTEMPTS);
    expect(abandoned).toEqual([{ key: 'failing:epa-source-watch', event: 'opened' }]);
    const r = await row(pg);
    expect(r.notify_pending).toBeNull();
    expect(r.last_notified_event).toBe('abandoned:opened');
  });

  it('(iv-a) run dies between claim and send → next pass sends it: delayed, not lost, no duplicate', async () => {
    const pg = await freshDb(); const store = pgStore(pg); const s = slack();
    // A crash after the claim commits and before the post leaves is exactly this state:
    // the claim is durable, nothing was sent, nothing confirmed.
    const crash = async () => { throw new Error('simulated: function killed (maxDuration) before the post'); };
    await runWatchdogIncidents({ store, source: 'dispatcher-watchdog', observations: [EPA], now: at(0), send: crash });
    expect(await row(pg)).toMatchObject({ notify_pending: 'opened', notify_attempts: 1 });
    expect(s.delivered).toEqual([]);
    await pass(store, s, at(H3));
    expect(s.delivered).toEqual(['Cron watchdog: 1 opened']);
  });

  it('(iv-b) run dies between send and confirm → same state as (iii): next pass DUPLICATES', async () => {
    const pg = await freshDb(); const s = slack();
    let die = true;
    const store = pgStore(pg, { failConfirm: () => die });
    await pass(store, s, at(0));
    die = false;
    await pass(store, s, at(H3));
    expect(s.delivered).toEqual(['Cron watchdog: 1 opened', 'Cron watchdog: 1 opened']);
  });

  it('(v) a failed RECOVERY post is retried (it used to be lost: resolved rows were never revisited)', async () => {
    const pg = await freshDb(); const store = pgStore(pg); const s = slack();
    await pass(store, s, at(0));
    s.set('reject');
    const r2 = await pass(store, s, at(H3), []);                   // incident clears; recovery post rejected
    expect(r2.claimed).toEqual([{ key: 'failing:epa-source-watch', event: 'recovered' }]);
    expect(await row(pg)).toMatchObject({ status: 'resolved', notify_pending: 'recovered' });
    s.set('deliver');
    await pass(store, s, at(2 * H3), []);
    expect(s.delivered).toEqual(['Cron watchdog: 1 opened', 'Cron watchdog: 1 recovered']);
    await pass(store, s, at(3 * H3), []);
    expect(s.delivered).toHaveLength(2);
  });

  it('(vi) Slack rejects FOREVER → bounded attempts, then the still-open incident surfaces in the daily summary', async () => {
    const pg = await freshDb(); const store = pgStore(pg); const s = slack();
    s.set('reject');
    for (let i = 0; i <= MAX_NOTIFY_ATTEMPTS; i++) await pass(store, s, at(i * H3));
    expect(s.attempts.filter((a) => a.includes('opened'))).toHaveLength(MAX_NOTIFY_ATTEMPTS);
    s.set('deliver');
    await pass(store, s, new Date('2026-10-07T12:00:00Z'));
    expect(s.delivered).toEqual(['Cron watchdog daily summary: 1 open incident(s), unchanged']);
  });

  it('overlap during a pending retry → exactly one re-send', async () => {
    const pg = await freshDb(); const store = pgStore(pg); const s = slack();
    s.set('reject');
    await pass(store, s, at(0));
    s.set('deliver');
    await Promise.all([pass(store, s, at(H3)), pass(store, s, at(H3 + 1000)), pass(store, s, at(H3 + 2000))]);
    expect(s.delivered).toEqual(['Cron watchdog: 1 opened']);
  });
});
