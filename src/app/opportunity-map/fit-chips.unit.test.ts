import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Fit chips — the green ✓ row "Fits your NAICS · Repeat buyer · SB-friendly", each shown ONLY when
// its real flag is true. As of 2026-08-03 (Eric "identity → story → estimate") the RESULT-LIST CARD
// no longer carries this row — the Repeat/SB story moved UP onto the identity line (dnaRow) and a
// chip row below would just repeat it. fitChips now lives on the map-pin POPUP (popupHTML) only.
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const mapRoute = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const apiRoute = readFileSync(join(__dirname, '../api/app/opportunity-map/route.ts'), 'utf8');

describe('Opportunity fit chips', () => {
  it('the RESULT-LIST card no longer renders the fitChips row (story moved to the identity line)', () => {
    const card = tmpl.slice(tmpl.indexOf('function cardHTML(o)'), tmpl.indexOf('function pass(o)'));
    expect(card).not.toContain('${fitChips(o)}'); // gone from the result-list card
  });

  it('fitChips still renders on the map-pin POPUP (popupHTML), not the card', () => {
    const popup = tmpl.slice(tmpl.indexOf('function popupHTML(o)'), tmpl.indexOf('function cardHTML(o)'));
    expect(popup).toContain('${fitChips(o)}'); // the popup keeps the fit-chip row
  });

  it('each chip is CONDITIONAL on its real flag — never unconditional (no fabricated ✓)', () => {
    expect(tmpl).toMatch(/if\(o\.fits\)\s+c\+=.*Fits your NAICS/);
    expect(tmpl).toMatch(/if\(o\.repeat\)\s+c\+=.*Repeat buyer/);
    expect(tmpl).toMatch(/if\(o\.sbf\)\s+c\+=.*SB-friendly/);
    // an empty row (no true flags) yields no markup at all
    expect(tmpl).toMatch(/return c\?'<div class="fitrow">'\+c\+'<\/div>':''/);
  });

  it('the check icon svg carries a viewBox (else the lucide 0-24 path clips)', () => {
    expect(tmpl).toMatch(/<svg class="fitic" viewBox="0 0 24 24">/);
  });

  it('fits is GROUNDED server-side: set only when scope=profile resolved real profileNaics (honest-null)', () => {
    // the API only flags fits when the user's profile codes are present
    expect(apiRoute).toMatch(/if\s*\(!profileNaics\.length\s*\|\|\s*!n\)\s*return false/);
    // 6-digit exact, shorter = prefix (the app convention)
    expect(apiRoute).toMatch(/pc\.length\s*>=\s*6\s*\?\s*pc\s*===\s*n\s*:\s*n\.startsWith\(pc\)/);
    // and it's threaded onto each pin + through the client card object
    expect(apiRoute).toMatch(/fits:\s*fitsPin\(pin\.naics\)/);
    expect(mapRoute).toMatch(/est:p\.est\|\|0,sbf:_sbf,fits:!!p\.fits/);
  });
});
