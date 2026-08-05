/**
 * The Decision Card hero (Eric 2026-08-03, "i love this one"): the open-opp list card leads with the
 * M-Estimate — a clean number, like a Zillow price — and NOTHING else competes with it. This test
 * locks the two things that make it TRUSTWORTHY, the exact bugs that would poison the M-Estimate brand:
 *
 *   1. NO FABRICATED NUMBER. When there's no grounded estimate (o.est falsy — the ≥8-comps-or-nothing
 *      contract from value-range.ts), the hero shows the branded "Estimate Pending", never a $0/made-up
 *      figure. estMoney() returns '' for n<=0 / non-finite; cardHero() maps '' → Estimate Pending.
 *   2. The number LEADS. cardHero renders at the top of .cbody, BEFORE the badge row + title, so the
 *      estimate is the first thing the eye lands on.
 *
 * Asserts on the SHIPPED template (source of truth) + the generated served copy (they must agree —
 * the pre-push template-sync gate enforces that, this pins the hero specifically).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const gen = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');

// Pull estMoney's body out of the template so we can exercise the real formatter logic.
function extractEstMoney(): (n: unknown) => string {
  const start = tmpl.indexOf('function estMoney(n){');
  expect(start, 'estMoney must exist in template.html').toBeGreaterThan(-1);
  // estMoney is a self-contained 5-line function; slice to its closing brace before the next
  // comment/function, so the extracted body is exactly estMoney (not the following cardHero).
  const end = tmpl.indexOf("return '$'+Math.round(n);}", start) + "return '$'+Math.round(n);}".length;
  const body = tmpl.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return estMoney;`)() as (n: unknown) => string;
}

describe('Decision Card hero — the number leads, honest when it cannot', () => {
  const estMoney = extractEstMoney();

  it('estMoney NEVER fabricates: <=0 / non-finite / null → empty string (→ Estimate Pending)', () => {
    for (const bad of [0, -1, -5000, NaN, Infinity, -Infinity, null, undefined, '' as unknown]) {
      expect(estMoney(bad), `estMoney(${String(bad)}) must be ''`).toBe('');
    }
  });

  it('estMoney formats real medians like the map pin (K/M/B, tabular)', () => {
    expect(estMoney(4_900_000)).toBe('$4.9M');
    expect(estMoney(540_000)).toBe('$540K');
    expect(estMoney(1_200_000)).toBe('$1.2M');
    expect(estMoney(2_000_000)).toBe('$2M');       // clean boundary, no ".0"
    expect(estMoney(1_800_000_000)).toBe('$1.8B');
    expect(estMoney(950)).toBe('$950');
  });

  it('cardHero shows "Estimate Pending" (branded, no number) when the estimate is not grounded', () => {
    // The open/forecast branch maps a falsy estMoneyExact → the pending block, never a $0.
    expect(tmpl).toMatch(/estMoneyExact\(o\.est\)[\s\S]{0,360}Estimate Pending/);
    expect(gen).toContain('Estimate Pending');
  });

  it('the card uses the EXACT formatter (matches the drawer hero) — Eric 2026-08-04 "I like the exact number better"', () => {
    // Sub-$1M shows the full figure ($479,084) instead of estMoney's rounded $479K, so the rail card
    // + popup card equal the drawer. >=$1M stays $X.XM (the drawer's fmtM does the same). The tiny
    // map-PIN bubble keeps the compact mMoney/estMoney (a full number overflows a map label).
    const s = tmpl.indexOf('function estMoneyExact(n){');
    expect(s, 'estMoneyExact must exist').toBeGreaterThan(-1);
    const body = tmpl.slice(s, tmpl.indexOf('}', tmpl.indexOf('toLocaleString()', s)) + 1);
    // eslint-disable-next-line no-new-func
    const estMoneyExact = new Function(`${body}; return estMoneyExact;`)() as (n: unknown) => string;
    expect(estMoneyExact(479_084)).toBe('$479,084');   // EXACT sub-$1M (was $479K) — matches the drawer
    expect(estMoneyExact(540_000)).toBe('$540,000');   // exact, with thousands separators
    expect(estMoneyExact(2_200_000)).toBe('$2.2M');    // >=$1M abbreviates, same as the drawer
    expect(estMoneyExact(1_800_000_000)).toBe('$1.8B');
    expect(estMoneyExact(0)).toBe('');                 // never fabricates → Estimate Pending
    expect(estMoneyExact(-5)).toBe('');
    // cardHero (the rail + popup card) calls the EXACT formatter; the pin bubble does NOT.
    const heroFn = tmpl.slice(tmpl.indexOf('function cardHero(o){'), tmpl.indexOf('function dueDate(o)'));
    expect(heroFn).toContain('estMoneyExact(o.est)');
  });

  it('the ≈ is the ONLY qualifier on a grounded card (estimate, not a quoted price) — no label', () => {
    // The hero carries the approximately-sign glyph and NO "M-Estimate" label text on the card.
    expect(tmpl).toContain('<span class="apx">≈ </span>');
    // The card hero block itself must not print the "M-Estimate" branding (that lives in the listing).
    const heroFn = tmpl.slice(tmpl.indexOf('function cardHero(o){'), tmpl.indexOf('function dueDate(o)'));
    expect(heroFn).not.toContain('M-Estimate');
  });

  it('DNA order — identity first, size second: lifecycle → identity (dnaRow) → estimate (cardHero) → title', () => {
    // Opportunity DNA (Eric 2026-08-03): the card leads with IDENTITY (agency typography), then the
    // estimate, then the title. The lifecycle category header (lcHeader) opens the whole card.
    const body = tmpl.slice(tmpl.indexOf('return `${lcHeader(o)}<div class="cstrip"'), tmpl.indexOf('function pass(o)'));
    const lcIdx = body.indexOf('${lcHeader(o)}');
    const dnaIdx = body.indexOf('${dnaRow(o)}');
    const heroIdx = body.indexOf('${cardHero(o)}');
    const rowIdx = body.indexOf('<div class="crow1">');
    const titleIdx = body.indexOf('<div class="ctitle">');
    expect(lcIdx).toBeGreaterThan(-1);
    expect(lcIdx).toBeLessThan(dnaIdx);     // lifecycle header opens the card, before identity
    expect(dnaIdx).toBeGreaterThan(-1);
    expect(heroIdx).toBeGreaterThan(-1);
    expect(dnaIdx).toBeLessThan(heroIdx);   // identity leads the body, then the estimate
    expect(heroIdx).toBeLessThan(rowIdx);
    expect(heroIdx).toBeLessThan(titleIdx);
  });

  it('RECOMPETE cards lead with the REAL contract value (o.value), not an ≈ estimate', () => {
    // A recompete is an awarded contract — its number is a firm value, so no ≈ and no M-Estimate.
    const heroFn = tmpl.slice(tmpl.indexOf('function cardHero(o){'), tmpl.indexOf('function dueDate(o)'));
    expect(heroFn).toMatch(/o\.src===['"]RECOMPETE['"][\s\S]{0,260}o\.value/);
  });
});
