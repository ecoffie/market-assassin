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
 * Production store is always cwd/out/mrr-workspace. Path construction keeps
 * those two segments as string literals so NFT can bound the directory instead
 * of tracing the whole project. Tests may redirect via env; that branch is
 * string-concatenated (not join(cwd, free-form)) and every fs call below
 * receives a bare path marked turbopackIgnore.
 */
function workspaceFile(parts: readonly string[]): string {
  const productionPath = join(process.cwd(), 'out', 'mrr-workspace', ...parts);
  const testRoot = process.env.MRR_WORKSPACE_STORE_ROOT;
  if (testRoot) return [testRoot, ...parts].join(sep);
  return productionPath;
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

export function persistJob(job: MrrRunJob): void {
  if (!isSafeMrrRunId(job.id)) return;
  mkdirSync(/* turbopackIgnore: true */ jobDir(job.id), { recursive: true });
  const record: PersistedMrrJob = {
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
  writeJobJson(job.id, record);
  writeDedupJson(createHash('sha256').update(dedupKey(job.ownerEmail, job.intakeHash)).digest('hex'), {
    runId: job.id,
    ownerEmail: job.ownerEmail,
    intakeHash: job.intakeHash,
  });
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
