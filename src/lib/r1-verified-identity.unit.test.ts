import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * R1 — identity comes only from a verified session.
 *
 * Drives the real handlers that issue credentials or report who the caller is. For each,
 * the five adversarial cases: logged out + someone else's email, a forged plaintext
 * cookie, a claimed staff address with no session, user A's session claiming user B,
 * and the legitimate caller. Nothing may be minted, approved or returned for anyone
 * but the verified session's own email.
 */

const getUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser,
      admin: { listUsers: async () => ({ data: { users: [] }, error: null }) },
    },
  }),
}));

const issueApiKey = vi.fn();
const listApiKeys = vi.fn();
const revokeApiKey = vi.fn();
vi.mock('@/lib/mcp/api-keys', () => ({ issueApiKey, listApiKeys, revokeApiKey, BRIEFINGS_READ_SCOPE: 'briefings:read' }));
const grantSignupCreditsIfFirst = vi.fn(async () => 0);
vi.mock('@/lib/mcp/credits', () => ({ grantSignupCreditsIfFirst }));
vi.mock('@/lib/mcp/referrals', () => ({ qualifyReferralFromRequest: async () => {} }));

const saveAuthCode = vi.fn();
vi.mock('@/lib/mcp/oauth/store', () => ({
  getClient: async () => ({ redirect_uris: ['https://client.example/cb'] }),
  saveAuthCode,
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.TWO_FACTOR_SECRET = 'r1-unit-test-secret';
process.env.EMAIL_ACTION_SECRET = 'r1-email-action-secret';
process.env.MCP_OAUTH_ENABLED = 'true';

const { createMIAuthSessionToken } = await import('@/lib/two-factor-session');
const { verifyClaimedIdentity, verifyUserOwnsEmail, generateEmailToken } = await import('@/lib/api-auth');
const keys = await import('@/app/api/mcp/keys/route');
const approve = await import('@/app/api/oauth/authorize/approve/route');
const me = await import('@/app/api/app/me/route');

const A = 'user-a@example.com';
const B = 'victim-b@example.com';
const STAFF = 'someone@govcongiants.com';

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
  issueApiKey.mockReset();
  issueApiKey.mockImplementation(async (email: string) => ({ key: `mk_${email}`, row: { id: 'k1', owner: email } }));
  listApiKeys.mockReset();
  listApiKeys.mockImplementation(async (email: string) => [{ id: 'k1', owner: email }]);
  revokeApiKey.mockReset();
  revokeApiKey.mockResolvedValue(true);
  saveAuthCode.mockReset();
  saveAuthCode.mockResolvedValue('code123');
  grantSignupCreditsIfFirst.mockClear();
});

type Who = { label: string; claim: string; headers?: Record<string, string>; cookie?: string };

/** The four ways a caller can claim an identity it cannot prove. */
const ATTACKS: Who[] = [
  { label: 'logged out + victim email', claim: B },
  { label: 'forged plaintext cookie for the victim', claim: B, cookie: `ma_access_email=${B}` },
  { label: 'claimed staff email, no session', claim: STAFF },
  { label: "A's session + B's email", claim: B, headers: { 'x-mi-auth-token': createMIAuthSessionToken(A) } },
];
const OWNER: Who = { label: "A's session + A's email", claim: A, headers: { 'x-mi-auth-token': createMIAuthSessionToken(A) } };

function req(url: string, who: Who, init: { method?: string; body?: unknown } = {}) {
  const headers = new Headers(who.headers || {});
  if (who.cookie) headers.set('cookie', who.cookie);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(url, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const approveBody = (claim: string) => ({
  email: claim,
  client_id: 'client-1',
  redirect_uri: 'https://client.example/cb',
  response_type: 'code',
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
  state: 's',
});

describe('POST /api/mcp/keys — mints a key only for the verified session', () => {
  for (const who of ATTACKS) {
    it(`${who.label} → 401, nothing minted`, async () => {
      const res = await keys.POST(req(`https://getmindy.ai/api/mcp/keys?email=${encodeURIComponent(who.claim)}`, who, { method: 'POST', body: { label: 'x' } }));
      expect(res.status).toBe(401);
      expect(issueApiKey).not.toHaveBeenCalled();
    });
  }
  it(`${OWNER.label} → 200, key issued to A only`, async () => {
    const res = await keys.POST(req(`https://getmindy.ai/api/mcp/keys?email=${A}`, OWNER, { method: 'POST', body: { label: 'x' } }));
    expect(res.status).toBe(200);
    expect(issueApiKey).toHaveBeenCalledTimes(1);
    expect(issueApiKey.mock.calls[0][0]).toBe(A);
  });
  it('a claim in the body cannot redirect the key to someone else', async () => {
    const res = await keys.POST(req('https://getmindy.ai/api/mcp/keys', OWNER, { method: 'POST', body: { email: B } }));
    expect(res.status).toBe(401);
    expect(issueApiKey).not.toHaveBeenCalled();
  });
});

describe("POST /api/mcp/keys purpose: 'briefings' — a narrow connection key", () => {
  it('issues a briefings:read key for the verified owner, with no MCP credits', async () => {
    const res = await keys.POST(req(`https://getmindy.ai/api/mcp/keys?email=${A}`, OWNER, { method: 'POST', body: { purpose: 'briefings' } }));
    expect(res.status).toBe(200);
    expect(issueApiKey).toHaveBeenCalledWith(A, expect.objectContaining({ scopes: ['briefings:read'] }));
    expect(grantSignupCreditsIfFirst).not.toHaveBeenCalled();
    expect((await res.json()).signupCredits).toBe(0);
  });
  it('an MCP key still gets the one-time signup grant path', async () => {
    await keys.POST(req(`https://getmindy.ai/api/mcp/keys?email=${A}`, OWNER, { method: 'POST', body: {} }));
    expect(issueApiKey.mock.calls[0][1]?.scopes).toBeUndefined();
    expect(grantSignupCreditsIfFirst).toHaveBeenCalledWith(A);
  });
  it('an unknown purpose is refused, nothing minted', async () => {
    const res = await keys.POST(req(`https://getmindy.ai/api/mcp/keys?email=${A}`, OWNER, { method: 'POST', body: { purpose: 'admin' } }));
    expect(res.status).toBe(400);
    expect(issueApiKey).not.toHaveBeenCalled();
  });
  it('a briefings key cannot be minted for someone else', async () => {
    const res = await keys.POST(req(`https://getmindy.ai/api/mcp/keys?email=${B}`, ATTACKS[3], { method: 'POST', body: { purpose: 'briefings' } }));
    expect(res.status).toBe(401);
    expect(issueApiKey).not.toHaveBeenCalled();
  });
});

describe('GET / DELETE /api/mcp/keys — list and revoke only your own keys', () => {
  for (const who of ATTACKS) {
    it(`GET: ${who.label} → 401, nothing listed`, async () => {
      const res = await keys.GET(req(`https://getmindy.ai/api/mcp/keys?email=${encodeURIComponent(who.claim)}`, who));
      expect(res.status).toBe(401);
      expect(listApiKeys).not.toHaveBeenCalled();
    });
    it(`DELETE: ${who.label} → 401, nothing revoked`, async () => {
      const res = await keys.DELETE(req(`https://getmindy.ai/api/mcp/keys?id=k1&email=${encodeURIComponent(who.claim)}`, who, { method: 'DELETE' }));
      expect(res.status).toBe(401);
      expect(revokeApiKey).not.toHaveBeenCalled();
    });
  }
  it(`GET: ${OWNER.label} → only A's keys`, async () => {
    const res = await keys.GET(req(`https://getmindy.ai/api/mcp/keys?email=${A}`, OWNER));
    expect(res.status).toBe(200);
    expect(listApiKeys).toHaveBeenCalledWith(A);
    expect((await res.json()).keys).toEqual([{ id: 'k1', owner: A }]);
  });
  it(`DELETE: ${OWNER.label} → revokes as A`, async () => {
    const res = await keys.DELETE(req(`https://getmindy.ai/api/mcp/keys?id=k1&email=${A}`, OWNER, { method: 'DELETE' }));
    expect(res.status).toBe(200);
    expect(revokeApiKey).toHaveBeenCalledWith(A, 'k1');
  });
});

describe('POST /api/oauth/authorize/approve — grants only as the verified session', () => {
  for (const who of ATTACKS) {
    it(`${who.label} → 401, no authorization code`, async () => {
      const res = await approve.POST(req('https://getmindy.ai/api/oauth/authorize/approve', who, { method: 'POST', body: approveBody(who.claim) }));
      expect(res.status).toBe(401);
      expect(saveAuthCode).not.toHaveBeenCalled();
    });
  }
  it(`${OWNER.label} → code issued for A`, async () => {
    const res = await approve.POST(req('https://getmindy.ai/api/oauth/authorize/approve', OWNER, { method: 'POST', body: approveBody(A) }));
    expect(res.status).toBe(200);
    expect(saveAuthCode).toHaveBeenCalledTimes(1);
    expect(saveAuthCode.mock.calls[0][0].userEmail).toBe(A);
  });
});

describe('GET /api/app/me — reports only the verified caller', () => {
  for (const who of ATTACKS.filter((w) => !w.headers)) {
    it(`${who.label} → 401`, async () => {
      const res = await me.GET(req(`https://getmindy.ai/api/app/me?email=${encodeURIComponent(who.claim)}`, who));
      expect(res.status).toBe(401);
    });
  }
  it("A's session with ?email=B → A, never B", async () => {
    const res = await me.GET(req(`https://getmindy.ai/api/app/me?email=${B}`, ATTACKS[3]));
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe(A);
  });
  it('an expired/invalid Mindy token + ?email= does not fall back to the claim', async () => {
    const res = await me.GET(req(`https://getmindy.ai/api/app/me?email=${B}`, { label: 'bad token', claim: B, headers: { 'x-mi-auth-token': 'garbage.sig' }, cookie: `ma_access_email=${B}` }));
    expect(res.status).toBe(401);
  });
});

describe('verifyClaimedIdentity / verifyUserOwnsEmail — the shared decision', () => {
  it('a Supabase session identifies; a claim for another address is a mismatch', async () => {
    getUser.mockResolvedValue({ data: { user: { email: A } }, error: null });
    const r = req('https://getmindy.ai/x', { label: 'supabase', claim: A, headers: { authorization: 'Bearer jwt' } });
    expect(await verifyClaimedIdentity(r, A)).toEqual({ status: 'verified', email: A, method: 'supabase' });
    expect(await verifyClaimedIdentity(r, B)).toEqual({ status: 'mismatch' });
  });
  it('a signed link proves only the email it was signed for', async () => {
    const { token, ts } = generateEmailToken(A);
    const r = req(`https://getmindy.ai/x?token=${token}&ts=${ts}`, { label: 'link', claim: A });
    expect(await verifyClaimedIdentity(r, A)).toMatchObject({ status: 'verified', email: A });
    expect(await verifyClaimedIdentity(r, B)).toEqual({ status: 'anonymous' });
  });
  it('a cookie or a staff address alone is anonymous', async () => {
    expect(await verifyClaimedIdentity(req('https://getmindy.ai/x', { label: 'c', claim: B, cookie: `ma_access_email=${B}` }), B)).toEqual({ status: 'anonymous' });
    expect(await verifyClaimedIdentity(req('https://getmindy.ai/x', { label: 's', claim: STAFF }), STAFF)).toEqual({ status: 'anonymous' });
  });
  it('verifyUserOwnsEmail refuses the cookie and the staff claim without requireStrongAuth', async () => {
    const cookie = await verifyUserOwnsEmail(req('https://getmindy.ai/api/library', { label: 'c', claim: B, cookie: `ma_access_email=${B}` }), B);
    const staff = await verifyUserOwnsEmail(req('https://getmindy.ai/api/library', { label: 's', claim: STAFF }), STAFF);
    expect(cookie.authenticated).toBe(false);
    expect(staff.authenticated).toBe(false);
  });
});
