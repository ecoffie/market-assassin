/**
 * /pricing comparison table on a phone: the table is 640px wide, so at 390px the Team and
 * Enterprise columns start off-screen. A visitor must be told to swipe, and the feature names
 * must stay in view while they do. Renders the real SimplePricing component (the call site
 * /pricing uses) and checks the markup plus the shipped CSS.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import SimplePricing from './SimplePricing';

const html = renderToStaticMarkup(<SimplePricing proCredits={1500} teamCredits={1000} forecastsLabel="33,000+" faqs={[]} />);
const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const css = doc.querySelector('style')?.textContent ?? '';
const phoneBlock = css.match(/@media \(max-width:640px\)\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('/pricing: comparison table on a phone', () => {
  it('shows a swipe hint right above the scrolling table', () => {
    const hint = doc.querySelector('section.cmp .cmp-hint');
    expect(hint?.textContent).toBe('Swipe to compare Team and Enterprise →');
    expect(hint?.nextElementSibling?.classList.contains('cmp-scroll')).toBe(true);
  });

  it('labels the scroll area and lets keyboard users scroll it', () => {
    const scroller = doc.querySelector('section.cmp .cmp-scroll');
    expect(scroller?.getAttribute('role')).toBe('region');
    expect(scroller?.getAttribute('aria-describedby')).toBe('cmp-hint');
    expect(scroller?.getAttribute('tabindex')).toBe('0');
  });

  it('hides the hint on wide screens and shows it at phone width', () => {
    expect(css).toContain('.sp .cmp-hint{display:none;');
    expect(phoneBlock).toContain('.sp .cmp-hint{display:block}');
  });

  it('keeps the feature column pinned while the plan columns scroll', () => {
    expect(phoneBlock).toMatch(/\.sp \.cmp th\[scope=row\]\{position:sticky;left:0;[^}]*background:var\(--mp-surface\)/);
  });

  it('keeps each group heading in view while the plan columns scroll', () => {
    const groups = [...doc.querySelectorAll('section.cmp tr.grp th')];
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.querySelector('.gl')?.textContent).toBe(g.textContent);
    expect(phoneBlock).toContain('.sp .cmp .grp .gl{position:sticky;left:12px}');
  });

  it('still lists all three plans in the table header', () => {
    const heads = [...doc.querySelectorAll('section.cmp thead th[scope=col]')].map((t) => t.textContent);
    expect(heads.slice(1)).toEqual(['Pro', 'Team', 'Enterprise']);
  });
});
