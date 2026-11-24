// @vitest-environment jsdom
/**
 * Connected files UI: hidden when the feature is off for this user; Connect shows what the provider grant
 * allows and leaves Mindy only when the customer clicks Continue; the provider callback's outcome is shown in
 * plain words and stripped from the address bar; picked files are removable chips; OneDrive picking says it is
 * coming rather than pretending.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const h = vi.hoisted(() => ({
  list: { status: 200, body: { connections: [], providers: [{ provider: 'google', available: true }, { provider: 'microsoft', available: true }] } } as { status: number; body: Record<string, unknown> },
  start: { status: 200, body: { authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', access_note: 'Google will let Mindy open only the files you pick.' } } as { status: number; body: Record<string, unknown> },
  calls: [] as Array<{ url: string; body?: string }>,
}));

vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string, _e: string, init?: { method?: string; body?: string }) => {
    h.calls.push({ url, body: init?.body });
    const r = url.includes('/start') ? h.start : h.list;
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  }),
}));

import { ConnectedFiles, type ConnectedFile } from './ConnectedFiles';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const realLocation = window.location;
let root: Root | null = null;
let el: HTMLDivElement;

async function mount(files: ConnectedFile[] = [], onChange = vi.fn()) {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(<ConnectedFiles email="pro@example.com" files={files} onChange={onChange} />); });
  await tick();
  return onChange;
}
const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const click = async (b: HTMLElement | undefined) => { await act(async () => { b!.click(); }); await tick(); };

beforeEach(() => {
  h.calls.length = 0;
  h.list = { status: 200, body: { connections: [], providers: [{ provider: 'google', available: true }, { provider: 'microsoft', available: true }] } };
  window.history.replaceState(null, '', '/app?panel=ask');
});
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('ConnectedFiles', () => {
  it('renders nothing when the feature is off for this user (list is 404)', async () => {
    h.list = { status: 404, body: { error: 'not_enabled' } };
    await mount();
    expect(el.querySelector('[data-testid="connected-files"]')).toBeNull();
  });

  it('Connect shows the access note first and does not leave Mindy until Continue', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, href: window.location.href, pathname: '/app', search: '?panel=ask', hash: '' } });
    await mount();
    await click(button('Use a file from Drive or OneDrive'));
    await click(button('Connect Google Drive'));
    const start = h.calls.find((c) => c.url.includes('/start'))!;
    expect(JSON.parse(start.body!)).toMatchObject({ provider: 'google', capabilities: ['file'], returnTo: '/app?panel=ask' });
    expect(el.textContent).toContain('Google will let Mindy open only the files you pick.');
    expect(assign).not.toHaveBeenCalled();
    await click(button('Continue to Google'));
    expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  });

  it('explains a consent link finished in another browser, and cleans the address bar', async () => {
    window.history.replaceState(null, '', '/app?panel=ask&connect=error&reason=browser_mismatch&provider=google');
    await mount();
    expect(el.textContent).toContain('same browser window');
    expect(window.location.search).toBe('?panel=ask');
  });

  it('shows picked files as chips that can be removed', async () => {
    const files: ConnectedFile[] = [{ handle: 'fh1.a.b', name: 'Cap Statement.pdf', provider: 'google' }];
    const onChange = await mount(files);
    expect(el.textContent).toContain('Cap Statement.pdf');
    await click(el.querySelector('button[aria-label="Remove Cap Statement.pdf"]') as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('a connected OneDrive says picking is coming, rather than offering a broken picker', async () => {
    h.list = { status: 200, body: { connections: [{ id: 'c2', provider: 'microsoft', connected_email: 'o@acme.com', status: 'connected' }], providers: [{ provider: 'microsoft', available: true }] } };
    await mount();
    await click(button('Use a file from Drive or OneDrive'));
    expect(el.textContent).toContain('OneDrive (o@acme.com): file picking is coming next');
  });

  it('a connection needing re-consent offers Reconnect', async () => {
    h.list = { status: 200, body: { connections: [{ id: 'c1', provider: 'google', connected_email: 'o@acme.com', status: 'reauth_needed' }], providers: [{ provider: 'google', available: true }] } };
    await mount();
    await click(button('Use a file from Drive or OneDrive'));
    expect(button('Reconnect Google Drive')).toBeTruthy();
  });
});
