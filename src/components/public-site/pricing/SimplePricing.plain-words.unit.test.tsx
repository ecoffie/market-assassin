/**
 * /pricing plan cards and comparison table speak to a beginner: no unexplained GovCon jargon
 * (NAICS, recompete, incumbent, BD team, primes), and the two terms we keep link to the live
 * glossary pages. Renders the real SimplePricing component (the call site /pricing uses).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import SimplePricing from './SimplePricing';

const html = renderToStaticMarkup(<SimplePricing proCredits={1500} teamCredits={1000} forecastsLabel="33,000+" faqs={[]} />);
const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const cards = [...doc.querySelectorAll('section.cards')];
const table = doc.querySelector('section.cmp table');
const text = (els: Element[]) => els.map((e) => e.textContent ?? '').join(' ');

describe('/pricing: plain words for beginners', () => {
  it('renders the plan cards and the comparison table', () => {
    expect(cards).toHaveLength(1);
    expect(table).not.toBeNull();
  });

  it('drops the unexplained jargon phrases', () => {
    const all = text([...cards, table!]);
    for (const phrase of [
      'for your NAICS, keywords and agencies',
      'with the incumbent.',
      'BD teams',
      'whole BD team',
      'For primes,',
      'Unlimited NAICS codes and keywords',
      'Recompete alerts, 12 months out',
      'Incumbent visibility',
    ]) expect(all, phrase).not.toContain(phrase);
  });

  it('says what each term means in plain words', () => {
    const all = text([...cards, table!]);
    expect(all).toContain('the industries, keywords and agencies you choose');
    expect(all).toContain('the company that holds the contract now');
    expect(all).toContain('business development teams');
  });

  it('links NAICS and recompete to the glossary in the cards and the table', () => {
    for (const scope of [cards[0], table!]) {
      const hrefs = [...scope.querySelectorAll('a')].map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('/glossary/naics-code');
      expect(hrefs).toContain('/glossary/recompete');
    }
  });

  it('keeps the credit numbers unchanged', () => {
    const all = text([...cards, table!]);
    expect(all).toContain('1,500 credits / month');
    expect(all).toContain('1,000 credits / month, shared by the team');
  });
});
