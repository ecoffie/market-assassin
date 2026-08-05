import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Opportunity DNA chip reveal (Eric 2026-08-04 "make the vocabulary visible" — strict progressive
// reveal). The card leads with ONE dominant genome strand on the identity line (dnaRow → dnaTop 1);
// the map-pin POPUP shows THREE grounded genome strands as a green ✓ chip row (dnaChips → dnaTop 3).
// Both draw from the SERVER-computed genome (o.dna) via the shared dnaTop() — the ONE source of
// truth — so no strand is fabricated (an opp with no genome shows no chips / no story).
//
// The legacy fitChips() (the old ad-hoc "Fits your NAICS · Repeat buyer · SB-friendly" row that read
// o.fits/o.repeat/o.sbf) is RETIRED from both surfaces — the card dropped it in the 2026-08-03
// identity redesign, and the popup swapped to dnaChips here.
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

describe('Opportunity DNA chip reveal', () => {
  it('the RESULT-LIST card carries neither the legacy fitChips row nor dnaChips (card = 1 strand, on dnaRow)', () => {
    const card = tmpl.slice(tmpl.indexOf('function cardHTML(o)'), tmpl.indexOf('function pass(o)'));
    expect(card).not.toContain('${fitChips(o)}'); // legacy row gone from the card
    expect(card).not.toContain('${dnaChips(o)}'); // the 3-strand row is popup-only (strict reveal)
    expect(card).toContain('${dnaRow(o)}');        // the card's ONE dominant strand rides here
  });

  it('the map-pin POPUP shows the deduped "Why this opportunity" chip row (whyChips), not the legacy fitChips', () => {
    const popup = tmpl.slice(tmpl.indexOf('function popupHTML(o)'), tmpl.indexOf('function dnaTop('));
    expect(popup).toContain('${whyChips(o)}'); // deduped chips under the "Why this opportunity" heading
    expect(popup).not.toContain('${fitChips(o)}');
    expect(popup).not.toContain('${pvSentence'); // the duplicate "Posted" sentence is gone from the popup
  });

  it('dnaChips renders up to THREE strands from the genome + a due chip, or nothing (no fabricated ✓)', () => {
    const fn = tmpl.slice(tmpl.indexOf('function dnaChips(o)'), tmpl.indexOf('function cardHTML(o)'));
    expect(fn).toMatch(/dnaTop\(o\.dna,3\)/);          // exactly the top 3 strands
    expect(fn).toMatch(/dueChip\(o\)/);                 // + the "Due in N Days" green check when soon
    // Empty genome AND no due chip → no row at all (the ternary returns '' when c is empty). An opp
    // with no strands but an imminent deadline still earns its urgency check — that's intended.
    expect(fn).toMatch(/c \? '<div class="fitrow">'\+c\+'<\/div>' : ''/);
    expect(fn).toContain('<div class="fitrow">');       // reuses the existing green-chip styling
  });

  it('dnaOrder is the shared sort (tier → priority RANK → good>watch>neutral); dnaTop guards + slices n', () => {
    const order = tmpl.slice(tmpl.indexOf('function dnaOrder('), tmpl.indexOf('function dnaTop('));
    expect(order).toMatch(/a\.tier-b\.tier/);                      // Tier-1 "can I win?" strands first
    expect(order).toMatch(/repeat_buyer:0/);                       // buyer trust leads the priority RANK
    expect(order).toMatch(/tone=\{good:0,watch:1,neutral:2\}/);    // a positive leads within a tier
    const top = tmpl.slice(tmpl.indexOf('function dnaTop('), tmpl.indexOf('function dnaRow('));
    expect(top).toMatch(/if\(!dna\|\|!dna\.length\) return \[\]/); // no genome → [] (never fabricates)
    expect(top).toMatch(/dnaOrder\(dna\)\.slice\(0,n\)/);          // exactly n, off the shared order
  });

  it('the check icon svg carries a viewBox (else the lucide 0-24 path clips)', () => {
    const fn = tmpl.slice(tmpl.indexOf('function dnaChips(o)'), tmpl.indexOf('function cardHTML(o)'));
    expect(fn).toMatch(/<svg class="fitic" viewBox="0 0 24 24">/);
  });
});
