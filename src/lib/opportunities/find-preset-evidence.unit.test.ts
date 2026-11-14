/**
 * Ask Mindy Phase 1 (P1-D): an industry-preset code is retrieval, not evidence of the requested work.
 *
 * Found on production 2026-11-14: "janitorial services in Florida" returned "Bombing Range Operation"
 * (NAICS 561210 Facilities Support, PSC M1PZ) and "AFCAP VI" (561210, PSC S216) labelled
 * "Direct match — the record itself establishes relevance". Neither record mentions janitorial work.
 * They are still retrieved and shown, but as RELATED_MARKET_CANDIDATE with an honest reason.
 */
import { describe, it, expect } from 'vitest';
import { buildDiscoveryPlan, MCP_POLICY } from '@/lib/discovery';
import { interpretCapability } from './market-interpretation';
import { labelOpenRow } from './find-opportunities';
import { classifyComingBackEvidence, relatedCodeWhy } from './match-evidence';

const CTX = { today: '2026-11-14', fiscalYear: 2027 };
const plan = (q: string) => buildDiscoveryPlan({ query: q }, MCP_POLICY, CTX);
const open = (o: Record<string, unknown>) => ({ title: '', description: '', department: 'DEPT OF DEFENSE', solicitation_number: 'X1', response_deadline: '2026-12-01', ...o });

describe('janitorial interpretation', () => {
  it('only 561720 Janitorial Services is direct; the rest of the family is related market', () => {
    const cap = interpretCapability('janitorial services');
    expect(cap.direct.naics).toEqual(['561720']);
    expect(cap.related_market?.naics).toEqual(['561210', '561730']);
    expect(interpretCapability('custodial').direct.naics).toEqual(['561720']);
  });
  it('construction and IT services are unchanged (the family IS the work)', () => {
    expect(interpretCapability('construction').related_market).toBeNull();
    expect(interpretCapability('it services').related_market).toBeNull();
    expect(interpretCapability('construction').direct.naics.length).toBeGreaterThan(1);
  });
});

describe('Open: labels', () => {
  const p = plan('janitorial services');
  const cap = interpretCapability('janitorial services');
  it('the production Bombing Range row (561210, no janitorial text) is RELATED, never DIRECT', () => {
    const l = labelOpenRow(open({ title: 'Bombing Range Operation', naics_code: '561210', psc_code: 'M1PZ' }), p, cap);
    expect(l.cls).toBe('RELATED_MARKET_CANDIDATE');
    expect(l.basis[0]).toBe('related_market_code');
  });
  it('the Key West janitorial row (561720) stays DIRECT on code', () => {
    const l = labelOpenRow(open({ title: 'USCG Sector Key West Recurring Janitorial Services', naics_code: '561720', psc_code: 'S201' }), p, cap);
    expect(l.cls).toBe('DIRECT_MATCH');
  });
  it('a facilities-support notice that says janitorial in its text is DIRECT on text', () => {
    const l = labelOpenRow(open({ title: 'Base operations support', description: 'Includes janitorial services for 12 buildings', naics_code: '561210' }), p, cap);
    expect(l.cls).toBe('DIRECT_MATCH');
    expect(l.basis[0]).toBe('buy_side_text');
  });
  it('landscaping (561730) with no janitorial text is RELATED', () => {
    expect(labelOpenRow(open({ title: 'Grounds maintenance', naics_code: '561730' }), p, cap).cls).toBe('RELATED_MARKET_CANDIDATE');
  });
});

describe('Coming back: labels', () => {
  const p = plan('janitorial services');
  const cap = interpretCapability('janitorial services');
  const row = (o: Record<string, unknown>) => ({ incumbent_name: 'ACME LLC', awarding_agency: 'Department of Defense', awarding_sub_agency: null, description: '', psc_description: null, naics_description: null, ...o });
  it('a 561210 recompete with no janitorial text is RELATED (related_market_code), not DIRECT', () => {
    const e = classifyComingBackEvidence(row({ naics_code: '561210', description: 'Facilities operations' }) as never, p, cap);
    expect(e.cls).toBe('RELATED_MARKET_CANDIDATE');
    expect(e.basis[0]).toBe('related_market_code');
  });
  it('a 561720 recompete is DIRECT on code', () => {
    expect(classifyComingBackEvidence(row({ naics_code: '561720' }) as never, p, cap).cls).toBe('DIRECT_MATCH');
  });
  it('a related code the customer TYPED is direct evidence again', () => {
    const typed = plan('janitorial 561210');
    expect(classifyComingBackEvidence(row({ naics_code: '561210' }) as never, typed, cap).cls).toBe('DIRECT_MATCH');
  });
});

describe('why text', () => {
  it('names the family and says the record does not establish the work', () => {
    const w = relatedCodeWhy('janitorial services', { naics_code: '561210' });
    expect(w).toMatch(/NAICS 561210 Facilities Support Services/);
    expect(w).toMatch(/does not say it includes janitorial services/);
    expect(w).not.toMatch(/Direct match/);
  });
});
