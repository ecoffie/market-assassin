import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accessTokenFor, disconnect, listConnections, saveConnection, scopeKeyFor } from './store';
import { OAuthError } from './oauth';
import { decryptSecret as decrypt } from '@/lib/crypto/secretbox';

/** Minimal in-memory stand-in for the PostgREST chains the store uses. */
function fakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  const conflicts: string[] = [];
  let n = 0;
  const make = () => {
    const filters: Array<[string, string, unknown]> = [];
    let op: 'select' | 'update' | 'upsert' | 'delete' = 'select';
    let patch: Record<string, unknown> = {};
    const match = (r: Record<string, unknown>) => filters.every(([k, kind, v]) => (kind === 'eq' ? r[k] === v : r[k] !== v));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push([k, 'eq', v]); return q; },
      neq: (k: string, v: unknown) => { filters.push([k, 'neq', v]); return q; },
      order: () => q,
      update: (p: Record<string, unknown>) => { op = 'update'; patch = p; return q; },
      delete: () => { op = 'delete'; return q; },
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
        op = 'upsert';
        conflicts.push(String(opts?.onConflict));
        // Same key as the unique index: (scope_key, provider, provider_account_id, owner_email).
        const hit = rows.find((r) => r.scope_key === row.scope_key && r.provider === row.provider && r.provider_account_id === row.provider_account_id && r.owner_email === row.owner_email);
        if (hit) Object.assign(hit, row);
        else rows.push({ id: `id-${++n}`, created_at: new Date().toISOString(), refresh_token_enc: null, ...row });
        patch = row;
        return q;
      },
      single: async () => ({ data: rows.find((r) => r.scope_key === patch.scope_key && r.provider_account_id === patch.provider_account_id && r.owner_email === patch.owner_email) ?? null, error: null }),
      maybeSingle: async () => ({ data: rows.find(match) ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        if (op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: null, error: null }).then(res); }
        if (op === 'delete') { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1); return Promise.resolve({ data: null, error: null }).then(res); }
        return Promise.resolve({ data: rows.filter(match), error: null }).then(res);
      },
    };
    return q;
  };
  return { rows, conflicts, db: { from: () => make() } as unknown as SupabaseClient };
}

const KEY = 'token-key-test-0123456789abcdef01234567';
beforeEach(() => {
  process.env.CONNECTED_APPS_STATE_SECRET = 'state-secret-test-0123456789abcdef0123';
  process.env.CONNECTED_APPS_TOKEN_ENC_KEY = KEY;
  process.env.CRM_TOKEN_ENC_KEY = 'shared-crm-key-test';
});
const decryptSecret = (v: string) => decrypt(v, { secret: KEY, salt: 'mindy-connected-apps-v1', id: 'k1' });

const tokens = (o: Partial<{ accessToken: string; refreshToken: string | null; expiresAt: number }> = {}) => ({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: Date.now() + 3600_000, grantedScopes: ['openid'], ...o });
const conn = (scopeKey: string, accountId = 'g-1', ownerEmail = 'a@b.com') => ({ scopeKey, ownerEmail, provider: 'google' as const, accountId, email: 'owner@acme.com', name: 'Owner', tokens: tokens() });

describe('scopeKeyFor', () => {
  it('own, client workspace, and refuse when unconfirmed', () => {
    expect(scopeKeyFor({ kind: 'own', email: 'A@b.com' })).toBe('own:a@b.com');
    expect(scopeKeyFor({ kind: 'client', email: 'coach@x.com', workspaceId: 'w1', vaultEmail: 'v' })).toBe('ws:w1');
    expect(scopeKeyFor({ kind: 'unavailable', email: 'a@b.com' })).toBeNull();
  });
});

describe('connected accounts store', () => {
  it('encrypts tokens at rest and never returns them in the view', async () => {
    const { db, rows } = fakeDb();
    const v = await saveConnection(conn('own:a@b.com'), db);
    expect(v).not.toHaveProperty('refresh_token_enc');
    expect(String(rows[0].refresh_token_enc)).toMatch(/^v2:k1:/); // key id travels with the ciphertext
    expect(decryptSecret(String(rows[0].refresh_token_enc))).toBe('rt-1');
    expect(JSON.stringify(rows[0])).not.toContain('rt-1');
    // Not readable with the shared CRM fallback key: the dedicated key is the only one.
    expect(() => decrypt(String(rows[0].refresh_token_enc))).toThrow();
  });

  it('refuses to store tokens without the dedicated key', async () => {
    delete process.env.CONNECTED_APPS_TOKEN_ENC_KEY;
    const { db, rows } = fakeDb();
    await expect(saveConnection(conn('own:a@b.com'), db)).rejects.toThrow(/dedicated secrets/);
    expect(rows).toHaveLength(0);
  });

  it('isolation: another scope can neither list nor use the connection', async () => {
    const { db } = fakeDb();
    const v = await saveConnection(conn('own:a@b.com'), db);
    expect(await listConnections('ws:other', 'a@b.com', db)).toEqual([]);
    expect(await accessTokenFor('ws:other', 'a@b.com', v.id, { db })).toEqual({ ok: false, reason: 'not_found' });
    expect(await disconnect('ws:other', 'a@b.com', v.id, { db, revoke: async () => 'revoked' })).toBe('not_found');
  });

  it('shared client workspace: a colleague can neither list, use nor disconnect another coach\'s connection', async () => {
    const { db, rows } = fakeDb();
    const mine = await saveConnection(conn('ws:w-9', 'g-1', 'coach-a@x.com'), db);
    await saveConnection(conn('ws:w-9', 'g-2', 'coach-b@x.com'), db);
    expect((await listConnections('ws:w-9', 'coach-b@x.com', db)).map((c) => c.id)).not.toContain(mine.id);
    expect(await listConnections('ws:w-9', 'coach-a@x.com', db)).toHaveLength(1);
    expect(await accessTokenFor('ws:w-9', 'coach-b@x.com', mine.id, { db })).toEqual({ ok: false, reason: 'not_found' });
    expect(await disconnect('ws:w-9', 'coach-b@x.com', mine.id, { db, revoke: async () => 'revoked' })).toBe('not_found');
    expect(rows.find((r) => r.id === mine.id)?.status).toBe('connected');
    expect(await accessTokenFor('ws:w-9', 'Coach-A@x.com', mine.id, { db })).toMatchObject({ ok: true });
  });

  it('a re-consent without a refresh token keeps the stored one', async () => {
    const { db, rows } = fakeDb();
    await saveConnection(conn('own:a@b.com'), db);
    await saveConnection({ ...conn('own:a@b.com'), tokens: tokens({ accessToken: 'at-2', refreshToken: null }) }, db);
    expect(rows).toHaveLength(1);
    expect(decryptSecret(String(rows[0].refresh_token_enc))).toBe('rt-1');
  });

  it('a fresh access token is used as-is; an expiring one is refreshed', async () => {
    const { db } = fakeDb();
    const v = await saveConnection(conn('own:a@b.com'), db);
    expect(await accessTokenFor('own:a@b.com', 'a@b.com', v.id, { db })).toMatchObject({ ok: true, token: 'at-1' });
    const later = Date.now() + 3600_000;
    const r = await accessTokenFor('own:a@b.com', 'a@b.com', v.id, { db, now: later, refresh: async () => tokens({ accessToken: 'at-new', refreshToken: null, expiresAt: later + 3600_000 }) });
    expect(r).toMatchObject({ ok: true, token: 'at-new' });
  });

  it('a dead grant marks reauth_needed and fails closed', async () => {
    const { db, rows } = fakeDb();
    const v = await saveConnection(conn('own:a@b.com'), db);
    const r = await accessTokenFor('own:a@b.com', 'a@b.com', v.id, { db, now: Date.now() + 7200_000, refresh: async () => { throw new OAuthError('invalid_grant'); } });
    expect(r).toEqual({ ok: false, reason: 'reauth_needed' });
    expect(rows[0].status).toBe('reauth_needed');
    expect(await accessTokenFor('own:a@b.com', 'a@b.com', v.id, { db })).toEqual({ ok: false, reason: 'reauth_needed' });
  });

  it('a transient refresh failure is not a reauth', async () => {
    const { db, rows } = fakeDb();
    const v = await saveConnection(conn('own:a@b.com'), db);
    expect(await accessTokenFor('own:a@b.com', 'a@b.com', v.id, { db, now: Date.now() + 7200_000, refresh: async () => { throw new OAuthError('http_503'); } })).toEqual({ ok: false, reason: 'refresh_failed' });
    expect(rows[0].status).toBe('connected');
  });

  it('disconnect revokes at the provider, discards tokens, and stops further use', async () => {
    const { db, rows } = fakeDb();
    const v = await saveConnection(conn('own:a@b.com'), db);
    let revoked = '';
    expect(await disconnect('own:a@b.com', 'a@b.com', v.id, { db, revoke: async (_p, t) => { revoked = t; return 'revoked'; } })).toBe('disconnected');
    expect(revoked).toBe('rt-1');
    expect(rows).toHaveLength(0); // the row (tokens and all) is deleted
    expect(await accessTokenFor('own:a@b.com', 'a@b.com', v.id, { db })).toEqual({ ok: false, reason: 'not_found' });
    expect(await listConnections('own:a@b.com', 'a@b.com', db)).toEqual([]);
  });

  it('a reconnect after disconnect is a NEW connection id, so handles bound to the old id never work again', async () => {
    const { db } = fakeDb();
    const v1 = await saveConnection(conn('own:a@b.com'), db);
    await disconnect('own:a@b.com', 'a@b.com', v1.id, { db, revoke: async () => 'revoked' });
    const v2 = await saveConnection(conn('own:a@b.com'), db);
    expect(v2.id).not.toBe(v1.id);
    expect(await accessTokenFor('own:a@b.com', 'a@b.com', v1.id, { db })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('a colleague connecting the same provider account gets their own row; the first person keeps theirs', async () => {
    const { db, rows, conflicts } = fakeDb();
    const mine = await saveConnection(conn('ws:w1', 'g-1', 'coach1@x.com'), db);
    const theirs = await saveConnection({ ...conn('ws:w1', 'g-1', 'coach2@x.com'), tokens: tokens({ accessToken: 'at-2', refreshToken: 'rt-2' }) }, db);
    expect(rows).toHaveLength(2);
    expect(theirs.id).not.toBe(mine.id);
    expect(await accessTokenFor('ws:w1', 'coach1@x.com', mine.id, { db })).toMatchObject({ ok: true, token: 'at-1' });
    // The store upserts on the same four columns as the unique index (migration 20261127).
    expect(conflicts.every((c) => c === 'scope_key,provider,provider_account_id,owner_email')).toBe(true);
  });

  it('a stored token that no longer decrypts marks the connection reauth_needed (fail soft, no throw)', async () => {
    const { db, rows } = fakeDb();
    const v = await saveConnection(conn('own:a@b.com'), db);
    rows[0].access_token_enc = 'v2:k1:garbage:garbage:garbage';
    rows[0].refresh_token_enc = 'v2:other-key:x:y:z';
    expect(await accessTokenFor('own:a@b.com', 'a@b.com', v.id, { db })).toEqual({ ok: false, reason: 'reauth_needed' });
    expect(rows[0].status).toBe('reauth_needed');
  });
});
