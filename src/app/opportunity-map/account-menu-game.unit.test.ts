/**
 * Top bar: login streak + UEI ranking chips beside the credits pill, and credits first in the
 * account dropdown (owner, 2026-11-19). Every chip shows only on a real answer.
 */
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from './account-menu';

const FIRST_SCRIPT = ACCOUNT_MENU_JS.replace(/^<script>/, '').replace(/<\/script>[\s\S]*$/, '');
const token = (p: Record<string, unknown>) => Buffer.from(JSON.stringify(p)).toString('base64url') + '.sig';

async function mount(opts: { me?: Record<string, unknown>; streak?: unknown; ranking?: unknown; streakOk?: boolean }) {
  const dom = new JSDOM(`<!doctype html><html><body><header>${ACCOUNT_MENU_HTML}</header></body></html>`, {
    url: 'https://getmindy.ai/app', runScripts: 'outside-only',
  });
  const w = dom.window as unknown as Window & typeof globalThis & { eval: (s: string) => unknown };
  w.localStorage.setItem('mi_beta_auth_token', token({ email: 'u@example.com', exp: Date.now() + 86_400_000 }));
  const calls: Array<{ url: string; method?: string }> = [];
  (w as unknown as { fetch: unknown }).fetch = vi.fn((url: string, init?: { method?: string }) => {
    calls.push({ url: String(url), method: init?.method });
    const u = String(url);
    const body = u.startsWith('/api/app/me') ? { email: 'u@example.com', name: 'U', picture: null, plan: 'pro', credits: 109150, proFeatures: true, ...(opts.me || {}) }
      : u.startsWith('/api/app/streak') ? opts.streak
      : u.startsWith('/api/app/my-ranking') ? opts.ranking : {};
    const ok = u.startsWith('/api/app/streak') ? opts.streakOk !== false : true;
    return Promise.resolve({ status: ok ? 200 : 500, ok, json: () => Promise.resolve(body) });
  });
  w.eval(FIRST_SCRIPT);
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  const d = w.document;
  const order = Array.from(d.querySelector('header')!.children).map((e) => e.id).filter(Boolean);
  return { d, calls, order };
}

const okStreak = { success: true, status: 'ok', streak: 6, longest: 9, countedToday: true, rewardedToday: 0, creditsEligible: true, next: { inDays: 1, credits: 25 } };
const okRank = { success: true, status: 'ok', uei: 'ABC123DEF456', ranking: { uei: 'ABC123DEF456', rankAll: 4210, countAll: 317402, rankState: 38, countState: 9210, state: 'FL' } };

describe('top bar streak + ranking chips', () => {
  it('shows streak, then rank, then the plan badge — and no credits pill in the top bar', async () => {
    const { d, calls, order } = await mount({ streak: okStreak, ranking: okRank });
    expect(d.getElementById('mindyStreak')?.textContent).toBe('6-day streak');
    expect(d.getElementById('mindyStreak')?.getAttribute('title')).toContain('Come back tomorrow for +25 credits');
    expect(d.getElementById('mindyRank')?.textContent).toBe('#4,210');
    expect(d.getElementById('mindyRank')?.getAttribute('title')).toContain('of 317,402 federal contractors (top 2%) · #38 in FL');
    expect(order.indexOf('mindyStreak')).toBeLessThan(order.indexOf('mindyRank'));
    expect(order.indexOf('mindyRank')).toBeLessThan(order.indexOf('mindyPlan'));
    expect(d.getElementById('mindyCred')).toBeNull();
    expect(calls.find((c) => c.url === '/api/app/streak')?.method).toBe('POST');
  });

  it('no UEI → "Get ranked" opening My Vault', async () => {
    const { d } = await mount({ streak: okStreak, ranking: { success: true, status: 'no_uei' } });
    const a = d.getElementById('mindyRank');
    expect(a?.textContent).toBe('Get ranked');
    expect(a?.getAttribute('href')).toBe('/app?panel=vault');
  });

  it('a UEI with no federal dollars says "Not ranked yet" and why, linking to My Vault', async () => {
    const { d } = await mount({ streak: okStreak, ranking: { success: true, status: 'not_found', uei: 'ABC123DEF456' } });
    const a = d.getElementById('mindyRank');
    expect(a?.textContent).toBe('Not ranked yet');
    expect(a?.getAttribute('title')).toContain('UEI ABC123DEF456');
    expect(a?.getAttribute('href')).toBe('/app?panel=vault');
  });

  it('nothing when the data is unavailable — never a fake 0 or #1', async () => {
    const { d } = await mount({ streak: { success: true, status: 'unavailable' }, ranking: { success: true, status: 'unavailable' } });
    expect(d.getElementById('mindyStreak')).toBeNull();
    expect(d.getElementById('mindyRank')).toBeNull();
  });

  it('a failed streak call shows no chip', async () => {
    const { d } = await mount({ streakOk: false, streak: null, ranking: okRank });
    expect(d.getElementById('mindyStreak')).toBeNull();
    expect(d.getElementById('mindyRank')).not.toBeNull();
  });

  it('free members see the streak with the Pro credit note', async () => {
    const { d } = await mount({ streak: { ...okStreak, creditsEligible: false }, ranking: okRank });
    expect(d.getElementById('mindyStreak')?.getAttribute('title')).toContain('Pro members earn +25 credits');
  });
});

describe('credits first in the account menu', () => {
  it('shows the balance right under the name, linking to billing', async () => {
    const { d } = await mount({ streak: okStreak, ranking: okRank });
    const row = d.getElementById('mindyAcctCredRow');
    expect(row?.style.display).toBe('flex');
    expect(d.getElementById('mindyAcctCredN')?.textContent).toBe('109,150');
    expect(row?.getAttribute('href')).toBe('/app?panel=settings&section=credits&tab=billing');
    const items = Array.from(d.getElementById('mindyAcctMenu')!.children).map((e) => e.id);
    expect(items.indexOf('mindyAcctCredRow')).toBe(items.indexOf('mindyAcctHd') + 1);
  });

  it('stays hidden when the balance is unknown', async () => {
    const { d } = await mount({ me: { credits: null }, streak: okStreak, ranking: okRank });
    expect(d.getElementById('mindyAcctCredRow')?.style.display).toBe('none');
  });
});
