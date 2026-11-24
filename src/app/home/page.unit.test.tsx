/**
 * Homepage phone card "Contracts coming back" (the hero-swipe timeline, shown only under 620px).
 *
 * It rendered "RFP posted · 4–2 months before the contract ends": a backwards range, and the
 * documented recompete rule is RFP 2–4 months before expiration (docs/agents/product-and-tools.md,
 * the same rule /recompetes/[slug] states). The stage names were also never explained.
 *
 * Renders the real page component so the test covers the call site, not just the string.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/public-site/PublicHeader', () => ({ default: () => null }));
vi.mock('./HomeTrialClicks', () => ({ default: () => null }));

import HomePage from './page';

function timelineItems(html: string): { label: string; detail: string }[] {
  const start = html.indexOf('How a contract comes back');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf('</a>', start);
  const card = html.slice(start, end);
  return [...card.matchAll(/<span class="tli"><b>([^<]+)<\/b><small>([^<]+)<\/small><\/span>/g)].map((m) => ({
    label: m[1],
    detail: m[2],
  }));
}

describe('homepage "How a contract comes back" card', () => {
  const html = renderToStaticMarkup(<HomePage />);
  const items = timelineItems(html);

  it('renders the four stages', () => {
    expect(items.map((i) => i.label)).toEqual([
      'Agency forecast',
      'Sources sought / RFI',
      'Pre-solicitation',
      'RFP posted',
    ]);
  });

  it('never shows a backwards month range', () => {
    expect(html).not.toContain('4–2 months');
    for (const { detail } of items) {
      for (const m of detail.matchAll(/(\d+)–(\d+) months/g)) {
        expect(Number(m[1]), detail).toBeLessThan(Number(m[2]));
      }
    }
  });

  it('states the documented RFP window: 2–4 months before the contract ends', () => {
    expect(items[3].detail).toContain('2–4 months before the contract ends');
  });

  it('explains each stage in plain English before its timing', () => {
    expect(items.map((i) => i.detail)).toEqual([
      'The agency’s buying plan · 6–18 months before the solicitation',
      'Agency asks who can do it · 6–12 months before the RFP',
      'Notice that bids are coming · 3–6 months before the RFP',
      'Request for proposals · 2–4 months before the contract ends',
    ]);
  });
});
