import { describe, it, expect } from 'vitest';
import { rankWeeklyContracts, type WeeklyContract } from './weekly-contracts';

function contract(partial: Partial<WeeklyContract> & Pick<WeeklyContract, 'contractNumber' | 'naicsCode'>): WeeklyContract {
  return {
    contractName: partial.contractName || `Award ${partial.contractNumber}`,
    agency: partial.agency || 'Department of Defense',
    incumbent: partial.incumbent || 'Incumbent',
    value: partial.value ?? 1_000_000,
    expirationDate: partial.expirationDate || '2026-12-01',
    daysUntilExpiration: partial.daysUntilExpiration ?? 80,
    setAside: 'Full & Open',
    description: partial.description || '',
    numberOfBids: partial.numberOfBids,
    ...partial,
  };
}

describe('rankWeeklyContracts — filter to saved market before the limit', () => {
  const savedNaics = ['541512'];

  it('drops off-industry keyword hits even when they score on value', () => {
    const ranked = rankWeeklyContracts(
      [
        contract({
          contractNumber: 'OFF-MARKET',
          naicsCode: '236220',
          contractName: 'Identity badge printers for a courthouse',
          value: 90_000_000,
          description: 'identity',
        }),
        contract({
          contractNumber: 'IN-MARKET',
          naicsCode: '541512',
          contractName: 'Identity and access management support',
          value: 2_000_000,
          expirationDate: '2026-12-01',
        }),
        contract({
          contractNumber: 'EXPIRED-WHALE',
          naicsCode: '541512',
          contractName: 'Old identity system',
          value: 900_000_000,
          expirationDate: '2015-12-31',
        }),
      ],
      {
        savedNaics,
        pscCodes: [],
        keywords: ['Identity'],
        agencies: [],
      },
    );
    expect(ranked.map((row) => row.contractNumber)).toEqual(['IN-MARKET']);
    expect(ranked[0].matchFactors).toContain('NAICS');
    expect(ranked[0].matchFactors).toContain('Keyword:Identity');
  });
});
