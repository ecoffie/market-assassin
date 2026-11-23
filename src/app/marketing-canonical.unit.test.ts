/**
 * Public marketing pages must declare their OWN canonical.
 *
 * The root layout sets `alternates.canonical: '/'` as the default (src/app/layout.tsx). Any page
 * that does not override it tells Google "I am a copy of the homepage" — verified live
 * 2026-11-22: /mcp/about, /enterprise, /mcp/tools, /mcp, /december-spend, /action-plan-2026,
 * /sblo-directory, /tier2-directory, /tribal-list, /ai-prompts and /mindy-intelligence all
 * served `<link rel="canonical" href="https://getmindy.ai">`. /mcp/gallery is the pattern.
 *
 * Each case imports the module that actually exports the route's metadata (the page, or the
 * route's layout when the page is a client component), so the test checks the real call site.
 */
import { describe, expect, it } from 'vitest';
import type { Metadata } from 'next';

const CASES: Array<[route: string, load: () => Promise<{ metadata?: Metadata }>]> = [
  ['/mcp', () => import('./mcp/page')],
  ['/mcp/about', () => import('./mcp/about/page')],
  ['/mcp/tools', () => import('./mcp/tools/layout')],
  ['/mcp/gallery', () => import('./mcp/gallery/page')],
  ['/enterprise', () => import('./enterprise/page')],
  ['/december-spend', () => import('./december-spend/layout')],
  ['/action-plan-2026', () => import('./action-plan-2026/layout')],
  ['/sblo-directory', () => import('./sblo-directory/layout')],
  ['/tier2-directory', () => import('./tier2-directory/layout')],
  ['/tribal-list', () => import('./tribal-list/layout')],
  ['/ai-prompts', () => import('./ai-prompts/layout')],
  ['/mindy-intelligence', () => import('./mindy-intelligence/layout')],
];

describe('public marketing pages declare their own canonical (not the homepage)', () => {
  it.each(CASES)('%s canonical is its own path', async (route, load) => {
    const mod = await load();
    expect(mod.metadata?.alternates?.canonical).toBe(route);
  });
});
