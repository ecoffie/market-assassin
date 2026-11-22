import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contractor profile pages and the compare pages sent visitors to /pricing with a
 * button that read "Start for free". /pricing starts a 14-day free trial that asks
 * for a card, so "for free" over-promised (live /contractors/deloitte-and-touche-llp
 * at 390px showed "Start for free ->" above the fold, 2026-11-22). The site header
 * and /mindy-landing already say "Start 14-day free trial"; these buttons now match.
 *
 * The test reads each page's source and checks every <Link href="/pricing"> label,
 * so it covers the call sites themselves, not a helper.
 */
const APP = join(__dirname, '..');

const PAGES: Array<{ file: string; pricingLinks: number }> = [
  { file: 'contractors/[slug]/page.tsx', pricingLinks: 1 },
  { file: 'contractors/[slug]/agencies/page.tsx', pricingLinks: 1 },
  { file: 'contractors/[slug]/contracts/[[...page]]/page.tsx', pricingLinks: 1 },
  { file: 'contractors/[slug]/naics/page.tsx', pricingLinks: 1 },
  { file: 'compare/page.tsx', pricingLinks: 1 },
  { file: 'compare/[competitor]/page.tsx', pricingLinks: 2 }, // plus one 'See pricing'
  { file: 'compare/govwin/page.tsx', pricingLinks: 2 },
  { file: 'compare/sam-gov/page.tsx', pricingLinks: 2 },
];

/**
 * Text content of every <Link href="/pricing" ...>LABEL</Link> in a source file,
 * minus the neutral "See pricing" secondary button on /compare/[competitor].
 */
function pricingLinkLabels(source: string): string[] {
  return [...source.matchAll(/<Link\s+href="\/pricing"[^>]*>([\s\S]*?)<\/Link>/g)].map((m) =>
    m[1].replace(/\s+/g, ' ').trim(),
  ).filter((label) => label !== 'See pricing');
}

describe('public /pricing buttons name the 14-day trial, not "free"', () => {
  for (const { file, pricingLinks } of PAGES) {
    const src = readFileSync(join(APP, file), 'utf8');

    it(`${file}: no "Start for free" copy`, () => {
      expect(src).not.toMatch(/Start for free/i);
    });

    it(`${file}: every /pricing button says "Start 14-day free trial"`, () => {
      const labels = pricingLinkLabels(src);
      expect(labels).toHaveLength(pricingLinks);
      for (const label of labels) {
        expect(label).toMatch(/^Start 14-day free trial( →)?$/);
      }
    });
  }
});
