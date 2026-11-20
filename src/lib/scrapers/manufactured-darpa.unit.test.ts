/**
 * The six ids and NAICS 541715 come from grantsgov-darpa.ts as of commit
 * f62b51f6f (2026-04-05). Grants.gov did not send that NAICS.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MANUFACTURED_DARPA_EXTERNAL_IDS,
  isManufacturedDarpaRow,
} from './manufactured-darpa';

describe('isManufacturedDarpaRow', () => {
  it('matches only the six hardcoded ids while they still carry 541715', () => {
    expect(MANUFACTURED_DARPA_EXTERNAL_IDS).toHaveLength(6);
    for (const id of MANUFACTURED_DARPA_EXTERNAL_IDS) {
      expect(isManufacturedDarpaRow({
        source: 'darpa_baa',
        external_id: id,
        naics_code: '541715',
      })).toBe(true);
    }
  });

  it('does not hide a live DARPA row whose NAICS was not invented', () => {
    expect(isManufacturedDarpaRow({
      source: 'darpa_baa',
      external_id: 'HR001125S0011',
      naics_code: null,
    })).toBe(false);
    expect(isManufacturedDarpaRow({
      source: 'darpa_baa',
      external_id: 'DARPARA2701',
      naics_code: '541715',
    })).toBe(false);
    expect(isManufacturedDarpaRow({
      source: 'nih_reporter',
      external_id: 'HR001125S0013',
      naics_code: '541715',
    })).toBe(false);
  });
});

describe('customer readers withhold the manufactured rows', () => {
  const root = join(__dirname, '../../..');
  const readers = [
    'src/lib/sbir/search.ts',
    'src/lib/briefings/pipelines/multisite.ts',
    'src/app/api/sbir/route.ts',
    'src/app/api/market-scan/route.ts',
  ];

  it('each customer read of aggregated_opportunities drops the six ids', () => {
    for (const rel of readers) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).toContain('isManufacturedDarpaRow');
    }
    const scan = readFileSync(join(root, 'src/app/api/market-scan/route.ts'), 'utf8');
    expect(scan).toContain("['nih_reporter', 'nsf_sbir', 'sbir_gov']");
    expect(scan).not.toContain("'darpa_baa'");
    const mcp = readFileSync(join(root, 'src/mcp/tools/sbir.ts'), 'utf8');
    expect(mcp).toContain('searchSbir');
    expect(mcp).toMatch(/not zero NSF/);
  });
});
