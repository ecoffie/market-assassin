import { isAbsolute, join, resolve, sep } from 'node:path';
import { resolveGitCommonDir } from './git-paths';
import type { RegistryResult, TaskRecord } from './types';

/**
 * PHASE 3A.4 (C) — THE CANONICAL TASK-WORKTREE RESOLVER.
 *
 * ⚠️ THE BUG THIS REPLACES: every caller resolved a task's worktree as
 * `join(process.cwd(), task.worktree)`. That is only correct from the MAIN checkout.
 * Run the same CLI from a LINKED worktree — which is exactly what the pilot runbook
 * instructs, and exactly where an Integrator actually stands — and it produces a NESTED,
 * NONEXISTENT path:
 *
 *   cwd  = /repo/.claude/worktrees/pstack-phase-3a-pilot-v2
 *   task = .claude/worktrees/pstack-phase-3a-pilot-v2
 *   join -> /repo/.claude/worktrees/pstack-phase-3a-pilot-v2/.claude/worktrees/pstack-phase-3a-pilot-v2
 *
 * `resolveWorktreeArtifact` then shells `git` at that path, git walks UP to the enclosing
 * worktree, and the command answers about the WRONG repository state — or fails with a
 * message that names a path no human ever configured. Both outcomes are worse than an
 * error: one is silently wrong, the other misdirects the diagnosis.
 *
 * THE FIX: a task's `worktree` is stored relative to the SHARED repository root, so it must
 * be resolved against that root — never against the caller's cwd. The shared root is derived
 * from the absolute GIT COMMON DIRECTORY (`git rev-parse --git-common-dir`), which is the one
 * value identical from the main checkout, any linked worktree, and the task's own worktree.
 * This is the same anchor `resolveRuntimeRegistryPath` already uses for the registry file, so
 * the registry and the artifacts it describes now agree on where "the repository" is.
 *
 * Consequence, and the property the tests assert: `integration-handoff` run from the task's
 * own worktree and `approve` run from a DIFFERENT linked worktree resolve the SAME absolute
 * candidate path.
 */

/**
 * The shared repository root — the directory that contains the common `.git`.
 *
 * For a normal repo the common dir is `<root>/.git`, so the root is its parent. For a BARE
 * repo the common dir IS the repository, and its parent is the directory holding it (this
 * checkout's layout: a bare `.git` beside the worktrees). Deriving from the common dir
 * rather than `--show-toplevel` is what makes the answer invocation-independent:
 * `--show-toplevel` returns the CALLER's worktree and would reintroduce the bug.
 */
export function resolveSharedRepoRoot(cwd: string): RegistryResult<string> {
  const common = resolveGitCommonDir(cwd);
  if (!common.ok) return common;
  // `resolveGitCommonDir` already returns an absolute, realpath-resolved path.
  return { ok: true, value: join(common.value, '..') };
}

/**
 * Resolve a task's worktree to an absolute path anchored on the SHARED repository root.
 *
 * - relative `task.worktree` -> resolved against the shared root (NOT cwd)
 * - absolute `task.worktree` -> honored as-is, but still confined to the shared root
 * - `overrideRoot`           -> explicit test/caller override, bypassing git discovery
 *
 * Path traversal outside the shared repository is REJECTED rather than clamped: a task
 * pointing at `../../elsewhere` is a corrupt record, and silently rewriting it to something
 * plausible would hide that. Spaces in the path are handled correctly because every hop is
 * `node:path` + `execFile` argv — never a shell string.
 */
export function resolveTaskWorktreePath(opts: {
  worktreeRel: string;
  cwd?: string;
  /** Explicit shared-root override (tests, or a caller that already resolved it). */
  overrideRoot?: string;
}): RegistryResult<{ sharedRoot: string; absPath: string }> {
  const rel = opts.worktreeRel?.trim();
  if (!rel) {
    return {
      ok: false,
      code: 'candidate_integrity',
      message: 'task.worktree is empty — cannot resolve candidate worktree',
    };
  }

  let sharedRoot: string;
  if (opts.overrideRoot?.trim()) {
    sharedRoot = resolve(opts.overrideRoot.trim());
  } else {
    const root = resolveSharedRepoRoot(opts.cwd ?? process.cwd());
    if (!root.ok) return root;
    sharedRoot = root.value;
  }
  sharedRoot = resolve(sharedRoot);

  const absPath = isAbsolute(rel) ? resolve(rel) : resolve(sharedRoot, rel);

  // CONFINEMENT: the resolved path must be the shared root itself or live beneath it.
  // Compare on a separator-terminated prefix so `/repo-evil` cannot pass as `/repo`.
  const rootWithSep = sharedRoot.endsWith(sep) ? sharedRoot : `${sharedRoot}${sep}`;
  if (absPath !== sharedRoot && !absPath.startsWith(rootWithSep)) {
    return {
      ok: false,
      code: 'candidate_integrity',
      message: `task worktree ${rel} resolves outside the shared repository root (${absPath})`,
    };
  }

  return { ok: true, value: { sharedRoot, absPath } };
}

/** Convenience wrapper for a TaskRecord — same rules, plus a branch/worktree presence check. */
export function resolveTaskWorktreeForRecord(
  task: Pick<TaskRecord, 'id' | 'worktree'>,
  opts: { cwd?: string; overrideRoot?: string } = {},
): RegistryResult<{ sharedRoot: string; absPath: string }> {
  if (!task.worktree?.trim()) {
    return {
      ok: false,
      code: 'candidate_integrity',
      message: `task ${task.id} has no worktree assigned`,
    };
  }
  return resolveTaskWorktreePath({ worktreeRel: task.worktree, ...opts });
}
