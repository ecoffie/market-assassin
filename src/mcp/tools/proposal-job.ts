/**
 * MCP tool: get_proposal_job — poll an async one_click_proposal job by id.
 *
 * one_click_proposal (async, the default) enqueues a background job and returns a job_id; the 5-pass
 * pipeline runs in a worker (FM-P03 — no gateway timeout). This tool returns the job's status and, when
 * done, the full proposal result (matrix + structure + draft + compliance score + the .docx base64).
 * Cheap + fast (one row read) so polling never hits the window. Ownership-scoped to the verified caller.
 * credits: 0 (a status poll shouldn't be charged).
 */
import { getProposalJob } from '@/lib/proposal/job-store';

export interface ProposalJobToolInput {
  job_id?: string;
  /** The verified MCP caller (ctx.userEmail) — never from args. */
  userEmail?: string | null;
}

export interface ProposalJobToolResult {
  job_id: string | null;
  status: 'queued' | 'running' | 'done' | 'error' | 'not_found';
  result: Record<string, unknown> | null;
  error: string | null;
  _meta: { grounded: boolean; degraded: boolean; done: boolean };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
}

export async function getProposalJobTool(input: ProposalJobToolInput): Promise<ProposalJobToolResult> {
  const jobId = (input.job_id || '').trim();
  if (!jobId) {
    return {
      job_id: null, status: 'not_found', result: null,
      error: 'Provide the job_id returned by one_click_proposal.',
      _meta: { grounded: false, degraded: false, done: false },
    };
  }
  const job = await getProposalJob(jobId, input.userEmail || 'anonymous');
  if (!job) {
    return {
      job_id: jobId, status: 'not_found', result: null,
      error: 'No job found for that id under your account (it may have expired, or belong to another account).',
      _meta: { grounded: false, degraded: false, done: false },
    };
  }
  const done = job.status === 'done';
  const result: ProposalJobToolResult = {
    job_id: job.id,
    status: job.status,
    result: done ? job.result : null,
    error: job.status === 'error' ? job.error : null,
    _meta: { grounded: done, degraded: job.status === 'error', done },
  };
  return result;
}
