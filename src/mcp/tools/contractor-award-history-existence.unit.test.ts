/**
 * CHAIN-2 — two tools may differ on SCOPE; they may never contradict on EXISTENCE.
 *
 * THE INVARIANT (Eric, 2026-08-25): once identity resolves to a canonical UEI, two tools
 * querying federal performance MAY differ in scope or time window, but they may NEVER
 * disagree on the existential claim "this contractor has federal award history."
 *
 * Regression case: FLUIDYNE CORPORATION. get_recipient_annual_obligations reported $20.2M
 * FY23-25 while get_contractor_award_history reported grounded=false / 0 / $0, because the
 * latter reads an 880-row / 373-recipient cache. ~94% of contractors we hold award data
 * for would have been told they have none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHistory = vi.fn();
const mockEstablish = vi.fn();
const mockByUei = vi.fn();
const mockResolveName = vi.fn();
vi.mock('@/lib/contractor-sales-history', () => ({
  getContractorSalesHistory: (o: unknown) => mockHistory(o),
  slugifyContractorName: (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
}));
vi.mock('@/lib/contractor/award-history-existence', () => ({
  establishAwardHistory: (c: string, u: string | null) => mockEstablish(c, u),
}));
vi.mock('@/lib/contractor/history-by-uei', () => ({
  getContractorHistoryByUei: (o: unknown) => mockByUei(o),
}));
vi.mock('@/lib/contractor/name-resolution', () => ({
  resolveAwardCorpusByName: (q: string) => mockResolveName(q),
}));

const { contractorAwardHistory } = await import('./contractor-award-history');

const EMPTY_HISTORY = { summary: { awardCount: 0 }, source: 'cache', awards: [] };

beforeEach(() => {
  mockHistory.mockReset(); mockEstablish.mockReset(); mockByUei.mockReset(); mockResolveName.mockReset();
  mockEstablish.mockResolvedValue({ hasFederalAwardHistory: false, degraded: false, sources: [], uei: null, recipientName: null });
  mockByUei.mockResolvedValue({ resolution: 'not_found', history: null });
  mockResolveName.mockResolvedValue({ status: 'none', searched: '' });
});

describe('CHAIN-2 — existence may not be contradicted', () => {
  it('⚠️ THE REGRESSION: own cache empty, another source HAS history → not absence', async () => {
    mockHistory.mockResolvedValue(EMPTY_HISTORY);
    mockEstablish.mockResolvedValue({
      hasFederalAwardHistory: true, degraded: false, uei: 'RG3VUTDYFNF8',
      recipientName: 'FLUIDYNE CORPORATION',
      sources: [{ source: 'recompete_mirror', found: true, awardCount: 33 }],
    });
    const r = await contractorAwardHistory({ company: 'FLUIDYNE CORPORATION' });
    expect(r._meta.grounded).toBe(true);                        // was false — the contradiction
    expect(r._meta.award_history_elsewhere).toBe(true);
    expect(r._meta.award_history_sources).toContain('recompete_mirror');
    expect(String(r._meta.note)).toMatch(/do NOT state the contractor has no federal past performance/i);
  });

  it('reports its OWN count honestly — existence is shared, scope is not merged', async () => {
    mockHistory.mockResolvedValue(EMPTY_HISTORY);
    mockEstablish.mockResolvedValue({
      hasFederalAwardHistory: true, degraded: false, uei: null, recipientName: null,
      sources: [{ source: 'recompete_mirror', found: true, awardCount: 33 }],
    });
    const r = await contractorAwardHistory({ company: 'FLUIDYNE CORPORATION' });
    // grounded=true (existence) but award_count stays 0 (this tool's real view).
    // Inventing a merged total would be a number no source supports.
    expect(r._meta.award_count).toBe(0);
    expect(r._meta.grounded).toBe(true);
  });

  it('genuine absence still reads as absence — every source agreed', async () => {
    mockHistory.mockResolvedValue(EMPTY_HISTORY);
    const r = await contractorAwardHistory({ company: 'ZZQX NO SUCH CONTRACTOR' });
    expect(r._meta.grounded).toBe(false);
    expect(r._meta.degraded).toBe(false);
    expect(r._meta.award_history_elsewhere).toBeUndefined();
    expect(mockEstablish).toHaveBeenCalled();     // absence ESTABLISHED, not assumed
  });

  it('an unqueryable existence check degrades — never "no history"', async () => {
    mockHistory.mockResolvedValue(EMPTY_HISTORY);
    mockEstablish.mockResolvedValue({ hasFederalAwardHistory: false, degraded: true, sources: [], uei: null, recipientName: null });
    const r = await contractorAwardHistory({ company: 'FLUIDYNE CORPORATION' });
    expect(r._meta.degraded).toBe(true);
    expect(r._meta.grounded).toBe(false);
  });

  it('a THROWN existence check degrades too', async () => {
    mockHistory.mockResolvedValue(EMPTY_HISTORY);
    mockEstablish.mockRejectedValue(new Error('db down'));
    const r = await contractorAwardHistory({ company: 'FLUIDYNE CORPORATION' });
    expect(r._meta.degraded).toBe(true);
  });

  it('a unique award-index name is loaded by UEI, not by the recompete slice', async () => {
    mockResolveName.mockResolvedValue({
      status: 'unique',
      uei: 'UM53UXL5QNF5',
      name: 'TANAQ SUPPORT SERVICES, LLC',
      total_obligated: 261_903_825.7,
      award_count: 54,
      match: 'exact_stem',
    });
    mockByUei.mockResolvedValue({
      resolution: 'found',
      history: {
        summary: { awardCount: 54, totalObligations: 261_903_825.7, topAgency: 'DoD', latestFiscalYear: 2026 },
        source: 'bigquery_normalized',
        contractor: { company: 'TANAQ SUPPORT SERVICES, LLC' },
        match: { method: 'recipient_name', confidence: 'high', name: 'TANAQ SUPPORT SERVICES, LLC' },
      },
      source: 'bigquery',
      asOf: '2026-09-01',
    });
    const r = await contractorAwardHistory({ company: 'TANAQ SUPPORT SERVICES, LLC' });
    expect(r.history?.source).toBe('bigquery_normalized');
    expect(r._meta.award_count).toBe(54);
    expect(r._meta.name_resolution).toBe('award_corpus_name_to_uei');
    expect(r._meta.coverage?.not_equivalent_to).toBe('recipients_rollup.total_obligated');
    expect(r._meta.note).toMatch(/match\.method recipient_name/);
    expect(mockHistory).not.toHaveBeenCalled();
    expect(mockEstablish).not.toHaveBeenCalled();
  });

  it('several name matches are returned as candidates and never auto-picked', async () => {
    mockResolveName.mockResolvedValue({
      status: 'ambiguous',
      match_count: 13,
      truncated: false,
      candidates: [
        { name: 'TANAQ SUPPORT SERVICES, LLC', uei: 'UM53UXL5QNF5', total_obligated: 261_903_825.7, award_count: 54 },
      ],
      note: '13 award-holding recipients match "Tanaq". This tool will not pick one.',
    });
    const r = await contractorAwardHistory({ company: 'Tanaq' });
    expect(r._meta.resolution).toBe('ambiguous');
    expect(r._meta.match_count).toBe(13);
    expect(r.history).toBeNull();
    expect(r.candidates?.[0].uei).toBe('UM53UXL5QNF5');
    expect(mockByUei).not.toHaveBeenCalled();
    expect(r._meta.note).not.toMatch(/couldn't find|no federal past performance/i);
  });

  it('a miss with no comma still runs the existence check', async () => {
    mockHistory.mockResolvedValue(EMPTY_HISTORY);
    mockResolveName.mockResolvedValue({ status: 'none', searched: 'TANAQ SUPPORT SERVICES LLC' });
    mockEstablish.mockResolvedValue({
      hasFederalAwardHistory: true, degraded: false, uei: null, recipientName: null,
      sources: [{ source: 'recompete_mirror', found: true, awardCount: 12 }],
    });
    const r = await contractorAwardHistory({ company: 'TANAQ SUPPORT SERVICES LLC' });
    expect(mockEstablish).toHaveBeenCalledWith('TANAQ SUPPORT SERVICES LLC', null);
    expect(r._meta.award_history_elsewhere).toBe(true);
    expect(r._meta.grounded).toBe(true);
    expect(r.history?.summary?.awardCount ?? 0).toBe(0);
    expect(r.history?.source).not.toBe('recompete_mirror');
  });

  it('when its own cache HAS awards, no second lookup is needed', async () => {
    mockHistory.mockResolvedValue({ summary: { awardCount: 12 }, source: 'cache', awards: [] });
    const r = await contractorAwardHistory({ company: 'ACME' });
    expect(r._meta.grounded).toBe(true);
    expect(r._meta.award_count).toBe(12);
    expect(mockEstablish).not.toHaveBeenCalled();
  });
});
