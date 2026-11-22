import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import GlossaryIndexPage from '@/app/glossary/page';
import GlossaryTermPage from '@/app/glossary/[slug]/page';
import BlogIndexPage from '@/app/blog/page';
import McpAboutPage from '@/app/mcp/about/page';
import McpConsole from '@/app/mcp/mcp-console';
import MindyIntelligencePage from '@/app/mindy-intelligence/page';
import MindyLandingPage from '@/app/mindy-landing/page';
import { glossaryTerms } from '@/data/glossary';

// There is no free plan for new users: /pricing offers only a 14-day trial ("Card required
// for the trial. No charge for 14 days"). Buttons that send a visitor to /pricing must not
// say "Start for free". Same words as the homepage and /pricing: "Start 14-day free trial".
const LABEL = 'Start 14-day free trial';
const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

function pricingLinks(el: ReactElement) {
  const html = renderToStaticMarkup(el);
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  return { html, labels: [...doc.querySelectorAll('a[href="/pricing"]')].map(text) };
}

describe('content pages: /pricing buttons use the trial label, not "Start for free"', () => {
  it.each([
    ['/glossary', () => <GlossaryIndexPage />, [LABEL, `Meet Mindy — ${LABEL}`]],
    ['/blog', () => <BlogIndexPage />, [LABEL]],
    ['/mcp/about', () => <McpAboutPage />, [LABEL, LABEL]],
    // Signed-out first render (session check still loading): the two /pricing buttons.
    ['/mcp', () => <McpConsole />, [LABEL, LABEL]],
    ['/mindy-intelligence', () => <MindyIntelligencePage />, [LABEL, LABEL]],
    // Three page buttons plus the embedded MindySignupForm's /pricing tab (relabelled by #2287).
    ['/mindy-landing', () => <MindyLandingPage />, [LABEL, LABEL, LABEL, `Meet Mindy — ${LABEL}`]],
  ] as const)('%s', (path, el, expected) => {
    const { html, labels } = pricingLinks(el());
    expect(html).not.toContain('Start for free');
    for (const want of expected) expect(labels).toContain(want);
    expect(labels.filter((l) => l.includes(LABEL))).toHaveLength(expected.length);
    expect(labels.filter((l) => l.includes('Start for free'))).toHaveLength(0);
  });

  it('/glossary/[slug]', async () => {
    const page = await GlossaryTermPage({ params: Promise.resolve({ slug: glossaryTerms[0].slug }) });
    const { html, labels } = pricingLinks(page);
    expect(html).not.toContain('Start for free');
    expect(labels).toContain(LABEL);
    expect(labels).toContain(`Meet Mindy — ${LABEL}`);
  });

  // These pages need BigQuery / Supabase to render, so pin the call site: the /pricing
  // button's text is the trial label.
  it.each([
    ['src/app/awards/page.tsx', LABEL],
    ['src/app/customers/page.tsx', LABEL],
    ['src/app/discover/page.tsx', `${LABEL} →`],
  ])('%s', (file, label) => {
    const src = read(file);
    expect(src).not.toContain('Start for free');
    expect(src).toMatch(new RegExp(`<Link\\s+href="/pricing"[^>]*>\\s*${label}\\s*</Link>`));
  });
});
