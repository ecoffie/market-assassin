/**
 * SEC-5d — anonymous signup never grants; the browser carries the code only until a verified
 * session claims it; terminal answers clear it, retryable ones keep it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('anonymous signup → no trial', () => {
  it('the grant helper is gone — nothing can be imported to grant a trial to a claimed email', async () => {
    const mod = await import('./apply-partner-referral') as Record<string, unknown>;
    expect(mod.applyPartnerReferralIfEligible).toBeUndefined();
  });
  for (const route of ['src/app/api/auth/mi-signup/route.ts', 'src/app/api/alerts/save-profile/route.ts', 'src/app/api/app/profile/route.ts']) {
    it(`${route} writes no trial / partner tag and never calls a grant`, () => {
      const code = strip(read(...route.split('/')));
      expect(code).not.toMatch(/applyPartnerReferral|claimPartnerReferral/);
      expect(code).not.toMatch(/trial_ends_at\s*[:=]/);
      expect(code).not.toMatch(/trial_source\s*[:=]/);
      expect(code).not.toMatch(/invitation_source\s*=\s*partner/);
    });
  }
  it('the claim endpoint is the only caller of claimPartnerReferral', () => {
    expect(strip(read('src', 'app', 'api', 'app', 'partner-referral', 'claim', 'route.ts'))).toMatch(/claimPartnerReferral\(/);
  });
});

describe('browser transport (claimPendingPartnerReferral)', () => {
  let ls: Map<string, string>, ss: Map<string, string>, cookie: string;
  beforeEach(() => {
    ls = new Map(); ss = new Map(); cookie = '';
    const store = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } });
    vi.stubGlobal('localStorage', store(ls));
    vi.stubGlobal('sessionStorage', store(ss));
    vi.stubGlobal('document', {
      get cookie() { return cookie; },
      set cookie(v: string) { const [kv, ...attrs] = v.split(';'); const [k, val] = kv.split('='); if (attrs.some((a) => a.trim() === 'max-age=0')) { cookie = ''; } else { cookie = `${k}=${val}`; } },
    });
    vi.resetModules();
  });
  const respond = (status: number, body: object) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('no session token → nothing sent, code kept', async () => {
    const { storePartnerRef, claimPendingPartnerReferral, getStoredPartnerRef } = await import('./partner-referral-client');
    storePartnerRef('mdeat');
    const f = respond(200, {});
    expect(await claimPendingPartnerReferral(f)).toBe('none');
    expect(f).not.toHaveBeenCalled();
    expect(getStoredPartnerRef()).toBe('MDEAT');
  });

  it('claimed → pending referral cleared from localStorage AND cookie', async () => {
    const { storePartnerRef, claimPendingPartnerReferral, getStoredPartnerRef } = await import('./partner-referral-client');
    storePartnerRef('MDEAT'); ls.set('mi_beta_auth_token', 'tok');
    expect(await claimPendingPartnerReferral(respond(200, { status: 'claimed', clearPending: true }))).toBe('claimed');
    expect(getStoredPartnerRef()).toBeNull();
    expect(cookie).toBe('');
  });

  it('already claimed → cleared (no repeated submissions)', async () => {
    const { storePartnerRef, claimPendingPartnerReferral, getStoredPartnerRef } = await import('./partner-referral-client');
    storePartnerRef('MDEAT'); ls.set('mi_beta_auth_token', 'tok');
    expect(await claimPendingPartnerReferral(respond(409, { status: 'already_claimed', clearPending: true }))).toBe('cleared');
    expect(getStoredPartnerRef()).toBeNull();
  });

  it.each([
    ['profile_required', 409, { status: 'profile_required', clearPending: false }],
    ['5xx', 500, { status: 'error', clearPending: false }],
    ['401', 401, { status: 'unauthenticated' }],
  ])('a retryable outcome (%s) KEEPS the pending referral', async (_n, status, body) => {
    const { storePartnerRef, claimPendingPartnerReferral, getStoredPartnerRef } = await import('./partner-referral-client');
    storePartnerRef('MDEAT'); ls.set('mi_beta_auth_token', 'tok');
    expect(await claimPendingPartnerReferral(respond(status as number, body as object))).toBe('kept');
    expect(getStoredPartnerRef()).toBe('MDEAT');
  });

  it('a network failure keeps the pending referral', async () => {
    const { storePartnerRef, claimPendingPartnerReferral, getStoredPartnerRef } = await import('./partner-referral-client');
    storePartnerRef('MDEAT'); ls.set('mi_beta_auth_token', 'tok');
    const boom = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await claimPendingPartnerReferral(boom)).toBe('kept');
    expect(getStoredPartnerRef()).toBe('MDEAT');
  });

  it('identity is never sent from the browser: the request carries the session token and the code only', async () => {
    const { storePartnerRef, claimPendingPartnerReferral } = await import('./partner-referral-client');
    storePartnerRef('MDEAT'); ls.set('mi_beta_auth_token', 'tok'); ls.set('mi_beta_email', 'someone@example.com');
    const f = respond(200, { status: 'claimed', clearPending: true });
    await claimPendingPartnerReferral(f);
    const [, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({ code: 'MDEAT' });
    expect((init.headers as Record<string, string>)['x-mi-auth-token']).toBe('tok');
  });
});

describe('server-rendered pages (ACCOUNT_MENU_JS) run the same handoff', () => {
  const src = read('src', 'app', 'opportunity-map', 'account-menu.ts');
  it('posts the stored code with the session token and clears only on clearPending', () => {
    expect(src).toMatch(/\/api\/app\/partner-referral\/claim/);
    expect(src).toMatch(/j\.clearPending===true/);
  });
  it('the injected script contains no "$" (the map injects it via String.replace)', async () => {
    const { ACCOUNT_MENU_JS } = await import('@/app/opportunity-map/account-menu');
    const handoff = ACCOUNT_MENU_JS.slice(ACCOUNT_MENU_JS.indexOf('mindy_partner_ref'));
    expect(handoff).not.toContain('$');
  });
});
