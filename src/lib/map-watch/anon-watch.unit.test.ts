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
/** A saved_searches fake honouring select/update + eq/in, with exact counts — like PostgREST. */
function claimDb(rows: WRow[], opts: { nullCount?: boolean; failFilterUpdate?: boolean; profileNaics?: string[] | 'error' } = {}) {
  const writes: Array<{ payload: Record<string, unknown>; ids: string[] }> = [];
  const db = {
    from: (table?: string) => {
      if (table === 'user_notification_settings') {
        const res = opts.profileNaics === 'error'
          ? { data: null, error: { message: 'down' } }
          : { data: { naics_codes: opts.profileNaics ?? [] }, error: null };
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(res) }) }) };
      }
      const conds: Array<[string, string, unknown]> = [];
      let payload: Record<string, unknown> | null = null;
      const match = (r: WRow) => conds.every(([op, k, v]) =>
        op === 'eq' ? (r as unknown as Record<string, unknown>)[k] === v : (v as string[]).includes((r as unknown as Record<string, string>)[k]));
      const q: Record<string, unknown> = {
        select: () => q,
        update: (p: Record<string, unknown>) => { payload = p; return q; },
        eq: (k: string, v: unknown) => { conds.push(['eq', k, v]); return q; },
        in: (k: string, v: unknown[]) => { conds.push(['in', k, v]); return q; },
        then: (res: (v: unknown) => unknown) => {
          const hit = rows.filter(match);
          if (!payload) return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(res);
          if (opts.failFilterUpdate && 'filters' in payload) return Promise.resolve({ error: { message: 'boom' }, count: null }).then(res);
          for (const r of hit) Object.assign(r, payload);
          writes.push({ payload, ids: hit.map((r) => r.id) });
          return Promise.resolve({ error: null, count: opts.nullCount ? null : hit.length }).then(res);
        },
      };
      return q;
    },
  };
  return { db: db as never, writes };
}
const w = (id: string, mode: string, horizons?: Record<string, unknown>, extra: Record<string, unknown> = {}): WRow =>
  ({ id, user_email: ANON, mode, filters: { naics: '541512', state: 'VA', ...(horizons ? { horizons } : {}), ...extra }, alerts_enabled: false });

describe('claiming is the only way alerts turn on', () => {
  it('attaches the verified email and enables alerts on an emailable watch, scoped to that anon id', async () => {
    const rows = [w('a', 'open', { open: true, recompete: false, forecast: true }), { ...w('x', 'open'), user_email: 'anon:someone-else' }];
    const { db } = claimDb(rows);
    const r = await claimAnonWatch(db, ANON, 'Buyer@Example.com');
    expect(r).toMatchObject({ ok: true, claimed: 1, alertsOn: 1, notEmailable: 0, comingBackExcluded: 0 });
    expect(rows[0]).toMatchObject({ user_email: 'buyer@example.com', alerts_enabled: true });
    expect(rows[0].filters).toEqual({ naics: '541512', state: 'VA', horizons: { open: true, recompete: false, forecast: true } });
    // one visitor cannot claim another's watch
    expect(rows[1].user_email).toBe('anon:someone-else');
  });

  it('refuses a malformed anon id', async () => {
    expect((await claimAnonWatch(claimDb([]).db, 'nope', 'a@b.com')).ok).toBe(false);
  });

  it('refuses a non-email', async () => {
    expect((await claimAnonWatch(claimDb([]).db, ANON, 'not-an-email')).ok).toBe(false);
  });

  it('uses an EXACT count, never the capped RETURNING payload (INT-005)', async () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/map-watch/anon-watch.ts'), 'utf8');
    expect(src).toMatch(/\{ count: 'exact' \}/);
    expect(src).not.toMatch(/\.update\([\s\S]{0,200}\.select\('id'\)/);
  });

  it('a NULL count is UNKNOWN, never reported as zero claimed', async () => {
    const { db } = claimDb([w('a', 'open')], { nullCount: true });
    const r = await claimAnonWatch(db, ANON, 'a@b.com');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/UNKNOWN, not zero/i);
  });
});

// F3 (2026-10-10): claiming turned alerts on for EVERY anon watch, including scopes the alert cron cannot
// deliver. Prod: 46 pending anon watches carry Recompete; one claimed watch (2026-10-04) alerts with it.
describe('F3 — claiming never activates an unsupported alert scope', () => {
  it('a watch kept with Recompetes on alerts for Open/Forecast only; every other filter is preserved', async () => {
    const rows = [w('a', 'open', { open: true, recompete: true, forecast: true })];
    const { db } = claimDb(rows);
    const r = await claimAnonWatch(db, ANON, 'a@b.com');
    expect(r).toMatchObject({ ok: true, claimed: 1, alertsOn: 1, comingBackExcluded: 1, notEmailable: 0 });
    expect(rows[0].alerts_enabled).toBe(true);
    expect(rows[0].filters).toEqual({ naics: '541512', state: 'VA', horizons: { open: true, recompete: false, forecast: true } });
  });

  it('a Recompete-only watch is claimed with alerts OFF and its filters untouched', async () => {
    const rows = [w('a', 'open', { open: false, recompete: true, forecast: false }), w('b', 'recompete')];
    const before = JSON.parse(JSON.stringify(rows.map((r) => r.filters)));
    const { db } = claimDb(rows);
    const r = await claimAnonWatch(db, ANON, 'a@b.com');
    expect(r).toMatchObject({ ok: true, claimed: 2, alertsOn: 0, notEmailable: 2, comingBackExcluded: 0 });
    expect(rows.map((x) => x.alerts_enabled)).toEqual([false, false]);
    expect(rows.map((x) => x.user_email)).toEqual(['a@b.com', 'a@b.com']);
    expect(rows.map((x) => x.filters)).toEqual(before);
  });

  it('never turns on a horizon the user did not choose (no broadening)', async () => {
    const rows = [w('a', 'open', { open: false, recompete: true, forecast: true })];
    await claimAnonWatch(claimDb(rows).db, ANON, 'a@b.com');
    expect(rows[0].filters.horizons).toEqual({ open: false, recompete: false, forecast: true });
  });

  it('a failed narrowing turns NOTHING on', async () => {
    const rows = [w('a', 'open', { open: true, recompete: true, forecast: false })];
    const r = await claimAnonWatch(claimDb(rows, { failFilterUpdate: true }).db, ANON, 'a@b.com');
    expect(r.ok).toBe(false);
    expect(rows[0]).toMatchObject({ user_email: ANON, alerts_enabled: false });
  });

  it('a mixed browser: each watch gets the truthful state', async () => {
    const rows = [w('a', 'open'), w('b', 'open', { open: true, recompete: true, forecast: false }), w('c', 'recompete')];
    const r = await claimAnonWatch(claimDb(rows).db, ANON, 'a@b.com');
    expect(r).toMatchObject({ ok: true, claimed: 3, alertsOn: 2, notEmailable: 1, comingBackExcluded: 1 });
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

  // UNIFIED VALIDATION (P0 release fix, 2026-11-14). This test used to assert that an anonymous watch may
  // store keys outside the allowlist. Those rows became ALERTING watches at claim time even though the alert
  // engine cannot apply those keys. Anonymous watches now follow the signed-in rules; the Map translates the
  // two multi-selects and asks before leaving map-only filters out, so a current client never sends them.
  const real = {
    naics: '541512', state: ['FL', 'GA'], valueRange: '-10297772', setAsideMulti: 'SDVOSB',
    noticeMulti: 'Solicitation,Presolicitation,Sources Sought', fsc: '7030', closingDays: '30',
    postedDays: '30', country: 'us', status: 'active', scope: 'profile', hasDocs: '1', fullOpen: true,
    sapBuyer: 'most', strategy: ['repeat_buyer', 'sb_friendly'], horizons: { open: true, forecast: true },
  };
  it('refuses the old Map payload with map-only keys, naming them (names only)', () => {
    const r = checkWatchPayload(real, null, null);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('invalid_filters');
    expect(r.reason).toBe('unsupported_keys');
    expect(r.refusedKeys).toEqual(['valueRange', 'setAsideMulti', 'noticeMulti', 'fsc']);
    expect(JSON.stringify(r.refusedKeys)).not.toContain('10297772');
  });
  it('accepts the same watch as the Map now plans it (multi-selects translated, map-only keys confirmed out)', () => {
    const planned: Record<string, unknown> = { ...real, setAside: 'SDVOSB', noticeType: 'Solicitation,Presolicitation,Sources Sought' };
    for (const k of ['valueRange', 'setAsideMulti', 'noticeMulti', 'fsc']) delete planned[k];
    expect(checkWatchPayload(planned, null, null)).toEqual({ ok: true });
  });
  it('refuses a whole-market anonymous watch, same as the signed-in path', () => {
    const r = checkWatchPayload({ horizons: { open: true, recompete: false, forecast: false } }, null, null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_narrowing');
  });
});

// UNIFIED ACTIVATION (P0 release fix, 2026-11-14): rows stored before the unified validator can hold map-only
// keys or no narrowing filter. Claiming them must not turn alerts on; they stay as bookmarks, untouched.
describe('claiming never activates filters the alert engine cannot honor', () => {
  it('a stored watch with a map-only key is claimed with alerts OFF and its filters untouched', async () => {
    const rows = [w('a', 'open', { open: true, recompete: false, forecast: false }, { valueRange: '-5772114' })];
    const before = JSON.parse(JSON.stringify(rows[0].filters));
    const r = await claimAnonWatch(claimDb(rows).db, ANON, 'a@b.com');
    expect(r).toMatchObject({ ok: true, claimed: 1, alertsOn: 0, filtersNotHonored: 1, notEmailable: 0 });
    expect(rows[0]).toMatchObject({ user_email: 'a@b.com', alerts_enabled: false });
    expect(rows[0].filters).toEqual(before);
  });

  it('a whole-market stored watch is claimed with alerts OFF', async () => {
    const rows: WRow[] = [{ id: 'a', user_email: ANON, mode: 'open', filters: { horizons: { open: true, recompete: false, forecast: false } }, alerts_enabled: false }];
    const r = await claimAnonWatch(claimDb(rows).db, ANON, 'a@b.com');
    expect(r).toMatchObject({ ok: true, alertsOn: 0, filtersNotHonored: 1 });
    expect(rows[0].alerts_enabled).toBe(false);
  });

  it('a mix: valid watches alert, unhonorable ones do not, recompete-only stays notEmailable', async () => {
    const rows = [w('a', 'open'), w('b', 'open', undefined, { office: 'W912PL' }), w('c', 'recompete')];
    const r = await claimAnonWatch(claimDb(rows).db, ANON, 'a@b.com');
    expect(r).toMatchObject({ ok: true, claimed: 3, alertsOn: 1, filtersNotHonored: 1, notEmailable: 1 });
    expect(rows.map((x) => x.alerts_enabled)).toEqual([true, false, false]);
  });
});

describe('a profile-scoped watch alerts only with profile NAICS (same rule as the signed-in path)', () => {
  const prof = (): WRow[] => [{ id: 'p', user_email: ANON, mode: 'open', filters: { scope: 'profile', horizons: { open: true, recompete: false, forecast: false } }, alerts_enabled: false }];
  it('profile has NAICS → alerts on', async () => {
    const rows = prof();
    const r = await claimAnonWatch(claimDb(rows, { profileNaics: ['541512'] }).db, ANON, 'a@b.com');
    expect(r).toMatchObject({ alertsOn: 1, filtersNotHonored: 0 });
  });
  it('profile has no NAICS → alerts off', async () => {
    const rows = prof();
    const r = await claimAnonWatch(claimDb(rows, { profileNaics: [] }).db, ANON, 'a@b.com');
    expect(r).toMatchObject({ alertsOn: 0, filtersNotHonored: 1 });
    expect(rows[0].alerts_enabled).toBe(false);
  });
  it('profile read fails → UNKNOWN → alerts off, never assumed', async () => {
    const rows = prof();
    const r = await claimAnonWatch(claimDb(rows, { profileNaics: 'error' }).db, ANON, 'a@b.com');
    expect(r).toMatchObject({ alertsOn: 0, filtersNotHonored: 1 });
  });
});
