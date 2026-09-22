import { describe, it, expect } from 'vitest';
import { fetchGAOReports } from './govinfo';

describe('GovInfo GAOREPORTS quarantine', () => {
  it('returns [] by default so legacy writer cannot become authoritative', async () => {
    const rows = await fetchGAOReports({ fiscalYear: 2026 });
    expect(rows).toEqual([]);
  });

  it('does not influence living GAO currentness when quarantined', async () => {
    const rows = await fetchGAOReports({});
    // Empty result must not be writable into institute clocks / living pain points.
    expect(rows.every((r) => r.source_name !== 'institute_gao')).toBe(true);
    expect(rows).toHaveLength(0);
  });
});
