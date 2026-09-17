/**
 * PATHWAY FIT v0 — red-team / unit tests (docs/PRD-pathway-fit-v0.md §11).
 */
import { describe, it, expect } from 'vitest';
import {
  matchCompanyToPathwaysPure,
  scoreCapabilityOverlap,
  stripEvidenceSide,
} from './pathway-fit-match';
import {
  caiConstruction,
  caiSocomCyber,
  caiVaIt,
  caiWithSetAside,
  companyCyberRelevant,
  companyNoAwards,
  companyUnrelatedConstruction,
} from './pathway-fit-fixtures';
import type { CaiPackageSlim, CompanyPublicRecord, PathwayDoorFit } from './pathway-fit-types';

function door(result: ReturnType<typeof matchCompanyToPathwaysPure>, kind: string): PathwayDoorFit {
  const d = result.doors.find((x) => x.door === kind);
  if (!d) throw new Error(`missing door ${kind}`);
  return d;
}

function positive(d: PathwayDoorFit): boolean {
  return d.determination === 'SUPPORTED_FIT' || d.determination === 'POSSIBLE_FIT';
}

const BANNED = [/you will win/i, /qualified to win/i, /you can bid this vehicle/i, /they will pick you/i];

describe('PATHWAY FIT red-team (PRD killers)', () => {
  it('1. Certification with no restricted buyer-side acquisition does NOT create set-aside fit', () => {
    const cai = caiSocomCyber(); // no set_aside observed
    const company = companyCyberRelevant();
    const r = matchCompanyToPathwaysPure(cai, company);
    const sa = door(r, 'set_aside');
    expect(positive(sa)).toBe(false);
    expect(sa.determination).toBe('NOT_APPLICABLE');
    expect(sa.proof_missing.some((m) => m.code === 'socioeconomic_restriction_absent')).toBe(true);
    // cert may appear as additional_advantage on other positive doors
    const withAdv = r.doors.filter((d) => positive(d) && d.additional_advantages.length > 0);
    expect(withAdv.length).toBeGreaterThan(0);
  });

  it('2. Vehicle + related awards, no verified hold → POSSIBLE_FIT not SUPPORTED', () => {
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), companyCyberRelevant());
    const idv = door(r, 'idv_task_order');
    expect(idv.determination).toBe('POSSIBLE_FIT');
    expect(idv.proof_missing.some((m) => m.code === 'vehicle_access_unverified')).toBe(true);
    expect(idv.why_this_fit || '').toMatch(/teaming/i);
    expect(idv.why_this_fit || '').not.toMatch(/you can bid this vehicle/i);
  });

  it('3. CSO + related awards, no demo → POSSIBLE_FIT', () => {
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), companyCyberRelevant());
    const cso = door(r, 'cso');
    expect(cso.determination).toBe('POSSIBLE_FIT');
    expect(cso.proof_missing.some((m) => m.code === 'demonstrable_product_unestablished')).toBe(true);
  });

  it('4. CAI PAE NOT_YET_MEASURABLE → matcher cannot promote', () => {
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), companyCyberRelevant());
    const pae = door(r, 'pae_portfolio');
    expect(pae.determination).toBe('NOT_ESTABLISHED');
    expect(pae.proof_missing.some((m) => m.code === 'cai_door_not_yet_measurable')).toBe(true);
    expect(positive(pae)).toBe(false);
  });

  it('5. Relevant company awards with no buyer-side observed door → no positive fit', () => {
    const cai: CaiPackageSlim = {
      scope: { agency: 'USSOCOM', capability: 'cybersecurity', naics: ['541512'], keywords: ['cyber'] },
      pathways: { observed: [], potential_not_established: [{ kind: 'pae_portfolio' }] },
    };
    const r = matchCompanyToPathwaysPure(cai, companyCyberRelevant());
    expect(r.summary.no_proven_door).toBe(true);
    expect(r.summary.supported_count + r.summary.possible_count).toBe(0);
  });

  it('6. Buyer has multiple doors but company has no relevant public proof → NO_PROVEN_DOOR', () => {
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), companyNoAwards());
    // cert alone without set-aside observed → still no proven door from awards
    expect(r.summary.no_proven_door).toBe(true);
  });

  it('7. Owner-asserted Vault outcome cannot upgrade determination', () => {
    const company = companyCyberRelevant();
    const without = matchCompanyToPathwaysPure(caiSocomCyber(), company, { include_owner_asserted: false });
    const withOwner = matchCompanyToPathwaysPure(caiSocomCyber(), company, { include_owner_asserted: true });
    expect(door(without, 'idv_task_order').determination).toBe(door(withOwner, 'idv_task_order').determination);
    expect(door(without, 'cso').determination).toBe(door(withOwner, 'cso').determination);
    expect(withOwner.owner_asserted_context?.shown).toBe(true);
    expect(withOwner.owner_asserted_context?.disclaimer).toMatch(/does not upgrade/i);
  });

  it('8. Removing either buyer or company evidence drops positive determination', () => {
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), companyCyberRelevant());
    expect(positive(door(r, 'idv_task_order'))).toBe(true);
    const noBuyer = stripEvidenceSide(r, 'buyer');
    expect(positive(door(noBuyer, 'idv_task_order'))).toBe(false);
    const noCompany = stripEvidenceSide(r, 'company');
    expect(positive(door(noCompany, 'idv_task_order'))).toBe(false);
  });
});

describe('PATHWAY FIT additional killers', () => {
  it('changing a CAI door to NYM prevents positive fit for that door', () => {
    const cai = caiSocomCyber({
      pathways: {
        observed: [
          {
            kind: 'conventional_solicitation',
            established: true,
            statement: 'conventional',
            citations: [
              {
                source_kind: 'sam_opportunities',
                source_id: 'x',
                locator: 'x',
                as_of: null,
              },
            ],
          },
        ],
        potential_not_established: [{ kind: 'cso' }, { kind: 'pae_portfolio' }],
      },
    });
    const r = matchCompanyToPathwaysPure(cai, companyCyberRelevant());
    expect(positive(door(r, 'cso'))).toBe(false);
    expect(door(r, 'cso').determination).toBe('NOT_ESTABLISHED');
  });

  it('owner assertion cannot upgrade POSSIBLE → SUPPORTED', () => {
    const company = companyCyberRelevant({
      owner_asserted: { claimed_demo_ready: true, claimed_vehicles: ['SEWP V'], outcomes: ['$2M saved'] },
    });
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), company, { include_owner_asserted: true });
    expect(door(r, 'cso').determination).toBe('POSSIBLE_FIT');
    expect(door(r, 'idv_task_order').determination).toBe('POSSIBLE_FIT');
  });

  it('large award amount alone cannot increase capability-quality strength', () => {
    const tiny: CompanyPublicRecord = companyCyberRelevant({
      awards: [
        {
          id: 'tiny',
          title: 'misc supplies',
          agency: 'GSA',
          naics: '339999',
          amount: 1,
          startDate: '2024-01-01',
          endDate: '2024-06-01',
          description: 'office supplies',
        },
      ],
    });
    const huge: CompanyPublicRecord = companyCyberRelevant({
      awards: [
        {
          id: 'huge',
          title: 'misc supplies',
          agency: 'GSA',
          naics: '339999',
          amount: 999_999_999,
          startDate: '2024-01-01',
          endDate: '2024-06-01',
          description: 'office supplies',
        },
      ],
    });
    const cai = caiSocomCyber();
    expect(scoreCapabilityOverlap(tiny, cai).level).toBe(scoreCapabilityOverlap(huge, cai).level);
  });

  it('self-certified status cannot be silently presented as authoritative', () => {
    const r = matchCompanyToPathwaysPure(caiWithSetAside(['SDVOSB']), companyCyberRelevant());
    const sa = door(r, 'set_aside');
    expect(sa.determination).toBe('POSSIBLE_FIT');
    expect(sa.proof_missing.some((m) => m.code === 'cert_self_identified_not_authoritative')).toBe(true);
    for (const p of sa.proof_to_lead_with) {
      expect(p.label.toLowerCase()).toMatch(/self-identified|authoritative/);
      if (/sdvosb/i.test(p.label)) expect(p.label).toMatch(/self-identified/i);
    }
  });

  it('no positive fit produces valid NO_PROVEN_DOOR', () => {
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), companyNoAwards());
    expect(r.summary.no_proven_door).toBe(true);
    expect(r.summary.headline).toMatch(/enough public evidence/i);
    expect(r._next).toHaveLength(1);
  });

  it('pf_rank_v1: set-aside does not outrank better-supported vehicle/conventional/CSO', () => {
    const company = companyCyberRelevant({
      certifications: [
        { code: 'SDVOSB', label: 'SDVOSB', provenance_state: 'sba', authoritative: true },
      ],
    });
    const r = matchCompanyToPathwaysPure(caiWithSetAside(['SDVOSB']), company);
    const positiveDoors = r.doors.filter(positive);
    expect(positiveDoors.length).toBeGreaterThan(1);
    const top = positiveDoors[0];
    expect(top.door).not.toBe('set_aside');
    const sa = door(r, 'set_aside');
    expect(sa.rank.components.set_aside_opener_penalty).toBe(5);
    expect(top.rank.score).toBeGreaterThanOrEqual(sa.rank.score);
  });

  it('_next is exactly one question', () => {
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), companyCyberRelevant());
    expect(r._next).toHaveLength(1);
    expect(r._next[0].prompt.length).toBeGreaterThan(10);
  });

  it('banned host phrases absent from why_this_fit / safe_next_actions', () => {
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), companyCyberRelevant());
    const blob = r.doors
      .map((d) => [d.why_this_fit, ...d.safe_next_actions, ...d.proof_to_lead_with.map((p) => p.why_related)].join('\n'))
      .join('\n');
    for (const re of BANNED) expect(blob).not.toMatch(re);
  });
});

describe('PATHWAY FIT fixture shapes for probes', () => {
  it('VA IT + cert can yield set-aside when restriction observed', () => {
    const company = companyCyberRelevant({
      certifications: [
        { code: 'SDVOSB', label: 'SDVOSB', provenance_state: 'sba', authoritative: true },
      ],
    });
    const r = matchCompanyToPathwaysPure(caiVaIt(), company);
    expect(positive(door(r, 'set_aside'))).toBe(true);
    expect(positive(door(r, 'conventional_solicitation'))).toBe(true);
  });

  it('construction company vs SOCOM cyber → NO_PROVEN_DOOR or only weak miss', () => {
    const r = matchCompanyToPathwaysPure(caiSocomCyber(), companyUnrelatedConstruction());
    expect(r.summary.no_proven_door).toBe(true);
  });

  it('construction buyer + construction UEI can yield conventional fit', () => {
    const r = matchCompanyToPathwaysPure(caiConstruction(), companyUnrelatedConstruction());
    expect(positive(door(r, 'conventional_solicitation'))).toBe(true);
  });
});
