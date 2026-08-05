import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Opportunity DNA — slice 1 (Eric 2026-08-03, tasks/EPIC-opportunity-dna.md).
// Two languages, never crossed: Identity = typography (agency word + one calm Landmark anchor);
// Behavior = a lucide ICON badge (SB-friendly), shown only when genuinely true. NO emoji.
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const apiRoute = readFileSync(join(__dirname, '../api/app/opportunity-map/route.ts'), 'utf8');

describe('Opportunity DNA — identity system on the card', () => {
  it('lifecycle is the CATEGORY HEADER (lcHeader), not a chip in crow1', () => {
    expect(tmpl).toContain('function lcHeader(o)');
    // header carries the three horizons with their own colors
    expect(tmpl).toMatch(/lchdr\.open/);
    expect(tmpl).toMatch(/lchdr\.recomp/);
    expect(tmpl).toMatch(/lchdr\.fore/);
    // the old source/"Target" chip (cardBadge) was removed from the card's crow1 row
    const cardFn = tmpl.slice(tmpl.indexOf('function cardHTML(o)'), tmpl.indexOf('function pass(o)'));
    expect(cardFn).not.toContain('cardBadge(o)');
  });

  it('IDENTITY = typography: dnaRow renders the agency word with a Landmark anchor (no per-agency icon/color)', () => {
    expect(tmpl).toContain('function dnaRow(o)');
    // the agency label is emitted as text (esc(ag)); the ONE anchor icon is the shared Landmark
    expect(tmpl).toMatch(/agid[\s\S]{0,120}#dna-landmark/);
    expect(tmpl).toMatch(/function dnaRow\(o\)[\s\S]{0,900}esc\(ag\)/);
  });

  it('IDENTITY prefers the SUB-agency over the parent department (Eric: "sub-agency instead of agency")', () => {
    // dnaRow reads o.subAgency first, falling back to o.agency only when it is empty.
    expect(tmpl).toMatch(/var ag = \(o\.subAgency && String\(o\.subAgency\)\.trim\(\)\)/);
    // both fields reach the card object clean()'d in the client toRow
    expect(route).toMatch(/subAgency:clean\(p\.subAgency\|\|''\)/);
    // and the API pin carries sub_tier as subAgency
    expect(apiRoute).toMatch(/subAgency:\s*\(r\.sub_tier as string\)/);
  });

  it('STORY = the ONE dominant genome strand on the identity line, never a pile (strict reveal card=1)', () => {
    // Eric 2026-08-04: the card's single DNA story now comes from the GROUNDED genome (o.dna) via
    // dnaTop(o.dna,1) — the strongest strand (tier then good>watch>neutral), NOT an ad-hoc
    // o.repeat/o.sbf pick. dnaTop is the ONE source of truth (mirrors server topStrands); the card
    // shows exactly one. Empty genome → [] → the line is just the identity (never a fabricated story).
    expect(tmpl).toMatch(/var top = dnaTop\(o\.dna,1\)/);
    expect(tmpl).toMatch(/var story = top\.length \? top\[0\] : ''/);
    // rendered as a "·"-prefixed story span only when a story exists (never a fabricated badge)
    expect(tmpl).toMatch(/story \? '<span class="story">[\s\S]{0,80}middot/);
  });

  it('NO EMOJI in the DNA helpers (de-vibe rule: emoji→lucide)', () => {
    const dnaBlock = tmpl.slice(tmpl.indexOf('function lcHeader(o)'), tmpl.indexOf('function cardHTML(o)'));
    // no emoji codepoints (astral plane / common symbol ranges) in the DNA helper block
    expect(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(dnaBlock)).toBe(false);
  });

  it('SB-friendly is GROUNDED SERVER-SIDE — sapBuyerTier runs in the API, NOT in the client toRow', () => {
    // sapBuyerTier is a SERVER lib. Calling it from the client toRow throws a ReferenceError in the
    // browser → toRow throws → the open horizon .map() rejects → "Open: 0" while Open returns 5,170.
    // So the server computes sbf on the pin; the client only reads it.
    expect(apiRoute).toContain("import { sapBuyerTier } from '@/lib/opportunities/sap-friendly-agencies'");
    // sbf is computed server-side from sapBuyerTier === 'most'. (Refactored 2026-08-04 into a `const
    // sbf =` so the value can also feed computeGenome — same computation, no longer inline in the
    // object literal. The guard is: sapBuyerTier(pin.agency) === 'most' ? 1 : 0 exists in the API.)
    expect(apiRoute).toMatch(/sbf\s*=\s*sapBuyerTier\(pin\.agency\)\s*===\s*'most'\s*\?\s*1\s*:\s*0/);
    // the client route must NOT import or CALL sapBuyerTier — only read the pre-computed p.sbf
    expect(route).not.toContain("import { sapBuyerTier }");
    expect(route).not.toMatch(/sapBuyerTier\([^)]*\)===/); // no live call (comments referencing the name are fine)
    expect(route).toMatch(/_sbf=\([^)]*_src!=='RECOMPETE'[\s\S]{0,80}p\.sbf\)\?1:0/);
    expect(route).toMatch(/est:p\.est\|\|0,estN:p\.estN\|\|0,estLow:p\.estLow\|\|0,estHigh:p\.estHigh\|\|0,estRange:p\.estRange\|\|'',sbf:_sbf/);
  });
});
