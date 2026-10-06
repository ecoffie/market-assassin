// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextRequest } from 'next/server';
import { STORE, WRITES } from '@/lib/keywords/__fixtures__/recording-supabase';
import { KEYWORD_MAX_COUNT } from '@/lib/keywords/sanitize';

/**
 * The Settings keyword save, through the ACTUAL UI: the real UnifiedSettingsPanel is rendered in
 * jsdom, the real Keywords field is typed into and the real "Save Settings" button clicked. The
 * panel's POST /api/alerts/preferences is routed into the REAL preferences route handler, backed
 * by a write-recording Supabase fake — so this covers click → request → handler → database.
 * Only the workspace-profile endpoint (not under test) is stubbed.
 *
 * This is how the reported customer entered 53 keywords and silently kept 40.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@supabase/supabase-js', async () => {
  const { fakeClient } = await import('@/lib/keywords/__fixtures__/recording-supabase');
  return { createClient: () => fakeClient() };
});
vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_req: unknown, email: string) => ({ authenticated: true, email }),
}));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => ({ workspaceId: null, asClient: false }),
  clientNotificationEmail: (id: string) => `client-${id}@workspace.local`,
}));
vi.mock('@/lib/app/derive-agencies-from-naics', () => ({ deriveAgenciesFromProfile: async () => [] }));

const EMAIL = 'settings-ui@example.com';
const PRIOR = ['prior keyword one', 'prior keyword two'];
const kws = (n: number) => Array.from({ length: n }, (_, i) => `capability phrase ${i + 1}`);

function seed() {
  for (const k of Object.keys(STORE)) delete STORE[k];
  WRITES.length = 0;
  STORE.user_notification_settings = [{
    user_email: EMAIL, keywords: [...PRIOR], naics_codes: ['541511'], agencies: ['VA'], aggregated_profile: {},
    alert_frequency: 'daily', alerts_enabled: true,
  }];
}
const stored = () => STORE.user_notification_settings[0].keywords as string[];
const prefWrites = () => WRITES.filter((w) => w.table === 'user_notification_settings');

/** The browser's fetch, routed: preferences → the real handler; workspace → a stub. */
async function routedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  const method = (init?.method || 'GET').toUpperCase();
  if (url.pathname === '/api/alerts/preferences') {
    const mod = await import('@/app/api/alerts/preferences/route');
    const req = new NextRequest(url.toString(), { method, body: method === 'GET' ? undefined : (init?.body as string), headers: { 'content-type': 'application/json' } });
    return method === 'GET' ? mod.GET(req) : mod.POST(req);
  }
  if (url.pathname === '/api/app/workspace') {
    if (method === 'GET') {
      return Response.json({ success: true, workspace: { name: 'Test' }, settings: {}, profile: { notification: STORE.user_notification_settings[0] } });
    }
    return Response.json({ success: true });
  }
  return Response.json({});
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  seed();
  vi.stubGlobal('fetch', vi.fn(routedFetch));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function renderPanel() {
  const { ToastHost } = await import('@/components/app/Toast');
  const { default: UnifiedSettingsPanel } = await import('./UnifiedSettingsPanel');
  await act(async () => { root.render(<ToastHost><UnifiedSettingsPanel email={EMAIL} tier="pro" /></ToastHost>); });
  // Wait for the real load (workspace + the real preferences GET handler) to finish.
  const fineTune = () => [...host.querySelectorAll('button')].find((b) => /Fine-tune codes manually/.test(b.textContent || ''));
  for (let i = 0; i < 200 && !fineTune(); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  // The Keywords field lives in the collapsed "Fine-tune codes manually" section — open it,
  // exactly as a user must.
  expect(fineTune(), 'the "Fine-tune codes manually" toggle renders').toBeTruthy();
  await act(async () => { fineTune()!.click(); });
  for (let i = 0; i < 100 && !host.querySelector('input[placeholder^="e.g. drone repair"]'); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

async function typeKeywordsAndSave(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[placeholder^="e.g. drone repair"]');
  expect(input, 'the Keywords field renders').toBeTruthy();
  expect(input!.value).toBe(PRIOR.join(', ')); // loaded from the saved profile
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const save = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save Settings');
  expect(save, 'the Save Settings button renders').toBeTruthy();
  await act(async () => { save!.click(); });
  // Wait for the save round-trip (real POST handler) and the resulting toast.
  for (let i = 0; i < 200 && !/Settings saved|did NOT save/.test(host.ownerDocument.body.textContent || ''); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

describe('Settings → Keywords → Save Settings (actual UI, real preferences handler)', () => {
  it(`${KEYWORD_MAX_COUNT + 1} keywords: the user sees "did NOT save" with the reason; nothing is written; prior keywords kept`, async () => {
    await renderPanel();
    await typeKeywordsAndSave(kws(KEYWORD_MAX_COUNT + 1).join(', '));
    expect(host.ownerDocument.body.textContent).toMatch(
      new RegExp(`Codes/keywords did NOT save: You entered ${KEYWORD_MAX_COUNT + 1} keywords; the limit is ${KEYWORD_MAX_COUNT}\\. Nothing was saved — remove 1 and save again\\.`),
    );
    expect(host.ownerDocument.body.textContent).not.toMatch(/Settings saved/);
    expect(prefWrites()).toEqual([]);
    expect(stored()).toEqual(PRIOR);
  });

  it('53 keywords (the list that was truncated to 40): saved intact and confirmed', async () => {
    await renderPanel();
    await typeKeywordsAndSave(kws(53).join(', '));
    expect(host.ownerDocument.body.textContent).toMatch(/Settings saved/);
    expect(stored()).toEqual(kws(53));
  });
});
