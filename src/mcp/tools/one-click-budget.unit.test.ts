/**
 * one_click_proposal time-budget guard (FM-P03, Eric/QA v5 2026-07-28). The one-click path chains 5
 * sequential passes (extract → structure → draft → referee → export); on a real multi-shall RFP the
 * whole chain exceeded the MCP gateway window → a hard connector timeout that LOST everything the
 * caller paid for. Fix: after the draft (the heavy work), if we're over ONE_CLICK_BUDGET_MS, STOP and
 * return matrix + structure + draft with _meta.partial + a note to run referee/export as follow-ups —
 * a graceful partial instead of a total-loss timeout. This locks that behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the chained stages so the test is hermetic + fast. The draft mock is slow enough to push the
// run past a tiny budget; referee/export must NOT be called when over budget.
const refereeMock = vi.fn();
const exportMock = vi.fn();
vi.mock('@/mcp/tools/compliance-matrix', () => ({
  extractComplianceMatrix: async () => ({ requirements: [{ id: 'R1', requirement: 'shall do X' }] }),
}));
vi.mock('@/mcp/tools/proposal-structure', () => ({
  buildProposalStructureTool: () => ({ volumes: [] }),
}));
vi.mock('@/mcp/tools/draft-proposal', () => ({
  draftProposal: async () => {
    await new Promise((r) => setTimeout(r, 20)); // consume the tiny budget
    return { sections: [{ title: 'Technical', section: 'technical', content: 'real draft' }], outline: [] };
  },
}));
vi.mock('@/mcp/tools/referee-compliance', () => ({ refereeProposalCompliance: (a: unknown) => refereeMock(a) }));
vi.mock('@/mcp/tools/export-proposal', () => ({ exportProposal: (a: unknown) => exportMock(a) }));

import { oneClickProposal } from './one-click-proposal';

beforeEach(() => { refereeMock.mockReset(); exportMock.mockReset(); });
afterEach(() => { delete process.env.ONE_CLICK_BUDGET_MS; });

describe('one_click_proposal budget guard (FM-P03)', () => {
  it('over budget → returns the draft, SKIPS referee + export, flags partial + a follow-up note', async () => {
    process.env.ONE_CLICK_BUDGET_MS = '1'; // any real work blows this → partial path
    const r = await oneClickProposal({ rfp_text: 'The Offeror shall do X.', userEmail: null });
    expect(r.draft?.sections.length).toBe(1);          // the paid work is returned
    expect(r._meta.partial).toBe(true);
    expect(refereeMock).not.toHaveBeenCalled();         // heavy follow-ups skipped
    expect(exportMock).not.toHaveBeenCalled();
    expect(r.compliance_score).toBeNull();
    expect(r.deliverable).toBeNull();
    expect(r._meta.note).toMatch(/export_proposal[\s\S]*referee_proposal_compliance|referee_proposal_compliance[\s\S]*export_proposal/);
  });

  it('within budget → runs the FULL chain (referee + export both called)', async () => {
    process.env.ONE_CLICK_BUDGET_MS = '600000'; // generous → full path
    refereeMock.mockResolvedValue({ summary: { score: 83 } });
    exportMock.mockResolvedValue({ filename: 'p.docx', mime: 'x', docx_base64: 'AAA', byte_size: 10 });
    const r = await oneClickProposal({ rfp_text: 'The Offeror shall do X.', userEmail: null });
    expect(r._meta.partial).toBe(false);
    expect(refereeMock).toHaveBeenCalledTimes(1);
    expect(exportMock).toHaveBeenCalledTimes(1);
    expect(r.deliverable?.byte_size).toBe(10);
  });
});
