import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { parseRegistry, assertRegistryInvariants } from './validate';
import { acquireRegistryLock, ensureRegistryDir, registryFileExists } from './lock';
import {
  createEmptyRegistry,
  REGISTRY_FORMAT_VERSION,
  REGISTRY_LEGACY_VERSION,
  type AgentTaskRegistry,
  type RegistryProvenance,
  type RegistryResult,
} from './types';
import { resolveGitCommonDir, resolveGitRoot } from './git-paths';
import { assertHealthyWorktree, resolveWriterPath } from './worktree-health';

/** Tracked bootstrap/schema example — runtime must never write here by default. */
export const DEFAULT_REGISTRY_REL = '.claude/agent-tasks/registry.json';
export const SEED_REGISTRY_REL = DEFAULT_REGISTRY_REL;

const RUNTIME_REGISTRY_SUFFIX = join('agent-tasks', 'registry.json');

function registryOverride(): string | undefined {
  return process.env.AGENT_TASK_REGISTRY_PATH ?? process.env.AGENT_TASK_REGISTRY;
}

export function resolveExplicitRegistryPath(cwd: string, override: string): string {
  return isAbsolute(override) ? override : join(cwd, override);
}

/** Default runtime registry under the shared git-common-dir (all worktrees). */
export function resolveRuntimeRegistryPath(cwd: string, override?: string): RegistryResult<string> {
  const explicit = override ?? registryOverride();
  if (explicit) {
    return { ok: true, value: resolveExplicitRegistryPath(cwd, explicit) };
  }
  const common = resolveGitCommonDir(cwd);
  if (!common.ok) return common;
  return { ok: true, value: join(common.value, RUNTIME_REGISTRY_SUFFIX) };
}

/** Tracked seed path for the current worktree checkout root. */
export function resolveSeedRegistryPath(cwd: string): RegistryResult<string> {
  const root = resolveGitRoot(cwd);
  if (!root.ok) return root;
  return { ok: true, value: join(root.value, SEED_REGISTRY_REL) };
}

/**
 * @deprecated Prefer resolveRuntimeRegistryPath — throws when cwd is outside git.
 * Kept for callers that already supply an explicit override path.
 */
export function resolveRegistryPath(cwd: string, override?: string): string {
  const resolved = resolveRuntimeRegistryPath(cwd, override);
  if (!resolved.ok) {
    throw new Error(`${resolved.code}: ${resolved.message}`);
  }
  return resolved.value;
}

export function readRegistryFile(absPath: string): RegistryResult<AgentTaskRegistry> {
  if (!registryFileExists(absPath)) {
    return { ok: false, code: 'malformed_registry', message: `registry missing: ${absPath}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absPath, 'utf8'));
  } catch {
    return { ok: false, code: 'malformed_registry', message: 'registry JSON parse failed' };
  }
  const parsed = parseRegistry(raw);
  if (!parsed) {
    return { ok: false, code: 'malformed_registry', message: 'registry schema validation failed' };
  }
  const inv = assertRegistryInvariants(parsed);
  if (inv) {
    return { ok: false, code: 'malformed_registry', message: inv };
  }
  return { ok: true, value: parsed };
}

/**
 * PHASE 3A.5 (B) — ORDINARY-MUTATION VERSION GATE.
 *
 * A version-1 registry is READABLE (so it can be inspected and migrated) but must not be
 * mutated by ordinary operations. Writing modern records into a legacy-shaped file would
 * produce a registry that old parsers still accept and therefore still rewrite — which
 * defeats the entire quarantine. The bounded administrator repair/migration path is the
 * ONLY writer allowed to touch a version-1 file, and it upgrades it in the same write.
 */
export function assertMutableVersion(registry: AgentTaskRegistry): RegistryResult<true> {
  if (registry.version === REGISTRY_FORMAT_VERSION) return { ok: true, value: true };
  if (registry.version === REGISTRY_LEGACY_VERSION) {
    return {
      ok: false,
      code: 'registry_upgrade_required',
      message: `registry is format version ${REGISTRY_LEGACY_VERSION}; ordinary mutations require version ${REGISTRY_FORMAT_VERSION}. Run the administrator repair/migration path to upgrade it.`,
    };
  }
  return {
    ok: false,
    code: 'unsupported_registry_version',
    message: `unsupported registry format version ${String(registry.version)}`,
  };
}

/** Build the execution-provenance stamp for a write originating at `cwd`. */
export function buildProvenance(opts: {
  actor: string;
  cwd?: string;
  writerPathHint?: string;
  at?: string;
}): RegistryProvenance {
  const cwd = opts.cwd ?? process.cwd();
  const health = assertHealthyWorktree(cwd);
  return {
    writerVersion: REGISTRY_FORMAT_VERSION,
    writerPath: resolveWriterPath(opts.writerPathHint),
    worktreePath: health.ok ? health.value.worktreePath : cwd,
    gitCommonDir: health.ok ? health.value.gitCommonDir : 'unresolved',
    actor: opts.actor,
    at: opts.at ?? new Date().toISOString(),
  };
}

export function writeRegistryFile(absPath: string, registry: AgentTaskRegistry): void {
  ensureRegistryDir(absPath);
  const tmp = `${absPath}.tmp.${process.pid}`;
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  writeFileSync(tmp, payload, 'utf8');
  renameSync(tmp, absPath);
}

/** Create an empty revision-0 runtime registry (never copies tracked seed content). */
export function initRegistryFile(
  absPath: string,
  opts?: { actor?: string; cwd?: string; writerPathHint?: string },
): AgentTaskRegistry {
  const empty = createEmptyRegistry(
    new Date().toISOString(),
    buildProvenance({
      actor: opts?.actor ?? 'bootstrap',
      cwd: opts?.cwd,
      writerPathHint: opts?.writerPathHint,
    }),
  );
  writeRegistryFile(absPath, empty);
  return empty;
}

export type RegistryUpdateResult<T> = RegistryResult<T> & { revision?: number };

export type MutateOptions = {
  lockOwner: string;
  sessionId?: string;
  waitMs?: number;
  /**
   * PHASE 3A.5 (C) — directory the mutation originates from. Health is asserted against
   * it BEFORE the lock is taken. Defaults to process.cwd().
   */
  cwd?: string;
  /**
   * PHASE 3A.5 (C) — skip the healthy-worktree assertion. Reserved for tests that
   * operate on disposable registries outside any worktree. Never set on a real path.
   */
  skipWorktreeHealth?: boolean;
  /**
   * PHASE 3A.5 (B) — allow this write to proceed against a legacy version-1 registry and
   * UPGRADE it to version 2 in the same revision. Reserved for the bounded administrator
   * repair/migration path.
   */
  allowLegacyUpgrade?: boolean;
  /** Provenance writer-path hint (defaults to argv[1] resolution). */
  writerPathHint?: string;
};

/**
 * Locked mutation: acquire → bootstrap-if-missing → read → revision-check → mutate → write → release.
 * First-time runtime creation happens under the exclusive lock (never copies tracked seed).
 */
export function mutateRegistry<T>(
  absPath: string,
  expectedRevision: number | null,
  mutator: (reg: AgentTaskRegistry) => RegistryResult<T>,
  opts: MutateOptions,
): RegistryUpdateResult<T> {
  // PHASE 3A.5 (C) — refuse BEFORE taking the lock. A caller that may not write must not
  // be able to block one that may, and an unhealthy context should never create lock
  // debris in a shared runtime directory.
  const cwd = opts.cwd ?? process.cwd();
  if (!opts.skipWorktreeHealth) {
    const health = assertHealthyWorktree(cwd);
    if (!health.ok) return health;
  }

  const lock = acquireRegistryLock({
    registryPath: absPath,
    owner: opts.lockOwner,
    sessionId: opts.sessionId,
    waitMs: opts.waitMs,
  });
  if (!lock.ok) return lock;

  try {
    if (!registryFileExists(absPath)) {
      initRegistryFile(absPath, {
        actor: opts.lockOwner,
        cwd,
        writerPathHint: opts.writerPathHint,
      });
    }

    const read = readRegistryFile(absPath);
    if (!read.ok) return read;

    // PHASE 3A.5 (B) — version gate, ahead of the mutator. A refusal here must leave the
    // file byte-identical, so it happens before anything is built or written.
    if (!opts.allowLegacyUpgrade) {
      const mutable = assertMutableVersion(read.value);
      if (!mutable.ok) return mutable;
    } else if (
      read.value.version !== REGISTRY_LEGACY_VERSION &&
      read.value.version !== REGISTRY_FORMAT_VERSION
    ) {
      return {
        ok: false,
        code: 'unsupported_registry_version',
        message: `unsupported registry format version ${String(read.value.version)}`,
      };
    }

    if (expectedRevision !== null && read.value.revision !== expectedRevision) {
      return {
        ok: false,
        code: 'revision_conflict',
        message: `expected revision ${expectedRevision}, found ${read.value.revision}`,
      };
    }

    const result = mutator(read.value);
    if (!result.ok) return result;

    // Every write lands on version 2 and (re)stamps provenance, so the writer identity
    // is refreshed on EVERY mutation rather than only at creation. A legacy file reaching
    // here is on the bounded upgrade path, so it is migrated in this same single revision.
    const next: AgentTaskRegistry = {
      ...read.value,
      version: REGISTRY_FORMAT_VERSION,
      revision: read.value.revision + 1,
      updatedAt: new Date().toISOString(),
      provenance: buildProvenance({
        actor: opts.lockOwner,
        cwd,
        writerPathHint: opts.writerPathHint,
      }),
    };
    const inv = assertRegistryInvariants(next);
    if (inv) {
      return { ok: false, code: 'malformed_registry', message: inv };
    }
    writeRegistryFile(absPath, next);
    return { ...result, revision: next.revision };
  } finally {
    lock.value.release();
  }
}

function lockedMutate<T>(
  registryPath: string,
  lockOwner: string,
  expectedRevision: number | undefined,
  mutator: (reg: AgentTaskRegistry) => RegistryResult<T>,
): RegistryUpdateResult<T> {
  return mutateRegistry(registryPath, expectedRevision ?? null, mutator, { lockOwner });
}

export { lockedMutate as mutateRegistryLocked };
export { recoverStaleLockDirAtomic, recoverStaleLockAdmin } from './lock';
