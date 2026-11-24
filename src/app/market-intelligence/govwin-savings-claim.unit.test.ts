import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * /market-intelligence said "Save $700+/month vs. Deltek GovWin at every tier" and
 * "Deltek GovWin: $800-1,200/mo" / "Your Savings: 85%+". None of it had a source, and it
 * did not add up on its own terms: Team is $499/mo, so against $800-1,200/mo it saves
 * $301-701, not $700+; Enterprise is "Custom", so "every tier" cannot be shown at all.
 * The GovWin monthly figure also contradicted /compare/govwin ("$15,000–$50,000 a year").
 *
 * The page now makes no GovWin price or savings claim and links to /compare/govwin,
 * the one page that carries the GovWin comparison. The test reads the page source, so it
 * checks the rendered call site itself.
 */
const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('/market-intelligence GovWin comparison makes no unsourced savings claim', () => {
  it('drops the "$700+/month at every tier" claim', () => {
    expect(src).not.toMatch(/Save \$700\+/);
    expect(src).not.toMatch(/at every tier/);
  });

  it('drops the unsourced GovWin monthly price and the 85% savings figure', () => {
    expect(src).not.toMatch(/\$800-1,200\/mo/);
    expect(src).not.toMatch(/Your Savings: 85%/);
  });

  it('states no GovWin dollar figure anywhere in rendered copy', () => {
    const govwinLines = src
      .split('\n')
      .filter((l) => /GovWin/.test(l) && !/^\s*(\/\/|\/?\*|\{\/\*)/.test(l));
    expect(govwinLines.length).toBeGreaterThan(0);
    for (const line of govwinLines) expect(line).not.toMatch(/\$\s?\d/);
  });

  it('links to /compare/govwin for the side-by-side comparison', () => {
    expect(src).toMatch(/<Link\s+href="\/compare\/govwin"[^>]*>[\s\S]*?<\/Link>/);
  });
});
