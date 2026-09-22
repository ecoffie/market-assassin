/**
 * P4 — Open FIND ranks market relevance before deadline.
 *
 * Retrieval may still over-fetch on a broad candidate OR (keyword ∪ taxonomy).
 * These tests lock the RANKING contract: substring “it” is not IT evidence;
 * DIRECT/RELATED keep P3 semantics; deadline sorts only inside a tier.
 */
import { describe, it, expect } from 'vitest';
import { TOOL_CREDITS } from '@/lib/mcp/tool-registry';
import { interpretCapability, interpretMarket, classifyRecord } from './market-interpretation';
import {
  classifyOpenRecord,
  rankOpenRows,
  openCandidateOrExpr,
  openEvidenceWhy,
  OPEN_FETCH_CAP,
  type OpenClassifiable,
} from './open-relevance';
import { HOST_RULES_FIND_FIRST_VALUE } from './find-opportunities';

function rec(partial: OpenClassifiable): OpenClassifiable {
  return {
    title: '',
    description: '',
    naics_code: '',
    psc_code: '',
    solicitation_number: '',
    department: '',
    response_deadline: null,
    ...partial,
  };
}

const IT = () => interpretCapability('IT services');
const CYBER = () => interpretCapability('cybersecurity');
const CON = () => interpretCapability('construction');

describe('P4 Open relevance ranking', () => {
  it('1. VA IT: ceiling lift cannot outrank Enterprise QA Software', () => {
    const ceiling = rec({
      title: 'Unrestricted Solicitation Brand Name Only Guldmann Ceiling Lift System',
      description: 'This solicitation is issued with the intent to award.',
      naics_code: '339112',
      psc_code: '6515',
      response_deadline: '2026-09-18T04:59:00Z',
    });
    const qa = rec({
      title: 'DA10--NEW TO -Enterprise QA Software System & Repository',
      naics_code: '541519',
      psc_code: 'DA10',
      response_deadline: '2026-09-18T14:00:00Z',
    });
    expect(classifyOpenRecord(ceiling, IT())).toBe('WEAK_NON_MARKET');
    expect(classifyOpenRecord(qa, IT())).toBe('DIRECT_MATCH');
    const ranked = rankOpenRows([ceiling, qa], IT());
    expect(ranked[0].row.title).toMatch(/Enterprise QA/i);
    expect(ranked[0].cls).toBe('DIRECT_MATCH');
  });

  it('2. VA IT: carpet cleaning cannot outrank C&P Help Desk merely because it closes sooner', () => {
    const carpet = rec({
      title: 'CARPET CLEANING SVCS - SEATTLE VA REGIONAL OFFICE',
      description: 'In accordance with RFO items listed herein.',
      naics_code: '561740',
      psc_code: 'S214',
      response_deadline: '2026-09-18T12:00:00Z',
    });
    const help = rec({
      title: 'DA01-Compensation & Pension (C&P) Product Line Help Desk Tier 2',
      naics_code: '541512',
      psc_code: 'DA01',
      response_deadline: '2026-10-01T14:00:00Z',
    });
    expect(classifyOpenRecord(carpet, IT())).toBe('WEAK_NON_MARKET');
    expect(classifyOpenRecord(help, IT())).toBe('DIRECT_MATCH');
    const ranked = rankOpenRows([carpet, help], IT());
    expect(ranked[0].row.title).toMatch(/Help Desk/i);
  });

  it('3. “it” inside solicitation/with/city/fittings/items does not create DIRECT IT', () => {
    const cap = IT();
    const bait = [
      rec({ title: 'City fittings and items', description: 'Award in accordance with the solicitation.' }),
      rec({ title: 'Unrestricted Solicitation', description: 'Issued with items listed.' }),
      rec({ naics_code: '339112', title: 'Medical fittings', psc_code: '6515' }),
    ];
    for (const row of bait) {
      expect(classifyOpenRecord(row, cap)).toBe('WEAK_NON_MARKET');
    }
  });

  it('4. IT NAICS can create DIRECT for IT-services intent', () => {
    for (const code of ['541511', '541512', '541513', '541519']) {
      expect(classifyOpenRecord(rec({ title: 'Untitled', naics_code: code }), IT())).toBe('DIRECT_MATCH');
    }
  });

  it('5. IT PSC can preserve relevant software records outside the core NAICS set', () => {
    const distiller = rec({
      title: 'Pre-Solicitation Notice with Intent to Sole Source for DistillerSR',
      naics_code: '513210',
      psc_code: 'DA10',
      description: 'Software subscription in accordance with the solicitation.',
    });
    expect(classifyOpenRecord(distiller, IT())).toBe('DIRECT_MATCH');
    expect(distiller.naics_code).not.toMatch(/^54151/);
  });

  it('6. Cybersecurity + 541512 without cyber evidence remains RELATED, not DIRECT', () => {
    const row = rec({ title: 'Platform as a Service', naics_code: '541512', psc_code: 'DA01' });
    expect(classifyOpenRecord(row, CYBER())).toBe('RELATED_MARKET_CANDIDATE');
    expect(classifyOpenRecord(row, CYBER())).not.toBe('DIRECT_MATCH');
    expect(classifyRecord(row, CYBER())).toBe('RELATED_MARKET_CANDIDATE');
  });

  it('7. Physical security remains outside cyber', () => {
    const row = rec({
      title: 'Physical security doors and access control',
      naics_code: '541512',
    });
    expect(classifyRecord(row, CYBER())).toBeNull();
    expect(classifyOpenRecord(row, CYBER())).toBe('WEAK_NON_MARKET');
    expect(classifyOpenRecord(row, CYBER())).not.toBe('DIRECT_MATCH');
    expect(classifyOpenRecord(row, CYBER())).not.toBe('RELATED_MARKET_CANDIDATE');
  });

  it('8+9. Construction DIRECT stays DIRECT; deadline sorts inside the tier', () => {
    const later = rec({
      title: 'New barracks construction',
      naics_code: '236220',
      response_deadline: '2026-12-15T17:00:00Z',
    });
    const sooner = rec({
      title: 'Roof replacement',
      naics_code: '236220',
      response_deadline: '2026-09-18T17:00:00Z',
    });
    const unrelatedSoon = rec({
      title: 'Blood products',
      naics_code: '325413',
      response_deadline: '2026-09-17T18:00:00Z',
    });
    expect(classifyOpenRecord(sooner, CON())).toBe('DIRECT_MATCH');
    expect(classifyOpenRecord(later, CON())).toBe('DIRECT_MATCH');
    const ranked = rankOpenRows([later, unrelatedSoon, sooner], CON());
    expect(ranked.map((r) => r.row.title)).toEqual([
      'Roof replacement',
      'New barracks construction',
      'Blood products',
    ]);
    expect(ranked[0].cls).toBe('DIRECT_MATCH');
    expect(ranked[1].cls).toBe('DIRECT_MATCH');
    expect(ranked[2].cls).toBe('WEAK_NON_MARKET');
  });

  it('10. One FIND / 10 credits remains true', () => {
    expect(TOOL_CREDITS.find_opportunities).toBe(10);
  });

  it('11. Coming back / soon host contract is unchanged (one FIND, first value, no restart)', () => {
    expect(HOST_RULES_FIND_FIRST_VALUE.join('\n')).toMatch(/present this result immediately/i);
    expect(HOST_RULES_FIND_FIRST_VALUE.join('\n')).toMatch(/Open now, Coming back, Coming soon/);
  });

  it('12. P3 interpretation/provenance remains attached for VA IT and SOCOM cyber', () => {
    const va = interpretMarket('IT services', 'VA');
    expect(va.capability.kind).toBe('industry_preset');
    expect(va.capability.direct.naics).toEqual(['541511', '541512', '541513', '541519']);
    expect(va.retrieval_plan.related_market_applied).toBe(false);
    expect(va.buyer.parent_department_applied).toBe(false);

    const socom = interpretMarket('cybersecurity', 'SOCOM');
    expect(socom.capability.kind).toBe('cyber_with_related_it');
    expect(socom.retrieval_plan.related_market_applied).toBe(true);
    expect(socom.capability.related_market?.naics).toContain('541512');
    expect(socom.capability.direct.naics).not.toContain('541512');
    expect(socom.buyer.parent_department_applied).toBe(false);
  });
});

describe('Open retrieval expr (one path, no related-market manufacture)', () => {
  it('IT services ORs keyword recall with interpreted NAICS and DA/DB/DJ PSC prefixes', () => {
    const expr = openCandidateOrExpr('IT services', IT());
    expect(expr).toMatch(/naics_code\.eq\.541512/);
    expect(expr).toMatch(/naics_code\.eq\.541519/);
    expect(expr).toMatch(/psc_code\.like\.DA%/);
    expect(expr).toMatch(/psc_code\.like\.DB%/);
    expect(expr).toMatch(/psc_code\.like\.DJ%/);
    // recall may still contain the residue token; ranking must not treat it as DIRECT
    expect(expr).toMatch(/ilike\.%it%/i);
  });

  it('cyber Open retrieval uses DIRECT taxonomy only — not related 54151x', () => {
    const expr = openCandidateOrExpr('cybersecurity', CYBER());
    expect(expr).toMatch(/naics_code\.eq\.518210/);
    expect(expr).toMatch(/psc_code\.eq\.DJ01/);
    expect(expr).not.toMatch(/naics_code\.eq\.541512/);
  });

  it('construction retrieval includes the industry-preset prefixes', () => {
    const expr = openCandidateOrExpr('construction', CON());
    expect(expr).toMatch(/naics_code\.like\.236%/);
    expect(expr).toMatch(/naics_code\.like\.237%/);
    expect(expr).toMatch(/naics_code\.like\.238%/);
  });
});

describe('Open evidence why + fetch cap bound', () => {
  it('does not dump NAICS into the host-facing why', () => {
    expect(openEvidenceWhy('DIRECT_MATCH', 'IT services')).not.toMatch(/54151/);
    expect(openEvidenceWhy('RELATED_MARKET_CANDIDATE', 'cybersecurity')).toMatch(/not confirmed/i);
    expect(openEvidenceWhy('WEAK_NON_MARKET', 'IT services')).toMatch(/does not establish/i);
  });

  it('over-fetch cap is 500 — smallest of 100/200/500 that keeps Help Desk in the VA IT pool', () => {
    expect(OPEN_FETCH_CAP).toBe(500);
  });
});
