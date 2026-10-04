import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  A1B,
  A1B_EXPECTED,
  allowedRemainingShortCode,
  cleanupScript,
  intentionallyRemovedInWindow,
  preservationExclusions,
  selectionSql,
  sqlIdList,
  verifySelection,
  type SelectedRow,
} from './a1b-cleanup';
import { lostTxnSql, malformedCodeSql, preservationSignatureSql } from './a1-acceptance';

const T = '`market-assasin.usaspending.awards`';
const ids = (rows: Array<{ txn_id: string }>) => rows.map((r) => r.txn_id);
const cents = (rows: Array<{ obligation: string }>) => rows.reduce((a, r) => a + Math.round(Number(r.obligation) * 100), 0);

describe('pinned populations (measured 2026-10-04)', () => {
  it('counts and obligations are exactly the measured ones', () => {
    expect(A1B.f3StaleCopies).toHaveLength(126);
    expect(A1B.f1ShortCodeTwins).toHaveLength(473);
    expect(A1B.f1bResolvedShortCode).toHaveLength(32);
    expect(A1B.ambiguousUntouched).toHaveLength(2);
    expect(A1B.f2SourceRedated).toHaveLength(2);
    expect(cents(A1B.f3StaleCopies)).toBe(Math.round(Number(A1B_EXPECTED.f3.obligation) * 100));
    expect(cents(A1B.f1ShortCodeTwins)).toBe(Math.round(Number(A1B_EXPECTED.f1.obligation) * 100));
    expect(A1B.preRepairClone).toBe('awards_clone_pre_idv_20261004_1406');
  });

  it('every population is unique within itself and disjoint from every other', () => {
    const groups = {
      f3: ids(A1B.f3StaleCopies), f1: ids(A1B.f1ShortCodeTwins), f1b: ids(A1B.f1bResolvedShortCode),
      ambiguous: ids(A1B.ambiguousUntouched), f2: ids(A1B.f2SourceRedated),
    };
    for (const [name, g] of Object.entries(groups)) expect(new Set(g).size, name).toBe(g.length);
    const names = Object.keys(groups) as Array<keyof typeof groups>;
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const b = new Set(groups[names[j]]);
      expect(groups[names[i]].filter((x) => b.has(x)), `${names[i]} ∩ ${names[j]}`).toEqual([]);
    }
  });

  it('short-code populations are short-code, FY2026, inside the early-August window; F1b dispositions are the resolved ones', () => {
    for (const r of [...A1B.f1ShortCodeTwins, ...A1B.f1bResolvedShortCode]) {
      expect(r.code).not.toMatch(/^[0-9]{3,4}$/);
      expect(r.fiscal_year).toBe(2026);
      expect(r.action_date >= '2026-04-23' && r.action_date <= '2026-05-03').toBe(true);
    }
    const disp = A1B.f1bResolvedShortCode.reduce<Record<string, number>>((a, r) => ({ ...a, [r.disposition]: (a[r.disposition] ?? 0) + 1 }), {});
    expect(disp).toEqual({ absent_at_source: 26, mod_absent_at_source: 2, superseded: 4 });
  });

  it('the two ambiguous rows and the two F2 re-dates are never deleted', () => {
    const script = cleanupScript(T);
    for (const r of [...A1B.ambiguousUntouched, ...A1B.f2SourceRedated]) expect(script).not.toContain(`'${r.txn_id}'`);
  });
});

describe('cleanup script — cannot reach outside the approved populations', () => {
  const script = cleanupScript(T);
  const statements = script.split(';').map((s) => s.trim()).filter(Boolean);
  const deletes = statements.filter((s) => /^DELETE\b/.test(s));
  const listOf = (stmt: string) => {
    const m = stmt.match(/AND txn_id IN \(('[^)]*')\)/);
    return m ? m[1].split(', ').map((x) => x.replace(/'/g, '')) : [];
  };

  it('is one transaction: BEGIN, three DELETEs each followed by its exact ASSERT, COMMIT — nothing else', () => {
    expect(statements[0]).toBe('BEGIN TRANSACTION');
    expect(statements.at(-1)).toBe('COMMIT TRANSACTION');
    expect(deletes).toHaveLength(3);
    expect(script).not.toMatch(/\b(UPDATE|MERGE|INSERT|DROP|TRUNCATE|CREATE|ALTER)\b/);
    expect(script).toContain(`ASSERT @@row_count = 126 AS`);
    expect(script).toContain(`ASSERT @@row_count = 473 AS`);
    expect(script).toContain(`ASSERT @@row_count = 32 AS`);
    const order = statements.map((s) => (/^DELETE/.test(s) ? 'D' : /^ASSERT/.test(s) ? 'A' : s.split(' ')[0]));
    expect(order).toEqual(['BEGIN', 'D', 'A', 'D', 'A', 'D', 'A', 'COMMIT']);
  });

  it('each DELETE is bounded by its exact pinned id list', () => {
    expect(listOf(deletes[0]).sort()).toEqual(ids(A1B.f3StaleCopies).sort());
    expect(listOf(deletes[1]).sort()).toEqual(ids(A1B.f1ShortCodeTwins).sort());
    expect(listOf(deletes[2]).sort()).toEqual(ids(A1B.f1bResolvedShortCode).sort());
  });

  it('F3 deletes only pre-A1 rows whose txn has an A1-loaded counterpart, in the pinned fiscal years', () => {
    const years = [...new Set(A1B.f3StaleCopies.map((r) => r.fiscal_year))].sort();
    expect(deletes[0]).toContain(`fiscal_year IN (${years.join(', ')})`);
    expect(deletes[0]).toContain('award_or_idv_flag IS NULL');
    expect(deletes[0]).toMatch(/txn_id IN \(SELECT txn_id FROM .* WHERE fiscal_year = 2026 AND award_or_idv_flag IS NOT NULL\)/);
  });

  it('F1/F1b delete only short-code, pre-A1, FY2026 rows inside 2026-04-23..2026-05-03', () => {
    for (const d of deletes.slice(1)) {
      expect(d).toContain('fiscal_year = 2026');
      expect(d).toContain(`action_date BETWEEN '2026-04-23' AND '2026-05-03'`);
      expect(d).toContain(`NOT REGEXP_CONTAINS(awarding_agency_code, r'^[0-9]{3,4}$')`);
      expect(d).toContain('award_or_idv_flag IS NULL');
    }
  });

  it('refuses unsafe identifiers before they reach SQL', () => {
    expect(() => sqlIdList([])).toThrow(/empty/);
    for (const bad of ["x'; DROP TABLE awards --", 'a b', 'ok_id_1) OR (1=1']) expect(() => sqlIdList([bad])).toThrow(/unsafe/);
  });
});

describe('verifySelection — the write never runs on a drifted set', () => {
  const asRows = (pop: string, rows: Array<{ txn_id: string; fiscal_year?: number; action_date: string; code: string; obligation: string }>): SelectedRow[] =>
    rows.map((r) => ({ pop, txn_id: r.txn_id, fiscal_year: r.fiscal_year ?? 2026, action_date: r.action_date, code: r.code, obligation: r.obligation }));
  const exact = (): SelectedRow[] => [
    ...asRows('f3', A1B.f3StaleCopies), ...asRows('f1', A1B.f1ShortCodeTwins),
    ...asRows('f1b', A1B.f1bResolvedShortCode), ...asRows('short_remaining', A1B.ambiguousUntouched),
  ];

  it('passes on exactly the pinned identities', () => {
    expect(verifySelection(exact())).toMatchObject({ f3: 126, f1: 473, f1b: 32 });
  });
  it('refuses an extra candidate row', () => {
    const rows = exact();
    rows.push({ ...rows[0], txn_id: 'EXTRA_ROW_NOT_PINNED_0001' });
    expect(() => verifySelection(rows)).toThrow(/F3: selected 127, pinned 126/);
  });
  it('refuses a missing candidate row', () => {
    const rows = exact().filter((r) => r.txn_id !== A1B.f1ShortCodeTwins[0].txn_id);
    expect(() => verifySelection(rows)).toThrow(/F1: selected 472/);
  });
  it('refuses a changed obligation or date on an otherwise identical row', () => {
    const a = exact(); a[0] = { ...a[0], obligation: String(Number(a[0].obligation) + 1) };
    expect(() => verifySelection(a)).toThrow(/F3/);
    const b = exact(); const i = b.findIndex((r) => r.pop === 'f1b'); b[i] = { ...b[i], action_date: '2026-04-22' };
    expect(() => verifySelection(b)).toThrow(/F1b/);
  });
  it('refuses when the short-code remainder is not exactly the two ambiguous rows', () => {
    const rows = exact().filter((r) => r.pop !== 'short_remaining');
    expect(() => verifySelection(rows)).toThrow(/remainder/);
  });
  it('the selection SQL is a single read-only statement over the same predicates', () => {
    const sql = selectionSql(T);
    expect(sql.trim()).toMatch(/^WITH\b/);
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|MERGE|INSERT|DROP|TRUNCATE)\b/);
    expect(sql).toContain('award_or_idv_flag IS NULL');
  });
});

describe('acceptance allowances — exact identities only', () => {
  const allow = { preservationExcluded: preservationExclusions(), removedInWindow: intentionallyRemovedInWindow(), allowedShortCode: allowedRemainingShortCode() };

  it('preservation excludes exactly the 126 stale copies + the 2 F2 re-dates, by txn_id|date', () => {
    expect(allow.preservationExcluded).toHaveLength(128);
    for (const r of A1B.f2SourceRedated) expect(allow.preservationExcluded).toContain(`${r.txn_id}|2026-05-06`);
    const sql = preservationSignatureSql(T, allow);
    expect(sql).toContain(`CONCAT(t.txn_id, '|', CAST(t.action_date AS STRING)) NOT IN (`);
    expect(preservationSignatureSql(T)).not.toContain('NOT IN ('); // no allowance unless asked
    expect(sql).not.toMatch(/tolerance|LIMIT|ABS\(/i);
  });
  it('lost-txn check excludes exactly the 505 rows A1b removed in the window', () => {
    expect(allow.removedInWindow).toHaveLength(505);
    expect(lostTxnSql(T, T, allow)).toContain('txn_id NOT IN (');
    expect(lostTxnSql(T, T)).not.toContain('txn_id NOT IN (');
  });
  it('only the two ambiguous rows may remain short-coded in the window', () => {
    expect(allow.allowedShortCode.sort()).toEqual(ids(A1B.ambiguousUntouched).sort());
    expect(malformedCodeSql(T, allow)).toContain('AS allowed_in_window');
  });
});

describe('workflow wiring', () => {
  const runner = readFileSync(join(process.cwd(), 'scripts/bq-awards-idv-migration.ts'), 'utf8');
  const wf = readFileSync(join(process.cwd(), '.github/workflows/bq-awards-idv-migration.yml'), 'utf8');
  it('a1b_cleanup is a protected write step: selection verified BEFORE the script runs', () => {
    expect(wf).toMatch(/- a1b_cleanup/);
    const sel = runner.indexOf('verifySelection(selected)');
    const write = runner.indexOf('cleanupScript(AWARDS)');
    expect(sel).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(sel);
  });
});
