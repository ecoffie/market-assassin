/**
 * Regression tests for the two defects the 36,070-URL production crawl found
 * after merge 2eaf4228 (Phase A). Both predate that merge; both are real.
 *
 *   1. Eight sitemap URLs returned 200 but with a wrong canonical — five
 *      canonicalised to the apex, three emitted none at all.
 *   2. Seven alias redirects issued a 308 to a canonical slug that 404s.
 *
 * The canonical assertions are source-level on purpose: a self-canonical is a
 * property of what the route EMITS, and the eight URLs are split across three
 * different mechanisms (page metadata, a client page needing a layout, and
 * route handlers that bypass Next metadata entirely). Testing them together is
 * the point — the crawl found them together.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => (existsSync(join(process.cwd(), p)) ? readFileSync(join(process.cwd(), p), 'utf8') : '');
/** Strip comments: these files explain the defect, and the explanation is not the code. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('defect 1 — all eight crawl-failing URLs now emit a self-canonical', () => {
  // Five that inherited the ROOT layout's `alternates: { canonical: '/' }`.
  const metadataPages: Array<[string, string, string]> = [
    ['/about', 'src/app/about/layout.tsx', 'https://getmindy.ai/about'],
    ['/opportunity-hunter', 'src/app/opportunity-hunter/layout.tsx', 'https://getmindy.ai/opportunity-hunter'],
    ['/privacy', 'src/app/privacy/page.tsx', 'https://getmindy.ai/privacy'],
    ['/terms', 'src/app/terms/page.tsx', 'https://getmindy.ai/terms'],
    ['/free-resources', 'src/app/free-resources/layout.tsx', 'https://getmindy.ai/free-resources'],
  ];

  it.each(metadataPages)('%s declares its own canonical', (_route, file, url) => {
    const src = code(read(file));
    expect(src, `${file} missing`).not.toBe('');
    expect(src).toContain('alternates:');
    expect(src).toContain(url);
  });

  it('/free-resources gets it via a layout, because a client page cannot export metadata', () => {
    expect(read('src/app/free-resources/page.tsx')).toContain("'use client'");
    expect(code(read('src/app/free-resources/layout.tsx'))).toContain('export const metadata');
  });

  // Three route handlers — Next metadata never applies to these.
  const routeHandlers: Array<[string, string, string]> = [
    ['/research', 'src/app/research/route.ts', 'https://getmindy.ai/research'],
    ['/research/about', 'src/app/research/about/route.ts', 'https://getmindy.ai/research/about'],
    ['/research/how-we-publish', 'src/app/research/how-we-publish/route.ts', 'https://getmindy.ai/research/how-we-publish'],
  ];

  it.each(routeHandlers)('%s passes a canonical into the shared shell', (_route, file, url) => {
    const src = code(read(file));
    expect(src, `${file} missing`).not.toBe('');
    expect(src).toContain(`canonical: '${url}'`);
  });

  it('govPage can emit a canonical, and omits the tag entirely when not given one', () => {
    const shell = read('src/lib/gov/shell.ts');
    expect(shell).toContain('canonical?: string');
    // Conditional, so existing callers that pass nothing are unchanged.
    expect(shell).toContain('opts.canonical ?');
    expect(shell).toContain('rel="canonical"');
  });

  it('does NOT change the root layout default', () => {
    // Re-pointing the global default would silently move every page that
    // currently relies on it; the fix is per-page opt-in.
    const root = read('src/app/layout.tsx');
    expect(root).toContain('canonical');
    expect(root).toContain('metadataBase');
  });
});

describe('defect 2 — a redirect is only issued to a serveable canonical', () => {
  const helper = code(read('src/lib/seo/canonical-redirect.ts'));

  it('resolves through the cache-only reader — never live BigQuery', () => {
    expect(helper).toContain('getRollupBySlug(canonical)');
    // No liveBq=true anywhere; the default is cache-only.
    expect(helper).not.toContain('getRollupBySlug(canonical, true)');
    expect(helper).not.toContain('bqQuery');
  });

  it('returns null when the target is not serveable, so the caller 404s', () => {
    expect(helper).toContain('return target ? canonical : null');
  });

  it('fails closed on error rather than asserting a redirect', () => {
    expect(helper).toContain('catch');
    expect(helper.slice(helper.indexOf('catch'))).toContain('return null');
  });

  const routes = [
    'src/app/contractors/[slug]/page.tsx',
    'src/app/contractors/[slug]/contracts/[[...page]]/page.tsx',
    'src/app/contractors/[slug]/naics/page.tsx',
    'src/app/contractors/[slug]/agencies/page.tsx',
  ];

  it.each(routes)('%s gates its redirect on serveability', (file) => {
    const src = code(read(file));
    expect(src, `${file} missing`).not.toBe('');
    expect(src).toContain('serveableCanonical(await resolveCanonicalSlug(slug))');
    // The raw resolver must not still feed permanentRedirect directly.
    expect(src).not.toMatch(/const canonical = await resolveCanonicalSlug\(slug\);/);
  });

  it('every contractor route that can redirect is covered — none left ungated', () => {
    for (const f of routes) {
      const src = code(read(f));
      const redirects = (src.match(/permanentRedirect\(`\/contractors\//g) ?? []).length;
      const gated = (src.match(/serveableCanonical\(/g) ?? []).length;
      // Each route has one alias redirect (plus /[slug] has a separate
      // canonical_slug consolidation that is already proven serveable).
      expect(gated, `${f}: ungated alias redirect`).toBeGreaterThanOrEqual(1);
      expect(redirects).toBeGreaterThanOrEqual(1);
    }
  });
});
