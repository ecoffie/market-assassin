import { describe, it, expect } from 'vitest';
import { serializeOpenSnapshot, parseOpenSnapshot, writeOpenSnapshot, loadOpenSnapshot, type SnapshotStore } from './open-snapshot-store';
import type { OpenSnapshot } from './open-cache';

/** Agent 5 cache review #3: one writer, private bucket, instances download + verify. Never a partial snapshot. */
const SNAP: OpenSnapshot = { builtAt: '2026-11-15T09:30:00.000Z', count: 2, rows: [{ notice_id: 'a', title: 'Custodial' } as never, { notice_id: 'b', title: 'Valve' } as never] };
function memStore(pub: boolean | null): SnapshotStore & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return { files, bucketIsPublic: async () => pub, put: async (p, b) => { files.set(p, b); }, get: async (p) => files.get(p) ?? null };
}

describe('serialize / parse round-trip with integrity', () => {
  it('round-trips exactly', () => {
    expect(parseOpenSnapshot(serializeOpenSnapshot(SNAP).bytes)).toEqual(SNAP);
  });
  it('a tampered or truncated file is refused', async () => {
    const { gzipSync, gunzipSync } = await import('node:zlib');
    const j = JSON.parse(gunzipSync(serializeOpenSnapshot(SNAP).bytes).toString());
    j.rows[0].title = 'Edited';
    expect(() => parseOpenSnapshot(gzipSync(JSON.stringify(j)))).toThrow(/checksum/);
    j.rows.pop();
    expect(() => parseOpenSnapshot(gzipSync(JSON.stringify(j)))).toThrow(/row count/);
  });
});

describe('private bucket only; never created here', () => {
  it('writes and loads through a private bucket', async () => {
    const st = memStore(false);
    await writeOpenSnapshot(st, SNAP);
    expect(await loadOpenSnapshot(st)).toEqual(SNAP);
  });
  it('a PUBLIC bucket is refused for writing and reading', async () => {
    await expect(writeOpenSnapshot(memStore(true), SNAP)).rejects.toThrow(/PUBLIC/);
    const st = memStore(false); await writeOpenSnapshot(st, SNAP);
    const leaked = { ...st, bucketIsPublic: async () => true };
    expect(await loadOpenSnapshot(leaked)).toBeNull();
  });
  it('a missing bucket is refused (no auto-create) and the loader returns null, so callers use SQL', async () => {
    await expect(writeOpenSnapshot(memStore(null), SNAP)).rejects.toThrow(/does not exist/);
    expect(await loadOpenSnapshot(memStore(null))).toBeNull();
  });
  it('the store implementation never calls createBucket', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./open-snapshot-store.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/createBucket\(/);
  });
});
