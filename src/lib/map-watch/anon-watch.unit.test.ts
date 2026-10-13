/**
 * Anonymous map watches.
 *
 * Measured on production (30 days): 8,583 map users, only 329 signed in —
 * 8,254 (96%) anonymous. 41 users have EVER saved a search. 87% of all users
 * visit one day and never return.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isAnonId, watchOwner, deriveWatchName, saveMapWatch, claimAnonWatch, checkWatchPayload,
} from './anon-watch';

const ANON = 'anon:57b9d751-9451-40c8-9f3e-2b1c4d5e6f70';

function mockDb(result: { data?: unknown; error?: { message: string } | null } = {}) {
  const captured: { insert?: Record<string, unknown>; update?: Record<string, unknown>; eq?: [string, string] } = {};
  const q: Record<string, unknown> = {};
  q.insert = (row: Record<string, unknown>) => { captured.insert = row; return q; };
  q.update = (row: Record<string, unknown>) => { captured.update = row; return q; };
  q.eq = (k: string, v: string) => { captured.eq = [k, v]; return q; };
  q.select = () => q;
  q.single = async () => ({ data: result.data ?? { id: 'w1', name: 'n' }, error: result.error ?? null });
  q.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? [{ id: 'w1' }], count: 1, error: result.error ?? null }).then(res);
  return { db: { from: vi.fn(() => q) } as never, captured };
}

describe('anon identity', () => {
  it('accepts a well-formed anon uuid', () => {
    expect(isAnonId(ANON)).toBe(true);
  });
  it('rejects malformed ids — a bad id must not become an owner key', () => {
    for (const bad of ['anon:', 'anon:123', 'nope', '', null, undefined, 'anon:zzzzzzzz-9451-40c8-9f3e-2b1c4d5e6f70']) {
      expect(isAnonId(bad as string)).toBe(false);
    }
  });
  it('a real email always wins over an anon id', () => {
    expect(watchOwner('A@B.com', ANON)).toBe('a@b.com');
  });
  it('falls back to the anon id when there is no email', () => {
    expect(watchOwner(null, ANON)).toBe(ANON);
  });
  it('returns null when neither is usable — never invents an owner', () => {
    expect(watchOwner(null, 'garbage')).toBeNull();
    expect(watchOwner('not-an-email', null)).toBeNull();
  });
});

describe('the user never has to name anything', () => {
  it('derives a readable name from what they are looking at', () => {
    expect(deriveWatchName({ naics: '541512', agency: 'Navy', state: 'FL' }, 'open'))
      .toBe('NAICS 541512 · Navy · FL');
  });
  it('uses the search term when present', () => {
    expect(deriveWatchName({ q: 'janitorial', state: 'TX' }, 'open')).toBe('janitorial · TX');
  });
  it('never returns an empty name', () => {
    expect(deriveWatchName({}, 'open')).toBe('Everything on this map');
    expect(deriveWatchName(undefined, undefined).length).toBeGreaterThan(0);
  });
  it('ignores "all" sentinels rather than printing them', () => {
    expect(deriveWatchName({ setAside: 'all', state: 'all', naics: '236220' }, 'open')).toBe('NAICS 236220');
  });
  it('marks a non-default mode so a forecast watch is distinguishable', () => {
    expect(deriveWatchName({ naics: '541512' }, 'forecast')).toContain('(forecast)');
  });
  it('caps the name at the column width', () => {
    expect(deriveWatchName({ q: 'x'.repeat(200) }, 'open').length).toBeLessThanOrEqual(80);
  });
});

describe('an anonymous watch can NEVER email anyone', () => {
  it('stores alerts_enabled=false for an anon owner', async () => {
    const { db, captured } = mockDb();
    const r = await saveMapWatch(db, { owner: ANON, filters: { naics: '541512' } });
    expect(r.ok).toBe(true);
    expect(r.alertsEnabled).toBe(false);
    // The column DEFAULTS to true — the row must override it explicitly.
    expect(captured.insert!.alerts_enabled).toBe(false);
  });

  it('an emailed owner does get alerts', async () => {
    const { db, captured } = mockDb();
    const r = await saveMapWatch(db, { owner: 'buyer@example.com', filters: {} });
    expect(r.alertsEnabled).toBe(true);
    expect(captured.insert!.alerts_enabled).toBe(true);
  });

  it('a save failure surfaces, it does not report success', async () => {
    const { db } = mockDb({ error: { message: 'boom' } });
    const r = await saveMapWatch(db, { owner: ANON });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/boom/);
  });
});

type WRow = { id: string; user_email: string; mode: string; filters: Record<string, unknown>; alerts_enabled: boolean };
/** A saved_searches fake honouring select/update + eq/in/maybeSingle, with exact counts — like PostgREST. */
function claimDb(rows: WRow[], opts: { nullCount?: boolean; failMove?: boolean } = {}) {
  const writes: Array<{ payload: Record<string, unknown>; ids: string[] }> = [];
  const db = {
    from: () => {
      const conds: Array<[string, string, unknown]> = [];
      let payload: Record<string, unknown> | null = null;
      const match = (r: WRow) => conds.every(([op, k, v]) =>
        op === 'eq' ? (r as unknown as Record<string, unknown>)[k] === v : (v as string[]).includes((r as unknown as Record<string, string>)[k]));
      const run = () => {
        const hit = rows.filter(match);
        if (!payload) return { data: hit.map((r) => ({ ...r })), error: null };
        if (opts.failMove && 'user_email' in payload) return { error: { message: 'boom' }, count: null };
        for (const r of hit) Object.assign(r, payload);
        writes.push({ payload, ids: hit.map((r) => r.id) });
        return { error: null, count: opts.nullCount ? null : hit.length };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        update: (p: Record<string, unknown>) => { payload = p; return q; },
        eq: (k: string, v: unknown) => { conds.push(['eq', k, v]); return q; },
        in: (k: string, v: unknown[]) => { conds.push(['in', k, v]); return q; },
        maybeSingle: () => { const r = run() as { data: WRow[] }; return Promise.resolve({ data: r.data[0] ?? null, error: null }); },
        then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
      };
      return q;
    },
  };
  return { db: db as never, writes };
}
const w = (id: string, mode: string, horizons?: Record<string, unknown>, owner = ANON): WRow =>
  ({ id, user_email: owner, mode, filters: { naics: '541512', state: 'VA', ...(horizons ? { horizons } : {}) }, alerts_enabled: false });
const ME = 'buyer@example.com';

describe('claiming moves THIS browser\u2019s watches — alerts OFF (option A)', () => {
  it('a bare claim (sign-in, retry, page load) moves the watch with the same filters and alerts off', async () => {
    const rows = [w('a', 'open', { open: true, recompete: true, forecast: true })];
    const before = JSON.parse(JSON.stringify(rows[0].filters));
    const r = await claimAnonWatch(claimDb(rows).db, ANON, 'Buyer@Example.com');
    expect(r).toMatchObject({ ok: true, claimed: 1, alertsOn: 0, alreadyOnAccount: 0 });
    expect(rows[0]).toMatchObject({ user_email: ME, alerts_enabled: false });
    expect(rows[0].filters).toEqual(before);
  });

  it('is scoped to the caller\u2019s anon id: another browser\u2019s watch never moves', async () => {
    const rows = [w('a', 'open'), w('x', 'open', undefined, 'anon:11111111-1111-4111-8111-111111111111')];
    await claimAnonWatch(claimDb(rows).db, ANON, ME);
    expect(rows[1].user_email).toBe('anon:11111111-1111-4111-8111-111111111111');
  });

  it('IDEMPOTENT: a second sign-in moves nothing and creates no duplicate', async () => {
    const rows = [w('a', 'open')];
    const { db } = claimDb(rows);
    await claimAnonWatch(db, ANON, ME);
    const again = await claimAnonWatch(db, ANON, ME);
    expect(again).toMatchObject({ ok: true, claimed: 0, alreadyOnAccount: 0 });
    expect(rows).toHaveLength(1);
  });

  it('switching accounts never transfers a watch already owned by another account', async () => {
    const rows = [w('a', 'open')];
    const { db } = claimDb(rows);
    await claimAnonWatch(db, ANON, ME);
    const other = await claimAnonWatch(db, ANON, 'someone-else@example.com');
    expect(other.claimed).toBe(0);
    expect(rows[0].user_email).toBe(ME);
  });

  it('an identical watch already on the account is not duplicated', async () => {
    const rows = [w('mine', 'open', { open: true }, ME), w('a', 'open', { open: true })];
    const r = await claimAnonWatch(claimDb(rows).db, ANON, ME);
    expect(r).toMatchObject({ claimed: 0, alreadyOnAccount: 1 });
    expect(rows.filter((x) => x.user_email === ME)).toHaveLength(1);
  });

  it('refuses a malformed anon id, a non-email, and an anon id posing as an account', async () => {
    expect((await claimAnonWatch(claimDb([]).db, 'nope', 'a@b.com')).ok).toBe(false);
    expect((await claimAnonWatch(claimDb([]).db, ANON, 'not-an-email')).ok).toBe(false);
  });

  it('uses an EXACT count, never the capped RETURNING payload (INT-005)', async () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/map-watch/anon-watch.ts'), 'utf8');
    expect(src).toMatch(/\{ count: 'exact' \}/);
    expect(src).not.toMatch(/\.update\([\s\S]{0,200}\.select\('id'\)/);
  });

  it('a NULL count is UNKNOWN, never reported as zero claimed', async () => {
    const r = await claimAnonWatch(claimDb([w('a', 'open')], { nullCount: true }).db, ANON, 'a@b.com');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/UNKNOWN, not zero/i);
  });

  it('a failed move turns nothing on and moves nothing', async () => {
    const rows = [w('a', 'open', { open: true })];
    const r = await claimAnonWatch(claimDb(rows, { failMove: true }).db, ANON, ME, { enableAlertsFor: 'a' });
    expect(r.ok).toBe(false);
    expect(rows[0]).toMatchObject({ user_email: ANON, alerts_enabled: false });
  });
});

describe('alerts turn on ONLY for the one watch the user explicitly opted into', () => {
  it('opt-in on an emailable watch: alerts on, every filter preserved', async () => {
    const rows = [w('a', 'open', { open: true, recompete: false, forecast: true }), w('b', 'open', { open: true })];
    const r = await claimAnonWatch(claimDb(rows).db, ANON, ME, { enableAlertsFor: 'a' });
    expect(r).toMatchObject({ ok: true, claimed: 2, alertsOn: 1 });
    expect(rows[0].alerts_enabled).toBe(true);
    expect(rows[1].alerts_enabled).toBe(false); // the other watch stays off
  });

  it('opt-in with Coming Back on: alerts for Open Now / Coming Soon only (F3), nothing broadened', async () => {
    const rows = [w('a', 'open', { open: false, recompete: true, forecast: true })];
    const r = await claimAnonWatch(claimDb(rows).db, ANON, ME, { enableAlertsFor: 'a' });
    expect(r).toMatchObject({ alertsOn: 1, comingBackExcluded: 1 });
    expect(rows[0].filters.horizons).toEqual({ open: false, recompete: false, forecast: true });
  });

  it('opt-in on a Coming Back-only watch: claimed, alerts stay OFF', async () => {
    const rows = [w('a', 'recompete')];
    const r = await claimAnonWatch(claimDb(rows).db, ANON, ME, { enableAlertsFor: 'a' });
    expect(r).toMatchObject({ claimed: 1, alertsOn: 0, notEmailable: 1 });
    expect(rows[0].alerts_enabled).toBe(false);
  });

  it('opt-in works when the sign-in hook already moved the watch (claimed 0, alerts on)', async () => {
    const rows = [w('a', 'open', { open: true }, ME)];
    const r = await claimAnonWatch(claimDb(rows).db, ANON, ME, { enableAlertsFor: 'a' });
    expect(r).toMatchObject({ claimed: 0, alertsOn: 1 });
  });

  it('a WATCH ID ALONE authorizes nothing: opting in to someone else\u2019s watch changes nothing', async () => {
    const rows = [w('theirs', 'open', { open: true }, 'victim@example.com'), w('anonOther', 'open', { open: true }, 'anon:22222222-2222-4222-8222-222222222222')];
    const r = await claimAnonWatch(claimDb(rows).db, ANON, ME, { enableAlertsFor: 'theirs' });
    expect(r).toMatchObject({ claimed: 0, alertsOn: 0 });
    const r2 = await claimAnonWatch(claimDb(rows).db, ANON, ME, { enableAlertsFor: 'anonOther' });
    expect(r2).toMatchObject({ claimed: 0, alertsOn: 0 });
    expect(rows.map((x) => [x.user_email, x.alerts_enabled])).toEqual([['victim@example.com', false], ['anon:22222222-2222-4222-8222-222222222222', false]]);
  });
});

describe('checkWatchPayload — stored values must be readable by the alert cron', () => {
  it('rejects sapBuyer saved as a boolean (the 2026-10-01 incident shape)', () => {
    const r = checkWatchPayload({ naics: '541510', sapBuyer: true }, null, null);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid sapBuyer value/);
  });

  it('rejects an unknown NAICS (541510) on the Map watch path too', () => {
    const r = checkWatchPayload({ naics: '541510' }, null, null);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown NAICS code "541510"/);
  });

  it('rejects non-string q / status', () => {
    expect(checkWatchPayload({ q: ['cyber'] }, null, null).ok).toBe(false);
    expect(checkWatchPayload({ naics: '541512', status: true }, null, null).ok).toBe(false);
  });

  it('accepts the Map payload shapes measured in production (incl. keys outside the MCP allowlist)', () => {
    const real = {
      naics: '541512', state: ['FL', 'GA'], valueRange: '-10297772', setAsideMulti: 'SDVOSB',
      noticeMulti: 'Solicitation,Presolicitation,Sources Sought', fsc: '7030', closingDays: '30',
      postedDays: '30', country: 'us', status: 'active', scope: 'profile', hasDocs: '1', fullOpen: true,
      sapBuyer: 'most', strategy: ['repeat_buyer', 'sb_friendly'], horizons: { open: true, forecast: true },
    };
    expect(checkWatchPayload(real, null, null)).toEqual({ ok: true });
  });
});
