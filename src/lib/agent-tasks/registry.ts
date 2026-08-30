import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { parseRegistry, assertRegistryInvariants } from './validate';
import { acquireRegistryLock, ensureRegistryDir, registryFileExists } from './lock';
import { createEmptyRegistry, type AgentTaskRegistry, type RegistryResult } from './types';
import { resolveGitCommonDir, resolveGitRoot } from './git-paths';

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

export function writeRegistryFile(absPath: string, registry: AgentTaskRegistry): void {
  ensureRegistryDir(absPath);
  const tmp = `${absPath}.tmp.${process.pid}`;
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  writeFileSync(tmp, payload, 'utf8');
  renameSync(tmp, absPath);
}

/** Create an empty revision-0 runtime registry (never copies tracked seed content). */
export function initRegistryFile(absPath: string): AgentTaskRegistry {
  const empty = createEmptyRegistry();
  writeRegistryFile(absPath, empty);
  return empty;
}

export type RegistryUpdateResult<T> = RegistryResult<T> & { revision?: number };

export type MutateOptions = {
  lockOwner: string;
  sessionId?: string;
  waitMs?: number;
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
  const lock = acquireRegistryLock({
    registryPath: absPath,
    owner: opts.lockOwner,
    sessionId: opts.sessionId,
    waitMs: opts.waitMs,
  });
  if (!lock.ok) return lock;

  try {
    if (!registryFileExists(absPath)) {
      initRegistryFile(absPath);
    }

    const read = readRegistryFile(absPath);
    if (!read.ok) return read;
    if (expectedRevision !== null && read.value.revision !== expectedRevision) {
      return {
        ok: false,
        code: 'revision_conflict',
        message: `expected revision ${expectedRevision}, found ${read.value.revision}`,
      };
    }

    const result = mutator(read.value);
    if (!result.ok) return result;

    const next: AgentTaskRegistry = {
      ...read.value,
      revision: read.value.revision + 1,
      updatedAt: new Date().toISOString(),
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
