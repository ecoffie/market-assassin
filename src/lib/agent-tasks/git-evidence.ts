import { execFileSync } from 'node:child_process';
import { resolveTaskWorktreePath } from './task-worktree';
import type { RegistryResult } from './types';

const SHA_RE = /^[0-9a-f]{40}$/i;

export type WorktreeArtifact = {
  headSha: string;
  treeSha: string;
  branch: string;
  clean: boolean;
  isDescendantOfBase: boolean;
};

export type GitMainMeta = {
  currentMainSha: string;
  mainAheadCount: number | null;
};

/**
 * Every git variable that can redirect a child `git` at a DIFFERENT repository.
 *
 * ⚠️ This list is load-bearing, not defensive tidiness. A pre-push HOOK runs with
 * GIT_DIR/GIT_INDEX_FILE (and friends) exported, so ANY child `git` inheriting them
 * operates on the OUTER repo regardless of `cwd`. Measured 2026-08-30: test fixtures that
 * shelled out to `git init` + `git commit` in a temp dir instead committed into the real
 * worktree, moved its branch ref, and left HEAD on a fixture branch. `cwd` is not a
 * boundary; a scrubbed environment is.
 */
export const GIT_ENV_OVERRIDE_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
] as const;

/**
 * A process env with every repository-redirecting git variable removed.
 *
 * EXPORTED so tests that build disposable repositories use the SAME sanitizer as
 * production rather than re-deriving a weaker copy that drifts out of sync.
 */
export function sanitizedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of GIT_ENV_OVERRIDE_VARS) {
    delete env[k];
  }
  return env;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: sanitizedGitEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function normalizeSha(sha: string): string {
  return sha.trim().toLowerCase();
}

function isValidSha(sha: string): boolean {
  return SHA_RE.test(sha.trim());
}

function err(message: string): RegistryResult<never> {
  return { ok: false, code: 'candidate_integrity', message };
}

/** Resolve origin/main and ahead-count relative to an authorized baseSha. */
export function resolveGitMainMeta(repoRoot: string, baseSha: string): RegistryResult<GitMainMeta> {
  try {
    execFileSync('git', ['fetch', 'origin', 'main'], { cwd: repoRoot, stdio: 'pipe', env: sanitizedGitEnv() });
  } catch {
    /* offline — use local refs */
  }
  try {
    const currentMainSha = normalizeSha(git(['rev-parse', 'origin/main'], repoRoot));
    const raw = git(['rev-list', '--count', `${normalizeSha(baseSha)}..origin/main`], repoRoot);
    const n = Number(raw);
    const mainAheadCount = Number.isFinite(n) && n >= 0 ? n : null;
    if (mainAheadCount === null) {
      return { ok: false, code: 'stale_main', message: 'cannot parse main ahead count from git' };
    }
    return { ok: true, value: { currentMainSha, mainAheadCount } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: 'not_git_repository', message: `git main metadata failed: ${msg}` };
  }
}

/**
 * Resolve current origin/main alone (no base required).
 *
 * `resolveGitMainMeta` needs a baseSha to compute an ahead-count; supersession is
 * precisely the operation where the OLD base is being retired, so it needs main by
 * itself. Fetches first so the successor anchors on real current main, never a stale
 * local ref — anchoring a successor at an out-of-date main would recreate the very
 * staleness supersession exists to clear.
 */
export function resolveCurrentMainSha(repoRoot: string): RegistryResult<string> {
  try {
    execFileSync('git', ['fetch', 'origin', 'main'], { cwd: repoRoot, stdio: 'pipe', env: sanitizedGitEnv() });
  } catch {
    /* offline — fall back to the local remote-tracking ref */
  }
  try {
    const sha = normalizeSha(git(['rev-parse', 'origin/main'], repoRoot));
    if (!isValidSha(sha)) {
      return { ok: false, code: 'stale_main', message: `origin/main resolved to invalid sha ${sha}` };
    }
    return { ok: true, value: sha };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, code: 'not_git_repository', message: `cannot resolve origin/main: ${msg}` };
  }
}

/** Resolve assigned feature worktree branch, HEAD, tree, cleanliness, and base ancestry. */
export function resolveWorktreeArtifact(opts: {
  /**
   * SHARED repository root. Callers must NOT pass `process.cwd()` — from a linked worktree
   * that produced a nested nonexistent path (see task-worktree.ts). It is treated as an
   * explicit override of the git-derived shared root, so tests can inject a disposable repo.
   */
  repoRoot: string;
  worktreeRel: string;
  expectedBranch: string;
  baseSha: string;
}): RegistryResult<WorktreeArtifact> {
  const resolved = resolveTaskWorktreePath({
    worktreeRel: opts.worktreeRel,
    overrideRoot: opts.repoRoot,
  });
  if (!resolved.ok) return resolved;
  const wtAbs = resolved.value.absPath;
  try {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], wtAbs);
    const headSha = normalizeSha(git(['rev-parse', 'HEAD'], wtAbs));
    const treeSha = normalizeSha(git(['rev-parse', 'HEAD^{tree}'], wtAbs));
    const status = git(['status', '--porcelain'], wtAbs);
    const clean = status.length === 0;
    const mergeBase = normalizeSha(git(['merge-base', opts.baseSha, headSha], wtAbs));
    const isDescendantOfBase = mergeBase === normalizeSha(opts.baseSha);

    if (branch !== opts.expectedBranch) {
      return err(
        `worktree branch ${branch} !== task.branch ${opts.expectedBranch}`,
      );
    }
    if (!isValidSha(headSha) || !isValidSha(treeSha)) {
      return err('worktree resolved malformed HEAD or tree SHA');
    }
    if (!clean) {
      return err(`worktree ${opts.worktreeRel} is not clean — commit or discard changes before integration`);
    }
    if (!isDescendantOfBase) {
      return err(
        `candidate HEAD ${headSha.slice(0, 12)} is not a descendant of base ${normalizeSha(opts.baseSha).slice(0, 12)}`,
      );
    }

    return {
      ok: true,
      value: { headSha, treeSha, branch, clean, isDescendantOfBase },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`worktree artifact resolution failed: ${msg}`);
  }
}

export function explicitNoGitMeta(opts: {
  baseSha: string;
  currentMainSha?: string;
  mainAheadCount?: string;
  candidateHeadSha?: string;
  candidateTreeSha?: string;
  requireCandidate?: boolean;
}): RegistryResult<{
  currentMainSha: string;
  mainAheadCount: number;
  candidateHeadSha?: string;
  candidateTreeSha?: string;
}> {
  const base = opts.baseSha?.trim();
  const currentMain = opts.currentMainSha?.trim();
  const candidateHead = opts.candidateHeadSha?.trim();
  const candidateTree = opts.candidateTreeSha?.trim();
  const aheadRaw = opts.mainAheadCount?.trim();

  if (!base || !isValidSha(base)) {
    return { ok: false, code: 'malformed_checkpoint', message: '--no-git requires valid task baseSha' };
  }
  if (!currentMain || !isValidSha(currentMain)) {
    return {
      ok: false,
      code: 'stale_main',
      message: '--no-git requires explicit --current-main (never inferred from base)',
    };
  }
  if (aheadRaw === undefined || aheadRaw === '') {
    return {
      ok: false,
      code: 'stale_main',
      message: '--no-git requires explicit --main-ahead',
    };
  }
  const mainAheadCount = Number(aheadRaw);
  if (!Number.isFinite(mainAheadCount) || mainAheadCount < 0) {
    return { ok: false, code: 'stale_main', message: '--no-git --main-ahead must be a non-negative integer' };
  }

  if (opts.requireCandidate) {
    if (!candidateHead || !isValidSha(candidateHead)) {
      return {
        ok: false,
        code: 'verification_incomplete',
        message: '--no-git requires explicit --candidate-head (never silently equal to base)',
      };
    }
    if (!candidateTree || !isValidSha(candidateTree)) {
      return {
        ok: false,
        code: 'verification_incomplete',
        message: '--no-git requires explicit --candidate-tree',
      };
    }
    return {
      ok: true,
      value: {
        currentMainSha: normalizeSha(currentMain),
        mainAheadCount,
        candidateHeadSha: normalizeSha(candidateHead),
        candidateTreeSha: normalizeSha(candidateTree),
      },
    };
  }

  return {
    ok: true,
    value: {
      currentMainSha: normalizeSha(currentMain),
      mainAheadCount,
    },
  };
}
