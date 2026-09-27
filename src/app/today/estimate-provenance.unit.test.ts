/**
 * GUARD — /today must tell the truth about what is ESTIMATED.
 *
 * The featured cards lead with an M-Estimate (Mindy's own value estimate from comparable
 * past contracts — `intel_value_range`, NOT the government's IGCE and NOT a solicited value).
 * The footer used to say "Every number on this page is a live query … — nothing is estimated"
 * directly under those "Est." ranges, and a card whose estimate carried no basis label
 * rendered a bare dollar figure with nothing marking it as an estimate at all.
 *
 * Rule (repair board P1-B): Mindy distinguishes known / estimated / unknown. A dollar value
 * we estimated must always read as an estimate, and the page must never deny estimating.
 * The estimation METHOD is out of scope here — only its labelling.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src', 'app', 'today', 'route.ts'), 'utf8');
// Strip comments so an explanatory note that QUOTES the old copy can't satisfy or trip a check.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('/today estimate provenance', () => {
  it('never claims that nothing is estimated', () => {
    expect(code).not.toMatch(/nothing is estimated/i);
  });

  it('the footer names the estimate and says it is not a government figure', () => {
    const foot = code.match(/<div class="tfoot">([\s\S]*?)<\/div>/);
    expect(foot).not.toBeNull();
    const text = foot![1];
    expect(text).toMatch(/M-Estimate/);
    expect(text).toMatch(/not a government/i);
    expect(text).toMatch(/Est\./);
  });

  it('a card with no estimate basis still labels its dollar value as an estimate', () => {
    // The basis ternary's null branch must produce an estimate label, not ''.
    const stmt = code.match(/const basis = o\.estBasis\s*\?[\s\S]*?;/);
    expect(stmt).not.toBeNull();
    // The final `: <literal>;` of the statement is the estBasis-null branch.
    const m = stmt![0].match(/:\s*('[^']*'|`[^`]*`)\s*;$/);
    expect(m).not.toBeNull();
    const nullBranch = m![1].trim();
    expect(nullBranch).not.toBe("''");
    expect(nullBranch).toMatch(/Est\./);
  });

  it('the basis line is rendered unconditionally beneath the value', () => {
    expect(code).toMatch(/<div class="tc-basis">\$\{esc\(basis\)\}<\/div>/);
    expect(code).not.toMatch(/\$\{basis \? `<div class="tc-basis">/);
  });
});
