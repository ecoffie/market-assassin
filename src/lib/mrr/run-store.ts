import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { Requirement } from './types';
import {
  runPhase1,
  type Phase1Artifacts,
  type Phase1ProgressStage,
  type Phase1RunResult,
  type RunPhase1Options,
} from './run-phase1';
import { reviewSourceFromEvidence } from './review-from-evidence';
import { createPhase1ReviewDto, type Phase1ReviewDto } from './workspace-dto';

export type MrrJobStatus = 'queued' | 'running' | 'done' | 'error';
export type MrrArtifactKind = 'mrr' | 'appendix' | 'evidence';

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

interface MrrRunJob {
  id: string;
  ownerEmail: string;
  intakeHash: string;
  input: Record<string, unknown>;
  status: MrrJobStatus;
  progress: Phase1ProgressStage;
  progressHistory: MrrProgressEvent[];
  result: Phase1RunResult | null;
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

type WorkspaceRunner = (
  input: Record<string, unknown>,
  options: RunPhase1Options,
) => Promise<Phase1RunResult>;

/**
 * Process-local Maps are a cache only. Next.js can compile sibling routes into
 * separate module instances, so POST/GET status and GET download do not share
 * one Map. Completed-run metadata is persisted beside the artifacts that
 * runPhase1 already writes under out/mrr-workspace/<runId>/.
 */
const jobs = new Map<string, MrrRunJob>();
const dedupIndex = new Map<string, string>();

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SECRET_KEY =
  /password|secret|token|credential|authorization|cookie|api[_-]?key|private[_-]?key|smtp/i;

let storeRoot = join(process.cwd(), 'out', 'mrr-workspace');

const PROGRESS_LABEL: Record<Phase1ProgressStage, string> = {
  queued: 'Queued',
  running_section_5: 'Researching §5 Taxonomy',
  running_section_9: 'Researching §9 Procurement History',
  running_section_11: 'Researching §11 Potential Suppliers',
  running_section_12: 'Assessing §12 Small Business / Rule of Two',
  running_section_15: 'Researching §15 Market Intelligence',
  assembling_documents: 'Assembling MRR and evidence artifacts',
  complete: 'Complete',
  complete_degraded: 'Complete with degraded evidence',
  failed: 'Failed',
};

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

export function isSafeMrrRunId(id: string): boolean {
  return RUN_ID_PATTERN.test(id);
}

export function mrrWorkspaceStoreRoot(): string {
  return storeRoot;
}

export function setMrrWorkspaceStoreRootForTests(root: string): void {
  storeRoot = root;
}

function newRunId(): string {
  return randomBytes(16).toString('base64url');
}

function dedupKey(ownerEmail: string, intakeHash: string): string {
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

function jobDir(id: string): string {
  return join(storeRoot, id);
}

function jobPath(id: string): string {
  return join(jobDir(id), 'job.json');
}

function dedupPath(key: string): string {
  const digest = createHash('sha256').update(key).digest('hex');
  return join(storeRoot, 'dedup', `${digest}.json`);
}

function isInsideDir(filePath: string, dir: string): boolean {
  const resolvedFile = resolve(filePath);
  const resolvedDir = resolve(dir);
  return resolvedFile === resolvedDir || resolvedFile.startsWith(resolvedDir + sep);
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function bindArtifacts(runId: string, artifacts: Phase1Artifacts): MrrBoundArtifacts | null {
  const dir = jobDir(runId);
  mkdirSync(dir, { recursive: true });
  const bound = {} as MrrBoundArtifacts;
  for (const kind of ['mrr', 'appendix', 'evidence'] as const) {
    const item = artifacts[kind];
    const fileName = basename(item.fileName);
    if (!fileName || fileName !== item.fileName || fileName.includes('..')) return null;
    const source = resolve(item.path);
    if (!existsSync(source)) return null;
    const dest = join(dir, fileName);
    if (source !== dest) writeFileSync(dest, readFileSync(source));
    bound[kind] = {
      path: dest,
      fileName,
      sha256: sha256File(dest),
    };
  }
  return bound;
}

function siblingArtifactNames(evidenceFileName: string): {
  mrr: string;
  appendix: string;
  evidence: string;
} {
  const fileName = basename(evidenceFileName);
  if (!fileName.endsWith('-evidence.json') || fileName.includes('..')) {
    throw new Error('reassembly refused: evidence artifact name is not a bound evidence JSON file');
  }
  const stem = fileName.slice(0, -'-evidence.json'.length);
  if (!stem) {
    throw new Error('reassembly refused: evidence artifact name is missing its run stem');
  }
  return {
    mrr: `${stem}.docx`,
    appendix: `${stem}-appendix.docx`,
    evidence: fileName,
  };
}

function bindExistingArtifacts(
  runId: string,
  names: { mrr: string; appendix: string; evidence: string },
): MrrBoundArtifacts | null {
  const dir = jobDir(runId);
  const bound = {} as MrrBoundArtifacts;
  for (const kind of ['mrr', 'appendix', 'evidence'] as const) {
    const fileName = basename(names[kind]);
    if (!fileName || fileName !== names[kind] || fileName.includes('..')) return null;
    const dest = join(dir, fileName);
    if (!isInsideDir(dest, dir) || !existsSync(dest)) return null;
    bound[kind] = {
      path: dest,
      fileName,
      sha256: sha256File(dest),
    };
  }
  return bound;
}

function resolveEvidencePath(runId: string, existing: MrrRunJob | null): string {
  if (existing?.artifacts?.evidence?.fileName) {
    const bound = join(jobDir(runId), basename(existing.artifacts.evidence.fileName));
    if (isInsideDir(bound, jobDir(runId)) && existsSync(bound)) return bound;
  }
  const files = readdirSync(jobDir(runId)).filter(
    (name) => name.endsWith('-evidence.json') && !name.includes('..'),
  );
  if (files.length !== 1) {
    throw new Error(
      'reassembly refused: could not identify a single bound evidence JSON for this run',
    );
  }
  return join(jobDir(runId), files[0]);
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function persistJob(job: MrrRunJob): void {
  if (!isSafeMrrRunId(job.id)) return;
  mkdirSync(jobDir(job.id), { recursive: true });
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
  atomicWriteJson(jobPath(job.id), record);
  atomicWriteJson(dedupPath(dedupKey(job.ownerEmail, job.intakeHash)), {
    runId: job.id,
    ownerEmail: job.ownerEmail,
    intakeHash: job.intakeHash,
  });
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function hydratePersisted(raw: unknown): MrrRunJob | null {
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
  const job = hydratePersisted(readJson(jobPath(id)));
  if (!job || job.id !== id) return null;
  jobs.set(job.id, job);
  dedupIndex.set(dedupKey(job.ownerEmail, job.intakeHash), job.id);
  return job;
}

function loadDedupFromDisk(ownerEmail: string, intakeHash: string): MrrRunJob | null {
  const raw = readJson(dedupPath(dedupKey(ownerEmail, intakeHash)));
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { runId?: unknown; ownerEmail?: unknown; intakeHash?: unknown };
  if (typeof record.runId !== 'string') return null;
  const job = loadJob(record.runId);
  if (
    !job ||
    job.ownerEmail !== ownerEmail ||
    job.intakeHash !== intakeHash
  ) {
    return null;
  }
  return job;
}

function loadJob(id: string): MrrRunJob | null {
  return jobs.get(id) ?? loadJobFromDisk(id);
}

function stampProgress(job: MrrRunJob, stage: Phase1ProgressStage): void {
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
  jobs.set(job.id, job);
  dedupIndex.set(key, job.id);
  persistJob(job);
  return { job: toMrrJobDto(job), created: true };
}

export async function startMrrJob(
  id: string,
  ownerEmail: string,
  runner: WorkspaceRunner = runPhase1,
): Promise<void> {
  const job = loadJob(id);
  if (!job || job.ownerEmail !== ownerEmail.toLowerCase().trim()) return;
  if (job.status !== 'queued') return;

  job.status = 'running';
  stampProgress(job, 'running_section_5');
  try {
    const result = await runner(job.input, {
      runId: job.id,
      intakeHash: job.intakeHash,
      outDir: jobDir(job.id),
      onProgress(stage) {
        stampProgress(job, stage);
      },
    });
    const artifacts = bindArtifacts(job.id, result.artifacts);
    if (!artifacts) {
      throw new Error('Completed artifacts are not bound to this run directory');
    }
    job.result = result;
    job.artifacts = artifacts;
    job.review = createPhase1ReviewDto(result);
    job.status = 'done';
    job.error = null;
    stampProgress(
      job,
      result.cells.some((cell) => cell.state === 'degraded')
        ? 'complete_degraded'
        : 'complete',
    );
  } catch (error) {
    console.error('[mrr-workspace] Phase 1 run failed:', error);
    job.status = 'error';
    job.error = 'Market research generation failed. No result was recorded.';
    stampProgress(job, 'failed');
  }
}

/**
 * Persist a completed run from already-bound artifacts + evidence JSON.
 * Hashes existing files in place — never rewrites MRR/appendix/evidence bytes,
 * never calls MCP/BigQuery, and never mints a review from defaults.
 */
export function persistCompletedMrrJobFromEvidence(args: {
  runId: string;
  ownerEmail: string;
}): MrrRunJobDto {
  const runId = args.runId.trim();
  const ownerEmail = args.ownerEmail.toLowerCase().trim();
  if (!isSafeMrrRunId(runId)) {
    throw new Error('reassembly refused: run id is not a bound workspace identity');
  }
  if (!ownerEmail) {
    throw new Error('reassembly refused: owner binding is missing');
  }

  const existing = hydratePersisted(readJson(jobPath(runId)));
  if (existing && existing.id !== runId) {
    throw new Error('reassembly refused: persisted job id does not match the bound run');
  }
  if (existing && existing.ownerEmail !== ownerEmail) {
    throw new Error('reassembly refused: owner binding does not match the persisted run');
  }

  const evidencePath = resolveEvidencePath(runId, existing);
  const bundle = readJson(evidencePath);
  const reviewSource = reviewSourceFromEvidence(bundle, {
    runId,
    intakeHash: existing?.intakeHash,
  });
  const review = createPhase1ReviewDto(reviewSource);
  const names = existing?.artifacts
    ? {
        mrr: existing.artifacts.mrr.fileName,
        appendix: existing.artifacts.appendix.fileName,
        evidence: existing.artifacts.evidence.fileName,
      }
    : siblingArtifactNames(basename(evidencePath));
  const artifacts = bindExistingArtifacts(runId, names);
  if (!artifacts) {
    throw new Error('reassembly refused: completed artifacts are not bound to this run directory');
  }
  if (existing?.artifacts) {
    for (const kind of ['mrr', 'appendix', 'evidence'] as const) {
      if (existing.artifacts[kind].sha256 !== artifacts[kind].sha256) {
        throw new Error(`reassembly refused: ${kind} hash changed while persisting completed metadata`);
      }
    }
  }

  const progress: Phase1ProgressStage = reviewSource.cells.some((cell) => cell.state === 'degraded')
    ? 'complete_degraded'
    : 'complete';
  const job: MrrRunJob = {
    id: runId,
    ownerEmail,
    intakeHash: reviewSource.intakeHash,
    input: publicInput({ ...reviewSource.requirement.normalized }),
    status: 'done',
    progress,
    progressHistory:
      existing?.progressHistory?.length
        ? existing.progressHistory
        : [{ stage: progress, at: reviewSource.generatedAt }],
    result: null,
    artifacts,
    review,
    error: null,
    createdAt: existing?.createdAt ?? reviewSource.generatedAt,
    updatedAt: existing?.updatedAt ?? reviewSource.generatedAt,
  };
  jobs.set(job.id, job);
  dedupIndex.set(dedupKey(ownerEmail, job.intakeHash), job.id);
  persistJob(job);
  return toMrrJobDto(job);
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
  if (basename(artifact.fileName) !== artifact.fileName) return null;
  const resolved = join(jobDir(id), artifact.fileName);
  if (!isInsideDir(resolved, jobDir(id)) || !existsSync(resolved)) return null;
  return {
    path: resolved,
    fileName: artifact.fileName,
    intakeHash: job.intakeHash,
    sha256: artifact.sha256,
  };
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
