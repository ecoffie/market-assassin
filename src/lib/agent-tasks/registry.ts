import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseRegistry, assertRegistryInvariants } from './validate';
import { acquireRegistryLock, ensureRegistryDir, registryFileExists } from './lock';
import { createEmptyRegistry, type AgentTaskRegistry, type RegistryResult } from './types';

export const DEFAULT_REGISTRY_REL = '.claude/agent-tasks/registry.json';

export function resolveRegistryPath(cwd: string, override?: string): string {
  const rel = override
    ?? process.env.AGENT_TASK_REGISTRY_PATH
    ?? process.env.AGENT_TASK_REGISTRY
    ?? DEFAULT_REGISTRY_REL;
  return rel.startsWith('/') ? rel : join(cwd, rel);
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
 * Locked mutation: acquire → read → revision-check → validate → mutate → write → release.
 * Optimistic revision check runs inside the exclusive lock.
 */
export function mutateRegistry<T>(
  absPath: string,
  expectedRevision: number | null,
  mutator: (reg: AgentTaskRegistry) => RegistryResult<T>,
  opts: MutateOptions,
): RegistryUpdateResult<T> {
  if (!registryFileExists(absPath)) {
    initRegistryFile(absPath);
  }

  const lock = acquireRegistryLock({
    registryPath: absPath,
    owner: opts.lockOwner,
    sessionId: opts.sessionId,
    waitMs: opts.waitMs,
  });
  if (!lock.ok) return lock;

  try {
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

export { recoverStaleLockDirAtomic, recoverStaleLockAdmin } from './lock';
