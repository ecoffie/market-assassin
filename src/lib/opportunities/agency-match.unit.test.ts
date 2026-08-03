/**
 * Guards the Agency multi-select matching (agency-match.ts).
 *
 * The Opportunity Map's Agency dropdown is a multi-select: checked agencies' match-needles are
 * PIPE-joined into one param, then OR'd across every source. Two things are easy to get wrong and
 * silently break a filter:
 *
 *  1) The delimiter must be a PIPE, not a comma — one preset needle ("STATE, DEPARTMENT OF") CONTAINS
 *     a comma, so a comma-split would shred it into "STATE" + "DEPARTMENT OF" and match the wrong rows.
 *  2) The SAME real agency is spelled in different WORD ORDERS per source — SAM's `department` =
 *     "STATE, DEPARTMENT OF" vs USASpending's `awarding_agency` = "Department of State" — so a
 *     multi-word needle must be matched in BOTH orders, WITHOUT the false positives a bare %STATE%
 *     would pull ("United States …").
 *
 * These assert the pure string logic (no DB) so a refactor can't regress either property.
 */
import { describe, it, expect } from 'vitest';
import { multiAgency, agencyIlikeConds, agencyOrExpr, agencyBqLikeConds, agencyBqOrSql } from './agency-match';

describe('multiAgency', () => {
  it('splits on PIPE, preserving a comma inside a needle', () => {
    expect(multiAgency('DEFENSE|STATE, DEPARTMENT OF')).toEqual(['DEFENSE', 'STATE, DEPARTMENT OF']);
  });
  it('a value with no pipe is one needle (the free-text agency input)', () => {
    expect(multiAgency('STATE, DEPARTMENT OF')).toEqual(['STATE, DEPARTMENT OF']);
  });
  it('trims, drops empties, dedupes', () => {
    expect(multiAgency(' DEFENSE | DEFENSE |  | ENERGY ')).toEqual(['DEFENSE', 'ENERGY']);
  });
  it('empty → []', () => {
    expect(multiAgency('')).toEqual([]);
  });
});

describe('agencyIlikeConds', () => {
  it('a single-word needle → one plain ilike', () => {
    expect(agencyIlikeConds('department', 'DEFENSE')).toEqual(['department.ilike.%DEFENSE%']);
  });
  it('a multi-word needle → BOTH word orders (so "STATE, DEPARTMENT OF" hits SAM AND recompete)', () => {
    const conds = agencyIlikeConds('department', 'STATE, DEPARTMENT OF');
    // forward matches SAM's "STATE, DEPARTMENT OF"; reverse matches "Department of State"
    expect(conds).toContain('department.ilike.%STATE%DEPARTMENT%OF%');
    expect(conds).toContain('department.ilike.%OF%DEPARTMENT%STATE%');
  });
  it('strips the .or() grammar chars (comma/parens) from the needle', () => {
    // no bare comma survives into the PostgREST .or() value (it would be read as a delimiter)
    for (const c of agencyIlikeConds('department', 'STATE, DEPARTMENT OF')) {
      expect(c).not.toMatch(/[,()]/);
    }
  });
  it('empty needle → []', () => {
    expect(agencyIlikeConds('department', '   ')).toEqual([]);
  });
});

describe('agencyOrExpr', () => {
  it('joins the per-needle conditions with commas into one .or() string', () => {
    const expr = agencyOrExpr('awarding_agency', ['DEFENSE', 'STATE, DEPARTMENT OF']);
    expect(expr).toBe(
      'awarding_agency.ilike.%DEFENSE%,awarding_agency.ilike.%STATE%DEPARTMENT%OF%,awarding_agency.ilike.%OF%DEPARTMENT%STATE%',
    );
  });
  it('no needles → empty string (caller applies no filter = whole map)', () => {
    expect(agencyOrExpr('department', [])).toBe('');
  });
});

describe('agencyBqLikeConds (BigQuery-SQL analog of agencyIlikeConds)', () => {
  it('a single-word needle → one LOWER()/LIKE fragment', () => {
    expect(agencyBqLikeConds('awarding_agency', 'VA')).toEqual(["LOWER(awarding_agency) LIKE '%va%'"]);
  });
  it('a multi-word needle → BOTH word orders, lowercased', () => {
    const conds = agencyBqLikeConds('awarding_agency', 'STATE, DEPARTMENT OF');
    expect(conds).toContain("LOWER(awarding_agency) LIKE '%state%department%of%'");
    expect(conds).toContain("LOWER(awarding_agency) LIKE '%of%department%state%'");
  });
  it('escapes an embedded single quote so it cannot break out of the SQL string literal', () => {
    const conds = agencyBqLikeConds('awarding_agency', "O'Brien");
    expect(conds[0]).not.toMatch(/[^\\]'brien/); // the quote must be backslash-escaped, not bare
    expect(conds[0]).toContain("\\'brien");
  });
  it('empty needle → []', () => {
    expect(agencyBqLikeConds('awarding_agency', '   ')).toEqual([]);
  });
});

describe('agencyBqOrSql — the WHERE-clause OR across department + sub-agency', () => {
  it('matches BOTH the department column and the sub-agency column for each needle', () => {
    const sql = agencyBqOrSql('awarding_agency', 'awarding_sub_agency', ['Navy']);
    expect(sql).toContain("LOWER(awarding_agency) LIKE '%navy%'");
    expect(sql).toContain("LOWER(awarding_sub_agency) LIKE '%navy%'");
    expect(sql).toMatch(/^\(.*\bOR\b.*\)$/);
  });
  it('no needles → (FALSE), so an AND (...) splice never matches anything by accident', () => {
    expect(agencyBqOrSql('awarding_agency', 'awarding_sub_agency', [])).toBe('(FALSE)');
  });
  it('multiple needles OR together across both columns (VA finds Veterans Affairs, Navy finds the sub-agency)', () => {
    const sql = agencyBqOrSql('awarding_agency', 'awarding_sub_agency', ['Veterans Affairs', 'Navy']);
    expect(sql).toContain('veterans%affairs');
    expect(sql).toContain('navy');
  });
});
