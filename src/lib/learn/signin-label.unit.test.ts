/**
 * "Free · sign in" was a static <span> on a force-static page — the one label that names an action
 * did nothing when clicked, for signed-in and signed-out readers alike (Joseph Boyd, 2026-10-25).
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { MISSIONS } from './missions';
import { learnIndexHtml, libraryItems, missionHtml, signinHref } from './render';
import { isSafeNext } from '@/lib/mindy/safe-next';

const SIGNIN = MISSIONS.filter((m) => m.access === 'signin');
const DAY = 24 * 60 * 60 * 1000;
const tok = (exp: number) => Buffer.from(JSON.stringify({ email: 'jb@example.com', exp })).toString('base64url') + '.sig';

/** Executes the REAL page scripts (shared header + Learn) with a stubbed /api/app/me. */
async function run(html: string, token: string | null, meStatus: number | 'hang' = 'hang') {
  const dom = new JSDOM(html, { url: 'https://getmindy.ai/learn', runScripts: 'outside-only' });
  const w = dom.window as unknown as Window & { eval: (s: string) => unknown };
  if (token) w.localStorage.setItem('mi_beta_auth_token', token);
  (w as unknown as { fetch: unknown }).fetch = (url: string) => {
    if (meStatus === 'hang' || !String(url).startsWith('/api/app/me')) return new Promise(() => {});
    return Promise.resolve({ status: meStatus, ok: meStatus < 300, json: () => Promise.resolve({ email: 'jb@example.com', name: 'J B', picture: null }) });
  };
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const header = scripts.find((x) => x.includes('mindyAcct'));
  const learn = scripts.filter((x) => x.includes('data-learn-signin'));
  expect(learn.length).toBe(1);
  if (header) w.eval(header.replace(/<\/script>[\s\S]*$/, ''));
  w.eval(learn[0]);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return w.document;
}

/** Rendered access labels only — body.textContent would also include the inline script's source. */
const labels = (d: Document) => [...d.querySelectorAll('.tag, [data-learn-signin-label]')].map((e) => e.textContent || '').join('|');

describe('Learn sign-in label is a real action that returns to the tutorial', () => {
  it('there are 10 sign-in tutorials (B1 B3 B5 B6 B7 I1 I3 I4 I5 A2)', () => {
    expect(SIGNIN.map((m) => m.id).sort()).toEqual(['A2', 'B1', 'B3', 'B5', 'B6', 'B7', 'I1', 'I3', 'I4', 'I5']);
  });

  it.each(SIGNIN.map((m) => [m.id, m] as const))('%s mission page: label is a link to /app?next=<this tutorial>', (_id, m) => {
    const href = `/app?next=${encodeURIComponent(`/learn/${m.slug}`)}`;
    expect(signinHref(m)).toBe(href);
    expect(isSafeNext(`/learn/${m.slug}`)).toBe(true);
    const h = missionHtml(m);
    expect(h).toContain(`<a class="tag signin" data-learn-signin href="${href.replace(/&/g, '&amp;')}">Free · sign in</a>`);
    expect(h).not.toMatch(/<span class="tag">Free · sign in<\/span>/);
  });

  it('index: cards keep a label (no <a> nested inside the card link); library rows get the link', () => {
    const h = learnIndexHtml();
    const cards = h.match(/<a class="mcard"[\s\S]*?<\/a>/g) || [];
    expect(cards.length).toBe(MISSIONS.length);
    for (const c of cards) expect(c.slice(2).includes('<a ')).toBe(false);
    expect((h.match(/data-learn-signin-label>Free · sign in</g) || []).length).toBe(SIGNIN.length * 2); // card + library caption
    expect((h.match(/<a class="tag signin" data-learn-signin href="\/app\?next=%2Flearn%2F[a-z0-9-]+">/g) || []).length).toBe(SIGNIN.length);
  });

  it('all 52 Library entries keep their existing destinations; only sign-in missions gain a sign-in link', () => {
    const items = libraryItems();
    expect(items.length).toBe(52);
    for (const it of items) {
      if (it.href) expect(it.href).toMatch(/^\/learn\/[a-z0-9-]+$/);
      const m = MISSIONS.find((x) => x.id === it.key);
      expect(it.signinHref).toBe(m && m.access === 'signin' ? signinHref(m) : null);
    }
  });

  it('signed out → the sign-in links stay', async () => {
    const d = await run(learnIndexHtml(), null);
    expect(d.querySelectorAll('a[data-learn-signin]').length).toBe(SIGNIN.length);
  });

  it('session ACCEPTED by the server (/me 200) → "Free · signed in", no sign-in link', async () => {
    const d = await run(learnIndexHtml(), tok(Date.now() + DAY), 200);
    expect(d.querySelectorAll('a[data-learn-signin]').length).toBe(0);
    expect(labels(d)).not.toContain('Free · sign in');
    expect(labels(d)).toContain('Free · signed in');
    const m = await run(missionHtml(SIGNIN[0]), tok(Date.now() + DAY), 200);
    expect(m.querySelectorAll('a[data-learn-signin]').length).toBe(0);
  });

  it('unexpired token the SERVER REJECTS (/me 401) → still offered sign-in, never "signed in"', async () => {
    const d = await run(learnIndexHtml(), tok(Date.now() + DAY), 401);
    expect(d.querySelectorAll('a[data-learn-signin]').length).toBe(SIGNIN.length);
    expect(labels(d)).not.toContain('Free · signed in');
  });

  it('no server answer yet / 5xx → not claimed as signed in', async () => {
    for (const st of ['hang', 500] as const) {
      const d = await run(learnIndexHtml(), tok(Date.now() + DAY), st);
      expect(labels(d)).not.toContain('Free · signed in');
    }
  });

  it('expired session → still offered sign-in (the destination would reject the token)', async () => {
    const d = await run(missionHtml(SIGNIN[0]), tok(Date.now() - 1000), 200);
    expect(d.querySelectorAll('a[data-learn-signin]').length).toBeGreaterThan(0);
  });

  it('free / Pro / outside / coming-next labels are unchanged', () => {
    for (const m of MISSIONS.filter((x) => x.access !== 'signin')) {
      expect(missionHtml(m)).not.toContain('data-learn-signin href');
    }
  });
});
