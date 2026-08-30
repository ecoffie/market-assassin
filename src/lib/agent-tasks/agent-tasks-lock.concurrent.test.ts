import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnTsxAsync } from './test-cli-spawn';
import {
  acquireRegistryLock,
  lockDirForRegistry,
  readLockMeta,
  recoverStaleLockAdmin,
} from './lock';
import { initRegistryFile, readRegistryFile, mutateRegistry } from './registry';

describe('registry filesystem lock', () => {
  let dir: string;
  let regPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-lock-'));
    regPath = join(dir, 'registry.json');
    initRegistryFile(regPath);
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('records owner, pid, session, and acquiredAt on acquire', () => {
    const lock = acquireRegistryLock({ registryPath: regPath, owner: 'agent-a', sessionId: 'sess-1' });
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;
    const meta = readLockMeta(regPath);
    expect(meta?.owner).toBe('agent-a');
    expect(meta?.pid).toBe(process.pid);
    expect(meta?.sessionId).toBe('sess-1');
    expect(meta?.acquiredAt).toMatch(/^\d{4}-\d/);
    lock.value.release();
  });

  it('fail-closed when active lock held (bounded wait)', () => {
    const first = acquireRegistryLock({ registryPath: regPath, owner: 'holder' });
    expect(first.ok).toBe(true);
    const second = acquireRegistryLock({
      registryPath: regPath,
      owner: 'intruder',
      waitMs: 100,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('lock_timeout');
    first.ok && first.value.release();
  });

  it('never silently takes over — admin recovery requires confirm', () => {
    const lockDir = lockDirForRegistry(regPath);
    mkdirSync(lockDir);
    writeFileSync(
      join(lockDir, 'meta.json'),
      JSON.stringify({
        owner: 'dead-agent',
        pid: 99999999,
        sessionId: 'dead',
        acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    );
    const denied = recoverStaleLockAdmin({ registryPath: regPath, actor: 'admin', confirm: false });
    expect(denied.ok).toBe(false);
    const ok = recoverStaleLockAdmin({ registryPath: regPath, actor: 'admin', confirm: true });
    expect(ok.ok).toBe(true);
  });

  it('mutateRegistry always releases lock in finally', () => {
    const r = mutateRegistry(
      regPath,
      0,
      (reg) => {
        reg.revision;
        return { ok: true, value: true };
      },
      { lockOwner: 'mutator' },
    );
    expect(r.ok).toBe(true);
    expect(readLockMeta(regPath)).toBeNull();
  });
});

describe('concurrent process mutation proof', { timeout: 30_000 }, () => {
  let dir: string;
  let regPath: string;
  const probe = join(process.cwd(), 'scripts/agent-task-concurrent-probe.mts');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-concurrent-'));
    regPath = join(dir, 'registry.json');
    initRegistryFile(regPath);
  });

  afterEach(() => {
    rmSync(lockDirForRegistry(regPath), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('serializes two simultaneous revision probes — revision advances once', async () => {
    const envBase = {
      ...process.env,
      AGENT_TASK_REGISTRY_PATH: regPath,
      EXPECTED_REV: '0',
    };

    function runProbe(actor: string): Promise<{ code: number; stdout: string }> {
      return spawnTsxAsync(probe, [], { env: { ...envBase, ACTOR: actor } });
    }

    const [a, b] = await Promise.all([runProbe('probe-a'), runProbe('probe-b')]);

    const codes = [a.code, b.code];
    expect(codes.filter((c) => c === 0).length).toBe(1);
    expect(codes.filter((c) => c !== 0).length).toBe(1);

    const failedStdout = a.code === 0 ? b.stdout : a.stdout;
    const failedParsed = JSON.parse(failedStdout || '{}');
    expect(['revision_conflict', 'lock_timeout']).toContain(failedParsed.code);

    const read = readRegistryFile(regPath);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.revision).toBe(1);
  });
});
