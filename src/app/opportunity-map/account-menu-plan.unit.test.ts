/**
 * Signed-in header plan chip (Map, /today, /bid, /learn all inject ACCOUNT_MENU_JS).
 *
 * 2026-11-15 (Eric's screenshot): a Pro account (Command Center grant: access_briefings + KV briefings:)
 * saw "100 credits" + "Upgrade". /api/app/me already returned plan "pro" (resolvePlan is promoted by
 * resolveAccess, the hasProAccess verdict), but paintPlan exempted only team/enterprise from Upgrade.
 * Pins: Pro (plan "pro" or proFeatures true) gets a "Pro" badge and NO Upgrade; Team/Enterprise keep
 * "Add credits"; Free keeps Upgrade; credits still show their real balance (null shows nothing).
 */
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ACCOUNT_MENU_HTML, ACCOUNT_MENU_JS } from './account-menu';

const FIRST_SCRIPT = ACCOUNT_MENU_JS.replace(/^<script>/, '').replace(/<\/script>[\s\S]*$/, '');
const token = (p: Record<string, unknown>) => Buffer.from(JSON.stringify(p)).toString('base64url') + '.sig';

async function mount(me: Record<string, unknown>) {
  const dom = new JSDOM(`<!doctype html><html><body><header><a href="/pricing">Pricing</a>${ACCOUNT_MENU_HTML}</header></body></html>`, {
    url: 'https://getmindy.ai/opportunity-map',
    runScripts: 'outside-only',
  });
  const w = dom.window as unknown as Window & typeof globalThis & { eval: (s: string) => unknown };
  w.localStorage.setItem('mi_beta_auth_token', token({ email: 'pro@example.com', exp: Date.now() + 86_400_000 }));
  (w as unknown as { fetch: unknown }).fetch = vi.fn((url: string) => {
    if (String(url).startsWith('/api/app/me')) {
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ email: 'pro@example.com', name: 'Pro User', picture: null, ...me }) });
    }
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) });
  });
  w.eval(FIRST_SCRIPT);
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  const d = w.document;
  return {
    upgrade: d.getElementById('mindyUpg'),
    plan: d.getElementById('mindyPlan'),
    credits: d.getElementById('mindyCred'),
    menuCredits: d.getElementById('mindyAcctCredRow')?.style.display === 'flex' ? d.getElementById('mindyAcctCredN')?.textContent : null,
  };
}

describe('header plan chip agrees with the server Pro verdict', () => {
  it('Pro (plan "pro", the Command Center grant case): "Pro" badge, real credits, NO Upgrade', async () => {
    const r = await mount({ plan: 'pro', credits: 100, proFeatures: true });
    expect(r.upgrade).toBeNull();
    expect(r.plan?.textContent).toBe('Pro');
    expect(r.plan?.getAttribute('href')).toBe('/app?panel=settings&section=credits&tab=billing');
    // Credits live in the dropdown now, not the top bar (owner 2026-11-19).
    expect(r.credits).toBeNull();
    expect(r.menuCredits).toBe('100');
  });
  it('proFeatures true alone (trial/staff, whatever plan label) is treated as Pro', async () => {
    const r = await mount({ plan: 'free', credits: 0, proFeatures: true });
    expect(r.upgrade).toBeNull();
    expect(r.plan?.textContent).toBe('Pro');
  });
  it('Free: Upgrade to /pricing, no Pro badge', async () => {
    const r = await mount({ plan: 'free', credits: 100, proFeatures: false });
    expect(r.plan).toBeNull();
    expect(r.upgrade?.textContent).toBe('Upgrade');
    expect(r.upgrade?.getAttribute('href')).toBe('/pricing');
  });
  it('Free with an unknown Pro verdict (proFeatures null) still shows Upgrade, never a guessed Pro', async () => {
    const r = await mount({ plan: 'free', credits: 100, proFeatures: null });
    expect(r.plan).toBeNull();
    expect(r.upgrade?.textContent).toBe('Upgrade');
  });
  it('Team / Enterprise: "Add credits", no Pro badge', async () => {
    for (const plan of ['team', 'enterprise']) {
      const r = await mount({ plan, credits: 900, proFeatures: true });
      expect(r.plan).toBeNull();
      expect(r.upgrade?.textContent).toBe('Add credits');
    }
  });
  it('unreadable credits (null) show no number, never a fake 0', async () => {
    const r = await mount({ plan: 'pro', credits: null, proFeatures: true });
    expect(r.credits).toBeNull();
    expect(r.plan?.textContent).toBe('Pro');
  });
});
