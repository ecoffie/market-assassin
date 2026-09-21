/**
 * Async job queue for one_click_proposal (FM-P03, 2026-07-28).
 *
 * one_click_proposal chains 5 sequential LLM passes and blows the 60s MCP gateway window on a real
 * RFP. Instead of running inline, the tool ENQUEUES a job here and returns the id immediately; a
 * dispatcher-fired worker (/api/cron/run-proposal-jobs) drains queued jobs with a long maxDuration and
 * writes the result back; the caller polls get_proposal_job by id.
 *
 * Degrade-clean: every function tolerates the table not existing yet (migration-pending) — enqueue
 * returns null so the tool can fall back to running inline, and reads return null rather than throwing.
 * The id is a 128-bit capability token (the access key); owner_email scopes ownership.
 */
import { randomBytes } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ProposalJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface ProposalJob {
  id: string;
  owner_email: string;
  status: ProposalJobStatus;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

function client(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 22-char base64url token — 128 bits, not enumerable. */
export function newJobId(): string {
  return randomBytes(16).toString('base64url');
}

/** A PostgREST "relation does not exist" (migration not run yet) — degrade, don't throw. */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || /relation .*proposal_jobs.* does not exist/i.test(err.message || '');
}

/**
 * Enqueue a job. Returns the new id, or null when storage is unavailable / the table is missing
 * (so the caller can fall back to running the pipeline inline).
 */
export async function enqueueProposalJob(input: {
  ownerEmail: string;
  jobInput: Record<string, unknown>;
}): Promise<string | null> {
  const sb = client();
  if (!sb) return null;
  const id = newJobId();
  const { error } = await sb.from('proposal_jobs').insert({
    id,
    owner_email: input.ownerEmail,
    status: 'queued',
    input: input.jobInput,
  });
  if (error) {
    if (!isMissingTable(error)) console.error('[proposal-jobs] enqueue failed:', error.message);
    return null;
  }
  return id;
}

/** Read one job — scoped to its owner (a caller can only see their own job). Null on miss/error. */
export async function getProposalJob(id: string, ownerEmail: string): Promise<ProposalJob | null> {
  const sb = client();
  if (!sb) return null;
  const { data, error } = await sb
    .from('proposal_jobs')
    .select('*')
    .eq('id', id)
    .eq('owner_email', ownerEmail)
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error('[proposal-jobs] get failed:', error.message);
    return null;
  }
  return (data as ProposalJob) || null;
}

/**
 * Atomically claim the oldest runnable job (queued, or running but stale-locked past `staleMs`).
 * The UPDATE ... WHERE status matches is the lock: two workers can't claim the same row. Returns the
 * claimed job or null when the queue is empty / the table is missing.
 */
export async function claimNextProposalJob(staleMs = 600_000): Promise<ProposalJob | null> {
  const sb = client();
  if (!sb) return null;
  const staleBefore = new Date(Date.now() - staleMs).toISOString();
  // Candidate: queued, OR running with a lock older than staleMs (a crashed worker's job).
  const { data: cands, error: selErr } = await sb
    .from('proposal_jobs')
    .select('id, attempts')
    .or(`status.eq.queued,and(status.eq.running,locked_at.lt.${staleBefore})`)
    .order('created_at', { ascending: true })
    .limit(5);
  if (selErr) {
    if (!isMissingTable(selErr)) console.error('[proposal-jobs] claim select failed:', selErr.message);
    return null;
  }
  for (const c of cands || []) {
    // Claim it: flip to running only if it's still claimable (CAS on the id + a not-locked-since guard).
    const { data: claimed, error: updErr } = await sb
      .from('proposal_jobs')
      .update({ status: 'running', locked_at: new Date().toISOString(), attempts: (c.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', c.id)
      .in('status', ['queued', 'running'])
      .lt('locked_at', staleBefore)  // only reclaim if not freshly locked; queued rows have NULL locked_at
      .select('*')
      .maybeSingle();
    // The NULL-locked_at queued rows won't match .lt(); handle them with a second attempt below.
    if (!updErr && claimed) return claimed as ProposalJob;
    // queued row (locked_at is NULL) — claim without the stale guard.
    const { data: claimedQ } = await sb
      .from('proposal_jobs')
      .update({ status: 'running', locked_at: new Date().toISOString(), attempts: (c.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', c.id)
      .eq('status', 'queued')
      .select('*')
      .maybeSingle();
    if (claimedQ) return claimedQ as ProposalJob;
  }
  return null;
}

/** Mark a claimed job done with its result payload. */
export async function completeProposalJob(id: string, result: Record<string, unknown>): Promise<void> {
  const sb = client();
  if (!sb) return;
  const { error } = await sb
    .from('proposal_jobs')
    .update({ status: 'done', result, error: null, locked_at: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error && !isMissingTable(error)) console.error('[proposal-jobs] complete failed:', error.message);
}

/** Mark a claimed job errored. */
export async function failProposalJob(id: string, message: string): Promise<void> {
  const sb = client();
  if (!sb) return;
  const { error } = await sb
    .from('proposal_jobs')
    .update({ status: 'error', error: message.slice(0, 2000), locked_at: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error && !isMissingTable(error)) console.error('[proposal-jobs] fail failed:', error.message);
}
