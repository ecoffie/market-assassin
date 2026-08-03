import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Opportunity DNA — slice 1 (Eric 2026-08-03, tasks/EPIC-opportunity-dna.md).
// Two languages, never crossed: Identity = typography (agency word + one calm Landmark anchor);
// Behavior = a lucide ICON badge (SB-friendly), shown only when genuinely true. NO emoji.
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

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
    expect(tmpl).toMatch(/dnaRow[\s\S]{0,400}esc\(ag\)/);
  });

  it('BEHAVIOR = icon: SB-friendly rides as a lucide check badge, only when o.sbf is true', () => {
    // shown conditionally on the real signal, never unconditionally
    expect(tmpl).toMatch(/o\.sbf\s*\?[\s\S]{0,120}beh sbf[\s\S]{0,120}#dna-check/);
  });

  it('NO EMOJI in the DNA helpers (de-vibe rule: emoji→lucide)', () => {
    const dnaBlock = tmpl.slice(tmpl.indexOf('function lcHeader(o)'), tmpl.indexOf('function cardHTML(o)'));
    // no emoji codepoints (astral plane / common symbol ranges) in the DNA helper block
    expect(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(dnaBlock)).toBe(false);
  });

  it('SB-friendly is GROUNDED server-side: sbf = sapBuyerTier top band, OPEN opps only (never fabricated)', () => {
    expect(route).toContain("import { sapBuyerTier } from '@/lib/opportunities/sap-friendly-agencies'");
    // only the 'most' band earns it, and recompete/forecast are excluded (they carry a different model)
    expect(route).toMatch(/_sbf=\([^)]*_src!=='RECOMPETE'[\s\S]{0,80}sapBuyerTier\(p\.agency\)==='most'\)\?1:0/);
    // and it's threaded onto the pin object
    expect(route).toMatch(/est:p\.est\|\|0,sbf:_sbf/);
  });
});
