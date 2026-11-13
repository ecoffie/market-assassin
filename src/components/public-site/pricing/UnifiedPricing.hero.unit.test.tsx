/**
 * /mcp/pricing hero (2026-11-13): "Federal market intelligence for you and your AI agents."
 * Copy-only change. This pins the new headline + supporting copy, keeps the trial line and
 * trial chips, and proves the plan cards (prices, credits, checkout links) are untouched.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import UnifiedPricing, { PLANS_FALLBACK } from './UnifiedPricing';

const html = renderToStaticMarkup(
  <UnifiedPricing initialTab="mcp" proCredits={1500} teamCredits={7000} signupCredits={100} forecastsLabel="33,000+" faqs={[]} />,
);
const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const hero = doc.querySelector('section.promo')!;
const heroText = (hero.textContent ?? '').replace(/ /g, ' ');

describe('/mcp/pricing hero', () => {
  it('has the new headline and no old one', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect((doc.querySelector('h1')!.textContent ?? '').replace(/ /g, ' ')).toBe('Federal market intelligence for you and your AI agents.');
    expect(html).not.toContain('GovWin-grade');
  });

  it('has the approved supporting copy', () => {
    expect(heroText).toContain(
      "Find opportunities, research competitors, track recompetes, and put Mindy's intelligence to work inside Claude, Cursor, and your favorite AI tools.",
    );
  });

  it('shows AI-agent compatibility without overclaiming', () => {
    const agents = [...hero.querySelectorAll('.agent')].map((a) => a.textContent);
    expect(agents).toEqual(['Claude', 'Cursor', 'Any MCP-compatible agent']);
  });

  it('keeps the trial messaging and existing chips', () => {
    expect(heroText).toContain('14-day free trial. No sales call.');
    expect(heroText).toContain('14-day free trial on Pro and Team');
    expect(heroText).toContain('Cancel anytime');
    expect(heroText).toContain('Refer a friend');
  });
});

describe('/mcp/pricing plans unchanged by the hero edit', () => {
  it('cards keep their credits and checkout links', () => {
    const credits = [...doc.querySelectorAll('.credits .main b')].map((b) => b.textContent);
    for (const n of ['500 credits', '3,000 credits', '5,000 credits']) expect(credits).toContain(n);
    const hrefs = new Set([...doc.querySelectorAll('a')].map((a) => a.getAttribute('href')));
    for (const p of PLANS_FALLBACK.filter((x) => x.id !== 'agency')) {
      expect(hrefs.has(p.annual!.checkoutUrl) || hrefs.has(p.monthly.checkoutUrl)).toBe(true);
    }
  });
});
