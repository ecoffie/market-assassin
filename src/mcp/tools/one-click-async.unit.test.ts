/**
 * one_click_proposal async job pattern (FM-P03 async refactor, Eric/QA 2026-07-28). The 5-pass pipeline
 * exceeds the 60s MCP gateway window, so one_click_proposal now ENQUEUES a job and returns a job_id
 * immediately; a worker runs the pipeline; the caller polls get_proposal_job. This locks:
 *   - async (default) returns a queued job_ack (job_id + poll instruction), does NOT run the pipeline
 *   - when the queue is unavailable, it falls back to the inline pipeline (never a hard failure)
 *   - get_proposal_job returns status, and the full result only when done
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const enqueueMock = vi.fn();
const getJobMock = vi.fn();
vi.mock('@/lib/proposal/job-store', () => ({
  enqueueProposalJob: (a: unknown) => enqueueMock(a),
  getProposalJob: (id: string, owner: string) => getJobMock(id, owner),
}));
// Stub the heavy pipeline stages so the inline-fallback path is fast + hermetic.
vi.mock('@/mcp/tools/compliance-matrix', () => ({ extractComplianceMatrix: async () => ({ requirements: [] }) }));
vi.mock('@/mcp/tools/proposal-structure', () => ({ buildProposalStructureTool: () => ({ volumes: [] }) }));
vi.mock('@/mcp/tools/draft-proposal', () => ({ draftProposal: async () => ({ sections: [], outline: [] }) }));
vi.mock('@/mcp/tools/referee-compliance', () => ({ refereeProposalCompliance: async () => ({ summary: {} }) }));
vi.mock('@/mcp/tools/export-proposal', () => ({ exportProposal: async () => null }));

import { oneClickProposal, type OneClickProposalJobAck } from './one-click-proposal';
import { getProposalJobTool } from './proposal-job';

beforeEach(() => { enqueueMock.mockReset(); getJobMock.mockReset(); });

describe('one_click_proposal — async front (FM-P03)', () => {
  it('async (default) → enqueues + returns a job_id ack, does NOT run inline', async () => {
    enqueueMock.mockResolvedValue('JOB123');
    const r = await oneClickProposal({ rfp_text: 'The Offeror shall do X.', userEmail: 'u@x.com' }) as OneClickProposalJobAck;
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(r.job_id).toBe('JOB123');
    expect(r.status).toBe('queued');
    expect(r._meta.async).toBe(true);
    expect(r.poll_with).toContain('get_proposal_job');
  });

  it('queue unavailable (enqueue → null) → falls back to the inline pipeline (no hard failure)', async () => {
    enqueueMock.mockResolvedValue(null);
    const r = await oneClickProposal({ rfp_text: 'The Offeror shall do X.', userEmail: 'u@x.com' });
    // inline result shape, not a job ack
    expect('job_id' in r).toBe(false);
    expect('_meta' in r && 'stages' in (r as { _meta: object })._meta).toBe(true);
  });

  it('async:false → runs inline directly, never enqueues', async () => {
    const r = await oneClickProposal({ rfp_text: 'The Offeror shall do X.', async: false, userEmail: 'u@x.com' });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect('job_id' in r).toBe(false);
  });

  it('no RFP → honest miss, never enqueues', async () => {
    const r = await oneClickProposal({ userEmail: 'u@x.com' });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect('job_id' in r).toBe(false);
  });
});

describe('get_proposal_job — poll (FM-P03)', () => {
  it('missing job_id → not_found, no throw', async () => {
    const r = await getProposalJobTool({ userEmail: 'u@x.com' });
    expect(r.status).toBe('not_found');
    expect(r._meta.grounded).toBe(false);
  });

  it('running job → status running, no result yet', async () => {
    getJobMock.mockResolvedValue({ id: 'J', status: 'running', result: null, error: null });
    const r = await getProposalJobTool({ job_id: 'J', userEmail: 'u@x.com' });
    expect(r.status).toBe('running');
    expect(r.result).toBeNull();
    expect(r._meta.done).toBe(false);
  });

  it('done job → returns the full result', async () => {
    getJobMock.mockResolvedValue({ id: 'J', status: 'done', result: { deliverable: { byte_size: 9 } }, error: null });
    const r = await getProposalJobTool({ job_id: 'J', userEmail: 'u@x.com' });
    expect(r.status).toBe('done');
    expect(r._meta.grounded).toBe(true);
    expect((r.result as { deliverable: { byte_size: number } })?.deliverable.byte_size).toBe(9);
  });

  it('unknown id → not_found (ownership-scoped miss)', async () => {
    getJobMock.mockResolvedValue(null);
    const r = await getProposalJobTool({ job_id: 'nope', userEmail: 'u@x.com' });
    expect(r.status).toBe('not_found');
  });
});
