/**
 * historical-context + market-overview key their market/incumbent/agency claims on PSC ("what was
 * bought") when available, not the broad NAICS (Eric 2026-08-03 — the BOP APX-radio case: NAICS
 * 541519 "IT services" surfaced Dell/Leidos $1.7B IT contracts as the "history"; PSC 5820 surfaces
 * TRIBALCO/Motorola/L3Harris RADIOS — the real market). PSC REPLACES the NAICS filter (never ANDs),
 * with a NAICS fallback when the PSC set is too thin. Live-verified: PSC vs NAICS diverge (radio
 * primes vs IT primes; 20 agencies vs 64).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const hist = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const overview = readFileSync(join(__dirname, '../../market-overview/route.ts'), 'utf8');
const liveOpp = readFileSync(join(__dirname, '../../../../lib/utils/live-opportunities.ts'), 'utf8');
const liveOppRoute = readFileSync(join(__dirname, '../live-opportunities/route.ts'), 'utf8');

describe('historical-context — PSC-first scope', () => {
  it('the USASpending filter scopes on PSC (psc_codes) OR NAICS — PSC REPLACES NAICS, not ANDs', () => {
    expect(hist).toContain("(byPsc && psc)");
    expect(hist).toContain("{ psc_codes: [String(psc).toUpperCase()] }");
    expect(hist).toContain("{ naics_codes: { require: [naics] } }");
  });
  it('POST accepts psc + tries PSC-first, falls back to NAICS when the PSC history is thin (<5)', () => {
    expect(hist).toContain('const { title, agency, naics, office, psc } = body');
    expect(hist).toContain('if (awards.length >= 5) scopeUsed = \'psc\'');
    expect(hist).toContain("if (scopeUsed !== 'psc')");
  });
  it('the response says HONESTLY which key drove the history (metadata.scope)', () => {
    expect(hist).toContain('scope: scopeUsed');
    expect(hist).toMatch(/scope: 'psc' \| 'naics'/);
  });
  it('the drawer caller threads the opp PSC through (LiveOpportunity.psc ← SAM classificationCode)', () => {
    expect(liveOpp).toContain('psc: opportunity.psc,');
    expect(liveOpp).toMatch(/psc: string;\s*\/\/ SAM classificationCode/);
    expect(liveOppRoute).toContain("psc: opp.classificationCode || ''");
  });
});

describe('market-overview — agency count keys on PSC when the market is PSC-driven', () => {
  it('agencyCount scopes on PSC (psc_codes) when supplied, NAICS otherwise — with a thin-PSC fallback', () => {
    expect(overview).toContain('async function agencyCount(codes: string[], psc?: string | null)');
    expect(overview).toContain('{ psc_codes: [String(psc).toUpperCase()] }');
    expect(overview).toContain('{ naics_codes: codes }');
    expect(overview).toContain('if (psc && n < 2 && codes.length) return agencyCount(codes, null)');
  });
  it('PSC is used ONLY when specific + dominant (topPscPct ≥ 40%) — the keywordCoverage gate', () => {
    expect(overview).toContain("(coverage.topPscPct ?? 0) >= 0.40) ? coverage.topPsc.code : null");
    expect(overview).toContain('agencyCount(codes, agencyPsc)');
  });
});
