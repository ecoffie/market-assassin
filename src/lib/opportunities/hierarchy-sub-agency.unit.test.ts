/**
 * Marine Corps sub-agency filter — resolves through SAM's Federal Hierarchy path, not sub_tier.
 *
 * Fixtures are real `sam_opportunities` rows (agency_hierarchy / sub_tier / solicitation_number) read
 * 2026-10-06. The generated PostgREST `.or()` conditions are EVALUATED against them (ilike semantics),
 * so this proves which notices are included, not only the expression's shape. Live counts at the time:
 * subAgency "Marine Corps" 0 → 1,135 (all), 19 open; DEPT OF THE NAVY control unchanged at 26,631.
 */
import { describe, it, expect } from 'vitest';
import { applyMapFilters, parseMapFilters } from './map-filters';
import { hierarchyPathConds, resolveHierarchySubAgency } from './hierarchy-sub-agency';

type Row = { sol: string; sub_tier: string; department: string; agency_hierarchy: string };
const NAVY = 'DEPT OF DEFENSE.DEPT OF THE NAVY';

const USMC_ROWS: Row[] = [
  // HQMC P&R — the notice behind the 2026-10-05 customer watch
  { sol: 'M9549426R0009', sub_tier: 'DEPT OF THE NAVY', department: 'DEPT OF DEFENSE', agency_hierarchy: `${NAVY}.USMC.MARCORP I&L.MARINE CORPS INSTALLATIONS COMMAND.MARINE CORPS INSTALLATIONS COMMAND HQ.COMMANDING OFFICER` },
  // USMC offices that do NOT use an "M" solicitation prefix
  { sol: 'GFSC', sub_tier: 'DEPT OF THE NAVY', department: 'DEPT OF DEFENSE', agency_hierarchy: `${NAVY}.USMC.MARCORP I&L.MARINE CORPS INSTALLATIONS COMMAND.MARINE CORPS INSTALLATIONS COMMAND HQ.COMMANDING OFFICER` },
  { sol: '26172', sub_tier: 'DEPT OF THE NAVY', department: 'DEPT OF DEFENSE', agency_hierarchy: `${NAVY}.USMC.MARCOR SYSCOM.COMMANDER` },
  // path ending exactly at the USMC segment
  { sol: 'A-A-50531B', sub_tier: 'DEPT OF THE NAVY', department: 'DEPT OF DEFENSE', agency_hierarchy: `${NAVY}.USMC` },
];

const NOT_USMC_ROWS: Row[] = [
  // Navy commands using "M"-prefixed solicitation numbers (why the prefix hypothesis was rejected)
  { sol: 'ML26-85', sub_tier: 'DEPT OF THE NAVY', department: 'DEPT OF DEFENSE', agency_hierarchy: `${NAVY}.NAVFAC.NAVFAC ATLANTIC CMD.NAVFAC MID-ATLANTIC.NAVFACSYSCOM MID-ATLANTIC` },
  { sol: 'MEA-26-01-001', sub_tier: 'DEPT OF THE NAVY', department: 'DEPT OF DEFENSE', agency_hierarchy: `${NAVY}.NAVSEA.NAVSEA WARFARE CENTER.COMMANDING OFFICER` },
  { sol: 'MSC_ETFO_FY26_1455', sub_tier: 'DEPT OF THE NAVY', department: 'DEPT OF DEFENSE', agency_hierarchy: `${NAVY}.MSC.MSC HQS.MSCHQ NORFOLK` },
  { sol: 'MIDS_LVT_SECURITY_MODULES', sub_tier: 'DEPT OF THE NAVY', department: 'DEPT OF DEFENSE', agency_hierarchy: `${NAVY}.SPAWAR.SPAWAR HQ.NAVAL INFORMATION WARFARE SYSTEMS` },
  // truncated path: command unknown → deliberately NOT matched (never broadened to Navy)
  { sol: 'M6700126Q0045', sub_tier: 'DEPT OF THE NAVY', department: 'DEPT OF DEFENSE', agency_hierarchy: NAVY },
  // Bureau of Prisons "USMCFP Springfield" — a substring "%USMC%" would catch it
  { sol: '15B30726Q00000001', sub_tier: 'FEDERAL PRISON SYSTEM / BUREAU OF PRISONS', department: 'JUSTICE, DEPARTMENT OF', agency_hierarchy: 'JUSTICE, DEPARTMENT OF.FEDERAL PRISON SYSTEM / BUREAU OF PRISONS.USMCFP SPRINGFIELD' },
];

/** Record .or() args; ignore every other builder call. */
function stubQuery() {
  const ors: string[] = [];
  const q: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['or', 'in', 'eq', 'gt', 'lt', 'lte', 'gte', 'not', 'neq', 'ilike', 'imatch', 'contains', 'select', 'order', 'limit']) {
    q[m] = (...a: unknown[]) => { if (m === 'or') ors.push(String(a[0])); return q; };
  }
  return { q, ors };
}

/** Evaluate a PostgREST `.or()` string of `col.ilike.pattern` conditions against a row. */
function orMatches(expr: string, row: Row): boolean {
  return expr.split(',').some((cond) => {
    const m = cond.match(/^([a-z_]+)\.ilike\.(.*)$/);
    if (!m) throw new Error(`unexpected condition ${cond}`);
    const value = String((row as Record<string, string>)[m[1]] ?? '');
    const re = new RegExp('^' + m[2].split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
    return re.test(value);
  });
}

function selects(params: Record<string, string>, row: Row): boolean {
  const { q, ors } = stubQuery();
  applyMapFilters(q, parseMapFilters((k) => params[k] ?? null));
  return ors.every((expr) => orMatches(expr, row));
}

describe('resolveHierarchySubAgency', () => {
  it.each(['Marine Corps', 'marine corps', 'USMC', 'U.S. Marine Corps', 'United States Marine Corps', 'Marines'])('resolves %s', (v) => {
    expect(resolveHierarchySubAgency(v)?.key).toBe('USMC');
  });
  it.each(['DEPT OF THE NAVY', 'Navy', 'Marine Corps Logistics Command', 'USMCFP', 'Army', ''])('leaves %s unchanged', (v) => {
    expect(resolveHierarchySubAgency(v)).toBeNull();
  });
  it('path conditions are segment-anchored (exact or followed by ".")', () => {
    const h = resolveHierarchySubAgency('USMC')!;
    expect(hierarchyPathConds(h)).toEqual([
      'agency_hierarchy.ilike.DEPT OF DEFENSE.DEPT OF THE NAVY.USMC',
      'agency_hierarchy.ilike.DEPT OF DEFENSE.DEPT OF THE NAVY.USMC.%',
    ]);
  });
});

describe('Marine Corps filter on the shared map filters (Map Open, saved-search alerts, badge, dashboard)', () => {
  for (const key of ['subAgency', 'agency']) {
    describe(`${key}=Marine Corps`, () => {
      it.each(USMC_ROWS)('includes USMC notice $sol', (row) => {
        expect(selects({ status: 'all', [key]: 'Marine Corps' }, row)).toBe(true);
      });
      it.each(NOT_USMC_ROWS)('excludes non-USMC notice $sol', (row) => {
        expect(selects({ status: 'all', [key]: 'Marine Corps' }, row)).toBe(false);
      });
    });
  }

  it('never broadens to all of Navy: a Navy notice outside USMC is excluded even though sub_tier is Navy', () => {
    const navsea = NOT_USMC_ROWS.find((r) => r.sol === 'MEA-26-01-001')!;
    expect(navsea.sub_tier).toBe('DEPT OF THE NAVY');
    expect(selects({ status: 'all', subAgency: 'Marine Corps' }, navsea)).toBe(false);
  });

  it('other sub-agency values keep the existing sub_tier semantics', () => {
    const { q, ors } = stubQuery();
    applyMapFilters(q, parseMapFilters((k) => ({ subAgency: 'DEPT OF THE NAVY' } as Record<string, string>)[k] ?? null));
    expect(ors).toEqual(['sub_tier.ilike.%DEPT OF THE NAVY%']);
    expect(selects({ status: 'all', subAgency: 'DEPT OF THE NAVY' }, NOT_USMC_ROWS[0])).toBe(true);
    expect(selects({ status: 'all', subAgency: 'DEPT OF THE NAVY' }, USMC_ROWS[0])).toBe(true);
  });

  it('a mixed sub-agency list ORs the hierarchy path with the plain sub_tier match', () => {
    const army: Row = { sol: 'W912', sub_tier: 'DEPT OF THE ARMY', department: 'DEPT OF DEFENSE', agency_hierarchy: 'DEPT OF DEFENSE.DEPT OF THE ARMY.AMC' };
    const p = { status: 'all', subAgency: 'Marine Corps,DEPT OF THE ARMY' };
    expect(selects(p, USMC_ROWS[0])).toBe(true);
    expect(selects(p, army)).toBe(true);
    expect(selects(p, NOT_USMC_ROWS[1])).toBe(false);
  });

  it('agency box: a plain needle keeps department OR sub_tier matching alongside the USMC path', () => {
    const army: Row = { sol: 'W912', sub_tier: 'DEPT OF THE ARMY', department: 'DEPT OF DEFENSE', agency_hierarchy: 'DEPT OF DEFENSE.DEPT OF THE ARMY.AMC' };
    const p = { status: 'all', agency: 'Marine Corps|ARMY' };
    expect(selects(p, USMC_ROWS[2])).toBe(true);
    expect(selects(p, army)).toBe(true);
    expect(selects(p, NOT_USMC_ROWS[2])).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALIASES, HIERARCHY_HORIZON_LIMIT_JS, hierarchyFilterLimitations } from './hierarchy-sub-agency';

describe('Forecast / Awarded: Marine Corps is a disclosed limitation, never ignored or broadened', () => {
  it('limitations name every unsupported horizon and only those', () => {
    const l = hierarchyFilterLimitations({ subAgency: 'Marine Corps' }, ['open', 'recompete', 'forecast']);
    expect(l.map((x) => x.horizon)).toEqual(['recompete', 'forecast']);
    expect(l[0].reason).toMatch(/not broadened to Navy/);
    expect(hierarchyFilterLimitations({ agency: 'ARMY|USMC' }, ['forecast'])).toHaveLength(1);
    expect(hierarchyFilterLimitations({ subAgency: 'DEPT OF THE NAVY' }, ['recompete', 'forecast'])).toEqual([]);
    expect(hierarchyFilterLimitations({ subAgency: 'Marine Corps' }, ['open'])).toEqual([]);
  });

  // The Map's browser check is generated from the server alias table; evaluate it and compare.
  const win: Record<string, (f: unknown) => unknown> = {};
  new Function('window', 'document', HIERARCHY_HORIZON_LIMIT_JS.replace(/^<script>|<\/script>$/g, ''))(win, {});
  const clientLimit = win.__hierarchyLimit as (f: Record<string, string>) => { label: string; supported: string[]; unsupported: string[] } | null;

  it.each([...Object.keys(ALIASES), 'U.S. Marine Corps', 'United States Marine Corps', ' usmc '])('client resolves %s like the server', (v) => {
    expect(clientLimit({ subAgency: v })).toEqual({ label: 'U.S. Marine Corps', supported: ['open'], unsupported: ['recompete', 'forecast'] });
    expect(resolveHierarchySubAgency(v)?.label).toBe('U.S. Marine Corps');
  });
  it.each(['DEPT OF THE NAVY', 'Army', 'Marine Corps Logistics Command', 'USMCFP', ''])('client leaves %s alone, like the server', (v) => {
    expect(clientLimit({ subAgency: v })).toBeNull();
    expect(resolveHierarchySubAgency(v)).toBeNull();
  });
  it('client reads the Agency box too (pipe-joined)', () => {
    expect(clientLimit({ agency: 'ARMY|Marine Corps' })?.label).toBe('U.S. Marine Corps');
  });

  it('the Map fetches only supported horizons under the limit and renders the disclosure (both fetch paths)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
    expect(src).toContain("_enabled=_enabled.filter(function(m){ return _hl.supported.indexOf(m)>-1; });");
    expect(src).toContain('window.__renderHierarchyLimit(_hl)');
    expect(src).toContain('hz=hz.filter(function(h){ return _hl2.supported.indexOf(h)>-1; });');
    expect(src).toContain('HIERARCHY_HORIZON_LIMIT_JS + PLAYERS_COPY_JS + LAYOUT_MOVE_JS');
  });

  it('the disclosure text says the layers are hidden, not shown as Navy', () => {
    const doc = { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {} } };
    const w: Record<string, unknown> = { innerWidth: 1200 };
    let el: Record<string, unknown> | null = null;
    doc.createElement = () => { el = { style: {}, setAttribute() {} }; return el; };
    new Function('window', 'document', HIERARCHY_HORIZON_LIMIT_JS.replace(/^<script>|<\/script>$/g, ''))(w, doc);
    (w.__renderHierarchyLimit as (l: unknown) => void)({ label: 'U.S. Marine Corps', supported: ['open'], unsupported: ['recompete', 'forecast'] });
    expect(String(el!.textContent)).toMatch(/showing open notices only.*Awarded contracts and forecasts cannot be filtered.*not shown as all of Navy/);
  });
});
