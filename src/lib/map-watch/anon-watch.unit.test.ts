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
  isAnonId, watchOwner, deriveWatchName, saveMapWatch, claimAnonWatch,
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

describe('claiming is the only way alerts turn on', () => {
  it('attaches the email and enables alerts, scoped to that anon id', async () => {
    const { db, captured } = mockDb();
    const r = await claimAnonWatch(db, ANON, 'Buyer@Example.com');
    expect(r.ok).toBe(true);
    expect(captured.update!.user_email).toBe('buyer@example.com');
    expect(captured.update!.alerts_enabled).toBe(true);
    // scoped — one visitor cannot claim another's watch
    expect(captured.eq).toEqual(['user_email', ANON]);
  });

  it('refuses a malformed anon id', async () => {
    const { db } = mockDb();
    expect((await claimAnonWatch(db, 'nope', 'a@b.com')).ok).toBe(false);
  });

  it('refuses a non-email', async () => {
    const { db } = mockDb();
    expect((await claimAnonWatch(db, ANON, 'not-an-email')).ok).toBe(false);
  });

  it('uses an EXACT count, never the capped RETURNING payload (INT-005)', async () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/map-watch/anon-watch.ts'), 'utf8');
    expect(src).toMatch(/\{ count: 'exact' \}/);
    expect(src).not.toMatch(/\.update\([\s\S]{0,200}\.select\('id'\)/);
  });

  it('a NULL count is UNKNOWN, never reported as zero claimed', async () => {
    const q: Record<string, unknown> = {};
    q.update = () => q; q.eq = () => q;
    q.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, count: null, error: null }).then(res);
    const db = { from: () => q } as never;
    const r = await claimAnonWatch(db, ANON, 'a@b.com');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/UNKNOWN, not zero/i);
  });
});
