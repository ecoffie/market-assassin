import { describe, expect, it } from 'vitest';
import { extractDodaac } from './market-scope';
import type { KeywordCoverage } from '@/lib/market/keyword-coverage';
import {
  confirmationToRequirement,
  coverageSnapshotFromKeywordCoverage,
  interpretMarketQuestion,
  type InterpretLookups,
  type OfficeCandidate,
  installationSearchToken,
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
    expect(result.intake?.naics).toBeUndefined();
    expect(result.intake?.office).toMatch(/FA4610/);
    expect(JSON.stringify(result.confirmation)).not.toMatch(/W912PL/);
    // Missing NAICS is surfaced as a suggestion the user accepts — never written onto scope.
    expect(result.naicsSuggestion).toEqual({
      code: '236220',
      name: 'Commercial and Institutional Building Construction',
      keyword: 'SABER',
    });
    expect(result.confirmation?.naics).toBeUndefined();
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
    expect(result.intake?.naics).toBeUndefined();
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
      transactionCount: 1,
      uniqueAwardCount: 1,
      fiscalYear: 2025,
      source: 'bigquery_usaspending_awards',
      sourceMaxActionDate: '2025-09-30',
      allAgencies: [],
      primarySense: 'work_text',
      evidenceStatus: 'MARKET_EVIDENCE_FOUND',
      naicsIdentityStatus: 'NOT_ESTABLISHED',
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

describe('clarification answers and requirement wording (hosted acceptance 2026-10-07)', () => {
  const nco10: OfficeCandidate = {
    dodaac: '36C250',
    officeName: '250-NETWORK CONTRACT OFFICE 10 (36C250)',
    subAgency: 'VETERANS AFFAIRS, DEPARTMENT OF',
    source: 'dodaac_directory',
  };
  function namedLookups(byName: Record<string, OfficeCandidate[]>): InterpretLookups {
    return {
      async searchOfficesByName(query: string) {
        return byName[query] ?? [];
      },
      async searchOfficesAtInstallation() {
        return [];
      },
      async coverageFor(keyword: string) {
        return keyword === 'IT help desk support'
          ? { keyword, leadNaics: { code: '541512', name: 'Computer Systems Design Services' } }
          : { keyword };
      },
    };
  }
  const question = 'IT help desk support for the VA medical center in Cleveland, Ohio';

  it('uses the answer to "which buyer or office?" instead of asking the same question forever', async () => {
    const result = await interpretMarketQuestion(
      { question, clarification: { dimension: 'buyer', value: '36C250' } },
      namedLookups({ '36C250': [nco10] }),
    );
    expect(result.status).toBe('ready');
    expect(result.confirmation?.contractingOfficeCode).toBe('36C250');
    expect(result.confirmation?.buyerDepartment).toBe('Department of Veterans Affairs');
  });

  it('an answer that matches no office says so — it does not repeat the identical prompt or broaden', async () => {
    const first = await interpretMarketQuestion({ question }, namedLookups({}));
    const second = await interpretMarketQuestion(
      { question, clarification: { dimension: 'buyer', value: 'Louis Stokes Cleveland VA Medical Center' } },
      namedLookups({}),
    );
    expect(second.status).toBe('needs_clarification');
    expect(second.clarification?.prompt).toMatch(/could not find a contracting office matching "Louis Stokes Cleveland VA Medical Center"/);
    expect(second.clarification?.prompt).not.toBe(first.clarification?.prompt);
    expect(second.confirmation).toBeUndefined();
  });

  it('takes the requirement from before "for" when the question leads with it', async () => {
    const result = await interpretMarketQuestion(
      { question, clarification: { dimension: 'buyer', value: '36C250' } },
      namedLookups({ '36C250': [nco10] }),
    );
    expect(result.confirmation?.keyword).toBe('IT help desk support');
    expect(result.naicsSuggestion?.code).toBe('541512');
    expect(result.confirmation?.naics).toBeUndefined();
  });

  it('searches installations by their distinctive word, not "Fort"', () => {
    expect(installationSearchToken('Fort Bragg, North Carolina')).toBe('Bragg');
    expect(installationSearchToken('Camp Lejeune')).toBe('Lejeune');
    expect(installationSearchToken('Vandenberg Space Force Base')).toBe('Vandenberg');
    expect(installationSearchToken('Walter Reed National Military Medical Center')).toBe('Walter');
  });
});

describe('office codes that start with digits (VA 36C250) — hosted acceptance 2026-10-07', () => {
  it('reads the office code from the confirmed office, never a word like "OFFICE"', () => {
    expect(extractDodaac('36C250 250-NETWORK CONTRACT OFFICE 10 (36C250)')).toBe('36C250');
    expect(extractDodaac('FA4610 30 CONS PK')).toBe('FA4610');
    expect(extractDodaac('W91247 MICC FDO FT BRAGG')).toBe('W91247');
    expect(extractDodaac('NETWORK CONTRACT OFFICE')).toBeUndefined();
  });

  it('choosing an office offered after a buyer answer resolves it instead of asking again', async () => {
    const nco10: OfficeCandidate = {
      dodaac: '36C250',
      officeName: '250-NETWORK CONTRACT OFFICE 10 (36C250)',
      subAgency: 'VETERANS AFFAIRS, DEPARTMENT OF',
      source: 'dodaac_directory',
    };
    const lookupsByName: InterpretLookups = {
      async searchOfficesByName(query: string) {
        return query === '36C250' ? [nco10] : [];
      },
      async searchOfficesAtInstallation() {
        return [];
      },
      async coverageFor(keyword: string) {
        return { keyword };
      },
    };
    const result = await interpretMarketQuestion(
      {
        question: 'IT help desk support for the VA medical center in Cleveland, Ohio',
        clarification: { dimension: 'office', value: '36C250' },
      },
      lookupsByName,
    );
    expect(result.status).toBe('ready');
    expect(result.confirmation?.contractingOfficeCode).toBe('36C250');
  });
});
