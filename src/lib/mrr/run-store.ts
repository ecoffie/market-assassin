import { basename, join, resolve } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import type { Phase1Artifacts, Phase1RunResult, RunPhase1Options } from './run-phase1';
import { reviewSourceFromEvidence } from './review-from-evidence';
import { createPhase1ReviewDto } from './workspace-dto';
import {
  createOrGetMrrJob,
  getMrrArtifact,
  getMrrJob,
  hydratePersisted,
  isInsideDir,
  isSafeMrrRunId,
  jobDir,
  loadJob,
  mrrWorkspaceStoreRoot,
  normalizedIntakeHash,
  persistJob,
  rememberJob,
  resetMrrRunStoreForTests,
  resolveBoundArtifactPath,
  setMrrWorkspaceStoreRootForTests,
  stampProgress,
  toMrrJobDto,
  type MrrArtifactKind,
  type MrrBoundArtifacts,
  type MrrRunJob,
  type MrrRunJobDto,
} from './run-store-read';

export type {
  MrrArtifactKind,
  MrrBoundArtifact,
  MrrBoundArtifacts,
  MrrJobStatus,
  MrrProgressEvent,
  MrrRunJobDto,
} from './run-store-read';
export {
  createOrGetMrrJob,
  getMrrArtifact,
  getMrrJob,
  isSafeMrrRunId,
  mrrWorkspaceStoreRoot,
  normalizedIntakeHash,
  resetMrrRunStoreForTests,
  setMrrWorkspaceStoreRootForTests,
  toMrrJobDto,
};

type WorkspaceRunner = (
  input: Record<string, unknown>,
  options: RunPhase1Options,
) => Promise<Phase1RunResult>;

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
  const bound = {} as MrrBoundArtifacts;
  for (const kind of ['mrr', 'appendix', 'evidence'] as const) {
    const resolved = resolveBoundArtifactPath(runId, names[kind]);
    if (!resolved) return null;
    bound[kind] = {
      path: resolved,
      fileName: basename(names[kind]),
      sha256: sha256File(resolved),
    };
  }
  return bound;
}

function resolveEvidencePath(runId: string, existing: MrrRunJob | null): string {
  if (existing?.artifacts?.evidence?.fileName) {
    const bound = resolveBoundArtifactPath(runId, existing.artifacts.evidence.fileName);
    if (bound) return bound;
  }
  const dir = jobDir(runId);
  const files = readdirSync(dir).filter(
    (name) => name.endsWith('-evidence.json') && !name.includes('..'),
  );
  if (files.length !== 1) {
    throw new Error(
      'reassembly refused: could not identify a single bound evidence JSON for this run',
    );
  }
  const resolved = resolveBoundArtifactPath(runId, files[0]);
  if (!resolved) {
    throw new Error('reassembly refused: evidence artifact is not inside the bound run directory');
  }
  return resolved;
}

function readJson(path: string): unknown | null {
  if (!existsSync(path) || !isInsideDir(path, mrrWorkspaceStoreRoot())) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export async function startMrrJob(
  id: string,
  ownerEmail: string,
  runner?: WorkspaceRunner,
): Promise<void> {
  const job = loadJob(id);
  if (!job || job.ownerEmail !== ownerEmail.toLowerCase().trim()) return;
  if (job.status !== 'queued') return;

  const run = runner ?? (await import('./run-phase1')).runPhase1;
  job.status = 'running';
  stampProgress(job, 'running_section_5');
  try {
    const result = await run(job.input, {
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

  const existing = hydratePersisted(readJson(join(jobDir(runId), 'job.json')));
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

  const progress = reviewSource.cells.some((cell) => cell.state === 'degraded')
    ? 'complete_degraded'
    : 'complete';
  const job: MrrRunJob = {
    id: runId,
    ownerEmail,
    intakeHash: reviewSource.intakeHash,
    input: {
      ...reviewSource.requirement.normalized,
    },
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
  rememberJob(job);
  persistJob(job);
  return toMrrJobDto(job);
}
