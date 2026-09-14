import { describe, expect, it } from 'vitest';
import type { KeywordCoverage } from '@/lib/market/keyword-coverage';
import {
  confirmationToRequirement,
  coverageSnapshotFromKeywordCoverage,
  interpretMarketQuestion,
  type InterpretLookups,
  type OfficeCandidate,
} from './interpret-market';

const vandenbergCons: OfficeCandidate = {
  dodaac: 'FA4610',
  officeName: '30 CONS PK',
  subAgency: 'DEPT OF THE AIR FORCE',
  city: 'VANDENBERG SFB',
  state: 'CA',
  noticeCount: 12,
  source: 'sam_office_address',
};

const usaceVandenberg: OfficeCandidate = {
  dodaac: 'W912PL',
  officeName: 'USACE LOS ANGELES DISTRICT',
  subAgency: 'DEPT OF THE ARMY',
  city: 'VANDENBERG SFB',
  state: 'CA',
  noticeCount: 3,
  source: 'sam_office_address',
};

const navseaHq: OfficeCandidate = {
  dodaac: 'N00024',
  officeName: 'NAVSEA HQ',
  subAgency: 'DEPT OF THE NAVY',
  city: 'WASHINGTON NAVY YARD',
  state: 'DC',
  source: 'dodaac_directory',
};

const navseaCrane: OfficeCandidate = {
  dodaac: 'N00164',
  officeName: 'NSWC CRANE',
  subAgency: 'DEPT OF THE NAVY',
  source: 'dodaac_directory',
};

const spe4a1: OfficeCandidate = {
  dodaac: 'SPE4A1',
  officeName: 'DLA AVIATION',
  subAgency: 'DEFENSE LOGISTICS AGENCY',
  city: 'Richmond',
  state: 'VA',
  source: 'dla_office_locations',
};

const spe4a0: OfficeCandidate = {
  dodaac: 'SPE4A0',
  officeName: 'DLA AVIATION',
  subAgency: 'DEFENSE LOGISTICS AGENCY',
  city: 'Richmond',
  state: 'VA',
  source: 'dla_office_locations',
};

function lookups(officesByName: OfficeCandidate[], atPlace: OfficeCandidate[]): InterpretLookups {
  return {
    async searchOfficesByName() {
      return officesByName;
    },
    async searchOfficesAtInstallation() {
      return atPlace;
    },
    async coverageFor(keyword: string) {
      if (keyword === 'soybean farming products') {
        return {
          keyword,
          leadNaics: { code: '311224', name: 'Soybean and Other Oilseed Processing' },
        };
      }
      if (keyword === 'soybean farming') {
        return {
          keyword,
          leadNaics: { code: '111110', name: 'Soybean Farming' },
          topPsc: { code: '8915', name: 'Fruits and Vegetables' },
        };
      }
      if (keyword === 'SABER') {
        return {
          keyword,
          leadNaics: { code: '236220', name: 'Commercial and Institutional Building Construction' },
          topPsc: { code: 'Z2JZ', name: 'Repair or Alteration of Miscellaneous Buildings' },
        };
      }
      if (keyword === 'shipbuilding') {
        return {
          keyword,
          leadNaics: { code: '336611', name: 'Ship Building and Repairing' },
          topPsc: { code: '1905', name: 'Combat Ships And Landing Vessels' },
        };
      }
      if (/soybean/i.test(keyword)) {
        return {
          keyword,
          leadNaics: { code: '111110', name: 'Soybean Farming' },
          topPsc: { code: '8915', name: 'Fruits and Vegetables' },
        };
      }
      return { keyword };
    },
  };
}

describe('interpretMarketQuestion', () => {
  it('resolves Vandenberg SABER to 30 CONS without requiring codes', async () => {
    const result = await interpretMarketQuestion(
      {
        question:
          'I want to understand the small-business market for construction / SABER-type work at Vandenberg Space Force Base.',
      },
      lookups([], [vandenbergCons, usaceVandenberg]),
    );
    expect(result.status).toBe('ready');
    expect(result.confirmation?.contractingOfficeCode).toBe('FA4610');
    expect(result.confirmation?.contractingOffice).toMatch(/30 CONS/i);
    expect(result.confirmation?.buyerDepartment).toBe('Department of the Air Force');
    expect(result.confirmation?.service).toMatch(/Space Force/i);
    expect(result.confirmation?.keyword).toBe('SABER');
    expect(result.intake?.naics).toBe('236220');
    expect(result.intake?.office).toMatch(/FA4610/);
    expect(JSON.stringify(result.confirmation)).not.toMatch(/W912PL/);
  });

  it('resolves NAVSEA HQ to N00024 and does not keep warfare centers', async () => {
    const result = await interpretMarketQuestion(
      {
        question:
          'I want to understand the small-business market for shipbuilding awarded by NAVSEA HQ.',
      },
      lookups([navseaHq, navseaCrane], []),
    );
    expect(result.status).toBe('ready');
    expect(result.confirmation?.contractingOfficeCode).toBe('N00024');
    expect(result.confirmation?.buyerDepartment).toBe('Department of the Navy');
    expect(result.confirmation?.installation).toMatch(/NAVY YARD/i);
  });

  it('asks one office clarification for DLA Aviation instead of guessing SPE4A1', async () => {
    const result = await interpretMarketQuestion(
      {
        question:
          'I want to understand the small-business market for soybean farming products awarded by DLA Aviation for Wyoming performance.',
      },
      lookups([spe4a1, spe4a0], []),
    );
    expect(result.status).toBe('needs_clarification');
    expect(result.clarification?.dimension).toBe('office');
    expect(result.clarification?.options?.map((option) => option.id).sort()).toEqual(['SPE4A0', 'SPE4A1']);
  });

  it('applies the DLA office clarification without guessing geography', async () => {
    const result = await interpretMarketQuestion(
      {
        question:
          'I want to understand the small-business market for soybean farming products awarded by DLA Aviation for Wyoming performance.',
        clarification: { dimension: 'office', value: 'SPE4A1' },
      },
      lookups([spe4a1, spe4a0], []),
    );
    expect(result.status).toBe('ready');
    expect(result.confirmation?.contractingOfficeCode).toBe('SPE4A1');
    expect(result.confirmation?.geography).toBe('WY');
    expect(result.intake?.naics).toBe('111110');
  });

  it('does not invent a buyer when nothing resolves', async () => {
    const result = await interpretMarketQuestion(
      { question: 'I want to understand the small-business market for widgets.' },
      lookups([], []),
    );
    expect(result.status).toBe('needs_clarification');
    expect(result.clarification?.dimension).toBe('buyer');
    expect(result.confirmation).toBeUndefined();
  });

  it('prefers a NAICS whose name matches the question over a dollar-lead processor code', () => {
    const snapshot = coverageSnapshotFromKeywordCoverage({
      keyword: 'soybean farming products',
      totalMarket: 1,
      naicsCount: 2,
      allNaics: [
        { code: '311224', name: 'Soybean and Other Oilseed Processing', amount: 9, pct: 0.9 },
        { code: '111110', name: 'Soybean Farming', amount: 1, pct: 0.1 },
      ],
      coverageCodes: ['311224'],
      coveragePct: 0.9,
      topCodePct: 0.9,
      leadCodePct: 0.9,
      pscCount: 0,
      topPsc: null,
      topPscPct: 0,
      topPscList: [],
      pinnedPscCodes: null,
    } satisfies KeywordCoverage);
    expect(snapshot?.leadNaics?.code).toBe('111110');
  });

  it('hides codes in confirmationToRequirement office text only as machine fields', async () => {
    const requirement = confirmationToRequirement('question', {
      buyerDepartment: 'Department of the Air Force',
      service: 'United States Space Force',
      installation: 'Vandenberg Space Force Base',
      contractingOffice: '30 CONS PK',
      contractingOfficeCode: 'FA4610',
      requirementLabel: 'SABER',
      geography: 'CA',
      naics: '236220',
      psc: 'Z2JZ',
      keyword: 'SABER',
    });
    expect(requirement.office).toContain('FA4610');
    expect(requirement.installation).toBe('Vandenberg Space Force Base');
  });
});
