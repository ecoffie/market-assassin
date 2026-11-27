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
  it('levels: not reported → unknown (was sole_source / low)', () => {
    expect(offersCompetitionLevel(null)).toBe('unknown');
    expect(offersCompetitionLevel(1)).toBe('sole_source');
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
  ])('%s', (f) => {
    const src = readFileSync(join(process.cwd(), f), 'utf8');
    expect(src).not.toMatch(/number_of_offers(_received)?\s*\|\|\s*['"]?0/);
    expect(src).not.toMatch(/extent_competed_description \|\| 'Full & Open'/);
  });
});
