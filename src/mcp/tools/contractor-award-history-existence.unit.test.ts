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
vi.mock('@/lib/contractor-sales-history', () => ({
  getContractorSalesHistory: (o: unknown) => mockHistory(o),
}));
vi.mock('@/lib/contractor/award-history-existence', () => ({
  establishAwardHistory: (c: string, u: string | null) => mockEstablish(c, u),
}));

const { contractorAwardHistory } = await import('./contractor-award-history');

const EMPTY_HISTORY = { summary: { awardCount: 0 }, source: 'cache', awards: [] };

beforeEach(() => {
  mockHistory.mockReset(); mockEstablish.mockReset();
  mockEstablish.mockResolvedValue({ hasFederalAwardHistory: false, degraded: false, sources: [], uei: null, recipientName: null });
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

  it('when its own cache HAS awards, no second lookup is needed', async () => {
    mockHistory.mockResolvedValue({ summary: { awardCount: 12 }, source: 'cache', awards: [] });
    const r = await contractorAwardHistory({ company: 'ACME' });
    expect(r._meta.grounded).toBe(true);
    expect(r._meta.award_count).toBe(12);
    expect(mockEstablish).not.toHaveBeenCalled();
  });
});
