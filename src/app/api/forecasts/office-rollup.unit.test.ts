/**
 * Forecasts at OFFICE / COMMAND level, not agency level (Eric, twice).
 *
 * Agency level is too coarse to act on: "DHS" is 993 forecasts across 62
 * offices. USCG/SFLC alone is 165 forecasts worth $1.0B across FY26-28 — that
 * is a targetable command; "DHS" is not. A contractor sells to an office.
 *
 * Measured against agency_forecasts 2026-08-01: 10,167 of 10,207 rows carry a
 * contracting_office across 220 distinct offices, so the grain exists in data
 * we already own.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('office filter', () => {
  it('accepts an ?office= param', () => {
    expect(SRC).toContain("searchParams.get('office')");
  });

  it('matches contracting_office OR program_office', () => {
    // Which column carries the recognisable command varies by source: ONR files
    // under a bare DoDAAC ("N00014"), USCG under "USCG/SFLC". A user typing
    // "SFLC" should find it either way.
    expect(SRC).toContain('contracting_office.ilike.');
    expect(SRC).toContain('program_office.ilike.');
  });

  it('supports comma-separated offices', () => {
    expect(SRC).toMatch(/office\.split\(','\)/);
  });
});

describe('mode=offices rollup', () => {
  it('is gated on an explicit mode', () => {
    expect(SRC).toContain("=== 'offices'");
  });

  it('pages past the PostgREST 1,000-row cap', () => {
    // A partial read would silently under-rank the biggest offices — exactly
    // the failure this whole feature exists to avoid.
    const fn = SRC.slice(SRC.indexOf('wantOfficeRollup'));
    expect(fn).toMatch(/range\(from, from \+ 999\)/);
    expect(fn).toContain('from += 1000');
  });

  it('ranks by forecast COUNT before value', () => {
    // A single $2B forecast is one shot; a command with 165 of them is a
    // repeatable relationship, which is the point of targeting an office.
    expect(SRC).toMatch(/b\.forecasts - a\.forecasts \|\| b\.totalValue - a\.totalValue/);
  });

  it('honours naics/agency/office filters so the ranking reflects THEIR market', () => {
    const fn = SRC.slice(SRC.indexOf('wantOfficeRollup'), SRC.indexOf("mode === 'coverage'"));
    expect(fn).toContain('source_agency');
    expect(fn).toContain('naics_code');
  });

  it('treats a <6-digit NAICS as a prefix and 6 as exact', () => {
    // Same rule as the map, so an office ranking and a pin search agree.
    expect(SRC).toMatch(/length >= 6 \? `naics_code\.eq\./);
    expect(SRC).toMatch(/naics_code\.like\./);
  });

  it('reports the totals the ranking was drawn from', () => {
    // Without these a truncated result looks complete.
    expect(SRC).toContain('totalOffices');
    expect(SRC).toContain('totalForecasts');
  });
});
