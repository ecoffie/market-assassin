/**
 * SAM archive helper — behavioural tests for the parts that need no credentials.
 *
 * The checksum-conflict rule is the one worth pinning: a same-name/different-bytes SAM file
 * must SURFACE, never be silently versioned away, because the archived bytes may be the
 * provenance for rows already in the database.
 */
import { describe, it, expect } from 'vitest';
import {
  archiveObjectKey, snapshotDate, sha256File, ArchiveChecksumConflict, archiveSamZip,
} from '../../../scripts/lib/sam-archive.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ZIP = 'SAM_PUBLIC_MONTHLY_V2_20260802.ZIP';

describe('archive object key + snapshot date', () => {
  it('encodes the snapshot in an immutable, collision-free path', () => {
    expect(archiveObjectKey(ZIP)).toBe('monthly/2026/08/' + ZIP);
    expect(archiveObjectKey('/tmp/sam-extract/' + ZIP)).toBe('monthly/2026/08/' + ZIP);
  });
  it('a later snapshot never collides with an earlier one', () => {
    expect(archiveObjectKey('SAM_PUBLIC_MONTHLY_V2_20260906.ZIP'))
      .not.toBe(archiveObjectKey(ZIP));
  });
  it('reports the date the snapshot REPRESENTS, not the ingestion date', () => {
    expect(snapshotDate(ZIP)).toBe('2026-08-02');
  });
  it('an unparseable name is quarantined, not guessed into a wrong month', () => {
    expect(archiveObjectKey('weird.zip')).toBe('monthly/unknown/weird.zip');
    expect(snapshotDate('weird.zip')).toBeNull();
  });
});

describe('checksum conflict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'samarch-'));
  const path = join(dir, ZIP);
  writeFileSync(path, 'incoming-bytes');

  const fakeStorage = (existing: { sha?: string } | null) => ({
    bucket: () => ({
      file: () => ({
        exists: async () => [existing !== null],
        getMetadata: async () => [{ metadata: existing?.sha ? { sha256: existing.sha } : {} }],
        save: async () => { throw new Error('save() must NOT be called when the object exists'); },
      }),
    }),
  });

  it('SAME NAME, DIFFERENT BYTES throws — never silently supersedes evidence', async () => {
    await expect(archiveSamZip({ storage: fakeStorage({ sha: 'deadbeef' }) as never, zipPath: path }))
      .rejects.toBeInstanceOf(ArchiveChecksumConflict);
  });

  it('byte-identical re-run skips the upload and stays idempotent', async () => {
    const sha = await sha256File(path);
    const r = await archiveSamZip({ storage: fakeStorage({ sha }) as never, zipPath: path });
    expect(r.skipped).toBe(true);
    expect(r.sha256).toBe(sha);
  });

  it('an archive predating checksums is not treated as a conflict', async () => {
    const r = await archiveSamZip({ storage: fakeStorage({}) as never, zipPath: path });
    expect(r.skipped).toBe(true);
  });

  it('the conflict error names both checksums so it can be investigated', async () => {
    try {
      await archiveSamZip({ storage: fakeStorage({ sha: 'aaa111' }) as never, zipPath: path });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as ArchiveChecksumConflict;
      expect(err.existing).toBe('aaa111');
      expect(err.message).toContain('DIFFERENT checksum');
      expect(err.message).toContain('provenance for existing DB rows');
    }
  });
});
