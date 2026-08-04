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

  it('the STORY rides the identity line (dnaRow) as the ONE dominant genome strand', () => {
    // Eric 2026-08-04: the story is the top genome strand via dnaTop(o.dna,1) — grounded, strict
    // reveal (card = 1). No longer the ad-hoc o.repeat/o.sbf pick.
    expect(tmpl).toMatch(/var top = dnaTop\(o\.dna,1\)/);
    expect(tmpl).toMatch(/var story = top\.length \? top\[0\] : ''/);
  });
});

describe('Docs chip removed from the card (Eric: "Docs doesn\'t belong on the card")', () => {
  it('no "Docs" chip in the card body', () => {
    expect(card).not.toContain("<span class=\"chip docs\">Docs</span>");
    expect(card).not.toContain('o.docs?');
  });
});

describe('Ask Mindy removed for now (Eric 2026-08-03) — no doorway, drawer code dormant', () => {
  it('no Ask Mindy nav link (.zh-ask) in the header markup', () => {
    // the nav <a class="zh-ask" onclick="...openAskMindy..."> is gone (comment mentions are fine —
    // strip line comments before asserting the RENDERED markup is absent)
    const src = route.replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain("<a class=\"zh-ask\"");
    expect(src).not.toContain('openAskMindy()');
  });
  it('the focused-search panel renders NO "Ask Mindy" row (zsp-ask) in either state', () => {
    const src = route.replace(/^\s*\/\/.*$/gm, '');
    // both the renderDefault empty-state row and the renderAutocomplete row are gone
    expect(src).not.toContain('class="zsp-ask" data-act="ask"');
  });
  it('the drawer code is LEFT INTACT (dormant, re-attachable) — window.openAskMindy still defined', () => {
    // "for now" = hide the doorways, keep the engine; the drawer IIFE must still define openAskMindy
    expect(route).toContain('window.openAskMindy=function');
  });
});

describe('legend — tiny, bottom-left, TWO variants (horizons on Opportunity, entities on Network)', () => {
  it('the OPPORTUNITY variant lists the three horizons with their pin colors', () => {
    expect(tmpl).toContain('class="maplegend"');
    expect(tmpl).toMatch(/lg-opps[\s\S]{0,400}background:var\(--grnd\)"><\/i>Open/);
    expect(tmpl).toMatch(/background:var\(--recomp\)"><\/i>Recompete/);
    expect(tmpl).toMatch(/background:var\(--forecast\)"><\/i>Forecast/);
  });
  it('the NETWORK variant lists the two entities with their real pin colors (Eric: "add a Network legend variant instead of hiding")', () => {
    // contractors purple #7c3aed, gov buyers red #dc2626 — the contactColorFor pin colors
    expect(tmpl).toMatch(/lg-net[\s\S]{0,300}background:#7c3aed"><\/i>Contractors/);
    expect(tmpl).toMatch(/background:#dc2626"><\/i>Gov Buyers/);
  });
  it('is pinned bottom-left and SWAPS groups on body.is-network (never hides the whole legend)', () => {
    expect(tmpl).toMatch(/\.maplegend\{position:absolute;left:12px;bottom:12px/);
    // default: opps shown, net hidden; on network: opps hidden, net shown
    expect(tmpl).toContain('.maplegend .lg-net{display:none}');
    expect(tmpl).toContain('body.is-network .maplegend .lg-opps{display:none}');
    expect(tmpl).toContain('body.is-network .maplegend .lg-net{display:flex}');
    // the whole-legend hide rule is GONE (it's a swap now, not a hide)
    expect(tmpl).not.toContain('body.is-network .maplegend{display:none}');
  });
  it('setMapMode toggles body.is-network for the entity (Network) datasets', () => {
    expect(route).toContain("document.body.classList.toggle('is-network', isContactMode(mode))");
  });
  it('ships in the generated template-html.ts (not just source)', () => {
    // template-html.ts is a JS string literal → attribute quotes are backslash-escaped
    expect(tmplTs).toContain('class=\\"maplegend\\"');
    expect(tmplTs).toContain('Contractors'); // the Network variant reached the served file
  });
});
