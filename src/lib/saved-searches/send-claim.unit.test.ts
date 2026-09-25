/**
 * The expired-claim case (record §12.5): a worker whose lease expired must not be able to overwrite state after another
 * worker has taken the claim. A late SEND is bounded differently: FORECAST_SEND_LEASE_MS (600s) exceeds the cron's
 * maxDuration (300s), so a holder whose lease has expired has already been terminated by the platform.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimSend, saveEvaluation, FORECAST_SEND_LEASE_MS } from './send-claim';

type Row = Record<string, unknown>;
function oneRowDb(row: Row) {
  const ts = (v: unknown) => (v == null ? null : Date.parse(String(v)));
  return {
    row,
    from: () => {
      const ops: Array<[string, unknown[]]> = [];
      let payload: Row = {};
      const q: Record<string, unknown> = {
        update: (p: Row) => { payload = p; return q; },
        eq: (...a: unknown[]) => { ops.push(['eq', a]); return q; },
        is: (...a: unknown[]) => { ops.push(['is', a]); return q; },
        or: (...a: unknown[]) => { ops.push(['or', a]); return q; },
        then: (res: (v: unknown) => unknown) => {
          const ok = ops.every(([m, a]) => {
            const c = a[0] as string;
            if (m === 'eq') return c === 'id' ? row.id === a[1] : row[c] != null && ts(row[c]) === ts(a[1]);
            if (m === 'is') return row[c] == null;
            return String(a[0]).split(',').some((t) => {
              const [col, op, ...v] = t.split('.');
              return op === 'is' ? row[col] == null : row[col] != null && ts(row[col])! < ts(v.join('.'))!;
            });
          });
          if (ok) Object.assign(row, payload);
          return Promise.resolve({ error: null, count: ok ? 1 : 0 }).then(res);
        },
      };
      return q;
    },
  };
}

describe('expired claim', () => {
  it("worker A's lease expires, B takes the claim and saves; A's late save is REJECTED and cannot overwrite B's state", async () => {
    const db = oneRowDb({ id: 's1', last_alerted_at: '2026-09-24T11:00:00.000Z', forecast_alert_claim_until: null, forecast_seen_through: 'W0' });
    const read = { id: 's1', last_alerted_at: '2026-09-24T11:00:00.000Z' };
    const t0 = new Date('2026-09-24T12:00:00.000Z');
    const a = await claimSend(db, read, t0);
    expect(a.claimed).toBe(true);
    // While A's lease is live, B cannot claim.
    expect((await claimSend(db, read, new Date(t0.getTime() + FORECAST_SEND_LEASE_MS - 1000))).claimed).toBe(false);
    // After expiry B claims (same version: A never saved) and completes.
    const tB = new Date(t0.getTime() + FORECAST_SEND_LEASE_MS + 1000);
    const b = await claimSend(db, read, tB);
    expect(b.claimed).toBe(true);
    expect(await saveEvaluation(db, read, { forecast_seen_through: 'W_B' }, { claim: b.claimed ? b.until : '', now: tB })).toBe('saved');
    // A wakes up and tries to save with ITS claim → rejected; B's state stands.
    const late = await saveEvaluation(db, read, { forecast_seen_through: 'W_A' }, { claim: a.claimed ? a.until : '', now: new Date(tB.getTime() + 1000) });
    expect(late).toBe('concurrent');
    expect(db.row.forecast_seen_through).toBe('W_B');
  });
  it('the lease outlives any worker: FORECAST_SEND_LEASE_MS > the route maxDuration', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/cron/saved-search-alerts/route.ts'), 'utf8');
    const maxDuration = Number(/export const maxDuration = (\d+);/.exec(route)?.[1]);
    expect(maxDuration).toBeGreaterThan(0);
    expect(FORECAST_SEND_LEASE_MS).toBeGreaterThan(maxDuration * 1000);
  });
});
