/**
 * P3 market interpretation — buyer normalization vs capability expansion.
 */
import { describe, it, expect } from 'vitest';
import {
  interpretMarket,
  interpretCapability,
  resolveBuyerIdentity,
  classifyRecord,
  CYBER_DIRECT_RE,
  PHYSICAL_SECURITY_RE,
  dualBuyerOrExpr,
  plainEnglishInterpretation,
} from './market-interpretation';

describe('buyer normalization is not expansion', () => {
  it('SOCOM / USSOCOM / U.S. Special Operations Command are the same buyer', () => {
    const a = resolveBuyerIdentity('SOCOM');
    const b = resolveBuyerIdentity('USSOCOM');
    expect(a.kind).toBe('normalization');
    expect(b.kind).toBe('normalization');
    expect(a.canonical).toMatch(/Special Operations Command/i);
    expect(b.canonical).toBe(a.canonical);
    expect(a.parent_department_applied).toBe(false);
    const blob = [...a.needles, ...b.needles].join(' ').toUpperCase();
    expect(blob).toMatch(/SOCOM/);
    expect(blob).toMatch(/USSOCOM/);
    expect(blob).toMatch(/SPECIAL OPERATIONS COMMAND/);
  });

  it('never adds Department of Defense when the customer said SOCOM', () => {
    const needles = resolveBuyerIdentity('SOCOM').needles.map((n) => n.toUpperCase());
    expect(needles.some((n) => n === 'DEPARTMENT OF DEFENSE' || n === 'DEPT OF DEFENSE' || n === 'DOD')).toBe(false);
    expect(needles.join(' ')).not.toMatch(/\bPENTAGON\b/);
  });

  it('dual-column buyer expr hits awarding_agency OR awarding_sub_agency', () => {
    const expr = dualBuyerOrExpr('awarding_agency', 'awarding_sub_agency', resolveBuyerIdentity('SOCOM').needles);
    expect(expr).toMatch(/awarding_agency\.ilike/);
    expect(expr).toMatch(/awarding_sub_agency\.ilike/);
  });
});

describe('capability: cybersecurity is not all IT and not physical security', () => {
  it('cybersecurity gets direct cyber taxonomy plus labeled related IT market', () => {
    const cap = interpretCapability('cybersecurity');
    expect(cap.kind).toBe('cyber_with_related_it');
    expect(cap.direct.naics).toEqual(['518210']);
    expect(cap.direct.psc).toEqual(['DJ01', 'DJ10']);
    expect(cap.related_market?.naics).toEqual(['541511', '541512', '541513', '541519']);
    expect(cap.direct.naics).not.toContain('541512');
  });

  it('physical security does not enter the cyber market', () => {
    const cap = interpretCapability('physical security');
    expect(cap.kind).toBe('literal');
    expect(cap.related_market).toBeNull();
    expect(cap.direct.naics).toEqual([]);
    expect(cap.excluded.some((e) => /physical security/i.test(e.phrase))).toBe(true);
    expect(PHYSICAL_SECURITY_RE.test('access-control doors')).toBe(true);
    expect(CYBER_DIRECT_RE.test('physical security')).toBe(false);
  });

  it('bare “security” is not cybersecurity', () => {
    const cap = interpretCapability('security');
    expect(cap.kind).toBe('literal');
    expect(cap.related_market).toBeNull();
  });

  it('IT-coded row without cyber evidence is RELATED, never DIRECT', () => {
    const cap = interpretCapability('cybersecurity');
    expect(
      classifyRecord(
        { title: 'Platform as a Service', naics_code: '541519', description: '', incumbent_name: 'NexTech' },
        cap,
      ),
    ).toBe('RELATED_MARKET_CANDIDATE');
    expect(
      classifyRecord(
        { title: 'Generic IT support', naics_code: '541512', description: '', psc_code: null },
        cap,
      ),
    ).toBe('RELATED_MARKET_CANDIDATE');
  });

  it('direct cyber code or text is DIRECT_MATCH', () => {
    const cap = interpretCapability('cybersecurity');
    expect(classifyRecord({ title: 'Hosting', naics_code: '518210' }, cap)).toBe('DIRECT_MATCH');
    expect(classifyRecord({ title: 'Cybersecurity Support Services', naics_code: '541519' }, cap)).toBe('DIRECT_MATCH');
    expect(classifyRecord({ title: 'IT support', psc_code: 'DJ01', naics_code: '541512' }, cap)).toBe('DIRECT_MATCH');
  });

  it('160th SOAR (aviation regiment) is not a cyber SIEM/SOAR signal', () => {
    const cap = interpretCapability('cybersecurity');
    expect(
      classifyRecord(
        {
          title: 'LOCKHEED MARTIN CORPORATION',
          naics_code: '561990',
          description: 'PROVIDE LMR SUPPORT SERVICES TO USASOAC, SOATB, SIMO, AND 160TH SOAR',
        },
        cap,
      ),
    ).toBeNull();
  });

  it('physical-security language on an IT-coded row is excluded from the cyber market', () => {
    const cap = interpretCapability('cybersecurity');
    expect(
      classifyRecord(
        { title: 'Physical security doors and access control', naics_code: '541512' },
        cap,
      ),
    ).toBeNull();
  });
});

describe('interpretMarket contract', () => {
  it('records requested phrase, direct taxonomy, related expansion, and unsupported dims', () => {
    const m = interpretMarket('cybersecurity', 'SOCOM');
    expect(m.customer_phrase).toBe('cybersecurity');
    expect(m.buyer.requested).toBe('SOCOM');
    expect(m.buyer.parent_department_applied).toBe(false);
    expect(m.retrieval_plan.related_market_applied).toBe(true);
    expect(m.truth.what_was_expanded.join(' ')).toMatch(/IT Services/);
    expect(m.truth.what_was_consumed.join(' ')).toMatch(/cybersecurity/);
    expect(plainEnglishInterpretation(m)).toMatch(/not as confirmed cyber/i);
    expect(plainEnglishInterpretation(m)).toMatch(/same buyer/i);
    expect(plainEnglishInterpretation(m)).not.toMatch(/54151/);
  });

  it('construction uses the Construction preset with no related IT expansion', () => {
    const m = interpretMarket('construction', 'Army');
    expect(m.capability.kind).toBe('industry_preset');
    expect(m.capability.direct.naics).toEqual(['236', '237', '238']);
    expect(m.retrieval_plan.related_market_applied).toBe(false);
  });
});
