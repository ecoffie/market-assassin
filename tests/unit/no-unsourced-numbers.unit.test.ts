/**
 * No unsourced numbers on customer-facing copy (Eric, 2026-11-27: "remove unsourced numbers everywhere else too").
 *
 * A number shown to a customer is allowed only when it is (a) imported from src/lib/marketing-stats.ts (sourced,
 * rounded-down corpus counts), (b) computed from live data at render time, (c) a price or credit amount, (d) an
 * opportunity fact, or (e) an official threshold or figure with its source next to it. A hand-typed stat ("3,000+
 * every week", "$183B", "67% faster", "10x", "saves 20 hours") is not.
 *
 * This guard scans the copy of the surfaces swept on 2026-11-27 for a bare numeric claim (digits followed by +, %,
 * x, or a $ amount with B/M/K/T) in rendered text. Code, comments, CSS and template expressions are stripped first.
 * ALLOWED lists the exceptions, each with its reason: prices, product terms, and claims about GovCon Giants and
 * Eric held unchanged for Eric's decision. Adding to ALLOWED needs one of the reasons above.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Files swept, and the exact claims allowed in each (with the reason). */
const SURFACES: Record<string, Array<[claim: string, reason: string]>> = {
  'src/app/page.tsx': [],
  'src/app/mindy-landing/page.tsx': [
    ['$1,490', 'price (c): matches src/lib/mcp/packages.ts'],
    ['$1,788', 'price (c): twelve monthly Pro payments, the annual comparison'],
  ],
  'src/app/mindy-day/confirmed/page.tsx': [],
  'src/app/home-redesign/page.tsx': [
    ['5+', 'product deliverable (matched opportunities in the workshop), not a stat'],
    ['100%', '"100% Free Access": an offer term, not a stat'],
  ],
  'src/app/pricing/page.tsx': [
    ['33%', 'annual discount computed from prices (packages.ts)'],
    ['$15K', 'competitor price (GovWin): held for Eric’s decision'],
    ['$50K', 'competitor price (GovWin): held for Eric’s decision'],
  ],
  'src/components/public-site/pricing/UnifiedPricing.tsx': [
    ['17%', 'annual discount computed from prices'],
    ['10+', 'plan tier definition (Partners: 10+ users), not a stat'],
    ['$1,490', 'price (c): matches src/lib/mcp/packages.ts'],
  ],
  'src/app/agencies/[slug]/page.tsx': [],
  'src/app/agencies/page.tsx': [],
  'src/app/blog/[slug]/page.tsx': [
    ['$5,000', 'competitor price: held for Eric’s decision'],
    ['$25,000', 'official threshold cited next to it (FAR 5.101)'],
    ['45+', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['$50M', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['$500K', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['$50K', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['$250K', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['$40M', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['$4.2M', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['30%', 'worked example or audience descriptor in guidance copy, not a market stat'],
  ],
  'src/app/compare/govwin/page.tsx': [
    ['$15K', 'competitor price: held for Eric’s decision'],
    ['$15,000', 'competitor price: held for Eric’s decision'],
    ['$50,000+', 'competitor price: held for Eric’s decision'],
    ['$50,000', 'competitor price: held for Eric’s decision'],
    ['$1M', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['$50K', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['100+', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['50+', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['$50M', 'worked example or audience descriptor in guidance copy, not a market stat'],
  ],
  'src/app/compare/sam-gov/page.tsx': [
    ['$50M', 'worked example or audience descriptor in guidance copy, not a market stat'],
  ],
  'src/app/contractors/[slug]/contracts/[[...page]]/page.tsx': [],
  'src/app/contractors/page.tsx': [
    ['$1B', 'contract-size bucket label (a filter definition), not a stat'],
    ['$100M', 'contract-size bucket label (a filter definition), not a stat'],
    ['$10M', 'contract-size bucket label (a filter definition), not a stat'],
    ['$1M', 'contract-size bucket label (a filter definition), not a stat'],
  ],
  'src/app/glossary/[slug]/page.tsx': [],
  'src/app/glossary/page.tsx': [],
  'src/app/lifetime/page.tsx': [
    ['$4,997', 'price (c): the Founders Lifetime offer price itself'],
    ['$1,490', 'price (c): matches src/lib/mcp/packages.ts'],
  ],
  'src/app/mcp/about/page.tsx': [],
  'src/app/naics/[code]/page.tsx': [],
  'src/app/start/page.tsx': [],
  'src/app/set-asides/8a/page.tsx': [
    ['51%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['$850K', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['$400K', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['$6.5M', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
  ],
  'src/app/set-asides/hubzone/page.tsx': [
    ['10%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['35%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['3%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['51%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['$1M', 'worked example or audience descriptor in guidance copy, not a market stat'],
    ['$100K', 'worked example or audience descriptor in guidance copy, not a market stat'],
  ],
  'src/app/set-asides/page.tsx': [
    ['35%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['10%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['51%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
  ],
  'src/app/set-asides/sdvosb/page.tsx': [
    ['51%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['100%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
  ],
  'src/app/set-asides/wosb/page.tsx': [
    ['51%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['$850K', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['$400K', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['$6.5M', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
    ['5%', 'official figure in the page’s cited eligibility/statute text (SBA, 15 U.S.C.)'],
  ],
  'src/lib/send-email.ts': [],
  'src/lib/briefings/recompete/email-templates.ts': [],
  'src/components/public-site/pricing/faqs.ts': [
    ['17%', 'annual discount computed from prices'],
    ['33%', 'annual discount computed from prices'],
    ['$15,000+', 'competitor price: held for Eric’s decision'],
    ['$1,490', 'price (c): matches src/lib/mcp/packages.ts'],
    ['$1,788', 'price (c): twelve monthly Pro payments'],
    ['$4,027', 'price (c): matches src/lib/mcp/packages.ts'],
    ['$5,988', 'price (c): twelve monthly Team payments'],
  ],
};

/** Rendered copy only: drop comments, imports, className/style attributes, CSS blocks and ${...}/{...} expressions. */
function copyOf(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/^import .*$/gm, ' ')
    .replace(/\b(?:className|class|style|href|src|key|id|width|height|cellpadding|cellspacing|border|bgcolor|aria-[a-z]+|data-[a-z-]+)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    // CSS declarations inside template strings (border-radius:50%; width:100%)
    .replace(/[a-z-]+\s*:\s*[^;{}\n'"`]*%[^;{}\n'"`]*;?/gi, ' ')
    .replace(/\$\{[^}]*\}/g, ' ');
}

/** A bare numeric claim: 3,000+ / 67% / 10x / $183B / $2M. */
const CLAIM = /(?<![\w.#-])(?:\$\d[\d,.]*\s*(?:[BMKT]\b|billion|million|trillion)|\d[\d,.]*\+(?![\d+])|\d[\d,.]*%|\d+x\b|\$\d{1,3}(?:,\d{3})+\+?)/g;

describe('no unsourced numbers on swept customer-facing surfaces', () => {
  for (const [file, allowed] of Object.entries(SURFACES)) {
    it(file, () => {
      const text = copyOf(readFileSync(join(process.cwd(), file), 'utf8'));
      const found = [...new Set(text.match(CLAIM) ?? [])].map((s) => s.trim());
      const ok = new Set(allowed.map(([c]) => c));
      expect(found.filter((c) => !ok.has(c)), 'unsourced number claims (wire to marketing-stats, cite an official source, or rewrite without the number)').toEqual([]);
    });
  }

  it('no hand-typed GovWin price comparison ratio; the VA note points to SBA VetCert, not the retired CVE', () => {
    const govwin = readFileSync(join(process.cwd(), 'src/app/compare/govwin/page.tsx'), 'utf8');
    expect(govwin).not.toMatch(/\b\d+% of the (?:price|cost)\b/);
    const agency = readFileSync(join(process.cwd(), 'src/app/agencies/[slug]/page.tsx'), 'utf8');
    expect(agency).not.toMatch(/\bCVE verified\b/);
    expect(agency).toContain('veterans.certify.sba.gov');
  });

  it('no claims about GovCon Giants or Eric on these pages (Eric, 2026-11-28: "remove the GovCon Giants claims too")', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
    expect(read('src/app/home-redesign/page.tsx')).not.toMatch(/Awards Won|Students Trained/);
    expect(read('src/app/mindy-landing/page.tsx')).not.toMatch(/contractors using Mindy|9,900/);
    expect(read('src/app/mcp/about/page.tsx')).not.toMatch(/\b\d+ years of\b/);
    expect(read('src/app/lifetime/page.tsx')).not.toMatch(/legacy course|paid \$4,997|lifetime course access cost|stay longer/);
  });

  it('corpus counts on these pages come from marketing-stats.ts, not hand-typed', () => {
    const s = readFileSync(join(process.cwd(), 'src/app/mindy-landing/page.tsx'), 'utf8');
    expect(s).toContain("from '@/lib/marketing-stats'");
    expect(s).not.toMatch(/(?:88|90),000\+|33,000\+/);
  });
});
