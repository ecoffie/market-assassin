/**
 * reconcileUnresolvedGaoAgencies — BOUNDED pass (2026-11-23).
 *
 * The read had no range (PostgREST silently caps a response at 1,000 rows) and every
 * NO_AGENCY row's `raw` was rewritten on every run with no budget check, spending the
 * shared run budget before the IG lane. The fake below enforces the 1,000-row cap
 * exactly like PostgREST, so an unranged read cannot pass these tests.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reconcileUnresolvedGaoAgencies, RECONCILE_MAX_PAGE_SIZE, auditDocumentAgency, type InstituteDocument,
} from './sources';
import CODES from '@/data/agency-toptier-codes.json';

const NAMES = Object.keys(CODES as Record<string, unknown>);
const POSTGREST_CAP = 1000;

type Row = {
  id: string; document_number: string; title: string; abstract: string | null;
  source_url: string; publication_date: string | null; raw: Record<string, unknown> | null;
  resolution_method: string | null; canonical_agency: string | null; source_type: string;
};

function fakeDb(rows: Row[], opts: { onRead?: () => void } = {}) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const pageSizes: number[] = [];
  const db = {
    from: () => {
      let gtId: string | null = null;
      let limit: number | null = null;
      let patch: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          if (patch && col === 'id') {
            updates.push({ id: val as string, patch });
            const row = rows.find((r) => r.id === val)!;
            Object.assign(row, patch);
          }
          return b;
        },
        or: () => b,
        gt: (_c: string, v: string) => { gtId = v; return b; },
        order: () => b,
        limit: (n: number) => { limit = n; return b; },
        update: (p: Record<string, unknown>) => { patch = p; return b; },
        then: (res: (v: unknown) => unknown) => {
          if (patch) return Promise.resolve({ data: null, error: null }).then(res);
          opts.onRead?.();
          const matching = rows
            .filter((r) => r.source_type === 'gao_report')
            .filter((r) => r.canonical_agency === null || r.resolution_method === 'unresolved')
            .filter((r) => gtId === null || r.id > gtId)
            .sort((a, z) => (a.id < z.id ? -1 : 1));
          const n = Math.min(limit ?? Infinity, POSTGREST_CAP); // PostgREST's silent cap
          pageSizes.push(limit ?? -1);
          return Promise.resolve({ data: matching.slice(0, n), error: null }).then(res);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, updates, pageSizes };
}

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const noAgencyRow = (n: number, raw: Record<string, unknown> | null = null): Row => ({
  id: id(n), document_number: `GAO-26-${String(n).padStart(6, '0')}`,
  title: `Federal Rulemaking: Good Cause and Other Mechanisms ${n}`, abstract: null,
  source_url: 'https://www.gao.gov/x', publication_date: '2026-09-10', raw,
  resolution_method: 'unresolved', canonical_agency: null, source_type: 'gao_report',
});
const resolvableRow = (n: number): Row => ({
  ...noAgencyRow(n),
  title: 'Disaster Risk: Improvements Needed to Enhance FEMA',
  abstract: 'FEMA — a component within the Department of Homeland Security — ...',
});

function storedNoAgencyRaw(row: Row): Record<string, unknown> {
  const doc: InstituteDocument = {
    sourceOrg: 'GAO', sourceType: 'gao_report', documentNumber: row.document_number, title: row.title,
    url: row.source_url, publicationDate: row.publication_date, abstract: row.abstract,
  };
  const a = auditDocumentAgency(doc, NAMES);
  return { feed: 'gao_rss', agencyClassification: a.classification, agencyCandidates: a.candidates, agencyNote: a.note };
}

describe('paged read — more than 1,000 candidate rows', () => {
  it('visits all 2,345 candidates in pages below the 1,000-row cap', async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => noAgencyRow(i + 1));
    const { db, pageSizes } = fakeDb(rows);
    const r = await reconcileUnresolvedGaoAgencies(db, NAMES);
    expect(r.scanned).toBe(2345);
    expect(r.noAgency).toBe(2345);
    expect(r.complete).toBe(true);
    expect(r.budgetExhausted).toBe(false);
    expect(pageSizes.every((n) => n > 0 && n < POSTGREST_CAP)).toBe(true);
    expect(r.pagesRead).toBe(Math.ceil(2345 / 500));
  });

  it('a page size at or above the cap is clamped below it', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => noAgencyRow(i + 1));
    const { db, pageSizes } = fakeDb(rows);
    const r = await reconcileUnresolvedGaoAgencies(db, NAMES, { pageSize: 5000 });
    expect(r.scanned).toBe(1500);
    expect(Math.max(...pageSizes)).toBe(RECONCILE_MAX_PAGE_SIZE);
  });

  it('keyset paging never skips rows when rows resolved this pass leave the filter', async () => {
    // Interleave resolvable rows across page boundaries: an offset read would skip.
    const rows = Array.from({ length: 1200 }, (_, i) => (i % 3 === 0 ? resolvableRow(i + 1) : noAgencyRow(i + 1)));
    const { db } = fakeDb(rows);
    const r = await reconcileUnresolvedGaoAgencies(db, NAMES, { pageSize: 100 });
    expect(r.scanned).toBe(1200);
    expect(r.newlyResolved).toBe(400);
    expect(r.details.filter((d) => d.canonicalAgency)).toHaveLength(400);
  });
});

describe('unchanged NO_AGENCY rows are not rewritten', () => {
  it('skips rows whose stored classification already matches', async () => {
    const rows = Array.from({ length: 1100 }, (_, i) => noAgencyRow(i + 1));
    for (const row of rows) row.raw = storedNoAgencyRaw(row);
    const { db, updates } = fakeDb(rows);
    const r = await reconcileUnresolvedGaoAgencies(db, NAMES);
    expect(r.scanned).toBe(1100);
    expect(r.unchangedSkipped).toBe(1100);
    expect(updates).toHaveLength(0);
    expect(r.details).toHaveLength(0);
  });

  it('writes first-time classifications once, then the second run writes nothing', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => noAgencyRow(i + 1, { feed: 'gao_rss' }));
    const { db, updates } = fakeDb(rows);
    const first = await reconcileUnresolvedGaoAgencies(db, NAMES);
    expect(updates).toHaveLength(30);
    expect(first.unchangedSkipped).toBe(0);
    // prior raw keys are preserved
    expect(updates[0].patch.raw).toMatchObject({ feed: 'gao_rss', agencyClassification: 'NO_AGENCY' });
    const second = await reconcileUnresolvedGaoAgencies(db, NAMES);
    expect(updates).toHaveLength(30);
    expect(second.unchangedSkipped).toBe(30);
  });

  it('a row whose stored note differs (inputs/map changed) IS rewritten', async () => {
    const row = noAgencyRow(1);
    row.raw = { ...storedNoAgencyRaw(row), agencyNote: 'stale note' };
    const { db, updates } = fakeDb([row]);
    await reconcileUnresolvedGaoAgencies(db, NAMES);
    expect(updates).toHaveLength(1);
  });

  it('a previously NO_AGENCY row that now resolves is still resolved (audit is never skipped)', async () => {
    const row = resolvableRow(1);
    row.raw = { agencyClassification: 'NO_AGENCY', agencyCandidates: [], agencyNote: 'old' };
    const { db } = fakeDb([row]);
    const r = await reconcileUnresolvedGaoAgencies(db, NAMES);
    expect(r.newlyResolved).toBe(1);
    expect(row.canonical_agency).toBe('Department of Homeland Security');
  });
});

describe('shared run budget', () => {
  it('a deadline already passed reads nothing and reports an incomplete pass', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => noAgencyRow(i + 1));
    let reads = 0;
    const { db, updates } = fakeDb(rows, { onRead: () => { reads++; } });
    const r = await reconcileUnresolvedGaoAgencies(db, NAMES, { deadlineMs: 0, now: () => 1 });
    expect(reads).toBe(0);
    expect(updates).toHaveLength(0);
    expect(r).toMatchObject({ scanned: 0, complete: false, budgetExhausted: true });
  });

  it('stops mid-pass when the budget runs out, without touching later rows', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => noAgencyRow(i + 1));
    let t = 0;
    const now = () => t++; // one tick per budget check
    const { db, updates } = fakeDb(rows);
    const r = await reconcileUnresolvedGaoAgencies(db, NAMES, { deadlineMs: 1200, now });
    expect(r.budgetExhausted).toBe(true);
    expect(r.complete).toBe(false);
    expect(r.scanned).toBeGreaterThan(0);
    expect(r.scanned).toBeLessThan(2500);
    expect(updates).toHaveLength(r.scanned);
    const touched = new Set(updates.map((u) => u.id));
    expect(touched.has(id(2500))).toBe(false);
  });
});

describe('route wiring', () => {
  it('the GAO cron passes the SHARED deadline and treats a budget cut as partial', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const route = readFileSync(join(process.cwd(), 'src/app/api/cron/institute-gao-sync/route.ts'), 'utf8');
    expect(route).toContain('reconcileUnresolvedGaoAgencies(db, names, { deadlineMs: started + budgetMs })');
    expect(route).toMatch(/if \(reconcile\.budgetExhausted\) partial = true;/);
  });
});
