import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Requirement } from './types';
import type { Phase1ReviewDto } from './workspace-dto';
import {
  PROGRESS_LABEL,
  isSafeMrrRunId,
  type MrrArtifactKind,
  type MrrJobStatus,
  type Phase1ProgressStage,
} from './workspace-constants';

export type {
  MrrArtifactKind,
  MrrJobStatus,
  Phase1ProgressStage,
} from './workspace-constants';
export { isSafeMrrRunId, PROGRESS_LABEL } from './workspace-constants';

export interface MrrProgressEvent {
  stage: Phase1ProgressStage;
  at: string;
}

export interface MrrBoundArtifact {
  path: string;
  fileName: string;
  sha256: string;
  /** True once the bytes are in durable storage (survive instance changes). */
  stored?: boolean;
}

export interface MrrBoundArtifacts {
  mrr: MrrBoundArtifact;
  appendix: MrrBoundArtifact;
  evidence: MrrBoundArtifact;
}

export interface MrrRunJob {
  id: string;
  ownerEmail: string;
  intakeHash: string;
  input: Record<string, unknown>;
  status: MrrJobStatus;
  progress: Phase1ProgressStage;
  progressHistory: MrrProgressEvent[];
  result: unknown | null;
  artifacts: MrrBoundArtifacts | null;
  review: Phase1ReviewDto | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PersistedMrrJob {
  version: 1;
  id: string;
  ownerEmail: string;
  intakeHash: string;
  input: Record<string, unknown>;
  status: MrrJobStatus;
  progress: Phase1ProgressStage;
  progressHistory: MrrProgressEvent[];
  artifacts: MrrBoundArtifacts | null;
  review: Phase1ReviewDto | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MrrRunJobDto {
  id: string;
  intakeHash: string;
  status: MrrJobStatus;
  progress: Phase1ProgressStage;
  progressLabel: string;
  progressHistory: MrrProgressEvent[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  review: Phase1ReviewDto | null;
  /**
   * Completed runs only: whether all three files can be downloaded right now.
   * `null` = could not be checked. Absent on queued/running/error runs.
   */
  filesAvailable?: boolean | null;
}

/**
 * Process-local Maps are a cache only. Next.js can compile sibling routes into
 * separate module instances, so POST/GET status and GET download do not share
 * one Map. Completed-run metadata is persisted beside the artifacts under
 * out/mrr-workspace/<runId>/.
 */
const jobs = new Map<string, MrrRunJob>();
const dedupIndex = new Map<string, string>();

const SECRET_KEY =
  /password|secret|token|credential|authorization|cookie|api[_-]?key|private[_-]?key|smtp/i;

/**
 * Production store is always cwd/out/mrr-workspace on a writable workstation.
 * Path construction keeps those two segments as string literals so NFT can bound
 * the directory instead of tracing the whole project.
 *
 * On Vercel the deployment filesystem is read-only at cwd, so assembly uses
 * /tmp/mrr-workspace for the request lifecycle only. Durable reopen is Vercel KV
 * (run-store-remote) — /tmp is never the reopen source of truth.
 * Tests may redirect via env; that branch is string-concatenated (not join(cwd,
 * free-form)) and every fs call below receives a bare path marked turbopackIgnore.
 */
function workspaceFile(parts: readonly string[]): string {
  const testRoot = process.env.MRR_WORKSPACE_STORE_ROOT;
  if (testRoot) return [testRoot, ...parts].join(sep);
  if (process.env.VERCEL) {
    return ['/tmp', 'mrr-workspace', ...parts].join(sep);
  }
  return join(process.cwd(), 'out', 'mrr-workspace', ...parts);
}

function workspaceExists(parts: readonly string[]): boolean {
  const target = workspaceFile(parts);
  return existsSync(/* turbopackIgnore: true */ target);
}

function readWorkspaceUtf8(parts: readonly string[]): string {
  const target = workspaceFile(parts);
  return readFileSync(/* turbopackIgnore: true */ target, 'utf8');
}

function readWorkspaceBuffer(parts: readonly string[]): Buffer {
  const target = workspaceFile(parts);
  return readFileSync(/* turbopackIgnore: true */ target);
}

function writeWorkspaceUtf8(parts: readonly string[], contents: string): void {
  const target = workspaceFile(parts);
  mkdirSync(/* turbopackIgnore: true */ dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(/* turbopackIgnore: true */ tmp, contents);
  renameSync(/* turbopackIgnore: true */ tmp, /* turbopackIgnore: true */ target);
}

export function mrrWorkspaceStoreRoot(): string {
  return workspaceFile([]);
}

export function setMrrWorkspaceStoreRootForTests(root: string): void {
  process.env.MRR_WORKSPACE_STORE_ROOT = root;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function normalizedIntakeHash(requirement: Requirement): string {
  return createHash('sha256').update(canonicalJson(requirement)).digest('hex');
}

function newRunId(): string {
  return randomBytes(16).toString('base64url');
}

export function dedupKey(ownerEmail: string, intakeHash: string): string {
  return `${ownerEmail.toLowerCase().trim()}:${intakeHash}`;
}

function publicInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = value;
  }
  return out;
}

export function jobDir(id: string): string {
  return workspaceFile([id]);
}

export function isInsideDir(filePath: string, dir: string): boolean {
  const resolvedFile = resolve(filePath);
  const resolvedDir = resolve(dir);
  return resolvedFile === resolvedDir || resolvedFile.startsWith(resolvedDir + sep);
}

function readJobJson(id: string): unknown | null {
  if (!isSafeMrrRunId(id)) return null;
  const parts = [id, 'job.json'] as const;
  if (!workspaceExists(parts)) return null;
  try {
    return JSON.parse(readWorkspaceUtf8(parts)) as unknown;
  } catch {
    return null;
  }
}

function readDedupJson(digest: string): unknown | null {
  if (!/^[a-f0-9]{64}$/.test(digest)) return null;
  const parts = ['dedup', `${digest}.json`] as const;
  if (!workspaceExists(parts)) return null;
  try {
    return JSON.parse(readWorkspaceUtf8(parts)) as unknown;
  } catch {
    return null;
  }
}

function writeJobJson(id: string, value: unknown): void {
  if (!isSafeMrrRunId(id)) return;
  writeWorkspaceUtf8([id, 'job.json'], `${JSON.stringify(value, null, 2)}\n`);
}

function writeDedupJson(digest: string, value: unknown): void {
  if (!/^[a-f0-9]{64}$/.test(digest)) return;
  writeWorkspaceUtf8(['dedup', `${digest}.json`], `${JSON.stringify(value, null, 2)}\n`);
}

function isTransientFsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'EACCES' || code === 'EROFS' || code === 'EPERM';
}

function jobRecord(job: MrrRunJob): PersistedMrrJob {
  return {
    version: 1,
    id: job.id,
    ownerEmail: job.ownerEmail,
    intakeHash: job.intakeHash,
    input: publicInput(job.input),
    status: job.status,
    progress: job.progress,
    progressHistory: job.progressHistory,
    artifacts: job.artifacts,
    review: job.review,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/** Best-effort local cache. Must not be required for job accept on Vercel. */
function persistJobToDisk(job: MrrRunJob): void {
  if (!isSafeMrrRunId(job.id)) return;
  mkdirSync(/* turbopackIgnore: true */ jobDir(job.id), { recursive: true });
  writeJobJson(job.id, jobRecord(job));
  writeDedupJson(createHash('sha256').update(dedupKey(job.ownerEmail, job.intakeHash)).digest('hex'), {
    runId: job.id,
    ownerEmail: job.ownerEmail,
    intakeHash: job.intakeHash,
  });
}

export function persistJob(job: MrrRunJob): void {
  try {
    persistJobToDisk(job);
  } catch (error) {
    if (!isTransientFsError(error)) throw error;
    console.warn('[mrr-workspace] local job cache unavailable', error);
  }
  if (process.env.VITEST) return;
  void import('./run-store-remote')
    .then(({ mirrorMrrJob }) => mirrorMrrJob(job))
    .catch((error) => {
      console.warn('[mrr-workspace] KV mirror skipped', error);
    });
}

/** Durable persist for hosted start/progress — awaits KV; disk is best-effort. */
export async function persistJobAsync(job: MrrRunJob): Promise<void> {
  let diskOk = false;
  try {
    persistJobToDisk(job);
    diskOk = true;
  } catch (error) {
    if (!isTransientFsError(error)) throw error;
    console.warn('[mrr-workspace] local job cache unavailable', error);
  }
  if (process.env.VITEST) return;
  const { mirrorMrrJob, isMrrKvConfigured } = await import('./run-store-remote');
  if (!isMrrKvConfigured()) {
    if (!diskOk) {
      throw new Error(
        'Market research cannot start: no writable local store and Vercel KV is not configured.',
      );
    }
    return;
  }
  await mirrorMrrJob(job);
}

export function readJobRecord(id: string): unknown | null {
  if (!isSafeMrrRunId(id)) return null;
  return readJobJson(id);
}

export function hydratePersisted(raw: unknown): MrrRunJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<PersistedMrrJob>;
  if (
    record.version !== 1 ||
    typeof record.id !== 'string' ||
    !isSafeMrrRunId(record.id) ||
    typeof record.ownerEmail !== 'string' ||
    typeof record.intakeHash !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.createdAt !== 'string'
  ) {
    return null;
  }
  return {
    id: record.id,
    ownerEmail: record.ownerEmail.toLowerCase().trim(),
    intakeHash: record.intakeHash,
    input: publicInput((record.input ?? {}) as Record<string, unknown>),
    status: record.status,
    progress: record.progress ?? 'queued',
    progressHistory: Array.isArray(record.progressHistory) ? record.progressHistory : [],
    result: null,
    artifacts: record.artifacts ?? null,
    review: record.review ?? null,
    error: record.error ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
  };
}

function loadJobFromDisk(id: string): MrrRunJob | null {
  if (!isSafeMrrRunId(id)) return null;
  const job = hydratePersisted(readJobRecord(id));
  if (!job || job.id !== id) return null;
  jobs.set(job.id, job);
  dedupIndex.set(dedupKey(job.ownerEmail, job.intakeHash), job.id);
  return job;
}

function loadDedupFromDisk(ownerEmail: string, intakeHash: string): MrrRunJob | null {
  const digest = createHash('sha256').update(dedupKey(ownerEmail, intakeHash)).digest('hex');
  const raw = readDedupJson(digest);
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { runId?: unknown; ownerEmail?: unknown; intakeHash?: unknown };
  if (typeof record.runId !== 'string') return null;
  const job = loadJob(record.runId);
  if (!job || job.ownerEmail !== ownerEmail || job.intakeHash !== intakeHash) {
    return null;
  }
  return job;
}

export function loadJob(id: string): MrrRunJob | null {
  return jobs.get(id) ?? loadJobFromDisk(id);
}

export function rememberJob(job: MrrRunJob): void {
  jobs.set(job.id, job);
  dedupIndex.set(dedupKey(job.ownerEmail, job.intakeHash), job.id);
}

export function stampProgress(job: MrrRunJob, stage: Phase1ProgressStage): void {
  const at = new Date().toISOString();
  job.progress = stage;
  job.updatedAt = at;
  const previous = job.progressHistory.at(-1);
  if (previous?.stage !== stage) job.progressHistory.push({ stage, at });
  persistJob(job);
}

export async function stampProgressAsync(
  job: MrrRunJob,
  stage: Phase1ProgressStage,
): Promise<void> {
  const at = new Date().toISOString();
  job.progress = stage;
  job.updatedAt = at;
  const previous = job.progressHistory.at(-1);
  if (previous?.stage !== stage) job.progressHistory.push({ stage, at });
  await persistJobAsync(job);
}

export function createOrGetMrrJob(args: {
  ownerEmail: string;
  input: Record<string, unknown>;
  normalizedRequirement: Requirement;
}): { job: MrrRunJobDto; created: boolean } {
  const ownerEmail = args.ownerEmail.toLowerCase().trim();
  const intakeHash = normalizedIntakeHash(args.normalizedRequirement);
  const key = dedupKey(ownerEmail, intakeHash);
  const existingId = dedupIndex.get(key);
  if (existingId) {
    const existing = loadJob(existingId);
    if (existing) return { job: toMrrJobDto(existing), created: false };
  }
  const fromDisk = loadDedupFromDisk(ownerEmail, intakeHash);
  if (fromDisk) return { job: toMrrJobDto(fromDisk), created: false };

  const now = new Date().toISOString();
  const job: MrrRunJob = {
    id: newRunId(),
    ownerEmail,
    intakeHash,
    input: publicInput({ ...args.normalizedRequirement }),
    status: 'queued',
    progress: 'queued',
    progressHistory: [{ stage: 'queued', at: now }],
    result: null,
    artifacts: null,
    review: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  rememberJob(job);
  persistJob(job);
  return { job: toMrrJobDto(job), created: true };
}

/** A run that started but has not advanced for this long died with its instance. */
export const MRR_STALE_RUN_MS = 8 * 60 * 1000;

function loadDedupLocal(ownerEmail: string, intakeHash: string): MrrRunJob | null {
  const id = dedupIndex.get(dedupKey(ownerEmail, intakeHash));
  const cached = id ? loadJob(id) : null;
  return cached ?? loadDedupFromDisk(ownerEmail, intakeHash);
}

/**
 * Should repeating this exact question run it again instead of returning the
 * cached run? Yes when the cached run failed, stalled, or completed but its
 * files can no longer be served (e.g. built in /tmp before durable storage).
 * An unknown file check (storage unreachable) is NOT treated as missing.
 */
export async function needsRerun(job: MrrRunJob, now = Date.now()): Promise<boolean> {
  if (job.status === 'error') return true;
  if (job.status === 'queued' || job.status === 'running') {
    const updated = Date.parse(job.updatedAt);
    return Number.isFinite(updated) && now - updated > MRR_STALE_RUN_MS;
  }
  return (await mrrFilesAvailable(job)) === false;
}

/** Reset a run to queued under the SAME id, then persist durably. */
export async function requeueMrrJobAsync(job: MrrRunJob): Promise<void> {
  const now = new Date().toISOString();
  job.status = 'queued';
  job.progress = 'queued';
  job.progressHistory = [{ stage: 'queued', at: now }];
  job.result = null;
  job.artifacts = null;
  job.review = null;
  job.error = null;
  job.updatedAt = now;
  rememberJob(job);
  await persistJobAsync(job);
}

/**
 * Hosted accept path. Prefers KV dedup, then creates a job and **awaits** KV
 * mirror so reopen/poll work across Vercel instances. Local disk is cache only.
 */
export async function createOrGetMrrJobAsync(args: {
  ownerEmail: string;
  input: Record<string, unknown>;
  normalizedRequirement: Requirement;
}): Promise<{ job: MrrRunJobDto; created: boolean }> {
  const ownerEmail = args.ownerEmail.toLowerCase().trim();
  const intakeHash = normalizedIntakeHash(args.normalizedRequirement);
  const { loadMrrDedupFromKv, mirrorMrrJob, isMrrKvConfigured } = await import('./run-store-remote');
  const remote = await loadMrrDedupFromKv(ownerEmail, intakeHash);
  if (remote) {
    if (await needsRerun(remote)) {
      await requeueMrrJobAsync(remote);
      return { job: toMrrJobDto(remote), created: true };
    }
    return { job: toMrrJobDto(remote), created: false };
  }
  const local = loadDedupLocal(ownerEmail, intakeHash);
  if (local && (await needsRerun(local))) {
    await requeueMrrJobAsync(local);
    return { job: toMrrJobDto(local), created: true };
  }
  const { job, created } = createOrGetMrrJob(args);
  if (created) {
    const full = loadJob(job.id);
    if (!full) {
      throw new Error('Market research cannot start: job was not retained after create.');
    }
    if (isMrrKvConfigured()) {
      await mirrorMrrJob(full);
    } else if (process.env.VERCEL) {
      throw new Error(
        'Market research cannot start on Vercel without KV_REST_API_URL / KV_REST_API_TOKEN.',
      );
    } else {
      await persistJobAsync(full);
    }
  }
  return { job, created };
}

/**
 * Resolve a validated basename inside the bound run directory. Never trusts a
 * persisted absolute path; GET/download re-join from the store root.
 */
export function resolveBoundArtifactPath(id: string, fileName: string): string | null {
  if (!isSafeMrrRunId(id)) return null;
  const base = basename(fileName);
  if (!base || base !== fileName || fileName.includes('..')) return null;
  const dir = jobDir(id);
  const resolved = workspaceFile([id, base]);
  if (!isInsideDir(resolved, dir) || !workspaceExists([id, base])) return null;
  return resolved;
}

export function getMrrJob(id: string, ownerEmail: string): MrrRunJobDto | null {
  if (!isSafeMrrRunId(id)) return null;
  const job = loadJob(id);
  if (!job || job.ownerEmail !== ownerEmail.toLowerCase().trim()) return null;
  return toMrrJobDto(job);
}

export async function getMrrJobAsync(
  id: string,
  ownerEmail: string,
): Promise<MrrRunJobDto | null> {
  const local = getMrrJob(id, ownerEmail);
  if (local) return local;
  const { loadMrrJobFromKv } = await import('./run-store-remote');
  const remote = await loadMrrJobFromKv(id);
  if (!remote || remote.ownerEmail !== ownerEmail.toLowerCase().trim()) return null;
  return toMrrJobDto(remote);
}

export function getMrrArtifact(
  id: string,
  ownerEmail: string,
  kind: MrrArtifactKind,
): { path: string; fileName: string; intakeHash: string; sha256: string } | null {
  if (!isSafeMrrRunId(id)) return null;
  const job = loadJob(id);
  if (
    !job ||
    job.ownerEmail !== ownerEmail.toLowerCase().trim() ||
    job.status !== 'done' ||
    !job.artifacts
  ) {
    return null;
  }
  const artifact = job.artifacts[kind];
  const resolved = resolveBoundArtifactPath(id, artifact.fileName);
  if (!resolved) return null;
  return {
    path: resolved,
    fileName: artifact.fileName,
    intakeHash: job.intakeHash,
    sha256: artifact.sha256,
  };
}

export function readBoundArtifactFile(id: string, fileName: string): Buffer | null {
  if (!isSafeMrrRunId(id)) return null;
  const base = basename(fileName);
  if (!base || base !== fileName || fileName.includes('..')) return null;
  const path = workspaceFile([id, base]);
  if (!isInsideDir(path, jobDir(id)) || !workspaceExists([id, base])) return null;
  return readWorkspaceBuffer([id, base]);
}

export function toMrrJobDto(job: MrrRunJob): MrrRunJobDto {
  return {
    id: job.id,
    intakeHash: job.intakeHash,
    status: job.status,
    progress: job.progress,
    progressLabel: PROGRESS_LABEL[job.progress],
    progressHistory: [...job.progressHistory],
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    review: job.review,
  };
}

export function resetMrrRunStoreForTests(): void {
  jobs.clear();
  dedupIndex.clear();
}

/** Owner-bound job from this instance's cache, else Vercel KV. */
export async function loadOwnedMrrJobAsync(
  id: string,
  ownerEmail: string,
): Promise<MrrRunJob | null> {
  if (!isSafeMrrRunId(id)) return null;
  const owner = ownerEmail.toLowerCase().trim();
  // KV is the source of truth across instances. A process-local copy can be a
  // stale snapshot (loaded mid-run by another request), so it is consulted only
  // when KV has no record (workstation runs, or KV unreachable).
  const { loadMrrJobFromKv } = await import('./run-store-remote');
  const remote = await loadMrrJobFromKv(id);
  if (remote) return remote.ownerEmail === owner ? remote : null;
  const local = loadJob(id);
  return local && local.ownerEmail === owner ? local : null;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export type OwnedArtifactRead =
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string }
  | {
      status: 'ok';
      bytes: Buffer;
      fileName: string;
      sha256: string;
      intakeHash: string;
    };

/**
 * Read one deliverable for its owner. Unknown run, wrong owner and unfinished
 * run are indistinguishable (`not_found`) so a run id cannot be probed.
 * Local bytes are used when this instance assembled the run; otherwise the
 * durable copy is read. Both are verified against the recorded sha256.
 */
export async function readOwnedMrrArtifact(
  id: string,
  ownerEmail: string,
  kind: MrrArtifactKind,
): Promise<OwnedArtifactRead> {
  const job = await loadOwnedMrrJobAsync(id, ownerEmail);
  if (!job || job.status !== 'done' || !job.artifacts) return { status: 'not_found' };
  const artifact = job.artifacts[kind];
  const base = basename(artifact.fileName);
  if (!base || base !== artifact.fileName) return { status: 'not_found' };

  try {
    const local = readBoundArtifactFile(id, base);
    if (local && sha256Hex(local) === artifact.sha256) {
      return { status: 'ok', bytes: local, fileName: base, sha256: artifact.sha256, intakeHash: job.intakeHash };
    }
  } catch {
    // fall through to durable storage
  }
  const { getMrrArtifactBytes } = await import('./artifact-storage');
  const stored = await getMrrArtifactBytes(id, base, artifact.sha256);
  if (stored) {
    return { status: 'ok', bytes: stored, fileName: base, sha256: artifact.sha256, intakeHash: job.intakeHash };
  }
  return {
    status: 'unavailable',
    reason: 'The files for this run are no longer available. Rebuild them to download.',
  };
}

/**
 * Can every deliverable of a completed run be served? true/false, or null when
 * durable storage could not be checked (never reported as "missing").
 */
export async function mrrFilesAvailable(job: MrrRunJob): Promise<boolean | null> {
  if (job.status !== 'done' || !job.artifacts) return false;
  const kinds = ['mrr', 'appendix', 'evidence'] as const;
  const localOk = kinds.every((kind) => {
    const base = basename(job.artifacts![kind].fileName);
    return Boolean(base) && workspaceExists([job.id, base]);
  });
  if (localOk) return true;
  const { storedMrrArtifactNames } = await import('./artifact-storage');
  const names = await storedMrrArtifactNames(job.id);
  if (!names) return null;
  return kinds.every((kind) => names.has(job.artifacts![kind].fileName));
}
