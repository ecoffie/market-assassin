/**
 * Card badges carry UNIQUE per-card info, not a repeated dataset label (Eric/Zillow 2026-07-27).
 * The section header + the card's color strip already say the dataset, so repeating
 * "Open on SAM" / "Target" / "Company" / "Buyer" on every card is redundant. All 4 datasets:
 *   Open     → posted freshness ("Posted N days ago")
 *   Awarded  → the real award type ("IDIQ vehicle" / "Task order" / …)
 *   Company  → set-aside eligibility chips only (no "Company" label)
 *   Buyer    → no redundant "Buyer" label (role/agency is in the meta line)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const tmplTs = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');
const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// eval the template's cardBadge (pure over an opp row; TODAY needed by postedAgo).
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  let d = 0; for (let i = open; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(start, i + 1); } }
  throw new Error('unbalanced');
}
const cardBadge = new Function(
  // TODAY is anchored to local noon on a fixed calendar day so the freshness math is deterministic
  // (matches the template's live-TODAY-at-noon logic, just pinned for the test).
  `const TODAY=new Date(2026,6,27,12,0,0);${extractFn(tmpl, 'postedAgo')}${extractFn(tmpl, 'awardTypeBadge')}${extractFn(tmpl, 'cardBadge')}; return cardBadge;`,
)();

describe('cardBadge — unique per-card lead badge (Open + Awarded)', () => {
  it('Open card → posted freshness, NOT a repeated "Open on SAM"', () => {
    // relative to the pinned TODAY (Jul 27): Jul 24 = 3 days ago, Jul 27 = today.
    expect(cardBadge({ src: 'SAM', posted: '2026-07-24' })).toBe('Posted 3 days ago');
    expect(cardBadge({ src: 'SAM', posted: '2026-07-27' })).toBe('Posted today');
    expect(cardBadge({ src: 'SAM', posted: '' })).toBe(''); // no filler badge when undated
    expect(cardBadge({ src: 'SAM', posted: '2026-07-24' })).not.toContain('Open on SAM');
  });
  it('Awarded card → the real award TYPE, NOT a repeated "Target"', () => {
    expect(cardBadge({ src: 'RECOMPETE', contractType: 'DELIVERY ORDER' })).toBe('Task order');
    expect(cardBadge({ src: 'RECOMPETE', contractType: 'IDV_IDC' })).toBe('IDIQ vehicle');
    expect(cardBadge({ src: 'RECOMPETE', contractType: '' })).toBe(''); // blank, not "Target"
    expect(cardBadge({ src: 'RECOMPETE', contractType: 'PURCHASE ORDER' })).not.toContain('Target');
  });
});

describe('the repeated dataset chip is gone from every card', () => {
  it('template cardHTML no longer renders "chip ${o.src}">${SRCLABEL[o.src]}"', () => {
    // Neither the source NOR the served .ts may render the repeated dataset label on the card.
    expect(tmpl).not.toContain('chip ${o.src}">${SRCLABEL[o.src]}');
    expect(tmplTs).not.toContain('chip ${o.src}\\">${SRCLABEL[o.src]}'); // escaped form in the .ts
  });
  it('contactCard (Companies/Buyers) no longer hardcodes a "Company"/"Buyer" chip', () => {
    // Brace-match the fn body (not a fixed slice window) so a comment edit can't truncate it.
    const block = extractFn(routeSrc, 'contactCard');
    // set-aside chips remain (unique); the fixed dataset label is gone. Card-parity pass
    // (Eric 2026-07-28): the chips now render SOFT (matching the Open/Recompete chip family),
    // so setAsideChips is called with the soft flag.
    expect(block).not.toContain("(o.ctype==='buyers'?'Buyer':'Company')");
    expect(block).toContain('setAsideChips(o.setAsides,true)');
  });
});
