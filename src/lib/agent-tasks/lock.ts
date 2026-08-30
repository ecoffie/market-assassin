import {
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { RegistryLockMeta, RegistryResult } from './types';
import { DEFAULT_LOCK_STALE_MS, DEFAULT_LOCK_WAIT_MS } from './types';

export function lockDirForRegistry(registryPath: string): string {
  return `${registryPath}.lock`;
}

export function lockMetaPath(registryPath: string): string {
  return join(lockDirForRegistry(registryPath), 'meta.json');
}

export function readLockMeta(registryPath: string): RegistryLockMeta | null {
  const metaPath = lockMetaPath(registryPath);
  if (!existsSync(metaPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as RegistryLockMeta;
    if (
      typeof raw.owner === 'string'
      && typeof raw.pid === 'number'
      && typeof raw.sessionId === 'string'
      && typeof raw.acquiredAt === 'string'
    ) {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

export function isLockStale(meta: RegistryLockMeta, nowMs: number, staleMs = DEFAULT_LOCK_STALE_MS): boolean {
  const acquired = Date.parse(meta.acquiredAt);
  if (!Number.isFinite(acquired)) return false;
  try {
    process.kill(meta.pid, 0);
    // Process alive — not stale by PID liveness; only age-based stale for dead PIDs
    return nowMs - acquired >= staleMs;
  } catch {
    return true;
  }
}

function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin — short bounded wait for prototype */
  }
}

export type AcquiredLock = {
  meta: RegistryLockMeta;
  release: () => void;
};

/**
 * Exclusive filesystem lock via atomic mkdir on registryPath.lock/.
 * Never silently takes over an active lock — use recoverStaleLockAdmin explicitly.
 */
export function acquireRegistryLock(opts: {
  registryPath: string;
  owner: string;
  sessionId?: string;
  waitMs?: number;
  nowMs?: number;
}): RegistryResult<AcquiredLock> {
  ensureRegistryDir(opts.registryPath);
  const waitMs = opts.waitMs ?? DEFAULT_LOCK_WAIT_MS;
  const lockDir = lockDirForRegistry(opts.registryPath);
  const sessionId = opts.sessionId ?? `pid-${process.pid}`;
  const deadline = (opts.nowMs ?? Date.now()) + waitMs;

  while (true) {
    try {
      mkdirSync(lockDir);
      const meta: RegistryLockMeta = {
        owner: opts.owner.trim(),
        pid: process.pid,
        sessionId,
        acquiredAt: new Date().toISOString(),
      };
      writeFileSync(lockMetaPath(opts.registryPath), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
      let released = false;
      return {
        ok: true,
        value: {
          meta,
          release: () => {
            if (released) return;
            released = true;
            try {
              if (existsSync(lockDir)) rmSync(lockDir, { recursive: true, force: true });
            } catch {
              /* best effort */
            }
          },
        },
      };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        return { ok: false, code: 'lock_conflict', message: `lock mkdir failed: ${code ?? 'unknown'}` };
      }
      const existing = readLockMeta(opts.registryPath);
      if (Date.now() >= deadline) {
        const holder = existing?.owner ?? 'unknown';
        return {
          ok: false,
          code: 'lock_timeout',
          message: `registry lock held by ${holder} — timed out after ${waitMs}ms`,
        };
      }
      sleep(Math.min(50, deadline - Date.now()));
    }
  }
}

function readLockMetaFromDir(lockDir: string): RegistryLockMeta | null {
  const metaPath = join(lockDir, 'meta.json');
  if (!existsSync(metaPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as RegistryLockMeta;
    if (
      typeof raw.owner === 'string'
      && typeof raw.pid === 'number'
      && typeof raw.sessionId === 'string'
      && typeof raw.acquiredAt === 'string'
    ) {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

/** Atomically claim a stale lock via rename before removal — never rmSync(lockDir) directly. */
export function recoverStaleLockDirAtomic(opts: {
  registryPath: string;
  nowMs?: number;
  staleMs?: number;
}): RegistryResult<RegistryLockMeta | null> {
  const lockDir = lockDirForRegistry(opts.registryPath);
  if (!existsSync(lockDir)) {
    return { ok: true, value: null };
  }
  const meta = readLockMeta(opts.registryPath);
  if (!meta) {
    return { ok: false, code: 'lock_conflict', message: 'lock directory exists but meta.json is malformed' };
  }
  const nowMs = opts.nowMs ?? Date.now();
  const staleMs = opts.staleMs ?? DEFAULT_LOCK_STALE_MS;
  if (!isLockStale(meta, nowMs, staleMs)) {
    return {
      ok: false,
      code: 'lock_not_stale',
      message: `lock held by ${meta.owner} (pid ${meta.pid}) — not stale; refusing recovery`,
    };
  }

  const recoveringPath = `${lockDir}.recover.${process.pid}.${nowMs}`;
  try {
    renameSync(lockDir, recoveringPath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: true, value: null };
    }
    return {
      ok: false,
      code: 'lock_conflict',
      message: 'lock changed during recovery — refusing to delete a live lock',
    };
  }

  const movedMeta = readLockMetaFromDir(recoveringPath);
  if (movedMeta && !isLockStale(movedMeta, nowMs, staleMs)) {
    try {
      if (!existsSync(lockDir)) renameSync(recoveringPath, lockDir);
    } catch {
      /* best effort restore */
    }
    return {
      ok: false,
      code: 'lock_not_stale',
      message: 'lock became live during recovery — restored and refused',
    };
  }

  try {
    rmSync(recoveringPath, { recursive: true, force: true });
  } catch {
    return { ok: false, code: 'lock_conflict', message: 'failed to remove recovered lock directory' };
  }
  return { ok: true, value: meta };
}

/** Administrative stale-lock recovery — never silent takeover. */
export function recoverStaleLockAdmin(opts: {
  registryPath: string;
  actor: string;
  confirm: boolean;
  nowMs?: number;
  staleMs?: number;
}): RegistryResult<RegistryLockMeta | null> {
  if (!opts.confirm) {
    return {
      ok: false,
      code: 'unauthorized_actor',
      message: 'recover-lock requires --confirm — stale takeover is never silent',
    };
  }
  return recoverStaleLockDirAtomic({
    registryPath: opts.registryPath,
    nowMs: opts.nowMs,
    staleMs: opts.staleMs,
  });
}

export function ensureRegistryDir(registryPath: string): void {
  const dir = dirname(registryPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function registryFileExists(registryPath: string): boolean {
  try {
    return statSync(registryPath).isFile();
  } catch {
    return false;
  }
}
