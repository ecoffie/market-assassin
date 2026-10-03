/**
 * C-5 (2026-10-03): the Map settings drawer must say when email alerts are OFF. 8,674 users have
 * alerts_enabled=false with a daily/weekly frequency still stored, and the drawer highlighted
 * "Every day" as if they were being emailed. Runs the real drawer HTML + JS in a DOM.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { SETTINGS_DRAWER_HTML, SETTINGS_DRAWER_JS } from './settings-drawer';

function b64url(o: unknown) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function boot(prefs: Record<string, unknown>) {
  const posts: Record<string, unknown>[] = [];
  const dom = new JSDOM(`<!doctype html><body>${SETTINGS_DRAWER_HTML}</body>`, { runScripts: 'outside-only', url: 'https://getmindy.ai/opportunity-map' });
  const w = dom.window as unknown as Window & typeof globalThis & { openSettingsDrawer: () => void; eval: (s: string) => void };
  w.localStorage.setItem('mi_beta_auth_token', `${b64url({ email: 'user@example.com' })}.sig`);
  (w as unknown as { fetch: unknown }).fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).startsWith('/api/alerts/preferences')) return { ok: true, json: async () => ({ success: true, data: prefs }) };
    posts.push(JSON.parse(init?.body || '{}'));
    return { ok: true, json: async () => ({ success: true }) };
  };
  w.eval(SETTINGS_DRAWER_JS.replace(/^<script>/, '').replace(/<\/script>$/, ''));
  w.openSettingsDrawer();
  await new Promise((r) => setTimeout(r, 10));
  const doc = w.document;
  const off = () => doc.getElementById('msetOff')!;
  const click = (sel: string) => (doc.querySelector(sel) as HTMLElement).click();
  const save = async () => { click('#msetSave'); await new Promise((r) => setTimeout(r, 10)); };
  return { doc, off, click, save, posts };
}

describe('Map settings drawer — alerts off is said, never implied', () => {
  it('alerts off + stored daily → notice shown, schedule dimmed', async () => {
    const d = await boot({ alertsEnabled: false, frequency: 'daily' });
    expect(d.off().className).toContain('show');
    expect(d.off().textContent).toMatch(/Email alerts are off/);
    expect(d.doc.getElementById('msetFreq')!.className).toContain('off');
  });

  it('alerts on → no notice', async () => {
    const d = await boot({ alertsEnabled: true, frequency: 'daily' });
    expect(d.off().className).not.toContain('show');
  });

  it('saving targeting while off never sends alertsEnabled (C-2 invariant kept)', async () => {
    const d = await boot({ alertsEnabled: false, frequency: 'weekly' });
    await d.save();
    expect(d.posts[0]).not.toHaveProperty('alertsEnabled');
    expect(d.off().textContent).toMatch(/Email alerts are off/);
  });

  it('"Turn alerts on" is the explicit instruction: save sends alertsEnabled true, notice clears', async () => {
    const d = await boot({ alertsEnabled: false, frequency: 'daily' });
    d.click('#msetOn');
    expect(d.off().textContent).toMatch(/will turn on when you save/);
    await d.save();
    expect(d.posts[0].alertsEnabled).toBe(true);
    expect(d.off().className).not.toContain('show');
  });

  it('stored Paused → picking a schedule says alerts will turn on (server rule), no explicit flag needed', async () => {
    const d = await boot({ alertsEnabled: false, frequency: 'paused' });
    expect(d.off().className).not.toContain('show');
    d.click('button[data-f="weekly"]');
    expect(d.off().textContent).toMatch(/will turn on when you save/);
    await d.save();
    expect(d.posts[0]).toMatchObject({ alertFrequency: 'weekly' });
    expect(d.posts[0]).not.toHaveProperty('alertsEnabled');
  });
});
