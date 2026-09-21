import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A CITATION MAKES A CLAIM LOOK GROUNDED. Do not attach one to something that is not.
 *
 * Two failures of that rule, both measured 2026-08-23:
 *
 * 1. recompete "Why vulnerable (displacement angle)" was a canned sentence chosen by
 *    Math.random(), rendered beside real researched fields (incumbent, contract value,
 *    timing signal) in a briefing that attaches sources: ['USASpending','GovConWire',
 *    'SAM.gov']. A reader has every reason to believe it came from analysing THEIR contract.
 *    It never did. Two contractors looking at the same recompete also saw different
 *    "analysis" on different runs, because nothing about the contract drove the choice.
 *
 * 2. bid-gates returned HTTP 200 + success: true with generic structural gates when the
 *    solicitation extraction FAILED. The user clears "can you perform this scope of work?",
 *    believes the document was read, and invests a proposal cycle in a bid that may require
 *    a CMMC level or vehicle they do not hold.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the displacement angle no longer poses as analysis', () => {
  const SRC = strip(read('src/lib/briefings/recompete/ai-generator.ts'));

  it('does not pick the fallback at random', () => {
    // Same contract, same answer. Random variation presented as insight is noise wearing a
    // finding's clothes.
    expect(SRC).not.toMatch(/angles\[Math\.floor\(Math\.random\(\)/);
    expect(SRC).toContain('stableIndex(');
  });

  it('keys the choice off the contract, so it is reproducible', () => {
    expect(SRC).toMatch(/stableIndex\(`\$\{contract\.naicsCode\}/);
  });

  it('labels the fallback as a general pattern, not a finding about this award', () => {
    // The prefix is the whole point: the guidance is still useful, it just stops claiming to
    // be specific to a contract it never examined.
    expect(SRC).toContain('General pattern for this industry (not specific to this award)');
  });
});

describe('bid-gates says when it could not read the solicitation', () => {
  const SRC = strip(read('src/app/api/app/proposal/bid-gates/route.ts'));

  it('no longer swallows the extraction failure silently', () => {
    // Was: `} catch { /* fall through with the structural gates */ }`
    expect(SRC).not.toMatch(/\} catch \{\s*\}/);
    expect(SRC).toContain('derivationFailed = true');
  });

  it('flags the response so the UI can say which half is missing', () => {
    expect(SRC).toContain('analysisDegraded: true');
    expect(SRC).toContain('structural only');
  });

  it('still returns 200 — the structural gates are real and worth keeping', () => {
    // Deliberately NOT a 502 like /api/analyst/bid-no-bid. Set-aside and deadline gates do
    // not depend on the document, so failing the whole response would discard real output.
    expect(SRC).toContain('success: true');
  });
});
