/**
 * ONE customer intent, ONE search meaning, every interface (Agent 3 alert parity, 2026-11-14).
 *
 * The contract: under the canonical engine, the saved-search alert's Open query is CALL-FOR-CALL the
 * query the Opportunity Map builds for the same search (+ the alert's 30-day posted window, which the
 * Map expresses as postedDays=30). A recording stub captures every PostgREST call on both sides.
 *
 * Saved filters arrive in two shapes: the Map URL (comma strings, `a|b` agencies) and the stored /
 * MCP-created row (arrays). Both must mean the same thing.
 *
 * Measured origin (live DB, 30-day window): "hvac maintenance" Map 133 vs alert 1,389; "medical staffing"
 * 75 vs 612; "janitorial services" 144 vs 36. Record: tasks/saved-search-alert-parity-2026-11-14.md
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { applyMapsOpenFilters, mapsOpenRequest } from '@/lib/opportunities/maps-open-discovery';
import { openEngineChanged, resolveOpenEngine, savedFilterGetter, savedSearchOpenEvaluation } from './open-evaluator';

function recorder() {
  const calls: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = new Proxy({}, {
    get: (_t, method: string) => (...args: unknown[]) => { calls.push(`${method}(${JSON.stringify(args)})`); return q; },
  });
  return { q, calls };
}

/** What the Map receives: URL params are strings; multi-select arrays are comma lists, agencies `|`-joined. */
function mapGetter(filters: Record<string, unknown>, extra: Record<string, string> = {}) {
  return (k: string) => {
    if (k in extra) return extra[k];
    const v = filters[k];
    if (v == null) return null;
    if (Array.isArray(v)) return v.join(k === 'agency' ? '|' : ',');
    return typeof v === 'object' ? null : String(v);
  };
}

const FIXTURES: Array<[string, Record<string, unknown>]> = [
  ['HVAC maintenance', { q: 'hvac maintenance' }],
  ['medical staffing', { q: 'medical staffing' }],
  ['janitorial services', { q: 'janitorial services' }],
  ['novice sentence', { q: 'we clean office buildings' }],
  ['multi-select arrays (MCP/stored shape)', { naics: ['561720', '561730'], state: ['VA', 'MD'], setAsideMulti: 'SB,WOSB' }],
  ['multi-agency array', { agency: ['Department of the Navy', 'Department of Veterans Affairs'], naics: ['541611'] }],
  ['multi-agency pipe string', { agency: 'DEFENSE|VETERANS AFFAIRS', naics: '541611' }],
  ['geography in the sentence', { q: 'security guard services in Texas' }],
  ['explicit state + text', { q: 'construction', state: 'GA' }],
  ['set-aside surface filter', { q: 'IT help desk', setAside: '8a' }],
  ['NAICS + keyword', { q: 'cleaning service', naics: '561720' }],
  ['MCP-created row', { q: 'cybersecurity', naics: ['541512', '541519'], state: 'FL', horizons: { open: true, forecast: true, recompete: false }, strategy: [] }],
  ['full & open + strategy', { q: 'fiber optic installation', fullOpen: true, strategy: ['repeat_buyer', 'sb_friendly'] }],
  ['broad text', { q: 'construction' }],
  ['no text (structured only)', { naics: '238220' }],
  ['nonsense text (honest zero)', { q: 'xqzv blorptastic' }],
];

describe('saved-search Open evaluator = Map evaluator (canonical engine)', () => {
  // Both sides derive date predicates from Date.now(); freeze it so only MEANING is compared.
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T12:00:00Z')); });
  afterAll(() => { vi.useRealTimers(); });
  for (const [name, filters] of FIXTURES) {
    it(`parity: ${name}`, () => {
      const ev = savedSearchOpenEvaluation(filters, undefined, 'canonical');
      expect(ev.ok).toBe(true);
      if (!ev.ok) return;
      const alert = recorder();
      ev.apply(alert.q);

      const map = recorder();
      applyMapsOpenFilters(map.q, mapsOpenRequest(mapGetter(filters, { postedDays: '30' })));

      expect(alert.calls).toEqual(map.calls);
    });
  }

  it('profile scope: an exclusion-only query keeps the profile (never widens to the whole market)', () => {
    const profile = { profileNaics: ['541511', '541512'], profileStates: ['VA'] };
    const ev = savedSearchOpenEvaluation({ q: '-computers', scope: 'profile' }, profile, 'canonical');
    expect(ev.ok).toBe(true);
    if (!ev.ok) return;
    const alert = recorder();
    ev.apply(alert.q);
    const map = recorder();
    applyMapsOpenFilters(map.q, mapsOpenRequest(mapGetter({ q: '-computers' }, { postedDays: '30' }), profile));
    expect(alert.calls).toEqual(map.calls);
    expect(alert.calls.join(' ')).toContain('541511');
  });

  it('a query that names a market escapes profile scope (same rule as the Map)', () => {
    const profile = { profileNaics: ['541511'], profileStates: [] };
    const ev = savedSearchOpenEvaluation({ q: 'janitorial', scope: 'profile' }, profile, 'canonical');
    if (!ev.ok) throw new Error('expected ok');
    const alert = recorder();
    ev.apply(alert.q);
    expect(alert.calls.join(' ')).not.toContain('541511');
  });

  it('stored JSON booleans mean what the Map URL means (fullOpen: true was silently dropped)', () => {
    for (const [k, needle] of [['fullOpen', 'set_aside_code.is.null'], ['hasDocs', 'has_sow_doc.eq.true'], ['hideCommodity', '']] as const) {
      const ev = savedSearchOpenEvaluation({ q: 'janitorial', [k]: true }, undefined, 'canonical');
      if (!ev.ok) throw new Error('expected ok');
      const a = recorder(); ev.apply(a.q);
      const m = recorder(); applyMapsOpenFilters(m.q, mapsOpenRequest(mapGetter({ q: 'janitorial', [k]: 'true' }, { postedDays: '30' })));
      expect(a.calls).toEqual(m.calls);
      if (needle) expect(a.calls.join(' ')).toContain(needle);
    }
  });

  it('agency arrays keep comma-bearing names intact (joined with |, never ,)', () => {
    expect(savedFilterGetter({ agency: ['VETERANS AFFAIRS, DEPARTMENT OF', 'DEPT OF DEFENSE'] })('agency')).toBe('VETERANS AFFAIRS, DEPARTMENT OF|DEPT OF DEFENSE');
    expect(savedFilterGetter({ naics: ['561720', 561730] })('naics')).toBe('561720,561730');
    expect(savedFilterGetter({ horizons: { open: true } })('horizons')).toBeNull();
    expect(savedFilterGetter({ fullOpen: false })('fullOpen')).toBe('false');
  });

  it('a refused plan is BLOCKED, never run as a zero (no `notice_id IS NULL` query)', () => {
    const ev = savedSearchOpenEvaluation({ q: '-computers' }, undefined, 'canonical');
    expect(ev.ok).toBe(false);
    if (ev.ok) return;
    expect(ev.status).toBe('needs_positive_scope');
    expect(ev.refinement).toBeTruthy();
  });

  it('applies the alert 30-day posted window unless the search saved its own', () => {
    const cutoff = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const run = (f: Record<string, unknown>) => {
      const ev = savedSearchOpenEvaluation(f, undefined, 'canonical');
      if (!ev.ok) throw new Error('expected ok');
      const r = recorder(); ev.apply(r.q); return r.calls.join(' ');
    };
    expect(run({ q: 'janitorial' })).toContain(cutoff(30));
    expect(run({ q: 'janitorial', postedDays: '7' })).toContain(cutoff(7));
  });
});

describe('legacy engine (rollback path) is the old meaning, by design', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T12:00:00Z')); });
  afterAll(() => { vi.useRealTimers(); });
  it('HVAC: legacy and canonical build different queries — the divergence this change removes', () => {
    const c = savedSearchOpenEvaluation({ q: 'hvac maintenance' }, undefined, 'canonical');
    const l = savedSearchOpenEvaluation({ q: 'hvac maintenance' }, undefined, 'legacy');
    if (!c.ok || !l.ok) throw new Error('expected ok');
    const a = recorder(); c.apply(a.q);
    const b = recorder(); l.apply(b.q);
    expect(a.calls).not.toEqual(b.calls);
    expect(l.via).toBe('legacy');
  });

  it('no plan-owned keys (no text, no agency): legacy and canonical are identical', () => {
    for (const f of [{ naics: '238220' }, { naics: ['561720'], state: 'VA', setAsideMulti: 'SB' }, {}]) {
      const c = savedSearchOpenEvaluation(f, undefined, 'canonical');
      const l = savedSearchOpenEvaluation(f, undefined, 'legacy');
      if (!c.ok || !l.ok) throw new Error('expected ok');
      const a = recorder(); c.apply(a.q);
      const b = recorder(); l.apply(b.q);
      expect(a.calls).toEqual(b.calls);
    }
  });
});

describe('engine resolution + change detection', () => {
  it('resolveOpenEngine mirrors the Forecast engine flag contract', () => {
    expect(resolveOpenEngine(undefined, false, null)).toBe('legacy');
    expect(resolveOpenEngine('true', false, null)).toBe('canonical');
    expect(resolveOpenEngine(undefined, true, 'canonical')).toBe('canonical');
    expect(resolveOpenEngine(undefined, false, 'canonical')).toBe('legacy'); // only preview may opt in per request
    expect(resolveOpenEngine('false', false, null)).toBe('legacy');
  });

  it('NULL stored engine = legacy; any change in either direction is detected', () => {
    expect(openEngineChanged(null, 'legacy')).toBe(false);
    expect(openEngineChanged(null, 'canonical')).toBe(true);
    expect(openEngineChanged('canonical', 'canonical')).toBe(false);
    expect(openEngineChanged('canonical', 'legacy')).toBe(true);
    expect(openEngineChanged('legacy', 'canonical')).toBe(true);
    expect(openEngineChanged('garbage', 'legacy')).toBe(false);
  });
});
