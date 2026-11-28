/**
 * Beginners who click "Connect Mindy to your AI" (or the hero card "Mindy in your AI") on the
 * homepage want the plain step-by-step setup guide (/mcp/setup), not the developer pitch at
 * /mcp/about (raw tool names, "p25/p50/p75", "stateless proposal loop"). /mcp/about itself also
 * never linked to /mcp/setup, so a beginner who landed there had no path to the steps.
 *
 * Renders the real page components so the test covers the call sites.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/public-site/PublicHeader', () => ({ default: () => null }));
vi.mock('./HomeTrialClicks', () => ({ default: () => null }));

import HomePage from './page';
import McpAboutPage from '../mcp/about/page';

/** The href of the nearest <a> that opens before `label`. */
function hrefOf(html: string, label: string): string | null {
  const at = html.indexOf(label);
  if (at < 0) return null;
  const open = html.lastIndexOf('<a ', at);
  const m = html.slice(open, at).match(/href="([^"]+)"/);
  return m ? m[1] : null;
}

describe('homepage AI CTAs go to the plain setup guide', () => {
  const html = renderToStaticMarkup(<HomePage />);

  it('"Connect Mindy to your AI" opens /mcp/setup', () => {
    expect(hrefOf(html, 'Connect Mindy to your AI')).toBe('/mcp/setup');
  });

  it('hero card "Mindy in your AI" opens /mcp/setup', () => {
    expect(hrefOf(html, 'Mindy in your AI</span>')).toBe('/mcp/setup');
  });
});

describe('/mcp/about links to the step-by-step setup guide', () => {
  const html = renderToStaticMarkup(<McpAboutPage />);

  it('has a "Step-by-step setup guide" link to /mcp/setup', () => {
    expect(hrefOf(html, 'Step-by-step setup guide')).toBe('/mcp/setup');
  });
});
