/**
 * Bureau provenance semantics.
 *
 * Every case is a measured condition from the 2026-09-14 attribution audit: FCO removed
 * organisational attribution from rows that still exist upstream (FWS 710, Forest Service 639,
 * PBS 28, NPS 14 all blanked; FAS renamed). These assert we neither erase that evidence nor
 * fabricate a source observation time for it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveBureau, isRealBureauAttribution, bureauChangeRecord,
} from './bureau-provenance';

describe('current source wins', () => {
  it('current non-null is used and marked current', () => {
    const r = resolveBureau({ currentSourceBureau: 'Federal Acquisition Service', currentSourceObservedAt: '2026-09-11T09:21:52-04:00' });
    expect(r.bureau).toBe('Federal Acquisition Service');
    expect(r.bureauProvenance).toBe('current');
    expect(r.bureauObservedAt).toBe('2026-09-11T09:21:52-04:00');
  });

  it('a CHANGED value takes the current spelling, not the older one (the real FAS rename)', () => {
    const r = resolveBureau({
      currentSourceBureau: 'Federal Acquisition Service',
      priorSourceBureau: 'FAS-Federal Acquisition Service',
    });
    expect(r.bureau).toBe('Federal Acquisition Service');
    expect(r.bureauProvenance).toBe('current');
    expect(r.changed).toBe(true);
    expect(r.previousValue).toBe('FAS-Federal Acquisition Service');
  });

  it('current == prior is not reported as a change', () => {
    const r = resolveBureau({ currentSourceBureau: 'National Park Service', priorSourceBureau: 'National Park Service' });
    expect(r.changed).toBe(false);
    expect(r.bureauProvenance).toBe('current');
  });
});

describe('current NULL preserves last_known — the core rule', () => {
  it('a blanked source does NOT erase the prior value', () => {
    // Measured: all 710 Fish & Wildlife rows still exist upstream with a blank Funding Organization.
    const r = resolveBureau({ currentSourceBureau: '', priorSourceBureau: 'Fish and Wildlife Service' });
    expect(r.bureau).toBe('Fish and Wildlife Service');
    expect(r.bureauProvenance).toBe('last_known');
  });

  it('null, undefined and whitespace all count as "source publishes nothing"', () => {
    for (const cur of [null, undefined, '', '   ']) {
      const r = resolveBureau({ currentSourceBureau: cur, priorSourceBureau: 'Forest Service' });
      expect(r.bureau).toBe('Forest Service');
      expect(r.bureauProvenance).toBe('last_known');
    }
  });
});

describe('new NULL rows remain unknown', () => {
  it('no current and no prior -> unknown, never inferred', () => {
    const r = resolveBureau({ currentSourceBureau: null, priorSourceBureau: null });
    expect(r.bureau).toBeNull();
    expect(r.bureauProvenance).toBeNull();
    expect(r.bureauObservedAt).toBeNull();
  });

  it('a DEPARTMENT NAME is not attribution — the header-drift artifact must not become a child', () => {
    // The stale parser wrote the department's own name into `bureau` on every canonical row.
    for (const d of ['Department of the Interior', 'General Services Administration', 'Department of State']) {
      expect(isRealBureauAttribution(d)).toBe(false);
      const r = resolveBureau({ currentSourceBureau: d, priorSourceBureau: d });
      expect(r.bureau).toBeNull();
      expect(r.bureauProvenance).toBeNull();
    }
  });
});

describe('observed_at is never synthesized', () => {
  it('carry-forward with no defensible source timestamp leaves it NULL', () => {
    // The duplicate api rows carry no raw_data and only a Mindy write stamp (2026-06-26).
    // That is not a source observation, so nothing may be recorded.
    const r = resolveBureau({ currentSourceBureau: null, priorSourceBureau: 'PBS-Public Building Service' });
    expect(r.bureauProvenance).toBe('last_known');
    expect(r.bureauObservedAt).toBeNull();
  });

  it('the module contains no now()/Date.now()/new Date() fallback', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/lib/forecasts/bureau-provenance.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    expect(SRC).not.toMatch(/Date\.now\(\)/);
    expect(SRC).not.toMatch(/new Date\(/);
    expect(SRC).not.toMatch(/\bnow\(\)/i);
  });

  it('resolution is pure — the same input always yields the same output', () => {
    const input = { currentSourceBureau: null, priorSourceBureau: 'Forest Service' };
    expect(resolveBureau(input)).toEqual(resolveBureau(input));
  });
});

describe('change ledger uses the EXISTING mechanism', () => {
  it('a carry-forward records source-family, id and the prior value', () => {
    const r = resolveBureau({ currentSourceBureau: null, priorSourceBureau: 'Fish and Wildlife Service' });
    const rec = bureauChangeRecord('DOI', 'GW-L:USGS0070330066', r)!;
    expect(rec.domain).toBe('forecast_attribution');
    expect(rec.change_type).toBe('bureau_carried_forward');
    expect(rec.entity_key).toBe('GW-L:USGS0070330066');
    expect(rec.old_value).toBe('Fish and Wildlife Service');
    expect(rec.new_value).toBeNull();   // the source now publishes nothing
  });

  it('a source-value change is recorded as a transition', () => {
    const r = resolveBureau({ currentSourceBureau: 'Federal Acquisition Service', priorSourceBureau: 'FAS-Federal Acquisition Service' });
    const rec = bureauChangeRecord('GSA', 'X1', r)!;
    expect(rec.change_type).toBe('bureau_source_changed');
    expect(rec.old_value).toBe('FAS-Federal Acquisition Service');
    expect(rec.new_value).toBe('Federal Acquisition Service');
  });

  it('an unchanged current value records nothing', () => {
    const r = resolveBureau({ currentSourceBureau: 'National Park Service' });
    expect(bureauChangeRecord('DOI', 'X2', r)).toBeNull();
  });
});

describe('runtime never joins the duplicate api rows', () => {
  it('the resolver modules contain no duplicate-path query', () => {
    const files = ['src/lib/forecasts/bureau-provenance.ts', 'src/lib/forecasts/agency-identity.ts'];
    for (const f of files) {
      const SRC = readFileSync(join(process.cwd(), f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
      expect(SRC, `${f} filters on source_type`).not.toMatch(/source_type['"\s]*[:=].*api/);
      expect(SRC, `${f} references duplicate_ingest_path`).not.toContain('duplicate_ingest_path');
    }
  });
});

describe('migration shape', () => {
  const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20260914_forecast_bureau_provenance.sql'), 'utf8');
  it('is additive and nullable with no data rewrite', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS bureau_provenance/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS bureau_observed_at/);
    expect(SQL).not.toMatch(/\bUPDATE\s+agency_forecasts/i);
    expect(SQL).not.toMatch(/\bDELETE\s+FROM/i);
  });
  it('constrains provenance to exactly the approved states', () => {
    expect(SQL).toMatch(/CHECK \(bureau_provenance IS NULL OR bureau_provenance IN \('current', 'last_known'\)\)/);
  });
});
