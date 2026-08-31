import { REGISTRY_FORMAT_VERSION, type RegistryProvenance } from './types';

/**
 * PHASE 3A.5 (B) — shared TEST provenance stamp.
 *
 * Fixtures must be shaped like a registry a real writer would produce, so they carry the
 * same version and provenance an actual mutation writes. A fixture that skipped
 * provenance would be rejected by `assertRegistryInvariants`, and one pinned at version 1
 * would exercise the legacy path rather than the current one — either way the test would
 * stop describing the system it is meant to protect.
 */
export function testProvenance(over: Partial<RegistryProvenance> = {}): RegistryProvenance {
  return {
    writerVersion: REGISTRY_FORMAT_VERSION,
    writerPath: '/test/scripts/agent-task.mts',
    worktreePath: '/test/worktree',
    gitCommonDir: '/test/.git',
    actor: 'test-writer',
    at: '2026-08-31T02:00:00.000Z',
    ...over,
  };
}
