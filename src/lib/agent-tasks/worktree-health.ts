import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { RegistryResult } from './types';

/**
 * PHASE 3A.5 (C) — HEALTHY-WORKTREE ENFORCEMENT.
 *
 * ⚠️ THE HOLE THIS CLOSES. Registry path resolution anchors on
 * `git rev-parse --git-common-dir`, and a BARE repository has a perfectly good common
 * dir. Measured on this repo: from the bare root, `--git-common-dir` returns `.git` and
 * resolves, while `--show-toplevel` fails with "this operation must be run in a work
 * tree". So the runtime registry was fully REACHABLE — and therefore MUTABLE — from the
 * bare root, where there is no checkout, no branch, and no worktree the operator could
 * be reasoning about. A mutation from there looks identical on disk to a legitimate one.
 *
 * The registry's guarantees are all stated in terms of a candidate worktree: a branch, a
 * base, a HEAD that evidence was produced against. A mutation issued from a context that
 * has none of those is unanchored by construction, so it is refused here rather than
 * validated later against a worktree that does not exist.
 *
 * ⚠️ READ-ONLY commands are deliberately NOT gated. `list`, `deps` and `doctor` are how
 * an operator diagnoses a broken environment; refusing to answer questions from an
 * unhealthy location would remove the only tool available at exactly the moment it is
 * needed. Only MUTATION is gated.
 *
 * This is intentionally distinct from `resolveSharedRepoRoot`, which answers "where is
 * the repository". This answers "is the CALLER standing somewhere a write may originate".
 */

/** Git honors GIT_* over `cwd`; strip them so the caller's location genuinely decides. */
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnv(),
    }).trim();
  } catch {
    return null;
  }
}

export type WorktreeHealth = {
  /** Absolute, realpath-resolved worktree root the mutation originates from. */
  worktreePath: string;
  /** Absolute, realpath-resolved shared git common dir. */
  gitCommonDir: string;
  /** True when this worktree is a linked worktree rather than the primary checkout. */
  linked: boolean;
};

function err(code: 'unhealthy_worktree' | 'not_git_repository', message: string) {
  return { ok: false as const, code, message };
}

const REMEDY =
  'run this command from a healthy registered git worktree (e.g. .claude/worktrees/<branch-slug>), not from the bare repository root or an unregistered directory';

/**
 * Assert the caller may originate a registry MUTATION from `cwd`.
 *
 * Fails closed on: a bare repository, a location outside any work tree, a git dir that
 * does not correspond to a registered worktree, and a worktree whose backing directory
 * has gone missing (a stale/pruned registration).
 */
export function assertHealthyWorktree(cwd: string): RegistryResult<WorktreeHealth> {
  if (!existsSync(cwd)) {
    return err('unhealthy_worktree', `invocation directory does not exist: ${cwd}. ${REMEDY}`);
  }

  const commonRaw = git(cwd, ['rev-parse', '--git-common-dir']);
  if (commonRaw === null) {
    return {
      ok: false,
      code: 'not_git_repository',
      message: 'cwd is not inside a git repository',
    };
  }

  // A BARE repo answers --git-common-dir happily; this is the discriminator that stops it.
  if (git(cwd, ['rev-parse', '--is-bare-repository']) === 'true') {
    return err(
      'unhealthy_worktree',
      `refusing to mutate the registry from a BARE repository (${cwd}): there is no checkout, branch, or candidate worktree to anchor the write. ${REMEDY}`,
    );
  }

  if (git(cwd, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return err(
      'unhealthy_worktree',
      `refusing to mutate the registry from outside a work tree (${cwd}). ${REMEDY}`,
    );
  }

  // Inside .git/ of an otherwise valid worktree, --show-toplevel still fails.
  const topRaw = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!topRaw) {
    return err(
      'unhealthy_worktree',
      `git reports no work tree root for ${cwd}. ${REMEDY}`,
    );
  }

  const abs = (p: string) => {
    const a = isAbsolute(p) ? p : resolve(cwd, p);
    try {
      return realpathSync.native ? realpathSync.native(a) : realpathSync(a);
    } catch {
      return a;
    }
  };

  const worktreePath = abs(topRaw);
  const gitCommonDir = abs(commonRaw);

  // A resolved-but-vanished worktree is a STALE registration. Git can still answer from a
  // cached path while the directory is gone; writing from there would attribute the
  // mutation to a location that no longer exists.
  if (!existsSync(worktreePath)) {
    return err(
      'unhealthy_worktree',
      `resolved work tree ${worktreePath} does not exist (stale or pruned registration). ${REMEDY}`,
    );
  }

  const gitDirRaw = git(cwd, ['rev-parse', '--git-dir']);
  if (!gitDirRaw) {
    return err('unhealthy_worktree', `git reports no git dir for ${cwd}. ${REMEDY}`);
  }
  const gitDir = abs(gitDirRaw);

  // A LINKED worktree's git dir lives under <common>/worktrees/<name>; the PRIMARY
  // checkout's git dir IS the common dir. Anything else is not a registered worktree.
  const linked = gitDir !== gitCommonDir;
  if (linked) {
    const registeredPrefix = `${gitCommonDir}/worktrees/`;
    if (!gitDir.startsWith(registeredPrefix)) {
      return err(
        'unhealthy_worktree',
        `git dir ${gitDir} is not a registered worktree of ${gitCommonDir}. ${REMEDY}`,
      );
    }
    if (!existsSync(gitDir)) {
      return err(
        'unhealthy_worktree',
        `worktree registration ${gitDir} is missing (pruned). ${REMEDY}`,
      );
    }
  }

  return { ok: true, value: { worktreePath, gitCommonDir, linked } };
}

/**
 * Resolve the writer's own module/CLI path for provenance.
 *
 * Best-effort by design: provenance must never be the reason a legitimate write fails,
 * so an unresolvable path degrades to a explicit marker rather than throwing.
 */
export function resolveWriterPath(hint?: string): string {
  const candidate = hint ?? process.argv[1];
  if (!candidate) return 'unknown';
  try {
    const a = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
    return realpathSync.native ? realpathSync.native(a) : realpathSync(a);
  } catch {
    return candidate;
  }
}
