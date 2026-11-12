/**
 * Every trial button on /pricing carries the "All sales final · No refunds" line right under it
 * (Eric 2026-11-10: "right next to all sales"; 2026-11-12: "add the no refunds line under each trial
 * button"). The note was lost once when /pricing was rebuilt as SimplePricing — this keeps it.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import SimplePricing from './SimplePricing';
import { PRO_TRIAL_ANNUAL, PRO_TRIAL_MONTHLY, SALES_URL, TEAM_TRIAL_ANNUAL, TEAM_TRIAL_MONTHLY } from './app-plan-links';

const html = renderToStaticMarkup(<SimplePricing proCredits={1500} teamCredits={1000} forecastsLabel="33,000+" faqs={[]} />);
const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const trialHrefs = new Set([PRO_TRIAL_ANNUAL, PRO_TRIAL_MONTHLY, TEAM_TRIAL_ANNUAL, TEAM_TRIAL_MONTHLY]);

describe('/pricing: no-refund line under each trial button', () => {
  const trialButtons = [...doc.querySelectorAll('a.cta')].filter((a) => trialHrefs.has(a.getAttribute('href') ?? ''));

  it('finds the four trial buttons (two plan cards, two in the comparison table)', () => {
    expect(trialButtons).toHaveLength(4);
  });

  it('puts the note directly under every trial button', () => {
    for (const a of trialButtons) {
      const next = a.nextElementSibling;
      expect(next?.hasAttribute('data-no-refund-note'), a.outerHTML).toBe(true);
      expect(next?.textContent).toContain('All sales final · No refunds');
    }
  });

  it('does not put it under "Speak to sales" (no money changes hands there)', () => {
    const sales = [...doc.querySelectorAll('a.cta')].filter((a) => a.getAttribute('href') === SALES_URL);
    expect(sales.length).toBeGreaterThan(0);
    for (const a of sales) expect(a.nextElementSibling?.hasAttribute('data-no-refund-note') ?? false).toBe(false);
  });
});
