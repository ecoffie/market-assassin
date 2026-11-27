// @vitest-environment jsdom
/**
 * Connected files UI: hidden when the feature is off for this user; Connect shows what the provider grant
 * allows and leaves Mindy only when the customer clicks Continue; the provider callback's outcome is shown in
 * plain words and stripped from the address bar; picked files are removable chips; OneDrive uses Mindy's own
 * chooser (browse folders, pick a readable file).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const h = vi.hoisted(() => ({
  list: { status: 200, body: { connections: [], providers: [{ provider: 'google', available: true }, { provider: 'microsoft', available: true }] } } as { status: number; body: Record<string, unknown> },
  start: { status: 200, body: { authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', access_note: 'Google will let Mindy open only the files you pick.' } } as { status: number; body: Record<string, unknown> },
  calls: [] as Array<{ url: string; body?: string; method?: string }>,
}));

vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string, _e: string, init?: { method?: string; body?: string }) => {
    h.calls.push({ url, body: init?.body, method: init?.method });
    if (init?.method === 'DELETE') {
      // After a disconnect the list no longer has the connection (the store marks it revoked).
      h.list = { status: 200, body: { connections: [], providers: (h.list.body.providers as unknown[]) || [] } };
      return { ok: true, status: 200, json: async () => ({ status: 'disconnected' }) };
    }
    if (url.includes('/browse')) {
      const b = JSON.parse(init?.body || '{}');
      const items = b.folder_id === 'fold-1'
        ? [{ id: 'file-1', name: 'Cap Statement.pdf', kind: 'file', size: 10, modified: null }]
        : [{ id: 'fold-1', name: 'Proposals', kind: 'folder', size: null, modified: null }];
      return { ok: true, status: 200, json: async () => ({ items }) };
    }
    if (url.includes('/selections')) return { ok: true, status: 200, json: async () => ({ file_handle: 'fh1.x.y', file: { name: 'Cap Statement.pdf' } }) };
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

  it('right after sign-in (first list call 401) the control still appears once the session lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      h.list = { status: 401, body: { error: 'unauthorized' } };
      await mount();
      expect(el.querySelector('[data-testid="connected-files"]')).toBeNull();
      h.list = { status: 200, body: { connections: [], providers: [{ provider: 'google', available: true }] } };
      await act(async () => { vi.advanceTimersByTime(1600); });
      await tick();
      expect(el.querySelector('[data-testid="connected-files"]')).not.toBeNull();
      expect(h.calls.filter((c) => c.url.startsWith('/api/app/connected-apps?')).length).toBe(2);
    } finally { vi.useRealTimers(); }
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

  it('OneDrive: browse folders in Mindy\'s chooser, pick a readable file, get a chip', async () => {
    h.list = { status: 200, body: { connections: [{ id: 'c2', provider: 'microsoft', connected_email: 'o@acme.com', status: 'connected' }], providers: [{ provider: 'microsoft', available: true }] } };
    const onChange = await mount();
    await click(button('Use a file from Drive or OneDrive'));
    await click(button('Pick from OneDrive (o@acme.com)'));
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Pick a file from OneDrive');
    await click(button('Proposals'));
    const browse = h.calls.filter((c) => c.url.includes('/browse'));
    expect(JSON.parse(browse[browse.length - 1].body!)).toMatchObject({ connection_id: 'c2', folder_id: 'fold-1' });
    await click(button('Cap Statement.pdf'));
    const sel = h.calls.find((c) => c.url.includes('/selections'))!;
    expect(JSON.parse(sel.body!)).toMatchObject({ connection_id: 'c2', file_id: 'file-1' });
    expect(onChange).toHaveBeenCalledWith([{ handle: 'fh1.x.y', name: 'Cap Statement.pdf', provider: 'microsoft' }]);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('a connection needing re-consent offers Reconnect', async () => {
    h.list = { status: 200, body: { connections: [{ id: 'c1', provider: 'google', connected_email: 'o@acme.com', status: 'reauth_needed' }], providers: [{ provider: 'google', available: true }] } };
    await mount();
    await click(button('Use a file from Drive or OneDrive'));
    expect(button('Reconnect Google Drive')).toBeTruthy();
  });
  it('Disconnect asks first, then removes the account and its picks', async () => {
    h.list = { status: 200, body: { connections: [{ id: 'c1', provider: 'google', connected_email: 'o@acme.com', status: 'connected' }], providers: [{ provider: 'google', available: true }, { provider: 'microsoft', available: true }] } };
    const onChange = await mount([{ handle: 'fh1.g', name: 'Cap.txt', provider: 'google' }, { handle: 'fh1.m', name: 'Plan.pdf', provider: 'microsoft' }]);
    await click(button('Use a file from Drive or OneDrive'));
    await click(button('Disconnect Google Drive (o@acme.com)'));
    // Nothing is sent until the customer confirms.
    expect(h.calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(el.textContent).toContain('files you picked from it will stop working');
    await click([...el.querySelectorAll('button')].find((b) => b.textContent === 'Disconnect'));
    const del = h.calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe('/api/app/connected-apps');
    expect(JSON.parse(del!.body!)).toEqual({ email: 'pro@example.com', id: 'c1' });
    expect(onChange).toHaveBeenCalledWith([{ handle: 'fh1.m', name: 'Plan.pdf', provider: 'microsoft' }]);
    expect(el.textContent).toContain('Google Drive (o@acme.com) is disconnected');
    await click(button('Use a file from Drive or OneDrive'));
    expect(button('Connect Google Drive')).toBeTruthy();
    expect(button('Pick from Google Drive')).toBeUndefined();
  });

  it('Cancel leaves the connection alone', async () => {
    h.list = { status: 200, body: { connections: [{ id: 'c1', provider: 'google', connected_email: 'o@acme.com', status: 'connected' }], providers: [{ provider: 'google', available: true }] } };
    await mount();
    await click(button('Use a file from Drive or OneDrive'));
    await click(button('Disconnect Google Drive'));
    await click(button('Cancel'));
    expect(h.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('back from consent when the app already rewrote the address: the outcome cookie is shown once, then cleared', async () => {
    document.cookie = 'mindy_ca_result=ok.microsoft.; Path=/';
    await mount();
    expect(el.textContent).toContain('OneDrive is connected. Pick a file to use it in this conversation.');
    expect(document.cookie).not.toContain('mindy_ca_result=ok');
  });

  it('a failed connect from the cookie says why in plain words', async () => {
    document.cookie = 'mindy_ca_result=error.microsoft.invalid_client; Path=/';
    await mount();
    expect(el.textContent).toContain('Mindy could not finish connecting because of a setup problem on our side. Nothing was connected.');
  });

  it('the outcome is not consumed while the session is still loading: it shows once the control appears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      document.cookie = 'mindy_ca_result=ok.microsoft.; Path=/';
      h.list = { status: 401, body: { error: 'unauthorized' } };
      await mount();
      // Not shown yet, and not thrown away: a remount after sign-in must still find it.
      expect(document.cookie).toContain('mindy_ca_result=ok.microsoft.');
      h.list = { status: 200, body: { connections: [], providers: [{ provider: 'microsoft', available: true }] } };
      await act(async () => { vi.advanceTimersByTime(1600); });
      await tick();
      expect(el.textContent).toContain('OneDrive is connected. Pick a file to use it in this conversation.');
      expect(document.cookie).not.toContain('mindy_ca_result=ok');
    } finally { vi.useRealTimers(); }
  });
});

describe('ConnectedFiles: email drafts (Slice B)', () => {
  const google = (scopes: string[]) => ({ id: 'c-g', provider: 'google', connected_email: 'pat@acme.example.com', status: 'connected', granted_scopes: scopes });

  it('a file-only account offers "Allow email drafts"; choosing it asks for file + draft and shows the note first', async () => {
    h.list = { status: 200, body: { connections: [google(['https://www.googleapis.com/auth/drive.file'])], providers: [{ provider: 'google', available: true }] } };
    h.start = { status: 200, body: { authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=2', access_note: "Google's permission to save email drafts in your Gmail also covers sending. Mindy never sends." } };
    await mount();
    await click(button('Use a file from Drive or OneDrive'));
    const allow = button('Allow email drafts in Gmail (pat@acme.example.com)');
    expect(allow).toBeTruthy();
    await click(allow);
    const start = h.calls.find((c) => c.url.includes('/start'))!;
    expect(JSON.parse(start.body!).capabilities).toEqual(['file', 'draft']);
    expect(el.textContent).toContain('Mindy never sends');
    expect(button('Continue to Google')).toBeTruthy();
  });

  it('an account that already allows drafts is not asked again', async () => {
    h.list = { status: 200, body: { connections: [google(['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/gmail.compose'])], providers: [{ provider: 'google', available: true }] } };
    await mount();
    await click(button('Use a file from Drive or OneDrive'));
    expect(button('Allow email drafts')).toBeUndefined();
  });

  it('connecting a new account still asks for files only', async () => {
    await mount();
    await click(button('Use a file from Drive or OneDrive'));
    await click(button('Connect Google Drive'));
    const start = h.calls.find((c) => c.url.includes('/start'))!;
    expect(JSON.parse(start.body!).capabilities).toEqual(['file']);
  });
});
