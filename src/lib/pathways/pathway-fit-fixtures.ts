/**
 * Shared CAI / company fixtures for PATHWAY FIT red-team tests.
 */
import type { CaiPackageSlim, CompanyPublicRecord } from './pathway-fit-types';

const cite = (kind: string, id: string, locator: string) => ({
  source_kind: kind,
  source_id: id,
  locator,
  as_of: '2026-09-01',
});

export function caiSocomCyber(overrides?: Partial<CaiPackageSlim>): CaiPackageSlim {
  const base: CaiPackageSlim = {
    scope: {
      agency: 'USSOCOM',
      office: null,
      capability: 'cybersecurity',
      naics: ['541512'],
      keywords: ['cyber', 'security', 'network'],
    },
    pathways: {
      observed: [
        {
          kind: 'cso',
          established: true,
          statement: 'Commercial Solutions Opening language appears on scoped SAM notices.',
          citations: [cite('sam_opportunities', 'NOTICE-CSO-1', 'sam_opportunities.notice_id=NOTICE-CSO-1')],
          evidence_count: 2,
        },
        {
          kind: 'idv_task_order',
          established: true,
          statement: 'Task-order / IDV activity appears in scoped records.',
          citations: [cite('recompete_opportunities', 'C-1', 'recompete.contract_id=C-1')],
          evidence_count: 2,
        },
        {
          kind: 'conventional_solicitation',
          established: true,
          statement: 'Conventional solicitations posted in live SAM records.',
          citations: [cite('sam_opportunities', 'NOTICE-RFP-1', 'sam_opportunities.notice_id=NOTICE-RFP-1')],
          evidence_count: 1,
        },
      ],
      potential_not_established: [
        { kind: 'consortium', reason: 'not established' },
        { kind: 'rapid_acquisition_office', reason: 'not established' },
        { kind: 'pae_portfolio', reason: 'not established' },
      ],
    },
    as_of: '2026-09-15',
  };
  return { ...base, ...overrides, pathways: overrides?.pathways ?? base.pathways, scope: { ...base.scope, ...overrides?.scope } };
}

export function caiWithSetAside(codes: string[] = ['SDVOSB']): CaiPackageSlim {
  const cai = caiSocomCyber();
  cai.pathways.observed.push({
    kind: 'set_aside',
    established: true,
    statement: 'Explicit set-aside labels appear on scoped notices.',
    citations: [cite('sam_opportunities', 'NOTICE-SA-1', 'set_aside=SDVOSB')],
    evidence_count: 1,
    set_aside_codes: codes,
  });
  return cai;
}

export function caiVaIt(): CaiPackageSlim {
  return {
    scope: {
      agency: 'Department of Veterans Affairs',
      office: null,
      capability: 'information technology',
      naics: ['541512'],
      keywords: ['IT', 'software', 'health'],
    },
    pathways: {
      observed: [
        {
          kind: 'conventional_solicitation',
          established: true,
          statement: 'Conventional IT solicitations observed.',
          citations: [cite('sam_opportunities', 'VA-1', 'notice=VA-1')],
          evidence_count: 2,
        },
        {
          kind: 'set_aside',
          established: true,
          statement: 'SDVOSB set-aside observed on scoped notices.',
          citations: [cite('sam_opportunities', 'VA-SA', 'set_aside=SDVOSB')],
          evidence_count: 1,
          set_aside_codes: ['SDVOSB'],
        },
      ],
      potential_not_established: [{ kind: 'pae_portfolio' }],
    },
    as_of: '2026-09-15',
  };
}

export function caiConstruction(): CaiPackageSlim {
  return {
    scope: {
      agency: 'USACE',
      office: null,
      capability: 'horizontal construction',
      naics: ['237310'],
      keywords: ['highway', 'construction', 'paving'],
    },
    pathways: {
      observed: [
        {
          kind: 'conventional_solicitation',
          established: true,
          statement: 'Conventional construction solicitations observed.',
          citations: [cite('sam_opportunities', 'USACE-1', 'notice=USACE-1')],
          evidence_count: 2,
        },
      ],
      potential_not_established: [{ kind: 'consortium' }],
    },
    as_of: '2026-09-15',
  };
}

export function companyCyberRelevant(overrides?: Partial<CompanyPublicRecord>): CompanyPublicRecord {
  const base: CompanyPublicRecord = {
    uei: 'CYBERUEI0001',
    legal_name: 'Cyber Relevant LLC',
    cage: '1ABC2',
    identity_source: 'fixture',
    certifications: [
      {
        code: 'SDVOSB',
        label: 'SDVOSB',
        provenance_state: 'self',
        authoritative: false,
      },
    ],
    awards: [
      {
        id: 'AWARD-CYBER-1',
        title: 'Cybersecurity risk management support',
        agency: 'Department of Defense',
        naics: '541512',
        amount: 2_500_000,
        startDate: '2023-01-01',
        endDate: '2025-06-01',
        description: 'network security cyber operations',
      },
    ],
    verified_vehicle_holds: [],
    ot_nontraditional_established: false,
    owner_asserted: {
      outcomes: ['Saved the government $2M'],
      claimed_vehicles: ['SEWP V'],
      claimed_demo_ready: true,
    },
  };
  return {
    ...base,
    ...overrides,
    certifications: overrides?.certifications ?? base.certifications,
    awards: overrides?.awards ?? base.awards,
    verified_vehicle_holds: overrides?.verified_vehicle_holds ?? base.verified_vehicle_holds,
    owner_asserted: overrides?.owner_asserted ?? base.owner_asserted,
  };
}

export function companyUnrelatedConstruction(): CompanyPublicRecord {
  return {
    uei: 'CONSTUEI0001',
    legal_name: 'Highway Builders Inc',
    cage: null,
    identity_source: 'fixture',
    certifications: [],
    awards: [
      {
        id: 'AWARD-HWY-1',
        title: 'Highway paving and resurfacing',
        agency: 'Department of Transportation',
        naics: '237310',
        amount: 8_000_000,
        startDate: '2022-01-01',
        endDate: '2024-12-01',
        description: 'asphalt paving highway construction',
      },
    ],
    verified_vehicle_holds: [],
    ot_nontraditional_established: false,
  };
}

export function companyNoAwards(): CompanyPublicRecord {
  return {
    uei: 'EMPTYUEI0001',
    legal_name: 'Empty Record Co',
    cage: null,
    identity_source: 'fixture',
    certifications: [
      {
        code: 'SDVOSB',
        label: 'SDVOSB',
        provenance_state: 'sba',
        authoritative: true,
      },
    ],
    awards: [],
    verified_vehicle_holds: [],
    ot_nontraditional_established: false,
  };
}
