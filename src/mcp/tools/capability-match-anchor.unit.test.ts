/**
 * capability_market_match capability-anchoring (FM-U10, Eric/QA 2026-07-29). For a HARDWARE maker
 * (EOD tools) the lead NAICS resolved to 561210 Facilities Support (67% by $ — base-ops contracts that
 * merely MENTION EOD), dragging vocabulary to LOGCAP/KBR and recompetes to facilities. Fix: when the
 * coverage is PSC-pinned, source vocab from the PSC; and pick the lead NAICS as the top NAICS that
 * ISN'T a generic services catch-all — so it lands on the real product code (verified live: 332993
 * Ammunition Mfg, vocab = "small diameter bomb / propelling charges", 10 competitors via NAICS fallback).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'capability-market-match.ts'), 'utf8');

describe('FM-U10 source assertions', () => {
  it('has a generic-services skip set so the lead NAICS avoids facilities-support catch-alls', () => {
    expect(src).toContain('GENERIC_SERVICES');
    expect(src).toContain("'561210'"); // Facilities Support — the exact culprit
  });
  it('sources vocabulary from the PSC when the coverage is PSC-pinned', () => {
    expect(src).toMatch(/isPscPinned && pinnedPsc[\s\S]*getVocabulary\(pinnedPsc, \{ codeType: 'psc'/);
  });
  it('falls back to a NAICS competitor search when the keyword search is empty', () => {
    expect(src).toMatch(/competitorsResolved/);
    expect(src).toMatch(/searchContractors\(\{ naics: leadNaics/);
  });
});

// Pure-logic mirror of the lead-NAICS anchoring.
describe('lead-NAICS anchoring logic (mirror)', () => {
  const GENERIC = new Set(['561210', '561990', '541990', '561499', '541611', '541618']);
  const pickLead = (allNaics: Array<{ code: string }>, pinned: boolean) => {
    const nonGeneric = allNaics.find((n) => !GENERIC.has(n.code))?.code;
    return pinned ? (nonGeneric ?? allNaics[0]?.code) : allNaics[0]?.code;
  };
  it('PSC-pinned: skips 561210 to the real product code', () => {
    const naics = [{ code: '561210' }, { code: '332993' }, { code: '334511' }];
    expect(pickLead(naics, true)).toBe('332993');
  });
  it('not pinned: keeps the promoted lead as-is (unchanged behavior)', () => {
    const naics = [{ code: '541512' }, { code: '541519' }];
    expect(pickLead(naics, false)).toBe('541512');
  });
  it('pinned but ALL generic: falls back to the top (no non-generic exists)', () => {
    const naics = [{ code: '561210' }, { code: '561990' }];
    expect(pickLead(naics, true)).toBe('561210');
  });
});
