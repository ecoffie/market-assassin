/**
 * IMI FIND — Workstream C: REGION (multi-state) + ACQUISITION STAGE. HERMETIC.
 *
 * Frozen inputs only (__fixtures__/imi-find/*.json, each with its own _provenance). The stage sample
 * (stage-sample.json) was captured read-only by scripts/capture-imi-find-stage-fixtures.ts; every
 * classification here is RE-DERIVED from the frozen notice_type + title, never read from a label.
 *
 * Acceptance client: Industrial Mechanical Inc. (IMI), UEI M66AH329AJM6, Watkinsville GA.
 */
import { describe, it, expect } from 'vitest';
import entityFx from './__fixtures__/imi-find/imi-entity.json';
import noticesFx from './__fixtures__/imi-find/imi-notices.json';
import tyonekFx from './__fixtures__/imi-find/tyonek-recompete.json';
import stageFx from './__fixtures__/imi-find/stage-sample.json';
import { transformEntity } from '@/lib/sam/entity-api';
import { buildDiscoveryPlan, matchesText, type DiscoveryPlan } from '@/lib/discovery';
import { parseStateList, stateOrExpr } from '@/lib/opportunities/map-filters';
import { anchorFromSamEntity, companyRecallBasis, type CompanyAnchor } from './company-anchor';
import { evaluateEligibility } from './company-eligibility';
import {
  classifyAcquisitionStage,
  stageOrExpr,
  stageRuleExpr,
  unknownStageOrExpr,
  parseStageGroup,
  STAGE_RULES,
  type AcquisitionStageGroup,
} from './acquisition-stage';
import {
  findOpportunities,
  mcpDiscoveryInput,
  mcpDiscoveryPolicy,
  resolveRegion,
  UNRESOLVED_REGION_SENTINEL,
  HOST_RULES_FIND_FIRST_VALUE,
  HOST_RULES_COMPANY_ANCHORED,
  HOST_RULES_STAGE,
  HOST_RULES_REGION,
  type FindOpportunitiesInput,
} from './find-opportunities';
import type { SamEntityResult } from '@/mcp/tools/sam-entity';

type Row = Record<string, unknown>;
const IMI_UEI = 'M66AH329AJM6';
const Q_IMI = 'industrial steel fabrication, machining, piping, rigging';
const REGION = ['GA', 'AL', 'TN'];

const entity = transformEntity(entityFx.data as Row);
const IMI: CompanyAnchor = anchorFromSamEntity(entity, { source: 'sam_entity_api' });

function currentNotice(sol: string): Row {
  const rows = (noticesFx.data as Row[]).filter((r) => r.solicitation_number === sol);
  const active = rows.filter((r) => r.active === true);
  const pool = active.length ? active : rows;
  return [...pool].sort((a, b) => String(b.posted_date).localeCompare(String(a.posted_date)))[0];
}
const SHAW = currentNotice('FA480326B0006');
const OKUMA = currentNotice('W911KF-26-S-0023');
const SHOTBLAST = currentNotice('W911KF-26-S-0024');
const KC135 = currentNotice('FA8517-27-R-0056');
const CSO = currentNotice('W911KF25SC002');
const KNOWN_FIT = [OKUMA, SHOTBLAST, KC135, SHAW];
const TYONEK = (tyonekFx.data as Row[]).filter((r) => String(r.contract_id).includes('FA857123D0004'));

function plan(query: string, input: Partial<FindOpportunitiesInput> = {}, company: CompanyAnchor | null = null): DiscoveryPlan {
  const i: FindOpportunitiesInput = { query, ...input };
  return buildDiscoveryPlan(mcpDiscoveryInput(i, company), mcpDiscoveryPolicy(i));
}

/**
 * JS mirror of the Open admission (the SQL is applyOpenPlan + the stage `.or`). State goes through
 * the SAME parseStateList the SQL path uses, so a sentinel / invalid list fails closed here too.
 */
function admitsOpen(p: DiscoveryPlan, row: Row, company: CompanyAnchor | null, stage: AcquisitionStageGroup | null = null): boolean {
  if (row.active !== true) return false;
  const states = parseStateList(p.horizons.open.mapFilters.state ?? null);
  if (states) {
    const office = (row.office_address as { state?: string } | null)?.state;
    if (!states.includes(String(row.pop_state || '')) && !states.includes(String(office || ''))) return false;
  }
  if (stage && !classifyAcquisitionStage(row).groups.some((g) => g.group === stage)) return false;
  const text = matchesText(p.matcher, [row.title as string, row.description as string, row.department as string, row.solicitation_number as string]);
  const tax = p.expansion.direct.naics.includes(String(row.naics_code)) || p.expansion.direct.psc.includes(String(row.psc_code));
  const comp = p.company ? !!companyRecallBasis(row, company) : false;
  return text || tax || comp;
}

function measure(p: DiscoveryPlan, company: CompanyAnchor | null, stage: AcquisitionStageGroup | null = null) {
  const recalled = KNOWN_FIT.filter((r) => admitsOpen(p, r, company, stage));
  const v = recalled.map((r) => evaluateEligibility(r, IMI).status);
  return {
    recalled: recalled.map((r) => String(r.solicitation_number)).sort(),
    eligible: v.filter((s) => s === 'ELIGIBLE').length,
    not_eligible_screened: v.filter((s) => s === 'NOT_ELIGIBLE').length,
    unknown: v.filter((s) => s === 'UNKNOWN').length,
  };
}

// ── C1 · REGION ─────────────────────────────────────────────────────────────────────────────────
describe('C1 region — several states, honest about what is not a state', () => {
  it('states[] and location OR together; names, codes and separators normalise; duplicates collapse', () => {
    expect(resolveRegion({ states: ['GA', 'Alabama', 'tn'] })).toEqual({ requested: ['GA', 'Alabama', 'tn'], states: REGION, unresolved: [] });
    expect(resolveRegion({ location: 'GA/AL/TN' })?.states).toEqual(REGION);
    expect(resolveRegion({ location: 'GA; AL', states: ['Georgia', 'TN'] })?.states).toEqual(REGION);
    expect(resolveRegion({ location: 'Florida' })?.states).toEqual(['FL']);
  });

  it('a place that is not a state is reported unresolved, never guessed (no installation/radius lookup)', () => {
    expect(resolveRegion({ location: 'Robins AFB / GA' })).toEqual({ requested: ['Robins AFB', 'GA'], states: ['GA'], unresolved: ['Robins AFB'] });
  });

  it('no location asked → null (the ONLY case that searches every state)', () => {
    expect(resolveRegion({})).toBeNull();
    expect(resolveRegion({ location: '  ', states: [] })).toBeNull();
    expect(plan(Q_IMI).states).toEqual([]);
  });

  it('the plan carries the whole region to every horizon (Open pop-or-office · recompete PoP · forecast pop_state)', () => {
    const p = plan(Q_IMI, { states: REGION });
    expect(p.states).toEqual(REGION);
    expect(p.horizons.open.mapFilters.state).toBe('GA,AL,TN');
    expect(stateOrExpr(parseStateList(p.horizons.open.mapFilters.state)!)).toBe(
      'pop_state.eq.GA,office_address->>state.eq.GA,pop_state.eq.AL,office_address->>state.eq.AL,pop_state.eq.TN,office_address->>state.eq.TN',
    );
    expect(JSON.stringify(p.horizons.recompete.ops)).toContain('place_of_performance_state.eq.GA,place_of_performance_state.eq.AL,place_of_performance_state.eq.TN');
    expect(p.horizons.forecast.forecastFilters.state).toBe('GA,AL,TN');
  });

  it('the existing single `location` still works exactly as before', () => {
    const p = plan(Q_IMI, { location: 'GA' });
    expect(p.states).toEqual(['GA']);
    expect(p.horizons.open.mapFilters.state).toBe('GA');
  });

  it('PR #1435 class: an invalid / all-unresolvable region fails CLOSED — it never broadens to every state', () => {
    for (const bad of [{ location: 'Robins AFB' }, { states: ['XX', 'ZZZZ'] }, { location: 'FLA' }] as Array<Partial<FindOpportunitiesInput>>) {
      const p = plan(Q_IMI, bad, IMI);
      expect(p.states, JSON.stringify(bad)).toEqual([UNRESOLVED_REGION_SENTINEL]);
      // Open: parseStateList returns [] (not null) → applyMapFilters matches the NO_MATCH sentinel.
      expect(parseStateList(p.horizons.open.mapFilters.state)).toEqual([]);
      expect(JSON.stringify(p.horizons.recompete.ops)).toContain(`place_of_performance_state.eq.${UNRESOLVED_REGION_SENTINEL}`);
      expect(parseStateList(p.horizons.forecast.forecastFilters.state)).toEqual([]);
      expect(KNOWN_FIT.filter((r) => admitsOpen(p, r, IMI))).toEqual([]);
    }
  });

  it('a partly-invalid list keeps its valid half (narrows, never widens)', () => {
    const p = plan(Q_IMI, { states: ['AL', 'XX'] }, IMI);
    expect(p.states).toEqual(['AL']);
    expect(measure(p, IMI).recalled).toEqual(['W911KF-26-S-0023', 'W911KF-26-S-0024']);
  });
});

// ── C2 · STAGE ──────────────────────────────────────────────────────────────────────────────────
describe('C2 stage — structured notice_type first, title keywords secondary, unknown stays unknown', () => {
  const sample = stageFx.data as Row[];

  it('every sampled rule row is re-derived into its group via the signal it was sampled for', () => {
    for (const r of sample.filter((x) => !String(x._sampled_for).startsWith('negative/'))) {
      const [group, signal] = String(r._sampled_for).split('/');
      const hit = classifyAcquisitionStage(r).groups.find((g) => g.group === group);
      expect(hit, `${r.notice_type} :: ${r.title}`).toBeTruthy();
      // A row can satisfy a title rule AND a structured rule; structured always wins the label.
      if (signal === 'structured_notice_type') expect(hit!.signal).toBe('structured_notice_type');
    }
  });

  it('negative controls: a keyword alone never overrides the structured notice type', () => {
    const neg = (tag: string) => sample.filter((r) => r._sampled_for === `negative/${tag}`);
    expect(neg('award_notice_titled_vehicle').length).toBeGreaterThan(0);
    for (const r of neg('award_notice_titled_vehicle')) expect(classifyAcquisitionStage(r).groups, String(r.title)).toEqual([]);
    for (const r of neg('special_notice_plain')) expect(classifyAcquisitionStage(r).groups, String(r.title)).toEqual([]);
    // A SOLICITATION titled "RFI" is still a solicitation (structured wins) — not market research…
    for (const r of neg('solicitation_titled_rfi').filter((x) => !/presol/i.test(String(x.notice_type)))) {
      expect(classifyAcquisitionStage(r).groups.map((g) => g.group), String(r.title)).not.toContain('MARKET_RESEARCH');
    }
    // …while a PRESOLICITATION titled "Request for Information" is market research by the title rule.
    const presolRfi = neg('solicitation_titled_rfi').find((x) => /presol/i.test(String(x.notice_type)));
    if (presolRfi) expect(classifyAcquisitionStage(presolRfi).groups[0]).toMatchObject({ group: 'MARKET_RESEARCH', signal: 'title_keyword' });
  });

  it('the IMI notices: RFIs are MARKET_RESEARCH (structured); Shaw MACC is a VEHICLE (title); Anniston CSO is NON_FAR (title)', () => {
    for (const r of [OKUMA, SHOTBLAST, KC135]) {
      expect(classifyAcquisitionStage(r).groups).toEqual([{ group: 'MARKET_RESEARCH', signal: 'structured_notice_type', reason: 'SAM notice type is Sources Sought / RFI' }]);
    }
    expect(classifyAcquisitionStage(SHAW).groups.map((g) => [g.group, g.signal])).toEqual([['VEHICLE_SOLICITATIONS', 'title_keyword']]);
    expect(classifyAcquisitionStage(CSO).groups.map((g) => [g.group, g.signal])).toEqual([['NON_FAR', 'title_keyword']]);
  });

  it('UNKNOWN: no / unrecognised notice_type is never placed in a stage', () => {
    for (const nt of [null, '', 'Mystery Type']) {
      const c = classifyAcquisitionStage({ notice_type: nt, title: 'RFI for IDIQ under a BAA' });
      expect(c).toEqual({ unknown: true, groups: [] });
    }
    expect(unknownStageOrExpr()).toMatch(/^notice_type\.is\.null,notice_type\.not\.imatch\."/);
  });

  it('word boundaries: substrings never count (BPAs yes, "bypass" no; SABER case-sensitive)', () => {
    const sol = (title: string) => classifyAcquisitionStage({ notice_type: 'Solicitation', title }).groups.map((g) => g.group);
    expect(sol('Janitorial BPAs, Region 4')).toContain('VEHICLE_SOLICITATIONS');
    expect(sol('Bypass valve replacement')).toEqual([]);
    expect(sol('SABER program, Robins AFB')).toContain('VEHICLE_SOLICITATIONS');
    expect(sol('Saber saw blades')).toEqual([]);
    expect(sol('Rotational fixture')).toEqual([]);
  });

  it('the SQL predicate is built from the SAME rules the JS labeller runs', () => {
    for (const g of ['MARKET_RESEARCH', 'VEHICLE_SOLICITATIONS', 'NON_FAR'] as const) {
      expect(stageOrExpr(g)).toBe(STAGE_RULES.filter((r) => r.group === g).map(stageRuleExpr).join(','));
    }
    expect(stageOrExpr('MARKET_RESEARCH')).toContain('notice_type.imatch.');
    expect(stageOrExpr('VEHICLE_SOLICITATIONS')).toContain('title.match."\\\\mSABER\\\\M"');
  });

  it('parseStageGroup: known values only; anything else is "invalid" (never silently ignored)', () => {
    expect(parseStageGroup('market_research')).toBe('MARKET_RESEARCH');
    expect(parseStageGroup('non-far')).toBe('NON_FAR');
    expect(parseStageGroup(undefined)).toBeNull();
    expect(parseStageGroup('rfp')).toBe('invalid');
  });

  it('frozen live measurement at capture: the recorded per-group counts and zero unknown types', () => {
    const live = (stageFx._provenance as { live_counts_at_capture: Record<string, number | null> }).live_counts_at_capture;
    expect(live.ACTIVE_TOTAL).toBeGreaterThan(0);
    expect(live.MARKET_RESEARCH).toBeGreaterThan(0);
    expect(live.UNKNOWN_NOTICE_TYPE).toBe(0);
  });
});

// ── Frozen IMI acceptance — same denominator (4 known-fit notices) ─────────────────────────────
describe('frozen IMI acceptance — region + stage, same denominator (4 known-fit notices)', () => {
  const EMPTY = { recalled: [], eligible: 0, not_eligible_screened: 0, unknown: 0 };
  const ANNISTON = { recalled: ['W911KF-26-S-0023', 'W911KF-26-S-0024'], eligible: 2, not_eligible_screened: 0, unknown: 0 };

  it('BEFORE (A head, IMI\'s own call: location GA): 0/4', () => {
    expect(measure(plan(Q_IMI, { location: 'GA' }, IMI), IMI)).toEqual(EMPTY);
  });

  it('BEFORE: a slash-separated region ("GA/AL/TN") was ONE unresolvable token — 0/4', () => {
    // At A's head mcpDiscoveryInput passed location verbatim; the plan split on commas only.
    const legacy = buildDiscoveryPlan({ ...mcpDiscoveryInput({ query: Q_IMI }, IMI), state: 'GA/AL/TN' }, mcpDiscoveryPolicy({ query: Q_IMI }));
    expect(legacy.states).toEqual(['GA/AL/TN']);
    expect(measure(legacy, IMI)).toEqual(EMPTY);
  });

  it('(2) AFTER: uei + states GA/AL/TN → 2/4 (both Anniston RFIs, recalled by registered PSC, ELIGIBLE)', () => {
    const p = plan(Q_IMI, { states: REGION }, IMI);
    expect(measure(p, IMI)).toEqual(ANNISTON);
    expect(companyRecallBasis(OKUMA, IMI)).toBe('company_registered_psc');
    expect(companyRecallBasis(SHOTBLAST, IMI)).toBe('company_registered_psc');
    expect([OKUMA.psc_code, SHOTBLAST.psc_code]).toEqual(['J034', 'J036']);
  });

  it('(2) AFTER: + stage MARKET_RESEARCH → the same 2/4 (both are structured Sources Sought)', () => {
    expect(measure(plan(Q_IMI, { states: REGION }, IMI), IMI, 'MARKET_RESEARCH')).toEqual(ANNISTON);
  });

  it('stage narrows honestly on the same denominator with no region: MACC drops out of MARKET_RESEARCH, is the only VEHICLE', () => {
    const p = plan(Q_IMI, {}, IMI);
    expect(measure(p, IMI)).toEqual({ recalled: ['FA480326B0006', 'W911KF-26-S-0023', 'W911KF-26-S-0024'], eligible: 2, not_eligible_screened: 1, unknown: 0 });
    expect(measure(p, IMI, 'MARKET_RESEARCH')).toEqual(ANNISTON);
    expect(measure(p, IMI, 'VEHICLE_SOLICITATIONS')).toEqual({ recalled: ['FA480326B0006'], eligible: 0, not_eligible_screened: 1, unknown: 0 });
    expect(measure(p, IMI, 'NON_FAR')).toEqual(EMPTY);
  });

  it('(3) FIXTURE RECALL — "fixtures and maintenance stands", Robins AFB / GA: NOT recalled, and not faked', () => {
    const p = plan('fixtures and maintenance stands', { location: 'Robins AFB / GA' });
    expect(p.states).toEqual(['GA']); // "Robins AFB" is reported unresolved, not geocoded
    // A 3-concept query requires every concept (frozen discovery rule). KC-135's only text is its
    // title — the cache has no description / SOW for it — and the title has no "stand".
    expect(p.matcher.alternatives).toHaveLength(1);
    expect(p.matcher.alternatives[0].eligibility).toBe('all');
    expect(p.matcher.alternatives[0].eligible.map((c) => c.label).sort()).toEqual(['fixtures', 'maintenance', 'stands']);
    expect(String(KC135.description || '')).toBe('');
    expect(admitsOpen(p, KC135, null)).toBe(false);
    // The matcher itself is right: word-bounded, plural → singular ("fixtures" matches "Fixture").
    expect(admitsOpen(plan('fixtures', { location: 'GA' }), KC135, null)).toBe(true);
    expect(admitsOpen(plan('fixtures, maintenance stands', { location: 'GA' }), KC135, null)).toBe(true);
    expect(admitsOpen(plan('fixtures', { location: 'GA' }), { ...KC135, title: 'Rotational fixtureless mount' }, null)).toBe(false);
    // A's noted limitation is untouched: "fabrication" does not match "FABRICATE" (not the same fix).
    expect(matchesText(plan('fabrication').matcher, ['FABRICATE AND INSTALL STEEL'])).toBe(false);
  });
});

// ── End-to-end over a RECORDING fake client (filters must reach the fetch, before the cap) ──────
type Call = { table: string; ops: Array<[string, unknown[]]> };
function recordingClient(tables: Record<string, Row[]>, calls: Call[]) {
  const make = (table: string) => {
    let head = false;
    const rec: Call = { table, ops: [] };
    calls.push(rec);
    const rows = tables[table] || [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch']) {
      builder[m] = (...args: unknown[]) => {
        rec.ops.push([m, args]);
        if (m === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true;
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(head ? { data: null, count: 3, error: null } : { data: rows, count: rows.length, error: null });
    return builder;
  };
  return { from: (t: string) => make(t) } as never;
}
const foundLookup = async () => ({ entity, matches: [], queried: { uei: IMI_UEI }, _meta: { grounded: true, degraded: false, match_count: 1, mode: 'uei', source: 'sam_live', lookup_status: 'found' } }) as unknown as SamEntityResult;
const orArgs = (c: Call) => c.ops.filter(([m]) => m === 'or').map(([, a]) => String(a[0]));

describe('findOpportunities — region + stage end-to-end', () => {
  it('(2) uei + GA/AL/TN + MARKET_RESEARCH: region AND stage are IN every Open fetch; items carry PSC + stage evidence', async () => {
    const calls: Call[] = [];
    // The fake returns the rows the SQL would admit (the two Anniston RFIs); the assertions are on the
    // query chain (what SQL ran) and on the labels (what the customer sees).
    const tables = { sam_opportunities: [OKUMA, SHOTBLAST], recompete_opportunities: TYONEK, agency_forecasts: [] };
    const res = await findOpportunities(
      { query: Q_IMI, uei: IMI_UEI, states: REGION, stage: 'MARKET_RESEARCH', limit_per_horizon: 25 },
      { client: recordingClient(tables, calls), entityLookup: foundLookup },
    );
    const openFetches = calls.filter((c) => c.table === 'sam_opportunities' && c.ops.some(([m, a]) => m === 'select' && String(a[0]).includes('notice_type')));
    expect(openFetches.length).toBe(2); // anchored plan + base plan (union)
    for (const c of openFetches) {
      expect(orArgs(c)).toContain(stateOrExpr(REGION));
      expect(orArgs(c)).toContain(stageOrExpr('MARKET_RESEARCH'));
      // filter-before-rank: the stage predicate precedes the cap.
      const iStage = c.ops.findIndex(([m, a]) => m === 'or' && a[0] === stageOrExpr('MARKET_RESEARCH'));
      const iLimit = c.ops.findIndex(([m]) => m === 'limit');
      expect(iStage).toBeLessThan(iLimit);
    }
    // The unknown-stage count ran without the stage predicate, with the unknown predicate.
    const unknownCount = calls.find((c) => c.table === 'sam_opportunities' && orArgs(c).includes(unknownStageOrExpr()));
    expect(unknownCount).toBeTruthy();
    expect(orArgs(unknownCount!)).not.toContain(stageOrExpr('MARKET_RESEARCH'));

    expect(res.query_summary.region).toEqual({ requested: REGION, states: REGION, unresolved: [] });
    expect(res.query_summary.stage).toBe('MARKET_RESEARCH');
    const open = res.horizons.open_now;
    expect(open.items.map((i) => i.solicitation_number).sort()).toEqual(['W911KF-26-S-0023', 'W911KF-26-S-0024']);
    for (const it of open.items) {
      expect(it.match_basis).toContain('company_registered_psc');
      expect(it.evidence_class).not.toBe('DIRECT_MATCH');
      expect(it.eligibility?.status).toBe('ELIGIBLE');
      expect(it.acquisition_stage).toMatchObject({ group: 'MARKET_RESEARCH', signal: 'structured_notice_type' });
    }
    expect(open.items.map((i) => i.psc_code).sort()).toEqual(['J034', 'J036']);
    expect(open.stage).toMatchObject({ group: 'MARKET_RESEARCH', applied: true, excluded_unknown_stage_count: 3, returned_by_signal: { structured_notice_type: 2, title_keyword: 0 } });
    expect(open.filters_consumed).toContain('stage→MARKET_RESEARCH(notice_type·title_secondary)');
    // Other horizons are context, explicitly NOT stage-filtered.
    for (const k of ['coming_back', 'coming_soon'] as const) {
      expect(res.horizons[k].stage).toMatchObject({ applied: false });
      expect(res.horizons[k].filters_unsupported.join(' ')).toMatch(/stage:MARKET_RESEARCH .*Open now only/);
    }
    // (6) re-asserted under region + stage: Tyonek is still a holder signal, never DIRECT.
    const ty = res.horizons.coming_back.items;
    expect(ty.length).toBe(6);
    expect(ty.every((i) => i.evidence_class === 'HOLDER_SIGNAL')).toBe(true);
    expect(res.presentation.host_rules).toEqual([...HOST_RULES_FIND_FIRST_VALUE, ...HOST_RULES_COMPANY_ANCHORED, ...HOST_RULES_STAGE]);
  });

  it('(1) re-asserted: Shaw MACC under VEHICLE_SOLICITATIONS in SC is NOT_ELIGIBLE, labelled a title-keyword vehicle', async () => {
    const res = await findOpportunities(
      { query: Q_IMI, uei: IMI_UEI, states: ['SC'], stage: 'VEHICLE_SOLICITATIONS' },
      { client: recordingClient({ sam_opportunities: [SHAW], recompete_opportunities: [], agency_forecasts: [] }, []), entityLookup: foundLookup },
    );
    const shaw = res.horizons.open_now.items[0];
    expect(shaw.solicitation_number).toBe('FA480326B0006');
    expect(shaw.eligibility?.status).toBe('NOT_ELIGIBLE');
    expect(shaw.acquisition_stage).toMatchObject({ group: 'VEHICLE_SOLICITATIONS', signal: 'title_keyword' });
  });

  it('an unresolvable location fails closed AND says so (host rule + unsupported), never "zero demand"', async () => {
    const calls: Call[] = [];
    const res = await findOpportunities({ query: 'fixtures and maintenance stands', location: 'Robins AFB' }, { client: recordingClient({}, calls) });
    expect(res.query_summary.region).toEqual({ requested: ['Robins AFB'], states: [], unresolved: ['Robins AFB'] });
    expect(res.query_summary.location).toBeNull();
    for (const k of ['open_now', 'coming_back', 'coming_soon'] as const) {
      expect(res.horizons[k].filters_unsupported.join(' ')).toMatch(/"Robins AFB".*nothing searched/);
    }
    expect(res.presentation.host_rules).toEqual([...HOST_RULES_FIND_FIRST_VALUE, ...HOST_RULES_REGION]);
    // Open's state predicate is the no-match sentinel, not absent.
    const open = calls.find((c) => c.table === 'sam_opportunities' && c.ops.some(([m, a]) => m === 'select' && String(a[0]).includes('notice_type')))!;
    expect(open.ops.some(([m, a]) => m === 'eq' && a[0] === 'pop_state' && a[1] === '__NONE__')).toBe(true);
  });

  it('an unrecognised stage is a validation ask on Open (never ignored → never widened)', async () => {
    const res = await findOpportunities({ query: Q_IMI, stage: 'RFP' }, { client: recordingClient({}, []) });
    expect(res.horizons.open_now.status).toBe('unavailable');
    expect(res.horizons.open_now.error?.class).toBe('validation_error');
  });

  it('P2 beginner first turn is unchanged: no uei / states / stage → no region, no stage, P2 rules only', async () => {
    const res = await findOpportunities({ query: 'janitorial' }, { client: recordingClient({ sam_opportunities: [OKUMA] }, []) });
    expect(res.query_summary.region).toBeUndefined();
    expect(res.query_summary.stage).toBeUndefined();
    expect(res.horizons.open_now.stage).toBeUndefined();
    expect(res.presentation.host_rules).toEqual([...HOST_RULES_FIND_FIRST_VALUE]);
  });
});
