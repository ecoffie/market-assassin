/**
 * Durable MRR job metadata for the Ralph demo.
 *
 * Process-local Maps and cwd/out/mrr-workspace are still the local cache, but
 * Vercel instances do not share that disk. Completed review JSON is mirrored to
 * Vercel KV so a run can be reopened without a terminal or a local checkout.
 * DOCX bytes stay on the instance that assembled them (best-effort download).
 */
import { createHash } from 'node:crypto';
import { kv } from '@vercel/kv';
import {
  dedupKey,
  hydratePersisted,
  rememberJob,
  type MrrRunJob,
} from './run-store-read';

const JOB_TTL_SECONDS = 60 * 60 * 24 * 30;

function kvConfigured(): boolean {
  if (process.env.VITEST) return false;
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export function isMrrKvConfigured(): boolean {
  return kvConfigured();
}

function jobKey(id: string): string {
  return `mrr:job:${id}`;
}

function dedupKvKey(ownerEmail: string, intakeHash: string): string {
  return `mrr:dedup:${createHash('sha256').update(dedupKey(ownerEmail, intakeHash)).digest('hex')}`;
}

export async function mirrorMrrJob(job: MrrRunJob): Promise<void> {
  if (!kvConfigured()) return;
  try {
    const record = {
      version: 1 as const,
      id: job.id,
      ownerEmail: job.ownerEmail,
      intakeHash: job.intakeHash,
      input: job.input,
      status: job.status,
      progress: job.progress,
      progressHistory: job.progressHistory,
      artifacts: job.artifacts,
      review: job.review,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
    await kv.set(jobKey(job.id), record, { ex: JOB_TTL_SECONDS });
    await kv.set(
      dedupKvKey(job.ownerEmail, job.intakeHash),
      { runId: job.id, ownerEmail: job.ownerEmail, intakeHash: job.intakeHash },
      { ex: JOB_TTL_SECONDS },
    );
  } catch (error) {
    console.warn('[mrr-workspace] KV mirror unavailable', error);
  }
}

export async function loadMrrJobFromKv(id: string): Promise<MrrRunJob | null> {
  if (!kvConfigured()) return null;
  try {
    const raw = await kv.get(jobKey(id));
    const job = hydratePersisted(raw);
    if (!job || job.id !== id) return null;
    rememberJob(job);
    return job;
  } catch (error) {
    console.warn('[mrr-workspace] KV job read unavailable', error);
    return null;
  }
}

export async function loadMrrDedupFromKv(
  ownerEmail: string,
  intakeHash: string,
): Promise<MrrRunJob | null> {
  if (!kvConfigured()) return null;
  try {
    const raw = await kv.get(dedupKvKey(ownerEmail, intakeHash));
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as { runId?: unknown };
    if (typeof record.runId !== 'string') return null;
    return loadMrrJobFromKv(record.runId);
  } catch (error) {
    console.warn('[mrr-workspace] KV dedup read unavailable', error);
    return null;
  }
}
