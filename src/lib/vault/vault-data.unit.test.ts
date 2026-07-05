import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  VAULT_TABLES,
  VAULT_STORAGE_BUCKET,
  readAllVaultData,
  deleteAllVaultData,
  listVaultStorageFiles,
} from './vault-data';

/**
 * The vault-data lib is the CANONICAL definition of "a user's vault" — it backs
 * export, self-serve delete, AND admin delete, so a bug here is a data-loss or
 * (worse) a cross-tenant-leak bug. These tests lock the properties that matter:
 * every vault table + Storage file is covered, deletion is OWNER-SCOPED (filters
 * by the exact email), and a single table error never aborts the rest.
 *
 * The Supabase client is a hand-rolled mock that records the (table, filter)
 * pairs it was asked to operate on, so we can assert the owner scoping directly.
 */

interface Recorded {
  deletes: { table: string; eqCol: string; eqVal: string }[];
  selects: { table: string; eqCol: string; eqVal: string }[];
  storageList: string[];
  storageRemoved: string[][];
}

function makeMockSupabase(opts?: {
  rowsPerTable?: number;
  failTable?: string;
  storageFiles?: string[];
  storageListError?: string;
}): { sb: SupabaseClient; rec: Recorded } {
  const rec: Recorded = { deletes: [], selects: [], storageList: [], storageRemoved: [] };
  const rowsPerTable = opts?.rowsPerTable ?? 2;

  const from = (table: string) => ({
    select: () => ({
      eq: (eqCol: string, eqVal: string) => {
        rec.selects.push({ table, eqCol, eqVal });
        if (opts?.failTable === table) return Promise.resolve({ data: null, error: { message: 'boom' } });
        const data = Array.from({ length: rowsPerTable }, (_, i) => ({ id: i, user_email: eqVal }));
        return Promise.resolve({ data, error: null });
      },
    }),
    delete: () => ({
      eq: (eqCol: string, eqVal: string) => {
        rec.deletes.push({ table, eqCol, eqVal });
        if (opts?.failTable === table) return Promise.resolve({ count: 0, error: { message: 'boom' } });
        return Promise.resolve({ count: rowsPerTable, error: null });
      },
    }),
  });

  const storage = {
    from: (_bucket: string) => ({
      list: (prefix: string) => {
        rec.storageList.push(prefix);
        if (opts?.storageListError) return Promise.resolve({ data: null, error: { message: opts.storageListError } });
        return Promise.resolve({ data: (opts?.storageFiles || []).map((name) => ({ name })), error: null });
      },
      remove: (paths: string[]) => {
        rec.storageRemoved.push(paths);
        return Promise.resolve({ error: null });
      },
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: { from, storage } as any as SupabaseClient, rec };
}

describe('VAULT_TABLES canonical list', () => {
  it('includes all five sensitive vault tables (drift guard)', () => {
    expect([...VAULT_TABLES].sort()).toEqual([
      'user_boilerplate_docs',
      'user_capabilities_library',
      'user_identity_profile',
      'user_past_performance',
      'user_team_members',
    ]);
  });
});

describe('deleteAllVaultData — owner-scoped, complete, resilient', () => {
  it('deletes EVERY vault table, each filtered by the exact user_email', async () => {
    const { sb, rec } = makeMockSupabase({ storageFiles: ['a.pdf'] });
    await deleteAllVaultData(sb, 'owner@x.com');
    // one delete per vault table
    expect(rec.deletes.map((d) => d.table).sort()).toEqual([...VAULT_TABLES].sort());
    // every delete scoped to the owner — NEVER an unscoped wipe
    for (const d of rec.deletes) {
      expect(d.eqCol).toBe('user_email');
      expect(d.eqVal).toBe('owner@x.com');
    }
  });

  it('removes the owner\'s Storage files (pathed by email)', async () => {
    const { sb, rec } = makeMockSupabase({ storageFiles: ['123-resume.pdf', '456-cap.pdf'] });
    const res = await deleteAllVaultData(sb, 'owner@x.com');
    expect(rec.storageList).toContain('owner@x.com');
    expect(rec.storageRemoved[0]).toEqual(['owner@x.com/123-resume.pdf', 'owner@x.com/456-cap.pdf']);
    expect(res.storage.files).toBe(2);
  });

  it('reports total rows deleted across tables', async () => {
    const { sb } = makeMockSupabase({ rowsPerTable: 3 });
    const res = await deleteAllVaultData(sb, 'owner@x.com');
    expect(res.totalRowsDeleted).toBe(3 * VAULT_TABLES.length);
  });

  it('a single failing table does NOT abort the others (best-effort)', async () => {
    const { sb, rec } = makeMockSupabase({ failTable: 'user_team_members' });
    const res = await deleteAllVaultData(sb, 'owner@x.com');
    // all tables still attempted
    expect(rec.deletes).toHaveLength(VAULT_TABLES.length);
    // the failure is surfaced, not swallowed
    const failed = res.tables.find((t) => t.table === 'user_team_members');
    expect(failed?.error).toBe('boom');
    // others still succeeded
    expect(res.tables.filter((t) => !t.error).length).toBe(VAULT_TABLES.length - 1);
  });

  it('surfaces a Storage list error without throwing', async () => {
    const { sb } = makeMockSupabase({ storageListError: 'bucket unavailable' });
    const res = await deleteAllVaultData(sb, 'owner@x.com');
    expect(res.storage.error).toBe('bucket unavailable');
    expect(res.storage.files).toBe(0);
  });
});

describe('readAllVaultData — owner-scoped export', () => {
  it('reads every vault table filtered by the owner email', async () => {
    const { sb, rec } = makeMockSupabase({ rowsPerTable: 2 });
    const out = await readAllVaultData(sb, 'owner@x.com');
    expect(out.map((t) => t.table).sort()).toEqual([...VAULT_TABLES].sort());
    for (const s of rec.selects) {
      expect(s.eqCol).toBe('user_email');
      expect(s.eqVal).toBe('owner@x.com');
    }
    expect(out.every((t) => t.rows.length === 2)).toBe(true);
  });

  it('a failing table reports its error but the export still returns the rest', async () => {
    const { sb } = makeMockSupabase({ failTable: 'user_identity_profile' });
    const out = await readAllVaultData(sb, 'owner@x.com');
    expect(out.find((t) => t.table === 'user_identity_profile')?.error).toBe('boom');
    expect(out.length).toBe(VAULT_TABLES.length);
  });
});

describe('listVaultStorageFiles', () => {
  it('prefixes returned names with the owner email path + uses the vault bucket', async () => {
    const { sb } = makeMockSupabase({ storageFiles: ['r.pdf'] });
    const res = await listVaultStorageFiles(sb, 'owner@x.com');
    expect(res.paths).toEqual(['owner@x.com/r.pdf']);
    expect(VAULT_STORAGE_BUCKET).toBe('vault-assets');
  });
});
