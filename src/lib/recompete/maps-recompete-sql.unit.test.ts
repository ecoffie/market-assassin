/**
 * Recompete compute-once (Gate 2) — the properties the design depends on, hermetically.
 * Live byte-parity against the multi-read path is scripts/recompete-parity.ts (48/48 on 2026-09-24).
 */
import { describe, it, expect } from 'vitest';
import { FIXTURES } from '@/lib/discovery/__fixtures__/fixtures';
import { SqlParams, opsSql, parseLogicList } from '@/lib/discovery/sql';
import {
  mapsRecompeteRequest, applyMapsRecompeteFilters, mapsRecompeteSurfaceOps,
} from './maps-recompete-discovery';
import { recompeteOnePassSql, RECOMPETE_COLUMN_TYPES } from './maps-recompete-sql';
import { RECOMPETE_PIN_COLS } from './map-pin';

const req = (p: Record<string, string>) => mapsRecompeteRequest((k) => p[k] ?? null);
const BBOX = { west: -125, south: 24, east: -66.9, north: 49.6 };
const opts = { bbox: BBOX, cap: 1000, pinCols: RECOMPETE_PIN_COLS };

describe('discovery/sql — a mechanical, closed serializer', () => {
  it('compiles the Recompete plan of EVERY canonical fixture (no op outside the grammar)', () => {
    for (const f of FIXTURES) {
      const inp = f.input as Record<string, string>;
      const r = req({ ...(inp.query ? { q: inp.query } : {}), ...(inp.agency ? { agency: inp.agency } : {}) });
      expect(() => recompeteOnePassSql(r, opts), f.id).not.toThrow();
    }
  });
  it('user text never enters the SQL string — it is always a bind parameter', () => {
    const evil = `x'); DROP TABLE recompete_opportunities; --`;
    const { text, values } = recompeteOnePassSql(req({ q: 'janitorial', subAgency: evil }), opts);
    expect(text).not.toContain('DROP TABLE');
    expect(values.some((v) => v.includes('DROP TABLE'))).toBe(true);
  });
  it('refuses operators and columns outside the grammar rather than guessing', () => {
    expect(() => parseLogicList('naics_code.cs.{1}')).toThrow(/unsupported operator/);
    const p = new SqlParams();
    expect(() => opsSql([{ op: 'or', expr: 'secret_col.eq.1' }], RECOMPETE_COLUMN_TYPES, p)).toThrow(/whitelist/);
    expect(() => opsSql([{ op: 'eq', col: 'naics_code', val: '1' } as never, { op: 'bogus' } as never], RECOMPETE_COLUMN_TYPES, p)).toThrow(/unsupported op/);
  });
  it('translates PostgREST leaf semantics exactly (quoted regex unescaped, * → %, not.imatch)', () => {
    const p = new SqlParams();
    const sql = opsSql([{ op: 'or', expr: 'description.imatch."\\\\mfoo\\\\M",naics_code.like.336*,or(psc_description.is.null,psc_description.not.imatch."x")' }], RECOMPETE_COLUMN_TYPES, p);
    expect(sql).toBe('("description" ~* $1::text OR "naics_code" LIKE $2::text OR ("psc_description" IS NULL OR NOT ("psc_description" ~* $3::text)))');
    expect(p.values).toEqual(['\\mfoo\\M', '336%', 'x']);
  });
});

describe('compute ONCE — the canonical predicate is evaluated a single time', () => {
  it('the market predicate appears exactly once, inside one MATERIALIZED CTE', () => {
    const { text } = recompeteOnePassSql(req({ q: 'software license' }), opts);
    expect((text.match(/AS MATERIALIZED/g) || []).length).toBe(1);
    expect((text.match(/~\*/g) || []).length).toBeGreaterThan(10);            // the regexes …
    const where = text.slice(text.indexOf('WHERE'), text.indexOf('\n),\npage AS'));
    expect((text.match(/~\*/g) || []).length).toBe((where.match(/~\*/g) || []).length); // … all in that one WHERE
  });
  it('every count, the page and the follow-ons are derived from that one set', () => {
    const { text } = recompeteOnePassSql(req({ naics: '541512' }), opts);
    for (const s of ['FROM m WHERE _mapped)', 'FROM m WHERE NOT _mapped)', 'FROM m WHERE _mapped AND _inview)', 'page AS (SELECT _id, _end FROM m', 'fo AS (SELECT _id FROM m']) {
      expect(text).toContain(s);
    }
    expect(text).toContain('ORDER BY _end ASC, _id ASC');                 // the Gate 1 page order
    expect(text).toContain('ORDER BY _id COLLATE "C" ASC');               // follow-ons: the JS order of map-follow-ons.ts
  });
  it('placeholders and values stay in lock-step', () => {
    const { text, values } = recompeteOnePassSql(req({ q: 'cybersecurity', setAside: 'SB-Total', minValue: '1', maxValue: '2', sap: 'friendly', likelihood: 'high', leadMax: '6' }), opts);
    const max = Math.max(...[...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    expect(max).toBe(values.length);
  });
});

describe('surface filters are ONE spec for both appliers — the PostgREST calls are unchanged', () => {
  // The pre-Gate-2 applyMapsRecompeteFilters, verbatim, as the reference.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function legacySurface(q: any, s: ReturnType<typeof req>['surface'], mapped: 'only' | 'none' | 'any') {
    if (mapped === 'only') q = q.not('map_lat', 'is', null);
    else if (mapped === 'none') q = q.is('map_lat', null);
    if (s.setAside) q = q.eq('set_aside_type', s.setAside);
    if (s.subAgency) q = q.ilike('awarding_sub_agency', `%${s.subAgency}%`);
    if (s.minValue != null) q = q.gte('potential_total_value', s.minValue);
    if (s.maxValue != null) q = q.lte('potential_total_value', s.maxValue);
    if (s.sap === 'friendly') q = q.in('contract_type', ['PURCHASE ORDER', 'BPA CALL']);
    else if (s.sap === 'gated') q = q.eq('contract_type', 'DELIVERY ORDER');
    if (s.likelihood === 'high') q = q.eq('recompete_likelihood', 'high');
    return q;
  }
  const recorder = () => {
    const calls: unknown[] = [];
    const q: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ['not', 'is', 'eq', 'ilike', 'gte', 'lte', 'in', 'or']) q[m] = (...a: unknown[]) => { calls.push([m, ...a]); return q; };
    return { q, calls };
  };
  const SURFACES: Array<Record<string, string>> = [
    {}, { setAside: 'SB-Total' }, { subAgency: 'Veterans' }, { minValue: '1000' }, { maxValue: '5' },
    { sap: 'friendly' }, { sap: 'gated' }, { likelihood: 'high' },
    { setAside: '8(a)', subAgency: 'Navy', minValue: '1', maxValue: '9', sap: 'friendly', likelihood: 'high' },
  ];
  for (const s of SURFACES) for (const mapped of ['only', 'none', 'any'] as const) {
    it(`identical call sequence: ${JSON.stringify(s)} / ${mapped}`, () => {
      const r = req({ naics: '541512', ...s });
      const a = recorder(), b = recorder();
      applyMapsRecompeteFilters(a.q, r, mapped);
      const planCalls = a.calls.filter((c) => (c as unknown[])[0] === 'or' || (c as unknown[])[1] === 'quality_flag' || (c as unknown[])[1] === 'period_of_performance_current_end');
      legacySurface(b.q, r.surface, mapped);
      expect(a.calls.slice(planCalls.length)).toEqual(b.calls);
      expect(mapsRecompeteSurfaceOps(r.surface, mapped).length).toBe(b.calls.length);
    });
  }
});
