/**
 * The shared account chip must not claim "signed in" for a session every destination rejects.
 *
 * Joseph Boyd (2026-10-25): "the sign-in links don't work even when I'm signed in". The chip painted
 * initials whenever `mi_beta_auth_token` merely EXISTED — no exp check, /api/app/me errors swallowed —
 * while the destinations (Map __tokenExpired, /welcome/company 401) correctly refused the dead token.
 *
 * These tests EXECUTE the shipped ACCOUNT_MENU_JS in jsdom (Map, /today, /bid, /learn all inject it).
 */
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from './account-menu';

function token(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url') + '.sig';
}

const FIRST_SCRIPT = ACCOUNT_MENU_JS.replace(/^<script>/, '').replace(/<\/script>[\s\S]*$/, '');

async function mount(opts: { token?: string | null; meStatus?: number; path?: string }) {
  const dom = new JSDOM(`<!doctype html><html><body>${ACCOUNT_MENU_HTML}</body></html>`, {
    url: `https://getmindy.ai${opts.path || '/learn'}`,
    runScripts: 'outside-only',
  });
  const w = dom.window as unknown as Window & typeof globalThis & { eval: (s: string) => unknown };
  if (opts.token) w.localStorage.setItem('mi_beta_auth_token', opts.token);
  const fetchMock = vi.fn((url: string) => {
    if (String(url).startsWith('/api/app/me')) {
      const status = opts.meStatus ?? 200;
      return Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve({ email: 'jb@example.com', name: 'Joe Boyd', picture: null }) });
    }
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) });
  });
  (w as unknown as { fetch: unknown }).fetch = fetchMock;
  w.eval(FIRST_SCRIPT);
  // let the /me promise chain settle
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  const btn = w.document.getElementById('mindyAcctBtn')!;
  return { btn, fetchMock, w };
}

const DAY = 24 * 60 * 60 * 1000;

describe('account chip reflects a LIVE session, not a present token', () => {
  it('no token → Sign up free, no /me call', async () => {
    const { btn, fetchMock } = await mount({ token: null });
    expect(btn.textContent).toBe('Sign up free');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/app/me'))).toBe(false);
  });

  it('valid token → initials, then the /me identity', async () => {
    const { btn } = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() + DAY }) });
    expect(btn.textContent).toBe('JB');
    expect(btn.classList.contains('mindy-acct-signin')).toBe(false);
  });

  it('expired token → Sign up free (was: initials), and it never asks /me', async () => {
    const { btn, fetchMock } = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() - 1000 }) });
    expect(btn.textContent).toBe('Sign up free');
    expect(btn.classList.contains('mindy-acct-signin')).toBe(true);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/app/me'))).toBe(false);
  });

  it('unexpired token the server rejects (/me 401) → Sign up free', async () => {
    const { btn, w } = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() + DAY }), meStatus: 401 });
    expect(btn.textContent).toBe('Sign up free');
    expect(w.document.getElementById('mindyAcctHd')!.style.display).toBe('none');
  });

  it('publishes the server verdict for page scripts: valid only after /me accepts, signed-out on 401/expired', async () => {
    const ok = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() + DAY }) });
    expect((ok.w as unknown as { __mindySession?: string }).__mindySession).toBe('valid');
    const rej = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() + DAY }), meStatus: 401 });
    expect((rej.w as unknown as { __mindySession?: string }).__mindySession).toBe('signed-out');
    const exp = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() - 1000 }) });
    expect((exp.w as unknown as { __mindySession?: string }).__mindySession).toBe('signed-out');
    const err = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() + DAY }), meStatus: 500 });
    expect((err.w as unknown as { __mindySession?: string }).__mindySession).toBeUndefined();
  });

  it('a transient /me failure (500) does NOT sign the user out', async () => {
    const { btn } = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() + DAY }), meStatus: 500 });
    expect(btn.textContent).toBe('J'); // initials from the token email; /me never answered
    expect(btn.classList.contains('mindy-acct-signin')).toBe(false);
  });

  it('Sign up free from an expired session opens the sign-in pop-up (menu stays closed), returning here via ?next=', async () => {
    const { btn, w } = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() - 1000 }), path: '/learn/find-your-buyers' });
    let opened = '';
    (w as unknown as { openSignInModal: (t: string) => void }).openSignInModal = (t) => { opened = t; };
    btn.click();
    expect(opened).toBe('Log in to Mindy');
    expect(w.document.getElementById('mindyAcctMenu')!.classList.contains('open')).toBe(false);
    // Without a modal on the page (e.g. /learn) it navigates to /app with this page as next.
    expect(ACCOUNT_MENU_JS).toContain('location.href="/app?next="+encodeURIComponent(location.pathname+location.search)');
  });
});

describe('logged-out top bar (Zoom-style)', () => {
  it('no token → html.mindy-anon (rail hidden) + Contact sales · Sign in · Sign up free, in that order', async () => {
    const { w } = await mount({ token: null });
    expect(w.document.documentElement.classList.contains('mindy-anon')).toBe(true);
    const wrap = w.document.getElementById('mindyAcct')!;
    const signIn = w.document.getElementById('mindyAnonSignIn')!;
    const sales = w.document.getElementById('mindyAnonSales')!;
    expect(signIn.textContent).toBe('Sign in');
    expect(sales.textContent).toBe('Contact sales');
    expect(sales.nextElementSibling).toBe(signIn);
    expect(signIn.nextElementSibling).toBe(wrap);
  });

  it('a valid session never gets the anon chrome', async () => {
    const { w } = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() + DAY }) });
    expect(w.document.documentElement.classList.contains('mindy-anon')).toBe(false);
    expect(w.document.getElementById('mindyAnonSignIn')).toBeNull();
  });

  it('Sign in opens the same pop-up; Sign up free opens it on the create-account step', async () => {
    const { btn, w } = await mount({ token: null });
    let opened = '';
    let created = 0;
    (w as unknown as { openSignInModal: (t: string) => void }).openSignInModal = (t) => { opened = t; };
    const create = w.document.createElement('a');
    create.id = 'lgmCreate';
    create.addEventListener('click', () => { created += 1; });
    w.document.body.appendChild(create);
    (w.document.getElementById('mindyAnonSignIn') as HTMLAnchorElement).click();
    expect(opened).toBe('Log in to Mindy');
    expect(created).toBe(0);
    opened = '';
    btn.click();
    expect(opened).toBe('Log in to Mindy');
    expect(created).toBe(1);
  });

  it('a 401 after paint adds the links only once', async () => {
    const { w } = await mount({ token: token({ email: 'jb@example.com', exp: Date.now() + DAY }), meStatus: 401 });
    expect(w.document.querySelectorAll('#mindyAnonSignIn').length).toBe(1);
  });
});
