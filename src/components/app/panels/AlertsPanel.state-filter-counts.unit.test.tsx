// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Alerts tab: after picking a state, the header ("N matches found") and the type pills
 * ("All (N)") must count the same rows the list shows. They used to count every loaded row,
 * before the client-side state filter, so the header said 5 while the list showed 4.
 * The real AlertsPanel is rendered in jsdom; only the network is stubbed.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/app',
}));

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const opp = (id: string, popState: string, noticeType: string, setAside?: string) => ({
  id,
  title: `Test opportunity ${id}`,
  department: 'Test Department',
  noticeType,
  setAside,
  popState,
  postedDate: old,
  responseDeadline: future,
  url: `https://sam.gov/opp/${id}/view`,
});
const OPPS = [
  opp('a1', 'VA', 'Solicitation', 'SBA'),
  opp('a2', 'VA', 'Solicitation'),
  opp('a3', 'VA', 'Sources Sought'),
  opp('a4', 'VA', 'Solicitation', 'SBA'),
  opp('a5', 'MD', 'Solicitation', 'SBA'),
];

async function stubFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname === '/api/app/opportunities') {
    return Response.json({ success: true, opportunities: OPPS, count: OPPS.length });
  }
  return Response.json({});
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(stubFetch));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const text = () => host.textContent || '';
const pill = (label: string) =>
  Array.from(host.querySelectorAll('button'))
    .map((b) => (b.textContent || '').trim())
    .find((t) => t.startsWith(`${label} (`));
const shownRows = () => Number(/Showing\s*(\d+)\s*of/.exec(text())?.[1]);

async function mountPanel() {
  const { ToastHost } = await import('@/components/app/Toast');
  const { default: AlertsPanel } = await import('./AlertsPanel');
  await act(async () => { root.render(<ToastHost><AlertsPanel email="alerts-test@example.com" tier="pro" /></ToastHost>); });
  // The panel debounces its first load by 350 ms.
  await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
  for (let i = 0; i < 5; i++) await tick();
}

async function pickState(value: string) {
  const select = host.querySelector('select[aria-label="Filter by state"]') as HTMLSelectElement;
  expect(select).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await tick();
}

describe('AlertsPanel counts after a state filter', () => {
  it('before any state is picked, header and pills count every loaded row', async () => {
    await mountPanel();
    expect(text()).toContain('5 matches found');
    expect(pill('All')).toBe('All (5)');
    expect(shownRows()).toBe(5);
  });

  it('after picking a state, header and pills count only the rows the list shows', async () => {
    await mountPanel();
    await pickState('VA');
    expect(shownRows()).toBe(4);
    expect(text()).toContain('4 matches found');
    expect(text()).not.toContain('5 matches found');
    expect(pill('All')).toBe('All (4)');
    expect(pill('Solicitations')).toBe('Solicitations (3)');
    expect(pill('Sources Sought')).toBe('Sources Sought (1)');
    expect(pill('Set-Aside')).toBe('Set-Aside (2)');
  });
});
