// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextRequest } from 'next/server';
import { STORE, WRITES } from '@/lib/keywords/__fixtures__/recording-supabase';
import { KEYWORD_MAX_COUNT } from '@/lib/keywords/sanitize';

/**
 * Market Research auto-capture, through the ACTUAL UI. The real MarketResearchPanel is rendered in
 * jsdom; the user types a description and clicks "Build My Market Map". The build saves that
 * description to the profile's keywords via POST /api/app/keywords/add — routed here into the
 * REAL add-keywords handler over a write-recording fake. Every other endpoint (code suggestion,
 * report generation) is stubbed: not under test.
 *
 * The capture used to be fire-and-forget: a keyword the server refused looked saved.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@supabase/supabase-js', async () => {
  const { fakeClient } = await import('@/lib/keywords/__fixtures__/recording-supabase');
  return { createClient: () => fakeClient() };
});
// Outside the Next router: an empty URL, as on a fresh /app?panel=research load.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/app',
}));
vi.mock('@/lib/two-factor-session', () => ({ requireMIAuthSession: () => ({ ok: true }) }));
vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: async () => ({ workspaceId: null, asClient: false }),
  clientNotificationEmail: (id: string) => `client-${id}@workspace.local`,
}));

const EMAIL = 'research-ui@example.com';
const FULL = Array.from({ length: KEYWORD_MAX_COUNT }, (_, i) => `saved phrase ${i + 1}`);

function seed(keywords: string[]) {
  for (const k of Object.keys(STORE)) delete STORE[k];
  WRITES.length = 0;
  STORE.user_notification_settings = [{ user_email: EMAIL, keywords: [...keywords], naics_codes: ['541511'] }];
}
const stored = () => STORE.user_notification_settings[0].keywords as string[];
const addCalls: number[] = [];

async function routedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname === '/api/app/keywords/add') {
    const { POST } = await import('@/app/api/app/keywords/add/route');
    const res = await POST(new NextRequest(url.toString(), { method: 'POST', body: init?.body as string, headers: { 'content-type': 'application/json' } }));
    addCalls.push(res.status);
    return res;
  }
  if (url.pathname === '/api/suggest-codes') {
    return Response.json({ naicsSuggestions: [{ code: '541511', name: 'Custom Computer Programming Services' }], pscSuggestions: [] });
  }
  return Response.json({});
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  addCalls.length = 0;
  vi.stubGlobal('fetch', vi.fn(routedFetch));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const bodyText = () => host.ownerDocument.body.textContent || '';

async function describeAndBuild(description: string) {
  const { ToastHost } = await import('@/components/app/Toast');
  const { default: MarketResearchPanel } = await import('./MarketResearchPanel');
  await act(async () => { root.render(<ToastHost><MarketResearchPanel email={EMAIL} tier="pro" /></ToastHost>); });
  const input = () => host.querySelector<HTMLInputElement>('input[placeholder^="e.g. medical supplies"]');
  for (let i = 0; i < 200 && !input(); i++) await tick();
  expect(input(), 'the describe field renders').toBeTruthy();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setValue.call(input(), description); input()!.dispatchEvent(new Event('input', { bubbles: true })); });
  const build = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Build My Market Map');
  expect(build, 'the "Build My Market Map" button renders').toBeTruthy();
  await act(async () => { build!.click(); });
  for (let i = 0; i < 300 && addCalls.length === 0; i++) await tick();
  for (let i = 0; i < 20; i++) await tick();
}

describe('Market Research → describe → Build: the keyword capture (actual UI, real add handler)', () => {
  it('a profile at the limit: the add is rejected, nothing is written, and the user is TOLD it was not saved', async () => {
    seed(FULL);
    await describeAndBuild('drone repair');
    expect(addCalls).toEqual([400]);
    expect(WRITES.filter((w) => w.table === 'user_notification_settings')).toEqual([]);
    expect(stored()).toEqual(FULL);
    expect(bodyText()).toMatch(/“drone repair” was not saved to your keywords\. You have 60 saved keywords; adding 1 would make 61, over the limit of 60\. Nothing was saved\./);
  });

  it('a profile with room: the keyword is saved and no "not saved" message appears', async () => {
    seed(FULL.slice(0, 10));
    await describeAndBuild('drone repair');
    expect(addCalls).toEqual([200]);
    expect(stored()).toEqual([...FULL.slice(0, 10), 'drone repair']);
    expect(bodyText()).not.toMatch(/was not saved to your keywords/);
  });
});
