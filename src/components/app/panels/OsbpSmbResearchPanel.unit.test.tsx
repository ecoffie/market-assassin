// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Small-business search tab, through the real panel: labels show a plain apostrophe (no stray
 * backslash), and result counts read "1 agency" / "1 contract", plural otherwise.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../authHeaders', () => ({ authedFetch: (url: string) => fetch(url) }));

const row = (uei: string, award_count: number, agency_count: number) => ({
  recipient_uei: uei, recipient_name: `Firm ${uei}`, total_obligated: 1_000_000, award_count, agency_count,
  set_asides: '', won_set_aside: false, psc_exact: true, psc_family: false, naics_match: false,
  match_score: 3, match_reason: 'Won exact PSC',
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    success: true, total: 2, results: [row('ONE', 1, 1), row('TWO', 3, 2)],
  })));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function render() {
  const { default: OsbpSmbResearchPanel } = await import('./OsbpSmbResearchPanel');
  await act(async () => { root.render(<OsbpSmbResearchPanel email="test@example.com" />); });
}

describe('OsbpSmbResearchPanel copy', () => {
  it('shows apostrophes without a stray backslash', async () => {
    await render();
    const text = host.textContent || '';
    expect(text).not.toContain('\\');
    expect(text).toContain("(what you're buying — best match)");
    expect(text).toContain("Enter the PSC of what you're buying (e.g. J998 ship repair) to find every small business that's won that work.");
  });

  it('singularizes agency and contract counts of 1', async () => {
    await render();
    const input = host.querySelector<HTMLInputElement>('input[placeholder="J998 (ship repair)"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'J998');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Find businesses')!;
    await act(async () => { btn.click(); });
    const text = host.textContent || '';
    expect(text).toContain('1 contract · 1 agency');
    expect(text).toContain('3 contracts · 2 agencies');
    expect(text).not.toContain('1 agencies');
    expect(text).not.toContain('1 contracts');
    expect(text).not.toContain('\\');
  });
});
