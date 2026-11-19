/**
 * "Book a 30-min call" in the account menu: paid members only (Pro, Team, trial/staff via proFeatures).
 * Owner, 2026-11-19. Hidden until the plan is known; free and unknown never see it.
 */
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from './account-menu';
import { BOOK_CALL_URL } from '@/lib/mindy/book-call';

const FIRST_SCRIPT = ACCOUNT_MENU_JS.replace(/^<script>/, '').replace(/<\/script>[\s\S]*$/, '');
const token = (p: Record<string, unknown>) => Buffer.from(JSON.stringify(p)).toString('base64url') + '.sig';

async function callLink(me: Record<string, unknown>) {
  const dom = new JSDOM(`<!doctype html><html><body><header>${ACCOUNT_MENU_HTML}</header></body></html>`, {
    url: 'https://getmindy.ai/opportunity-map',
    runScripts: 'outside-only',
  });
  const w = dom.window as unknown as Window & typeof globalThis & { eval: (s: string) => unknown };
  w.localStorage.setItem('mi_beta_auth_token', token({ email: 'u@example.com', exp: Date.now() + 86_400_000 }));
  (w as unknown as { fetch: unknown }).fetch = vi.fn((url: string) => Promise.resolve({
    status: 200, ok: true,
    json: () => Promise.resolve(String(url).startsWith('/api/app/me') ? { email: 'u@example.com', name: 'U', picture: null, ...me } : {}),
  }));
  w.eval(FIRST_SCRIPT);
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  return w.document.getElementById('mindyAcctCall') as HTMLAnchorElement | null;
}

describe('Book a call (account menu)', () => {
  it('links to the Calendly page in a new tab', async () => {
    const a = await callLink({ plan: 'pro', credits: 10, proFeatures: true });
    expect(a?.getAttribute('href')).toBe(BOOK_CALL_URL);
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.style.display).toBe('flex');
  });
  it.each([
    ['team', { plan: 'team', credits: 10 }],
    ['trial (proFeatures)', { plan: 'free', credits: 0, proFeatures: true }],
  ])('shows for %s', async (_l, me) => {
    expect((await callLink(me))?.style.display).toBe('flex');
  });
  it.each([
    ['free', { plan: 'free', credits: 100, proFeatures: false }],
    ['unknown Pro verdict', { plan: 'free', credits: 100, proFeatures: null }],
  ])('stays hidden for %s', async (_l, me) => {
    expect((await callLink(me))?.style.display).toBe('none');
  });
});
