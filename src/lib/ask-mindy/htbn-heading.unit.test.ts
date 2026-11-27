/** The literal "How They Buy Now" section (Agent 4 production retest, 2026-11-27): rules and detector. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOW_THEY_BUY_NOW, HTBN_HEADING, htbnHeadingMissing } from './how-they-buy-now';
import { CREATE_DOCUMENT_TOOL_DEF } from '@/lib/chat/generate-document-tool';

describe('How They Buy Now heading', () => {
  it('the report order names a section titled exactly "How They Buy Now" right after the Summary, in both engines', () => {
    expect(HTBN_HEADING).toBe('How They Buy Now');
    expect(HOW_THEY_BUY_NOW).toMatch(/Report order: 1 Summary \(the answer and the ranked moves\) · 2 a level-1 section titled exactly "How They Buy Now"/);
    expect(JSON.stringify(CREATE_DOCUMENT_TOOL_DEF)).toMatch(/Summary \(the answer and the ranked moves\), then a level-1 section titled exactly 'How They Buy Now'/);
  });
  it('detector: two or more report sections and no exact heading', () => {
    const s = (...h: string[]) => h.map((heading) => ({ heading }));
    expect(htbnHeadingMissing(s('Summary', 'Where the money is moving', 'Pathways and examples'))).toBe(true);
    expect(htbnHeadingMissing(s('Summary', 'how they buy now ', 'Where the money is moving', 'Pathways'))).toBe(false);
    expect(htbnHeadingMissing(s('Summary', 'Action plan'))).toBe(false);
    expect(htbnHeadingMissing(s('How the government buys now', 'Readiness checklist', 'Action plan'))).toBe(true);
    expect(htbnHeadingMissing(undefined)).toBe(false);
  });
  it('research turns create the document tool with the one-retry heading check', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/app/chat/route.ts'), 'utf8');
    expect(src).toMatch(/\.\.\.\(researchTurn \? \{ retryForHeading: true \} : \{\}\),/);
  });
});
