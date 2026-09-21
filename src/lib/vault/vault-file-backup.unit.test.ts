import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { backupVaultFiles, BACKUP_BUCKET } from './vault-file-backup';
import { VAULT_STORAGE_BUCKET } from './vault-data';

/**
 * The vault-file backup copies irreplaceable customer files (resumes, cap
 * statements) to a separate bucket, because Supabase DB backups exclude Storage.
 * These tests lock the properties that make it SAFE and useful: it never deletes
 * from the live bucket, it recurses into per-user folders, it's incremental
 * (skips unchanged files), and one failed object doesn't abort the run.
 *
 * The Supabase storage client is a hand-rolled in-memory mock.
 */

interface MockFile { name: string; id: string | null; metadata: { size: number } | null }

function makeMock(opts: {
  live: Record<string, { size: number; bytes?: string }>;   // path -> file
  backup?: Record<string, { size: number }>;                // pre-existing backup
  failDownload?: string;                                     // path that fails to download
}): { sb: SupabaseClient; removed: string[]; uploaded: string[] } {
  const removed: string[] = [];
  const uploaded: string[] = [];
  const backupStore = { ...(opts.backup || {}) };

  // Build a directory tree for list() from flat paths.
  function listAt(store: Record<string, { size: number }>, prefix: string): MockFile[] {
    const seenDirs = new Set<string>();
    const files: MockFile[] = [];
    for (const path of Object.keys(store)) {
      if (prefix && !path.startsWith(prefix + '/')) continue;
      const rest = prefix ? path.slice(prefix.length + 1) : path;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        files.push({ name: rest, id: 'file-id', metadata: { size: store[path].size } });
      } else {
        const dir = rest.slice(0, slash);
        if (!seenDirs.has(dir)) {
          seenDirs.add(dir);
          files.push({ name: dir, id: null, metadata: null }); // folder
        }
      }
    }
    return files;
  }

  const from = (bucket: string) => ({
    list: (prefix: string) => {
      const store = bucket === VAULT_STORAGE_BUCKET ? opts.live : backupStore;
      return Promise.resolve({ data: listAt(store, prefix), error: null });
    },
    download: (path: string) => {
      if (opts.failDownload === path) return Promise.resolve({ data: null, error: { message: 'download failed' } });
      const blob = { arrayBuffer: async () => new TextEncoder().encode(opts.live[path]?.bytes || 'x').buffer };
      return Promise.resolve({ data: blob, error: null });
    },
    upload: (path: string) => {
      uploaded.push(path);
      backupStore[path] = { size: opts.live[path]?.size ?? 1 };
      return Promise.resolve({ error: null });
    },
    remove: (paths: string[]) => { removed.push(...paths); return Promise.resolve({ error: null }); },
  });

  const storage = {
    from,
    getBucket: (_b: string) => Promise.resolve({ data: { name: BACKUP_BUCKET }, error: null }),
    createBucket: () => Promise.resolve({ error: null }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: { storage } as any as SupabaseClient, removed, uploaded };
}

describe('backupVaultFiles — safe, incremental, resilient', () => {
  it('NEVER deletes from the live bucket (copy-only)', async () => {
    const { sb, removed } = makeMock({ live: { 'a@x.com/resume.pdf': { size: 10 } } });
    await backupVaultFiles(sb);
    expect(removed).toEqual([]); // no remove() ever called
  });

  it('recurses into per-user folders and copies nested files', async () => {
    const { sb, uploaded } = makeMock({
      live: {
        'a@x.com/cap.pdf': { size: 5 },
        'a@x.com/resumes/jane.pdf': { size: 8 }, // nested one level deeper
        'b@x.com/pricing.xlsx': { size: 12 },
      },
    });
    const r = await backupVaultFiles(sb);
    expect(uploaded.sort()).toEqual(['a@x.com/cap.pdf', 'a@x.com/resumes/jane.pdf', 'b@x.com/pricing.xlsx']);
    expect(r.copied).toBe(3);
  });

  it('is incremental — skips files already backed up at the same size', async () => {
    const { sb, uploaded } = makeMock({
      live: { 'a@x.com/cap.pdf': { size: 5 }, 'a@x.com/new.pdf': { size: 9 } },
      backup: { 'a@x.com/cap.pdf': { size: 5 } }, // cap.pdf already backed up
    });
    const r = await backupVaultFiles(sb);
    expect(uploaded).toEqual(['a@x.com/new.pdf']); // only the new one
    expect(r.copied).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it('re-copies a file whose size changed (upsert)', async () => {
    const { sb, uploaded } = makeMock({
      live: { 'a@x.com/cap.pdf': { size: 20 } },       // now bigger
      backup: { 'a@x.com/cap.pdf': { size: 5 } },      // old size
    });
    const r = await backupVaultFiles(sb);
    expect(uploaded).toEqual(['a@x.com/cap.pdf']);
    expect(r.copied).toBe(1);
  });

  it('one failed object does not abort the run', async () => {
    const { sb, uploaded } = makeMock({
      live: { 'a@x.com/good.pdf': { size: 5 }, 'a@x.com/bad.pdf': { size: 6 } },
      failDownload: 'a@x.com/bad.pdf',
    });
    const r = await backupVaultFiles(sb);
    expect(uploaded).toContain('a@x.com/good.pdf');   // the good one still copied
    expect(r.errors.map((e) => e.path)).toEqual(['a@x.com/bad.pdf']);
    expect(r.copied).toBe(1);
  });

  it('bounds a run with maxObjects and flags truncation', async () => {
    const live: Record<string, { size: number }> = {};
    for (let i = 0; i < 5; i++) live[`a@x.com/f${i}.pdf`] = { size: i + 1 };
    const { sb } = makeMock({ live });
    const r = await backupVaultFiles(sb, { maxObjects: 2 });
    expect(r.scanned).toBe(2);
    expect(r.truncated).toBe(true);
  });
});
