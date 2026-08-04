/**
 * Eric 2026-08-03, three asks on the Explore map:
 *  1. LEGEND — tiny, bottom-left: ● Open · ● Recompete · ● Forecast ("people love legends").
 *  2. REMOVE "Docs" from the result card ("Docs doesn't belong on the card").
 *  3. Card reads IDENTITY → STORY → ESTIMATE, not database → estimate → title. So the order is
 *     lcHeader (OPEN NOW) → dnaRow (Army · Repeat Buyer) → cardHero (≈ $8.2M) → title → location →
 *     facts. The estimate no longer CARRIES identity; the story rides the identity line.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const tmplTs = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

const card = tmpl.slice(tmpl.indexOf('function cardHTML(o)'), tmpl.indexOf('function pass(o)'));

describe('card order — identity → story → estimate (not database → estimate → title)', () => {
  it('the render order is lcHeader → dnaRow → cardHero → title → location → facts', () => {
    const iHeader = card.indexOf('${lcHeader(o)}');
    const iDna    = card.indexOf('${dnaRow(o)}');
    const iHero   = card.indexOf('${cardHero(o)}');
    const iTitle  = card.indexOf('<div class="ctitle">');
    const iLoc    = card.indexOf('<div class="cmeta">');
    const iStats  = card.indexOf('<div class="stats">');
    // every anchor present
    [iHeader, iDna, iHero, iTitle, iLoc, iStats].forEach((x) => expect(x).toBeGreaterThan(-1));
    // strictly increasing → identity (dnaRow) BEFORE estimate (cardHero) BEFORE title/loc/facts
    expect(iHeader).toBeLessThan(iDna);
    expect(iDna).toBeLessThan(iHero);   // identity before estimate — the whole point
    expect(iHero).toBeLessThan(iTitle);
    expect(iTitle).toBeLessThan(iLoc);
    expect(iLoc).toBeLessThan(iStats);
  });

  it('the STORY rides the identity line (dnaRow), so the estimate does not carry identity', () => {
    // strongest-signal story, folded into dnaRow (repeat beats sb-friendly)
    expect(tmpl).toMatch(/var story = o\.repeat \? 'Repeat Buyer' : \(o\.sbf \? 'SB-friendly' : ''\)/);
  });
});

describe('Docs chip removed from the card (Eric: "Docs doesn\'t belong on the card")', () => {
  it('no "Docs" chip in the card body', () => {
    expect(card).not.toContain("<span class=\"chip docs\">Docs</span>");
    expect(card).not.toContain('o.docs?');
  });
});

describe('horizon legend — tiny, bottom-left, gated to the Opportunity map', () => {
  it('markup lists the three horizons with their pin colors', () => {
    expect(tmpl).toContain('class="maplegend"');
    expect(tmpl).toMatch(/background:var\(--grnd\)"><\/i>Open/);
    expect(tmpl).toMatch(/background:var\(--recomp\)"><\/i>Recompete/);
    expect(tmpl).toMatch(/background:var\(--forecast\)"><\/i>Forecast/);
  });
  it('is pinned bottom-left and hidden on the Network map', () => {
    expect(tmpl).toMatch(/\.maplegend\{position:absolute;left:12px;bottom:12px/);
    expect(tmpl).toContain('body.is-network .maplegend{display:none}');
  });
  it('setMapMode toggles body.is-network for the entity (Network) datasets', () => {
    expect(route).toContain("document.body.classList.toggle('is-network', isContactMode(mode))");
  });
  it('ships in the generated template-html.ts (not just source)', () => {
    // template-html.ts is a JS string literal → attribute quotes are backslash-escaped
    expect(tmplTs).toContain('class=\\"maplegend\\"');
  });
});
