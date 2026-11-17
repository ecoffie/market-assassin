/**
 * /api/app/vault/doc-access — the browser's only source of on/off for Vault document features.
 * Verified session only; 'true' = everyone, 'allowlist' = VAULT_DOC_ALLOWLIST only; booleans only.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ authOk: true }));
vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_r: unknown, email: string) => (state.authOk ? { authenticated: true, email } : { authenticated: false, error: 'Unauthorized' }),
}));

import { GET } from './route';

const req = (email: string) => new NextRequest(`https://getmindy.ai/api/app/vault/doc-access?email=${encodeURIComponent(email)}`);

afterEach(() => { vi.unstubAllEnvs(); state.authOk = true; });

describe('GET /api/app/vault/doc-access', () => {
  it('everything off by default', async () => {
    const res = await GET(req('erika@example.com'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, uploads: false, generate: false });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('allowlist: the listed verified account sees uploads/generate; anyone else does not', async () => {
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', 'allowlist');
    vi.stubEnv('VAULT_GENERATED_FILES', 'allowlist');
    vi.stubEnv('VAULT_DOC_ALLOWLIST', 'Erika@Example.com');
    expect(await (await GET(req('erika@example.com'))).json()).toEqual({ success: true, uploads: true, generate: true });
    expect(await (await GET(req('other@example.com'))).json()).toEqual({ success: true, uploads: false, generate: false });
  });

  it('global "true" keeps working for everyone', async () => {
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', 'true');
    expect(await (await GET(req('anyone@example.com'))).json()).toEqual({ success: true, uploads: true, generate: false });
  });

  it('unverified session → 401, everything false (an allowlisted email in the URL is not enough)', async () => {
    vi.stubEnv('VAULT_ASK_MINDY_UPLOADS', 'allowlist');
    vi.stubEnv('VAULT_DOC_ALLOWLIST', 'erika@example.com');
    state.authOk = false;
    const res = await GET(req('erika@example.com'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, uploads: false, generate: false });
  });
});
