import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => ({}), getReadClient: () => ({}) }));
import { buildBuyingOfficesQuery, getBuyingOffices, piidFromAwardId } from './buying-offices';
import type { ScopedAggregateDeps } from '@/lib/bigquery/scoped-aggregate';
import { expandMetroCities, metroCoreStates } from '@/lib/bigquery/award-scope';
import { annotateResultContract } from '@/lib/mcp/result-contract';
import { listMcpTools, toolParameters } from '@/lib/mcp/tool-registry';
import { isPublicMcpTool, listPublicMcpTools } from '@/lib/mcp/public-catalog';
import { chatToolPolicy, isChatOfferable } from '@/lib/chat/chat-tool-policy';
import { preflightPaidInput } from '@/lib/mcp/credit-integrity';

const NOW = new Date('2026-11-14T00:00:00Z'); // FY2027 started; latest complete FY = 2026

const OFFICE_ROWS = [
  {
    office_key: 'N00189', award_count: 11, transaction_count: 60, obligated: 58_877_046.2,
    top_naics: [{ code: '561422', obligated: 40_000_000 }],
    example_awards: [{ award_id: 'CONT_AWD_N0018925FZ083_9700_N0018920DZ003_9700', obligated: 21_000_000 }],
    counterparts: [{ key: 'NAVY PERSONNEL COMMAND', obligated: 8_437_120 }],
    top_places: [{ city: 'MILLINGTON', state: 'TN', obligated: 58_877_046.2 }],
    total_obligated: 65_723_500.81, total_awards: 74, total_offices: 17, as_of: { value: '2026-09-30' },
    scope_cities: [{ city: 'MILLINGTON', obligated: 58_906_144, award_count: 12 }, { city: 'MEMPHIS', obligated: 6_700_000, award_count: 60 }],
  },
  {
    office_key: 'W912EQ', award_count: 4, transaction_count: 9, obligated: 1_088_003,
    top_naics: [{ code: '561320', obligated: 1_088_003 }],
    example_awards: [{ award_id: 'CONT_AWD_W912EQ24P0035_9700_-NONE-_-NONE-', obligated: 500_000 }],
    counterparts: [{ key: 'ARMY CORPS OF ENGINEERS CIVIL WORKS', obligated: 1_088_003 }],
    top_places: [{ city: 'MEMPHIS', state: 'TN', obligated: 1_088_003 }],
    total_obligated: 65_723_500.81, total_awards: 74, total_offices: 17, as_of: { value: '2026-09-30' },
    scope_cities: null,
  },
];

const NAMES = [
  { code: 'N00189', name: 'NAVSUP FLT LOG CTR NORFOLK', agency: 'Department of Defense', sub_agency: 'Department of the Navy' },
  { code: 'W912EQ', name: 'W07V ENDIST MEMPHIS', agency: 'Department of Defense', sub_agency: 'Department of the Army' },
];

function deps(opts: { bytes?: number; fail?: boolean; rows?: unknown[] } = {}) {
  const calls: Array<{ query: string; params: Record<string, unknown>; cacheKey: string }> = [];
  const d: ScopedAggregateDeps = {
    dryRun: vi.fn(async () => ({ bytesProcessed: opts.bytes ?? 3 * 1024 ** 3 })),
    run: vi.fn(async (o: { cacheKey: string; query: string; params: Record<string, unknown> }) => {
      calls.push(o);
      if (opts.fail) return { rows: [], state: 'failed' as const };
      if (o.query.includes('ANY_VALUE(awarding_office)')) return { rows: NAMES as never[], state: 'hit' as const };
      if (o.query.includes('ANY_VALUE(funding_agency)')) return { rows: [] as never[], state: 'empty' as const };
      const rows = opts.rows ?? OFFICE_ROWS;
      return { rows: rows as never[], state: rows.length ? ('hit' as const) : ('empty' as const) };
    }) as ScopedAggregateDeps['run'],
  };
  return { d, calls };
}

describe('get_buying_offices', () => {
  it('ranks offices with codes, names, counterpart customers and honest location basis', async () => {
    const { d, calls } = deps();
    const r = await getBuyingOffices(
      { state: 'Tennessee', cities: ['Memphis', 'Millington', 'Germantown, TN'], naics: ['5613', '5611'] },
      d,
      NOW,
    );
    expect(r._meta.grounded).toBe(true);
    expect(r.offices[0]).toMatchObject({
      rank: 1, office_code: 'N00189', office_code_type: 'dodaac', office_name: 'NAVSUP FLT LOG CTR NORFOLK',
      sub_agency: 'Department of the Navy', award_count: 11,
    });
    expect(r.offices[0].top_funding_offices?.[0].name).toBe('NAVY PERSONNEL COMMAND');
    expect(r.offices[0].example_awards[0].piid).toBe('N0018925FZ083');
    expect(r.offices[0].share_pct).toBeCloseTo(89.58, 1);
    expect(r.totals).toMatchObject({ obligated: 65_723_500.81, award_count: 74, office_count: 17 });
    expect(r._meta.as_of).toBe('2026-09-30');
    // Ported Defense lag: emitted from the tool's own rows (a Navy office is listed), with the evidence named.
    expect(r._meta.defense_lag).toMatchObject({ applies: true, lag_days: 90, window_end: '2026-09-30', evidence: expect.stringContaining('NAVSUP') });
    expect(r.scope.location_basis).toBe('place_of_performance');
    // Cities are reported both ways: matched, and requested-but-empty.
    expect(r.cities_matched?.map((c) => c.city)).toEqual(['MEMPHIS', 'MILLINGTON']);
    expect(r.cities_without_rows).toEqual(['GERMANTOWN']);
    // Scope was applied INSIDE the query, as parameters.
    const main = calls[0];
    expect(main.params).toMatchObject({ state: 'TN', cities: ['MEMPHIS', 'MILLINGTON', 'GERMANTOWN'], naics: ['5613', '5611'], fyFrom: 2024, fyTo: 2026 });
    expect(r._meta.applied_filters).toMatchObject({ state: 'TN', naics: ['5613', '5611'], fiscal_year_from: 2024, fiscal_year_to: 2026 });
    expect(r._meta.ignored_args).toEqual([]);
  });

  it('applies the scope before ranking (filters inside base, LIMIT after)', () => {
    const q = buildBuyingOfficesQuery({ role: 'awarding', hasState: true, hasCities: true, hasNaics: true, hasPsc: false, windowSql: 'fiscal_year BETWEEN @fyFrom AND @fyTo' });
    const baseEnd = q.indexOf('offices AS');
    for (const f of ['pop_state = @state', 'IN UNNEST(@cities)', 'UNNEST(@naics)']) {
      const at = q.indexOf(f);
      expect(at, f).toBeGreaterThan(0);
      expect(at, f).toBeLessThan(baseEnd);
    }
    expect(q.indexOf('LIMIT @limit')).toBeGreaterThan(baseEnd);
    expect(q).not.toContain('psc_code');
  });

  it('refuses an over-budget scan as unavailable, never a zero', async () => {
    const { d } = deps({ bytes: 9 * 1024 ** 3 });
    const r = await getBuyingOffices({ naics: '56', fiscal_year_from: 2021, fiscal_year_to: 2026 }, d, NOW);
    expect(r._meta).toMatchObject({ degraded: true, grounded: false, result_state: 'unavailable', incomplete_reason: 'scope_too_broad' });
    expect(d.run).not.toHaveBeenCalled();
    const annotated = annotateResultContract(r, {}, toolParameters('get_buying_offices'));
    expect(annotated._meta.result_state).toBe('unavailable');
  });

  it('a BigQuery failure is degraded, never a zero', async () => {
    const { d } = deps({ fail: true });
    const r = await getBuyingOffices({ state: 'TN' }, d, NOW);
    expect(r._meta).toMatchObject({ degraded: true, result_state: 'unavailable' });
  });

  it('an empty scope with every filter applied is a verified none', async () => {
    const { d } = deps({ rows: [] });
    const args = { state: 'TN', city: 'Nowhereville', naics: '561320' };
    const r = await getBuyingOffices(args, d, NOW);
    expect(r._meta.grounded).toBe(false);
    expect(r._meta.degraded).toBe(false);
    const annotated = annotateResultContract(r, args, toolParameters('get_buying_offices'));
    expect(annotated._meta.result_state).toBe('none_found');
  });

  it('reports filters it could not apply instead of widening silently', async () => {
    const { d } = deps();
    const args = { state: 'Narnia', naics: '5613,abc', rank_by: 'popularity' };
    const r = await getBuyingOffices(args, d, NOW);
    const ignored = r._meta.ignored_args.map((i) => `${i.arg}:${i.reason}`);
    expect(ignored).toEqual(expect.arrayContaining(['state:invalid_value', 'naics:invalid_value', 'rank_by:invalid_value']));
    const annotated = annotateResultContract(r, args, toolParameters('get_buying_offices'));
    expect(annotated._meta.result_state).toBe('partial');
  });

  it('needs a state, NAICS or PSC (non-billable validation error, nothing queried)', async () => {
    const { d } = deps();
    const r = await getBuyingOffices({ city: 'Memphis' }, d, NOW);
    expect(r._meta.validation_error).toBeTruthy();
    expect(d.dryRun).not.toHaveBeenCalled();
    expect(preflightPaidInput('get_buying_offices', { city: 'Memphis' })?.code).toBe('invalid_input');
    expect(preflightPaidInput('get_buying_offices', { state: 'TN' })).toBeNull();
  });

  it('rank_by funding ranks customers and names the contracting offices behind them', async () => {
    const rows = [{ ...OFFICE_ROWS[0], office_key: 'NAVY PERSONNEL COMMAND', counterparts: [{ key: 'N00189', obligated: 8_437_120 }] }];
    const { d, calls } = deps({ rows });
    const r = await getBuyingOffices({ state: 'TN', naics: '5614', rank_by: 'funding' }, d, NOW);
    expect(calls[0].query).toContain('funding_office');
    expect(r.offices[0]).toMatchObject({ office_name: 'NAVY PERSONNEL COMMAND', office_code: null, office_code_type: null });
    expect(r.offices[0].top_awarding_offices?.[0]).toMatchObject({ code: 'N00189', name: 'NAVSUP FLT LOG CTR NORFOLK' });
  });

  it('parses the PIID out of a USASpending award id', () => {
    expect(piidFromAwardId('CONT_AWD_36C24926N0074_3600_-NONE-_-NONE-')).toBe('36C24926N0074');
    expect(piidFromAwardId('garbage')).toBeNull();
  });
});

describe('Ask-Mindy-only availability', () => {
  for (const name of ['get_buying_offices', 'get_vehicle_spend_mix']) {
    it(`${name} is registered, offered to chat as allowed_read, and absent from public MCP`, () => {
      expect(listMcpTools().some((t) => (t.function as { name: string }).name === name)).toBe(true);
      const p = chatToolPolicy(name, true);
      expect(p.decision).toBe('allowed_read');
      expect(isChatOfferable(p)).toBe(true);
      expect(isPublicMcpTool(name)).toBe(false);
      expect(listPublicMcpTools().some((t) => (t.function as { name: string }).name === name)).toBe(false);
    });
  }
});

describe('deterministic metro expansion (no dependence on which suburbs a model recalls)', () => {
  it('a single core city expands to cities within the radius in the state', async () => {
    const { d, calls } = deps();
    const r = await getBuyingOffices({ state: 'TN', city: 'Memphis', naics: '5613' }, d, NOW);
    const sent = calls.find((c) => 'cities' in c.params)!.params.cities as string[];
    expect(sent).toEqual(expect.arrayContaining(['MEMPHIS', 'MILLINGTON', 'GERMANTOWN', 'COLLIERVILLE']));
    expect(r._meta.applied_filters.metro).toMatchObject({ core_city: 'MEMPHIS', center: 'MEMPHIS|TN', radius_miles: 30 });
    // expansion towns with no awards are expected and are not reported as misses
    expect(r.cities_without_rows).toEqual([]);
  });
  it('metro_radius_miles=0 keeps the exact city only', async () => {
    const { d, calls } = deps();
    await getBuyingOffices({ state: 'TN', city: 'Memphis', naics: '5613', metro_radius_miles: 0 }, d, NOW);
    expect(calls.find((c) => 'cities' in c.params)!.params.cities).toEqual(['MEMPHIS']);
  });
  it('a city not in the list is kept as given (never dropped)', async () => {
    const { d, calls } = deps();
    await getBuyingOffices({ state: 'TN', city: 'Atlantis', naics: '5613' }, d, NOW);
    expect(calls.find((c) => 'cities' in c.params)!.params.cities).toEqual(['ATLANTIS']);
  });
});

describe('a metro is always pinned to one state (2026-11-15 Birmingham incident)', () => {
  // Production answer: "Birmingham metro (cities within 30 miles)" with no state ranked offices whose
  // work was in Leeds MA, Fairfield PA, New Castle DE, Cordova AK and Pelham TN, because the expansion
  // returned Birmingham AL's suburb NAMES and the query matched those names in every state.
  const OTHER_STATE_NAMES = ['LEEDS', 'FAIRFIELD', 'PELHAM', 'CORDOVA'];

  it('no state + an ambiguous core city (Birmingham: AL, IA, MI, NJ, OH) does not expand suburbs by bare name', async () => {
    const { d, calls } = deps();
    const r = await getBuyingOffices({ city: 'Birmingham', naics: '2362' }, d, NOW);
    const sent = calls.find((c) => 'cities' in c.params)!.params as Record<string, unknown>;
    expect(sent.cities).toEqual(['BIRMINGHAM']);
    for (const n of OTHER_STATE_NAMES) expect(sent.cities).not.toContain(n);
    expect(r._meta.applied_filters.metro).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/BIRMINGHAM is a city name in AL, IA, MI, NJ, OH/);
    expect(r.notes.join(' ')).toMatch(/City matched in every state/);
  });

  it('no state + an ambiguous core city with an explicit radius reports the radius as not applied, naming the states', async () => {
    const { d } = deps();
    const r = await getBuyingOffices({ city: 'Birmingham', naics: '2362', metro_radius_miles: 30 }, d, NOW);
    expect(r._meta.applied_filters.metro_radius_miles).toBeUndefined();
    expect(JSON.stringify(r._meta.ignored_args)).toMatch(/several states \(AL, IA, MI, NJ, OH\)/);
  });

  it('state AL + Birmingham expands the metro AND filters on AL, so suburb names cannot match other states', async () => {
    const { d, calls } = deps();
    const r = await getBuyingOffices({ state: 'AL', city: 'Birmingham', naics: '2362' }, d, NOW);
    const call = calls.find((c) => 'cities' in c.params)!;
    expect(call.params.cities).toEqual(expect.arrayContaining(['BIRMINGHAM', 'LEEDS', 'FAIRFIELD', 'PELHAM']));
    expect(call.params.state).toBe('AL');
    expect(call.query).toContain('pop_state = @state');
    expect(r.scope.state).toBe('AL');
    expect(r._meta.applied_filters.metro).toMatchObject({ core_city: 'BIRMINGHAM', state: 'AL', state_source: 'given' });
  });

  it('no state + a core city that exists in ONE state pins the metro to that state and says so', async () => {
    const { d, calls } = deps();
    const r = await getBuyingOffices({ city: 'Tuscaloosa', naics: '2362' }, d, NOW);
    const call = calls.find((c) => 'cities' in c.params)!;
    expect(call.params.state).toBe('AL');
    expect(call.query).toContain('pop_state = @state');
    expect(r.scope.state).toBe('AL');
    expect(r._meta.applied_filters.state).toBe('AL');
    expect(r._meta.applied_filters.metro).toMatchObject({ core_city: 'TUSCALOOSA', state: 'AL', state_source: 'core_city' });
    expect(r.notes.join(' ')).toMatch(/No state was given; TUSCALOOSA is only in AL/);
    expect(r.notes.join(' ')).not.toMatch(/City matched in every state/);
    expect(call.cacheKey).toContain(':AL:');
  });

  it('expandMetroCities never returns an unpinned expansion', () => {
    expect(expandMetroCities('Birmingham', [])).toBeNull();
    expect(metroCoreStates('Birmingham')).toEqual(['AL', 'IA', 'MI', 'NJ', 'OH']);
    const al = expandMetroCities('Birmingham', ['AL'])!;
    expect(al.state).toBe('AL');
    expect(al.cities).toEqual(expect.arrayContaining(['LEEDS', 'FAIRFIELD', 'PELHAM']));
    expect(expandMetroCities('Tuscaloosa', [])!.state).toBe('AL');
  });
});

describe('acc7 R4: metro radius with one city in `cities`', () => {
  it('expands the metro instead of reporting a radius it did not apply', async () => {
    const { d, calls } = deps();
    const r = await getBuyingOffices({ state: 'TN', cities: ['Memphis'], naics: '561320', metro_radius_miles: 30 }, d, NOW);
    const sent = calls.find((c) => 'cities' in c.params)!.params.cities as string[];
    expect(sent).toEqual(expect.arrayContaining(['MEMPHIS', 'MILLINGTON']));
    expect(r._meta.applied_filters.metro).toMatchObject({ core_city: 'MEMPHIS', radius_miles: 30 });
  });
  it('several explicit cities with a radius are matched exactly and the radius is reported as not applied', async () => {
    const { d, calls } = deps();
    const r = await getBuyingOffices({ state: 'TN', cities: ['Memphis', 'Nashville'], naics: '561320', metro_radius_miles: 30 }, d, NOW);
    expect(calls.find((c) => 'cities' in c.params)!.params.cities).toEqual(['MEMPHIS', 'NASHVILLE']);
    expect(r._meta.applied_filters.metro_radius_miles).toBeUndefined();
    expect(JSON.stringify(r._meta.ignored_args)).toMatch(/metro_radius_miles/);
  });
});

describe('unresolved offices stay unnamed', () => {
  it('does not invent a name or a contact for a missing code or a code with no name', async () => {
    const { d } = deps({
      rows: [
        { ...OFFICE_ROWS[0], office_key: '(not reported)' },
        { ...OFFICE_ROWS[0], office_key: 'ABC123' },
      ],
    });
    const r = await getBuyingOffices({ state: 'TN', naics: '5613' }, d, NOW);
    expect(r.offices.map((o) => o.name_provenance)).toEqual(['not_reported', 'code_only']);
    expect(r.offices[0].office_name).toBeNull();
    expect(r.offices[0].office_code).toBeNull();
    expect(r.offices[1].office_name).toBeNull();
    expect(r.offices[1].office_code).toBe('ABC123');
    expect(r.offices.every((o) => !('email' in o) && !('phone' in o))).toBe(true);
    expect(r.notes.join(' ')).toMatch(/not filled in/);
  });

  it('uses a directory name when the award record has only a code', async () => {
    const { d } = deps({
      rows: [{ ...OFFICE_ROWS[0], office_key: 'ABC123' }],
    });
    const r = await getBuyingOffices({ state: 'TN', naics: '5613' }, d, NOW, {
      lookup: async () => ({
        names: new Map([['ABC123', { name: 'NAVSUP FLT LOG CTR NORFOLK', source: 'sam_office_name' as const }]]),
        failed: false,
      }),
    });
    expect(r.offices[0].name_provenance).toBe('directory_sam');
    expect(r.offices[0].office_name).toBe('NAVSUP FLT LOG CTR NORFOLK');
    expect(r.offices[0].office_code).toBe('ABC123');
    expect(r.notes.join(' ')).toMatch(/buying-office directory/);
    expect(r.notes.join(' ')).toMatch(/No contact was added/);
  });
});

describe('get_buying_offices: window vs warehouse currency (EFS Digital chip, 2026-11-25)', () => {
  // The chip read "as of 2026-09-30" (FY2026 end, the default window's last FY) while the warehouse held actions
  // through 2026-11-20. _meta now carries both, and as_of is kept unchanged for existing readers.
  const coverage = async () => ({ clocks: { sourceActionMax: '2026-11-20' }, lastBuilt: null, freshness: 'fresh' }) as never;
  it('reports the fiscal-year window and data_current_through separately; as_of unchanged', async () => {
    const { d } = deps();
    const r = await getBuyingOffices({ state: 'TN' }, d, NOW, undefined, coverage);
    expect(r._meta.window).toMatchObject({ fy_from: 2024, fy_to: 2026, defaulted: true });
    expect(r._meta.window.label).toMatch(/FY2024-FY2026/);
    expect(r._meta.data_current_through).toBe('2026-11-20');
    expect('as_of' in r._meta).toBe(true);
  });
  it('an unreadable coverage clock is null (unknown), never a guessed date', async () => {
    const { d } = deps();
    const r = await getBuyingOffices({ state: 'TN' }, d, NOW, undefined, async () => { throw new Error('kv down'); });
    expect(r._meta.data_current_through).toBeNull();
  });
  it('validation and unavailable results carry the window too', async () => {
    const { d } = deps({ fail: true });
    const r = await getBuyingOffices({ state: 'TN' }, d, NOW, undefined, coverage);
    expect(r._meta.window.fy_to).toBe(2026);
    expect(r._meta.data_current_through).toBe('2026-11-20');
  });
});
