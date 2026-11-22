/**
 * Default <head> for a plain /opportunity-map visit (no ?opp= share).
 *
 * Production-before (curl https://getmindy.ai/opportunity-map, 2026-11-22): `<title>Mindy Map</title>`
 * and NO meta description, canonical, og:* or twitter:* tags — shared links and search results
 * showed a bare card. The ?opp=<notice_id> share head must still win when it exists.
 */
import { describe, it, expect } from 'vitest';
import { applyMapHead, renderMapDefaultHead, MAP_DEFAULT_TITLE, MAP_DEFAULT_DESCRIPTION } from './share-metadata';
import { OPPORTUNITY_MAP_TEMPLATE } from '@/app/opportunity-map/template-html';

const ORIGIN = 'https://getmindy.ai';

describe('renderMapDefaultHead', () => {
  const head = renderMapDefaultHead(ORIGIN);
  it('carries title, description, canonical, og and twitter tags', () => {
    expect(head).toContain(`<title>${MAP_DEFAULT_TITLE}</title>`);
    expect(head).toContain(`<meta name="description" content="${MAP_DEFAULT_DESCRIPTION}">`);
    expect(head).toContain('<link rel="canonical" href="https://getmindy.ai/opportunity-map">');
    expect(head).toContain('<meta property="og:url" content="https://getmindy.ai/opportunity-map">');
    expect(head).toContain(`<meta property="og:title" content="${MAP_DEFAULT_TITLE}">`);
    expect(head).toContain(`<meta property="og:description" content="${MAP_DEFAULT_DESCRIPTION}">`);
    expect(head).toContain('<meta property="og:image" content="https://getmindy.ai/opengraph-image">');
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(head).toContain('<meta name="twitter:image" content="https://getmindy.ai/opengraph-image">');
  });
  it('names the three horizons the map actually shows, with no superlatives', () => {
    for (const label of ['Open Now', 'Coming Back', 'Coming Soon']) expect(MAP_DEFAULT_DESCRIPTION).toContain(label);
    expect(MAP_DEFAULT_DESCRIPTION).not.toMatch(/\b(best|most|fastest|only|#1|leading)\b/i);
    expect(MAP_DEFAULT_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });
});

// The route-level call site is covered in src/app/opportunity-map/share-metadata-route.unit.test.ts.
describe('applyMapHead', () => {
  it('replaces the bare template title with the default head on a plain visit', () => {
    const out = applyMapHead(OPPORTUNITY_MAP_TEMPLATE, null, ORIGIN);
    expect(out).not.toContain('<title>Mindy Map</title>');
    expect(out).toContain('<link rel="canonical" href="https://getmindy.ai/opportunity-map">');
    expect(out.match(/<title>/g)).toHaveLength(1);
  });
  it('lets the ?opp= share head win over the defaults', () => {
    const share = '<title>CES Hillside Mower</title><meta property="og:title" content="CES Hillside Mower">';
    const out = applyMapHead(OPPORTUNITY_MAP_TEMPLATE, share, ORIGIN);
    expect(out).toContain(share);
    expect(out).not.toContain(MAP_DEFAULT_TITLE);
    expect(out).not.toContain('rel="canonical" href="https://getmindy.ai/opportunity-map"');
  });
});
