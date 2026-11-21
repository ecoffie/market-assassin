import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteAllVaultData, listVaultStorageFiles, VAULT_STORAGE_BUCKET } from './vault-data';
import { listAllOwnedFiles, removeOwnedFiles, isOwnedPath } from './vault-delete';
import { hardDeleteVaultDocument } from './document-delete';
import { markBackupCopiesForPurge, purgeDueBackupCopies, PURGE_PREFIX, BACKUP_RECOVERY_DAYS } from './vault-backup-purge';
import { BACKUP_BUCKET } from './vault-file-backup';

/**
 * Complete and accurate Vault deletion. The fake Storage behaves like Supabase Storage in the ways that
 * matter here:
 *   - list(prefix, {limit, offset}) returns ONE level, paged; a sub-folder is {name, id:null, metadata:null};
 *   - remove(paths) deletes EXACT keys only (a folder path deletes nothing) and returns what it removed.
 */

type Buckets = Map<string, Map<string, string>>;

function fakeStorage(seed: Record<string, string[]> = {}, opts: { failRemove?: boolean; dropOne?: boolean; failListUnder?: string } = {}) {
  const buckets: Buckets = new Map();
  for (const [b, keys] of Object.entries(seed)) buckets.set(b, new Map(keys.map((k) => [k, 'x'])));
  const calls = { removed: [] as string[][] };
  const bucket = (b: string) => {
    if (!buckets.has(b)) buckets.set(b, new Map());
    return buckets.get(b)!;
  };
  const storage = {
    from: (b: string) => ({
      list: async (prefix: string, o: { limit?: number; offset?: number } = {}) => {
        if (opts.failListUnder && prefix.startsWith(opts.failListUnder)) return { data: null, error: { message: 'list boom' } };
        const base = prefix ? `${prefix}/` : '';
        const files = new Set<string>();
        const folders = new Set<string>();
        for (const k of bucket(b).keys()) {
          if (!k.startsWith(base)) continue;
          const rest = k.slice(base.length);
          const slash = rest.indexOf('/');
          if (slash === -1) files.add(rest);
          else folders.add(rest.slice(0, slash));
        }
        const entries = [
          ...[...folders].map((name) => ({ name, id: null, metadata: null })),
          ...[...files].map((name) => ({ name, id: `id-${name}`, metadata: { size: 1 } })),
        ].sort((a, c) => a.name.localeCompare(c.name));
        const off = o.offset ?? 0;
        return { data: entries.slice(off, off + (o.limit ?? 100)), error: null };
      },
      remove: async (paths: string[]) => {
        calls.removed.push(paths);
        if (opts.failRemove) return { data: null, error: { message: 'remove boom' } };
        const out: { name: string }[] = [];
        paths.forEach((p, i) => {
          if (opts.dropOne && i === 0) return; // silently not removed
          if (bucket(b).delete(p)) out.push({ name: p });
        });
        return { data: out, error: null };
      },
      upload: async (path: string, body: Buffer | string) => {
        bucket(b).set(path, String(body));
        return { error: null };
      },
      download: async (path: string) => {
        const v = bucket(b).get(path);
        return v === undefined ? { data: null, error: { message: 'not found' } } : { data: { text: async () => v }, error: null };
      },
    }),
  };
  return { storage, buckets, calls, keys: (b: string) => [...bucket(b).keys()].sort() };
}

/** Supabase-shaped client: tables accept delete().eq() for the 5 vault tables. */
function client(storage: unknown): SupabaseClient {
  const from = () => ({ delete: () => ({ eq: async () => ({ count: 1, error: null }) }) });
  return { from, storage } as unknown as SupabaseClient;
}

const OWNER = 'owner@x.com';
const ownerFiles = [`${OWNER}/1-cap.pdf`, `${OWNER}/generated/2-v1-report.docx`, `${OWNER}/resumes/3-cv.pdf`];
const otherFiles = ['other@x.com/9-secret.pdf', 'owner@x.com.evil/8-trap.pdf', 'xowner@x.com/7.pdf'];

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('account / Vault deletion with VAULT_COMPLETE_DELETION on', () => {
  beforeEach(() => vi.stubEnv('VAULT_COMPLETE_DELETION', 'true'));

  it('deletes files in every sub-folder (generated/, resumes/) and counts exactly what was removed', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [...ownerFiles, ...otherFiles] });
    const res = await deleteAllVaultData(client(f.storage), OWNER);
    expect(res.storage.error).toBeUndefined();
    expect(res.storage.files).toBe(3);
    expect(res.storage.requested).toBe(3);
    expect(f.keys(VAULT_STORAGE_BUCKET)).toEqual([...otherFiles].sort());
  });

  it('pages past 1000 entries per folder', async () => {
    const top = Array.from({ length: 2500 }, (_, i) => `${OWNER}/${String(i).padStart(5, '0')}.pdf`);
    const gen = Array.from({ length: 1200 }, (_, i) => `${OWNER}/generated/${String(i).padStart(5, '0')}.docx`);
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [...top, ...gen, ...otherFiles] });
    const res = await deleteAllVaultData(client(f.storage), OWNER);
    expect(res.storage).toMatchObject({ files: 3700, requested: 3700 });
    expect(res.storage.error).toBeUndefined();
    expect(f.keys(VAULT_STORAGE_BUCKET)).toEqual([...otherFiles].sort());
  });

  it('never touches another customer, including look-alike prefixes', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [...ownerFiles, ...otherFiles] });
    await deleteAllVaultData(client(f.storage), OWNER);
    for (const batch of f.calls.removed) for (const p of batch) expect(isOwnedPath(p, OWNER)).toBe(true);
    expect(f.keys(VAULT_STORAGE_BUCKET)).toEqual(expect.arrayContaining(otherFiles));
  });

  it('marks the removed files backup copies for purge after the recovery window', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: ownerFiles });
    const res = await deleteAllVaultData(client(f.storage), OWNER);
    expect(res.storage.backupPurge).toEqual({ markedFiles: 3 });
    const markers = f.keys(BACKUP_BUCKET).filter((k) => k.startsWith(`${PURGE_PREFIX}/`));
    expect(markers).toHaveLength(1);
    const req = JSON.parse(f.buckets.get(BACKUP_BUCKET)!.get(markers[0])!);
    expect(req.owner).toBe(OWNER);
    expect([...req.paths].sort()).toEqual([...ownerFiles].sort());
  });

  it('a failed remove is an error with 0 counted, never success', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: ownerFiles }, { failRemove: true });
    const res = await deleteAllVaultData(client(f.storage), OWNER);
    expect(res.storage.files).toBe(0);
    expect(res.storage.error).toMatch(/remove boom/);
  });

  it('a file Storage did not remove makes the receipt an error', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: ownerFiles }, { dropOne: true });
    const res = await deleteAllVaultData(client(f.storage), OWNER);
    expect(res.storage.files).toBe(2);
    expect(res.storage.error).toMatch(/1 of 3 file\(s\) were not removed/);
  });

  it('a sub-folder that cannot be listed fails the deletion before anything is removed', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: ownerFiles }, { failListUnder: `${OWNER}/resumes` });
    const res = await deleteAllVaultData(client(f.storage), OWNER);
    expect(res.storage.error).toMatch(/sub-folder/);
    expect(res.storage.files).toBe(0);
    expect(f.calls.removed).toHaveLength(0);
  });

  it('the dry-run listing is recursive and lists files only', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [...ownerFiles, ...otherFiles] });
    const r = await listVaultStorageFiles(client(f.storage), OWNER);
    expect([...r.paths].sort()).toEqual([...ownerFiles].sort());
  });
});

describe('account / Vault deletion with the flag OFF (legacy sweep, honest receipt)', () => {
  it('removes top-level files only, as before, and reports the sub-folders it left as an error', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [...ownerFiles, ...otherFiles] });
    const res = await deleteAllVaultData(client(f.storage), OWNER);
    // Folder entries are never counted as removed files.
    expect(res.storage.files).toBe(1);
    expect(res.storage.error).toMatch(/2 sub-folder\(s\)/);
    expect(f.calls.removed).toEqual([[`${OWNER}/1-cap.pdf`]]);
    expect(f.keys(VAULT_STORAGE_BUCKET)).toEqual(expect.arrayContaining([`${OWNER}/generated/2-v1-report.docx`, `${OWNER}/resumes/3-cv.pdf`]));
    expect(f.keys(BACKUP_BUCKET)).toEqual([]);
  });

  it('a flat Vault still deletes cleanly with no error', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [`${OWNER}/a.pdf`, `${OWNER}/b.pdf`] });
    const res = await deleteAllVaultData(client(f.storage), OWNER);
    expect(res.storage).toEqual({ files: 2, requested: 2 });
  });

  it('says when the top-level listing was cut off at 1000', async () => {
    const top = Array.from({ length: 1001 }, (_, i) => `${OWNER}/${String(i).padStart(5, '0')}.pdf`);
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: top });
    const res = await deleteAllVaultData(client(f.storage), OWNER);
    expect(res.storage.files).toBe(1000);
    expect(res.storage.error).toMatch(/more than 1000/);
  });
});

describe('path guards', () => {
  it('refuses to remove any path outside the owner prefix', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [...ownerFiles, ...otherFiles] });
    const r = await removeOwnedFiles(f.storage, VAULT_STORAGE_BUCKET, OWNER, [ownerFiles[0], otherFiles[0]]);
    expect(r.removed).toBe(0);
    expect(r.callError).toMatch(/outside this vault/);
    expect(f.calls.removed).toHaveLength(0);
  });

  it('rejects owners that could escape their folder', () => {
    expect(isOwnedPath('a@x.com/../b@x.com/f.pdf', 'a@x.com')).toBe(false);
    expect(isOwnedPath('a@x.com/', 'a@x.com')).toBe(false);
    expect(() => isOwnedPath('x/y', 'a/b')).toThrow();
  });

  it('listing is rooted at the exact owner folder', async () => {
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [...ownerFiles, ...otherFiles] });
    const r = await listAllOwnedFiles(f.storage, VAULT_STORAGE_BUCKET, OWNER);
    expect(r.ok && [...r.paths].sort()).toEqual([...ownerFiles].sort());
  });
});

// ── single-document Delete ────────────────────────────────────────────────────────────────────

type DocRow = { id: string; user_email: string; storage_path: string | null; parent_id: string | null };

function fakeDb(rows: DocRow[], opts: { failDelete?: boolean } = {}) {
  const deletes: string[][] = [];
  const db = {
    from: () => {
      const filters: Array<(r: DocRow) => boolean> = [];
      let mode: 'select' | 'delete' = 'select';
      const q = {
        select: () => q,
        delete: () => { mode = 'delete'; return q; },
        eq: (col: keyof DocRow, val: unknown) => { filters.push((r) => r[col] === val); return q; },
        in: (col: keyof DocRow, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return q; },
        maybeSingle: async () => ({ data: rows.find((r) => filters.every((f) => f(r))) ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (mode === 'delete') {
            if (opts.failDelete) return resolve({ count: null, error: { message: 'db boom' } });
            deletes.push(hit.map((r) => r.id));
            for (const h of hit) rows.splice(rows.indexOf(h), 1);
            return resolve({ count: hit.length, error: null });
          }
          return resolve({ data: hit, error: null });
        },
      };
      return q;
    },
  };
  return { db, rows, deletes };
}

const DOC = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';

function docFixture() {
  const rows: DocRow[] = [
    { id: DOC, user_email: OWNER, storage_path: `${OWNER}/generated/1-v1-r.docx`, parent_id: null },
    { id: V2, user_email: OWNER, storage_path: `${OWNER}/generated/2-v2-r.docx`, parent_id: DOC },
    { id: FOREIGN, user_email: 'other@x.com', storage_path: 'other@x.com/9-secret.pdf', parent_id: null },
  ];
  const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [rows[0].storage_path!, rows[1].storage_path!, rows[2].storage_path!] });
  return { rows, f };
}

describe('single-document Delete (distinct from Archive)', () => {
  it('removes the file, the record and its later versions, and marks backups for purge', async () => {
    const { rows, f } = docFixture();
    const { db } = fakeDb(rows);
    const r = await hardDeleteVaultDocument({ db, storage: f.storage }, { id: DOC, ownerEmail: OWNER });
    expect(r).toEqual({ ok: true, receipt: { documents: 2, files: 2, filesAlreadyAbsent: 0, backupPurge: { markedFiles: 2 } } });
    expect(rows.map((x) => x.id)).toEqual([FOREIGN]);
    expect(f.keys(VAULT_STORAGE_BUCKET)).toEqual(['other@x.com/9-secret.pdf']);
  });

  it("another customer's document id is not found and nothing is touched", async () => {
    const { rows, f } = docFixture();
    const { db, deletes } = fakeDb(rows);
    const r = await hardDeleteVaultDocument({ db, storage: f.storage }, { id: FOREIGN, ownerEmail: OWNER });
    expect(r).toMatchObject({ ok: false, status: 404, code: 'not_found' });
    expect(deletes).toHaveLength(0);
    expect(f.calls.removed).toHaveLength(0);
  });

  it('a Storage failure deletes no records', async () => {
    const { rows } = docFixture();
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: rows.map((x) => x.storage_path!) }, { failRemove: true });
    const { db, deletes } = fakeDb(rows);
    const r = await hardDeleteVaultDocument({ db, storage: f.storage }, { id: DOC, ownerEmail: OWNER });
    expect(r).toMatchObject({ ok: false, code: 'storage_failed' });
    expect(deletes).toHaveLength(0);
    expect(rows).toHaveLength(3);
  });

  it('a record delete failure is an error, never success (retry-safe)', async () => {
    const { rows, f } = docFixture();
    const { db } = fakeDb(rows, { failDelete: true });
    const r = await hardDeleteVaultDocument({ db, storage: f.storage }, { id: DOC, ownerEmail: OWNER });
    expect(r).toMatchObject({ ok: false, code: 'delete_failed' });
  });

  it('a file that is already gone is reported as absent, and the record is still removed', async () => {
    const { rows } = docFixture();
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: [rows[0].storage_path!] });
    const { db } = fakeDb(rows);
    const r = await hardDeleteVaultDocument({ db, storage: f.storage }, { id: DOC, ownerEmail: OWNER });
    expect(r).toMatchObject({ ok: true, receipt: { documents: 2, files: 1, filesAlreadyAbsent: 1 } });
  });

  it('a stored path outside the owner folder stops everything', async () => {
    const rows: DocRow[] = [{ id: DOC, user_email: OWNER, storage_path: 'other@x.com/9-secret.pdf', parent_id: null }];
    const f = fakeStorage({ [VAULT_STORAGE_BUCKET]: ['other@x.com/9-secret.pdf'] });
    const { db, deletes } = fakeDb(rows);
    const r = await hardDeleteVaultDocument({ db, storage: f.storage }, { id: DOC, ownerEmail: OWNER });
    expect(r).toMatchObject({ ok: false, code: 'inconsistent' });
    expect(deletes).toHaveLength(0);
    expect(f.keys(VAULT_STORAGE_BUCKET)).toEqual(['other@x.com/9-secret.pdf']);
  });
});

describe('backup purge after the recovery window', () => {
  const T0 = new Date('2026-11-21T12:00:00Z');
  const after = (days: number) => new Date(T0.getTime() + days * 86_400_000);

  it('keeps the backup copy for the recovery window, then removes it and the request', async () => {
    const f = fakeStorage({ [BACKUP_BUCKET]: [...ownerFiles, ...otherFiles] });
    const mark = await markBackupCopiesForPurge(f.storage, OWNER, ownerFiles, T0);
    expect(mark.ok).toBe(true);

    const early = await purgeDueBackupCopies(f.storage, after(BACKUP_RECOVERY_DAYS - 1));
    expect(early).toMatchObject({ requestsProcessed: 0, copiesRemoved: 0, errors: [] });
    expect(f.keys(BACKUP_BUCKET)).toEqual(expect.arrayContaining(ownerFiles));

    const due = await purgeDueBackupCopies(f.storage, after(BACKUP_RECOVERY_DAYS + 1));
    expect(due).toMatchObject({ requestsProcessed: 1, copiesRemoved: 3, alreadyAbsent: 0, errors: [] });
    expect(f.keys(BACKUP_BUCKET)).toEqual([...otherFiles].sort());
  });

  it('refuses to record or act on a path outside the owner folder', async () => {
    const f = fakeStorage({ [BACKUP_BUCKET]: otherFiles });
    expect(await markBackupCopiesForPurge(f.storage, OWNER, [otherFiles[0]], T0)).toMatchObject({ ok: false });
    // A tampered request naming another customer's copy is refused and nothing is removed.
    const bad = { owner: OWNER, paths: [otherFiles[0]], requestedAt: T0.toISOString(), purgeAfter: T0.toISOString() };
    await f.storage.from(BACKUP_BUCKET).upload(`${PURGE_PREFIX}/2026-11-21/bad.json`, JSON.stringify(bad));
    const run = await purgeDueBackupCopies(f.storage, after(1));
    expect(run.copiesRemoved).toBe(0);
    expect(run.errors[0]).toMatch(/outside its vault/);
    expect(f.keys(BACKUP_BUCKET)).toEqual(expect.arrayContaining(otherFiles));
  });
});
