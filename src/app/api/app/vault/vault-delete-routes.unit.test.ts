import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Route-level guards for Vault deletion: Archive stays the default, permanent Delete is off unless
 * VAULT_COMPLETE_DELETION='true', needs confirm=DELETE, uses the STRICT acting owner, and is refused in a
 * client workspace until the workspace ownership policy is approved. Whole-Vault delete of a client's
 * Vault is refused too when complete deletion is on.
 */
const st = vi.hoisted(() => ({
  authEmail: 'owner@x.com' as string | null,
  writeOwner: { ownerEmail: 'owner@x.com', workspace: 'own' as 'own' | 'client' } as { ownerEmail: string; workspace: 'own' | 'client' } | null,
  active: { workspaceId: 'ws-own', asClient: false },
  hardDeleteCalls: [] as Array<{ id: string; ownerEmail: string }>,
  vaultDeleteCalls: [] as string[],
  archived: [] as Array<{ id: string; owner: string }>,
}));

vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_r: unknown, email: string) =>
    st.authEmail && email === st.authEmail ? { authenticated: true, email: st.authEmail } : { authenticated: false, error: 'Unauthorized' },
}));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => st.active,
  clientNotificationEmail: (ws: string) => `client+${ws}@clients.getmindy.ai`,
}));
vi.mock('@/lib/vault/upload', async (orig) => ({
  ...(await orig<typeof import('@/lib/vault/upload')>()),
  resolveVaultWriteOwner: async () => st.writeOwner,
}));
vi.mock('@/lib/vault/document-delete', () => ({
  hardDeleteVaultDocument: async (_d: unknown, input: { id: string; ownerEmail: string }) => {
    st.hardDeleteCalls.push(input);
    return { ok: true, receipt: { documents: 1, files: 1, filesAlreadyAbsent: 0, backupPurge: { markedFiles: 1 } } };
  },
}));
vi.mock('@/lib/vault/vault-data', async (orig) => ({
  ...(await orig<typeof import('@/lib/vault/vault-data')>()),
  deleteAllVaultData: async (_sb: unknown, email: string) => {
    st.vaultDeleteCalls.push(email);
    return { tables: [], storage: { files: 0, requested: 0 }, totalRowsDeleted: 0 };
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {},
    from: () => {
      const f: { id?: string; owner?: string } = {};
      const q = {
        update: () => q,
        eq: (col: string, v: string) => { if (col === 'id') f.id = v; if (col === 'user_email') f.owner = v; return q; },
        then: (res: (v: unknown) => void) => { st.archived.push({ id: f.id!, owner: f.owner! }); res({ error: null }); },
      };
      return q;
    },
  }),
}));

import { DELETE as docDELETE } from './documents/route';
import { DELETE as vaultDELETE } from './route';

const ID = '11111111-1111-4111-8111-111111111111';
const req = (path: string) => new NextRequest(`https://getmindy.ai${path}`, { method: 'DELETE' });

beforeEach(() => {
  vi.unstubAllEnvs();
  st.authEmail = 'owner@x.com';
  st.writeOwner = { ownerEmail: 'owner@x.com', workspace: 'own' };
  st.active = { workspaceId: 'ws-own', asClient: false };
  st.hardDeleteCalls = []; st.vaultDeleteCalls = []; st.archived = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('DELETE /api/app/vault/documents', () => {
  it('default is still Archive (owner-scoped), never a permanent delete', async () => {
    vi.stubEnv('VAULT_COMPLETE_DELETION', 'true');
    const res = await docDELETE(req(`/api/app/vault/documents?email=owner@x.com&id=${ID}`));
    expect(res.status).toBe(200);
    expect(st.archived).toEqual([{ id: ID, owner: 'owner@x.com' }]);
    expect(st.hardDeleteCalls).toHaveLength(0);
  });

  it('mode=delete is unavailable while the flag is off (nothing deleted or archived)', async () => {
    const res = await docDELETE(req(`/api/app/vault/documents?email=owner@x.com&id=${ID}&mode=delete&confirm=DELETE`));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_available');
    expect(st.hardDeleteCalls).toHaveLength(0);
    expect(st.archived).toHaveLength(0);
  });

  it('requires confirm=DELETE', async () => {
    vi.stubEnv('VAULT_COMPLETE_DELETION', 'true');
    const res = await docDELETE(req(`/api/app/vault/documents?email=owner@x.com&id=${ID}&mode=delete`));
    expect(res.status).toBe(400);
    expect(st.hardDeleteCalls).toHaveLength(0);
  });

  it('an unauthenticated caller deletes nothing', async () => {
    vi.stubEnv('VAULT_COMPLETE_DELETION', 'true');
    const res = await docDELETE(req(`/api/app/vault/documents?email=victim@x.com&id=${ID}&mode=delete&confirm=DELETE`));
    expect(res.status).toBe(401);
    expect(st.hardDeleteCalls).toHaveLength(0);
  });

  it('an unconfirmed workspace deletes nothing', async () => {
    vi.stubEnv('VAULT_COMPLETE_DELETION', 'true');
    st.writeOwner = null;
    const res = await docDELETE(req(`/api/app/vault/documents?email=owner@x.com&id=${ID}&mode=delete&confirm=DELETE`));
    expect(res.status).toBe(409);
    expect(st.hardDeleteCalls).toHaveLength(0);
  });

  it("a client workspace is refused until the ownership policy is approved", async () => {
    vi.stubEnv('VAULT_COMPLETE_DELETION', 'true');
    st.writeOwner = { ownerEmail: 'client+ws1@clients.getmindy.ai', workspace: 'client' };
    const res = await docDELETE(req(`/api/app/vault/documents?email=owner@x.com&id=${ID}&mode=delete&confirm=DELETE`));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('client_workspace_policy_pending');
    expect(st.hardDeleteCalls).toHaveLength(0);
  });

  it('own Vault: deletes as the confirmed owner, never the email in the query', async () => {
    vi.stubEnv('VAULT_COMPLETE_DELETION', 'true');
    const res = await docDELETE(req(`/api/app/vault/documents?email=owner@x.com&id=${ID}&mode=delete&confirm=DELETE`));
    expect(res.status).toBe(200);
    expect(st.hardDeleteCalls).toEqual([{ id: ID, ownerEmail: 'owner@x.com' }]);
  });
});

describe('DELETE /api/app/vault (whole Vault)', () => {
  it("complete deletion ON: a client's Vault is refused", async () => {
    vi.stubEnv('VAULT_COMPLETE_DELETION', 'true');
    st.active = { workspaceId: 'ws1', asClient: true };
    const res = await vaultDELETE(req('/api/app/vault?email=owner@x.com&confirm=DELETE'));
    expect(res.status).toBe(403);
    expect(st.vaultDeleteCalls).toHaveLength(0);
  });

  it('complete deletion ON: own Vault proceeds as the authenticated owner', async () => {
    vi.stubEnv('VAULT_COMPLETE_DELETION', 'true');
    const res = await vaultDELETE(req('/api/app/vault?email=owner@x.com&confirm=DELETE'));
    expect(res.status).toBe(200);
    expect(st.vaultDeleteCalls).toEqual(['owner@x.com']);
  });

  it('flag OFF: behaviour unchanged (coach Mode still targets the active client Vault)', async () => {
    st.active = { workspaceId: 'ws1', asClient: true };
    const res = await vaultDELETE(req('/api/app/vault?email=owner@x.com&confirm=DELETE'));
    expect(res.status).toBe(200);
    expect(st.vaultDeleteCalls).toEqual(['client+ws1@clients.getmindy.ai']);
  });
});
