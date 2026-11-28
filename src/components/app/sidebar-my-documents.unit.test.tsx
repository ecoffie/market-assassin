// @vitest-environment jsdom
/**
 * /app sidebar: generated PDFs (and uploads) had no way in: Vault is reached only from the account menu.
 * "My Documents" under Saved opens the Vault on its Documents section (Eric, 2026-11-27).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => <a href={href} {...(rest as object)}>{children as never}</a> }));
vi.mock('./authHeaders', () => ({ authedFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) }));
vi.mock('./track', () => ({ useAppTracker: () => vi.fn() }));
vi.mock('./UpgradeModal', () => ({ UpgradeModal: () => null }));
vi.mock('./WorkspaceSwitcher', () => ({ default: () => null }));

import UnifiedSidebar, { MY_DOCUMENTS_TARGET } from './UnifiedSidebar';
import type { AppPanel } from './UnifiedSidebar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(activePanel: AppPanel, onPanelChange = vi.fn()) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<UnifiedSidebar activePanel={activePanel} onPanelChange={onPanelChange} userTier="free" userEmail="pat@example.com" />); });
  return { el, onPanelChange };
}
const row = (el: HTMLElement) => el.querySelector('[data-tour="nav-documents"]') as HTMLButtonElement | null;

beforeEach(() => { document.body.innerHTML = ''; });

describe('/app sidebar: My Documents', () => {
  it('is listed under Saved, after Watchlist and Saved opportunities, for every tier (free included)', async () => {
    const { el } = await mount('chat');
    const btn = row(el)!;
    expect(btn.textContent).toContain('My Documents');
    const saved = Array.from(el.querySelectorAll('div')).find((d) => d.textContent === 'Saved')!;
    const section = saved.parentElement!;
    const labels = Array.from(section.querySelectorAll('button')).map((b) => b.getAttribute('data-tour'));
    expect(labels).toEqual(['nav-watchlist', 'nav-saved', 'nav-documents']);
  });

  it('opens the Vault on its Documents section (the /app?panel=vault&section=documents deep link)', async () => {
    const { el, onPanelChange } = await mount('chat');
    await act(async () => { row(el)!.click(); });
    expect(onPanelChange).toHaveBeenCalledWith('vault', { section: 'documents' });
    expect(MY_DOCUMENTS_TARGET).toEqual({ panel: 'vault', context: { section: 'documents' } });
  });

  it('is highlighted while the Vault is open', async () => {
    const { el } = await mount('vault');
    expect(row(el)!.getAttribute('aria-current')).toBe('page');
  });

  it('the address bar keeps the section, and the Vault follows a repeat request', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/app/app/page.tsx', 'utf8');
    expect(page).toContain("if (panel === 'vault' && typeof context?.section === 'string') params.set('section', context.section);");
    const vault = readFileSync('src/components/app/panels/VaultPanel.tsx', 'utf8');
    expect(vault).toMatch(/if \(initialSection\) setSection\(initialSection\);\s*\}, \[initialSection, sectionRequest\]\);/);
  });
});
