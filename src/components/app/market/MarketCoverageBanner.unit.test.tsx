// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MarketCoverageBanner, { type MarketCoverage } from './MarketCoverageBanner';

/**
 * The REAL banner component, rendered in jsdom, its real "+ Add all" button clicked, with only
 * the network (`fetch`) intercepted. A rejected save must never read as "✓ Added".
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COVERAGE = {
  keyword: 'drones', total_market: 243_000_000, naics_count: 42, top_code_pct: 28,
  keywords: ['unmanned aircraft', 'uas'], all_naics: [],
} as unknown as MarketCoverage;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function renderAndClickAdd(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => { root.render(<MarketCoverageBanner coverage={COVERAGE} email="user@example.com" />); });
  const button = [...host.querySelectorAll('button')].find((b) => /Add all/.test(b.textContent || ''));
  expect(button, 'the "+ Add all" button renders').toBeTruthy();
  await act(async () => { button!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return fetchMock;
}

describe('MarketCoverageBanner "+ Add all" — the actual UI', () => {
  it('a 400 keyword_limit rejection shows the server message and NEVER "✓ Added"', async () => {
    const message = 'You have 59 saved keywords; adding 2 would make 61, over the limit of 60. Nothing was saved. Only 1 more fits — remove some saved keywords in Settings, or add fewer.';
    const fetchMock = await renderAndClickAdd(new Response(JSON.stringify({ error: message, code: 'keyword_limit' }), { status: 400 }));
    expect(fetchMock).toHaveBeenCalledWith('/api/app/keywords/add', expect.objectContaining({ method: 'POST' }));
    expect(host.textContent).not.toMatch(/✓ Added/);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect([...host.querySelectorAll('button')].some((b) => /Add all/.test(b.textContent || ''))).toBe(true); // can retry
  });

  it('a network failure also never reads as added', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    await act(async () => { root.render(<MarketCoverageBanner coverage={COVERAGE} email="user@example.com" />); });
    const button = [...host.querySelectorAll('button')].find((b) => /Add all/.test(b.textContent || ''))!;
    await act(async () => { button.click(); });
    expect(host.textContent).not.toMatch(/✓ Added/);
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Not saved/);
  });

  it('a 200 shows "✓ Added"', async () => {
    await renderAndClickAdd(new Response(JSON.stringify({ success: true, added: 2 }), { status: 200 }));
    expect(host.textContent).toMatch(/✓ Added/);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
