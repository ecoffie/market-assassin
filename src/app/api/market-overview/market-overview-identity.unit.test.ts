/**
 * V2: market-overview must not route forecast/recompete off coverageCodes alone.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/market-overview/route.ts'),
  'utf8',
);

describe('market-overview coverage identity boundary', () => {
  it('keeps coverageCandidates as measurement display, not tile routing scope', () => {
    expect(SRC).toContain('corroboratedCodes');
    expect(SRC).toContain('coverageCandidates');
    expect(SRC).toContain('forecastTileByKeyword');
    expect(SRC).toContain('recompeteTileByKeyword');
    expect(SRC).toContain('awaitingMarketConfirmation');
    expect(SRC).toContain('hasCorroboratedNaics');
  });

  it('never silently pins NAICS-scoped tiles to coverage alone', () => {
    // Old defect: codes = explicit || coverage.coverageCodes then recompeteTile(codes)
    expect(SRC).not.toMatch(/recompeteTile\(codes\)/);
    expect(SRC).not.toMatch(/forecastTile\(codes\)/);
    expect(SRC).not.toMatch(/setAsideTile\(codes\)/);
    // Tile fan-out uses corroborated NAICS or keyword paths — not coverageCandidates
    expect(SRC).toMatch(/hasCorroboratedNaics\s*\n\s*\? recompeteTileByNaics\(corroboratedCodes\)/);
    expect(SRC).toMatch(/hasCorroboratedNaics\s*\n\s*\? forecastTileByNaics\(corroboratedCodes\)/);
  });
});
