/**
 * Unknown is never zero: a missing offer count is "not reported", never 0 bids / sole source / 1 bidder.
 * Every surface that used `|| 0` / parseInt(x || '0') now goes through reportedOffers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportedOffers, offersCompetitionLevel } from './offers';
import { getCompetitionLevel } from '@/components/app/panels/RecompetesPanel';

describe('reportedOffers', () => {
  it.each([[null, null], [undefined, null], ['', null], ['abc', null], [0, null], ['0', null], ['1', 1], [3, 3], ['12', 12]])('%j → %j', (v, want) => {
    expect(reportedOffers(v)).toBe(want);
  });
  it('levels: not reported → unknown (was sole_source / low); 1 offer is low, not sole source', () => {
    expect(offersCompetitionLevel(null)).toBe('unknown');
    expect(offersCompetitionLevel(1)).toBe('low');
    expect(offersCompetitionLevel(2)).toBe('low');
    expect(offersCompetitionLevel(4)).toBe('medium');
    expect(offersCompetitionLevel(9)).toBe('high');
  });
});

describe('RecompetesPanel competition level', () => {
  it('no type and no count → unknown, never "full"', () => {
    expect(getCompetitionLevel({ competition_type: null, number_of_offers: null })).toBe('unknown');
  });
  it('reported values still classify', () => {
    expect(getCompetitionLevel({ competition_type: null, number_of_offers: 1 })).toBe('sole_source');
    expect(getCompetitionLevel({ competition_type: null, number_of_offers: 3 })).toBe('low');
    expect(getCompetitionLevel({ competition_type: 'FULL AND OPEN COMPETITION', number_of_offers: null })).toBe('full');
    expect(getCompetitionLevel({ competition_type: 'NOT COMPETED', number_of_offers: null })).toBe('sole_source');
  });
});

describe('no surface coerces a missing offer count to 0', () => {
  it.each([
    'src/app/api/admin/send-all-briefings/route.ts',
    'src/app/api/cron/weekly-deep-dive/route.ts',
    'src/components/app/panels/RecompetesPanel.tsx',
    'src/lib/briefings/weekly-contracts.ts',
    'src/lib/sam/contract-awards.ts',
    'src/lib/sam/usaspending-fallback.ts',
  ])('%s', (f) => {
    const src = readFileSync(join(process.cwd(), f), 'utf8');
    expect(src).not.toMatch(/number_of_offers(_received)?\s*\|\|\s*['"]?0/);
    expect(src).not.toMatch(/numberOfOffersReceived'\)\s*as string \|\| '0'/);
    expect(src).not.toMatch(/extent_competed_description \|\| 'Full & Open'/);
  });
});

describe('contract-intel research: a missing count is UNKNOWN, never "Only 0 bidder(s)"', () => {
  it('route reads the null-safe count', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/contract-intel/research/route.ts'), 'utf8');
    expect(src).toMatch(/offers === null \? 'UNKNOWN'/);
    expect(src).toMatch(/offers !== null && offers <= 2/);
  });
  it('expiring route averages only reported counts (null when none)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/contract-intel/expiring/route.ts'), 'utf8');
    expect(src).toMatch(/avgBids === null \? null/);
  });
});
