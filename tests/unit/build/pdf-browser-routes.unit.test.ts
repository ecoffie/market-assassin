/**
 * Every route that renders a PDF in a headless browser must have the browser traced into its function
 * (next.config.ts outputFileTracingIncludes). @sparticuz/chromium ships the binary as archives nothing
 * require()s, so a route missing from that list fails at runtime only, on Vercel, with "the PDF could not be
 * produced right now" while Word/Excel/CSV still save (prod 2026-11-27: research-mode reports had no PDF
 * because create_document runs inside /api/app/chat; the last Vault PDF was Nov 22).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROMIUM = "['./node_modules/@sparticuz/chromium/bin/**/*']";

/** Routes that launch a browser for PDF output, and why. */
const PDF_ROUTES: Array<[route: string, why: string]> = [
  ['/api/app/chat', 'Ask Mindy research mode calls create_document (DocModel -> PDF) inside the chat function'],
  ['/api/app/documents/render', 'the document engine export route'],
  ['/reports/*/pdf', 'the hosted market report PDF download'],
  ['/api/gov-buyer/market-research/export/**/*', 'the Market Research memo export'],
  ['/api/cron/sync-dibbs/**/*', 'the DIBBS scraper'],
];

describe('build: every PDF-rendering route can reach a browser on Vercel', () => {
  const cfg = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
  for (const [route, why] of PDF_ROUTES) {
    it(`${route} (${why})`, () => {
      expect(cfg).toContain(`'${route}': ${CHROMIUM}`);
    });
  }

  it('the chat route gets the browser on its exact key only (not every chat sub-route)', () => {
    expect(cfg).not.toContain(`'/api/app/chat/**/*': ${CHROMIUM}`);
  });
});
