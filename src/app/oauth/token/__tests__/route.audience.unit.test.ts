/**
 * Token endpoint — RFC 8707 audience binding for the ChatGPT profile.
 *
 *   · a grant made for https://mcp.getmindy.ai/chatgpt/mcp mints aud = that resource,
 *     grants NO signup or referral credits (owner decision 3), and refresh rotation keeps it
 *   · a grant with no/unknown resource mints the DEFAULT audience and still grants
 *     signup credits — exactly today's Claude behaviour
 *   · a mismatched resource between grant and request is invalid_target
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.MCP_OAUTH_SIGNING_SECRET = 'test-signing-secret-token';
process.env.MCP_OAUTH_ENABLED = 'true';

const store = {
  consumeAuthCode: vi.fn(),
  consumeRefreshToken: vi.fn(),
  saveRefreshToken: vi.fn(async () => 'new-refresh'),
  getClient: vi.fn(async () => ({ client_id: 'c1', redirect_uris: ['https://x/cb'] })),
};
vi.mock('@/lib/mcp/oauth/store', () => store);
const grantSignupCreditsIfFirst = vi.fn(async () => 100);
vi.mock('@/lib/mcp/credits', () => ({ grantSignupCreditsIfFirst: (...a: unknown[]) => grantSignupCreditsIfFirst(...(a as [])) }));
const qualifyReferralFromRequest = vi.fn(async () => undefined);
vi.mock('@/lib/mcp/referrals', () => ({ qualifyReferralFromRequest: (...a: unknown[]) => qualifyReferralFromRequest(...(a as [])) }));

const { POST } = await import('../route');
const { verifyAccessToken, OAUTH_RESOURCE, OAUTH_RESOURCE_CHATGPT } = await import('@/lib/mcp/oauth/tokens');

// PKCE pair: verifier "v" * 43 → S256 challenge
import { createHash } from 'node:crypto';
const VERIFIER = 'v'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function tokenReq(body: Record<string, string>): NextRequest {
  return new NextRequest('https://getmindy.ai/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}
const codeRecord = (resource: string | null) => ({
  client_id: 'c1', user_email: 'buyer@example.com', redirect_uri: 'https://x/cb', code_challenge: CHALLENGE, scope: 'mcp', resource,
});
const exchange = (extra: Record<string, string> = {}) =>
  POST(tokenReq({ grant_type: 'authorization_code', code: 'abc', code_verifier: VERIFIER, client_id: 'c1', redirect_uri: 'https://x/cb', ...extra }));

beforeEach(() => vi.clearAllMocks());

describe('authorization_code', () => {
  it('ChatGPT resource → ChatGPT audience, no signup/referral grant, audience persisted on the refresh row', async () => {
    store.consumeAuthCode.mockResolvedValue(codeRecord(OAUTH_RESOURCE_CHATGPT));
    const res = await exchange({ resource: OAUTH_RESOURCE_CHATGPT });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(verifyAccessToken(json.access_token, OAUTH_RESOURCE_CHATGPT)?.aud).toBe('https://mcp.getmindy.ai/chatgpt/mcp');
    expect(verifyAccessToken(json.access_token)).toBeNull(); // not valid on the full endpoint
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
    expect(qualifyReferralFromRequest).not.toHaveBeenCalled();
    expect(store.saveRefreshToken).toHaveBeenCalledWith(expect.objectContaining({ resource: OAUTH_RESOURCE_CHATGPT }));
  });

  it('ChatGPT resource recorded at authorize but absent on the token request → still ChatGPT', async () => {
    store.consumeAuthCode.mockResolvedValue(codeRecord(OAUTH_RESOURCE_CHATGPT));
    const json = await (await exchange()).json();
    expect(verifyAccessToken(json.access_token, OAUTH_RESOURCE_CHATGPT)).not.toBeNull();
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['no resource', null, undefined],
    ['the canonical resource', 'https://mcp.getmindy.ai/mcp', 'https://mcp.getmindy.ai/mcp'],
    ['a legacy / unknown resource', 'https://getmindy.ai/mcp/mcp', undefined],
  ])('default (Claude) grant with %s → default audience + signup grant, unchanged', async (_l, bound, requested) => {
    store.consumeAuthCode.mockResolvedValue(codeRecord(bound));
    const res = await exchange(requested ? { resource: requested } : {});
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(verifyAccessToken(json.access_token)?.aud).toBe(OAUTH_RESOURCE);
    expect(verifyAccessToken(json.access_token, OAUTH_RESOURCE_CHATGPT)).toBeNull();
    expect(grantSignupCreditsIfFirst).toHaveBeenCalledWith('buyer@example.com');
    expect(qualifyReferralFromRequest).toHaveBeenCalled();
    // refresh row keeps exactly what it stored before (the raw recorded resource)
    expect(store.saveRefreshToken).toHaveBeenCalledWith(expect.objectContaining({ resource: bound ?? undefined }));
  });

  it('a grant for one resource cannot be exchanged for the other → invalid_target', async () => {
    store.consumeAuthCode.mockResolvedValue(codeRecord(OAUTH_RESOURCE_CHATGPT));
    const res = await exchange({ resource: OAUTH_RESOURCE });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_target');
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
  });
});

describe('refresh_token rotation preserves the audience', () => {
  const refresh = (extra: Record<string, string> = {}) =>
    POST(tokenReq({ grant_type: 'refresh_token', refresh_token: 'r1', client_id: 'c1', ...extra }));

  it('ChatGPT row → ChatGPT token, ChatGPT resource carried to the new row', async () => {
    store.consumeRefreshToken.mockResolvedValue({ token_hash: 'h', client_id: 'c1', user_email: 'buyer@example.com', scope: 'mcp', resource: OAUTH_RESOURCE_CHATGPT });
    const json = await (await refresh()).json();
    expect(verifyAccessToken(json.access_token, OAUTH_RESOURCE_CHATGPT)).not.toBeNull();
    expect(store.saveRefreshToken).toHaveBeenCalledWith(expect.objectContaining({ resource: OAUTH_RESOURCE_CHATGPT, rotatedFrom: 'h' }));
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
  });

  it('existing Claude row (null resource) → default token, unchanged', async () => {
    store.consumeRefreshToken.mockResolvedValue({ token_hash: 'h', client_id: 'c1', user_email: 'buyer@example.com', scope: 'mcp', resource: null });
    const json = await (await refresh()).json();
    expect(verifyAccessToken(json.access_token)?.aud).toBe(OAUTH_RESOURCE);
  });

  it('ChatGPT row refreshed with resource=full → invalid_target', async () => {
    store.consumeRefreshToken.mockResolvedValue({ token_hash: 'h', client_id: 'c1', user_email: 'buyer@example.com', scope: 'mcp', resource: OAUTH_RESOURCE_CHATGPT });
    const res = await refresh({ resource: OAUTH_RESOURCE });
    expect(res.status).toBe(400);
  });
});
