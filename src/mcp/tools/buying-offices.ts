/**
 * Ask Mindy tool: get_buying_offices — WHO buys this, in this place, ranked by obligated dollars.
 *
 * The question it answers: "Who buys staffing and clerical services in the Memphis metro?" No
 * other tool ranks CONTRACTING OFFICES for a city or metro; the ranking needs the awarding
 * office, the funding office and the place of performance together, which only the BigQuery
 * award warehouse (`usaspending.awards`, one row per contract action) carries.
 *
 * Honesty rules built in:
 *   - Location is PLACE OF PERFORMANCE (pop_state / pop_city). The warehouse does not record
 *     where the awarding office sits, so an office in Norfolk that buys work performed in
 *     Millington is ranked for Millington, and the result says so (top_places).
 *   - The AWARDING office (the contracting shop that signs) and the FUNDING office (the customer
 *     whose money it is) are different organizations. Each ranked office lists its top
 *     counterpart offices so neither is hidden; `rank_by:"funding"` ranks customers instead.
 *   - Dollars are NET obligations inside the window (de-obligations subtract), never lifetime
 *     award values.
 *   - A scope too broad to scan safely is refused with its measured size (`scope_too_broad`),
 *     never returned as zero. A BigQuery failure is `degraded`, never zero.
 *
 * Registered in the shared registry for Ask Mindy only. Hidden from the public MCP catalog
 * (public-catalog-config.ts) until an owner review decides otherwise.
 */
import {
  bqDateString,
  normalizeCities,
  normalizeNaicsPrefixes,
  normalizePscPrefixes,
  normalizeStateArg,
  num,
  resolveFyWindow,
  round2,
  windowLabel,
  windowParams,
  windowPredicate,
} from '@/lib/bigquery/award-scope';
import { runScopedAggregate, type ScopedAggregateDeps } from '@/lib/bigquery/scoped-aggregate';
import type { IgnoredArg } from '@/lib/mcp/result-contract';

const AWARDS_TABLE = '`market-assasin.usaspending.awards`';
const NOT_REPORTED = '(not reported)';
const VALIDATION_ERROR =
  'Give at least a state, a NAICS code/prefix, or a PSC code/prefix. A nationwide all-industry office ranking is not a useful or safe scan.';

export interface BuyingOfficesInput {
  state?: unknown;
  city?: unknown;
  cities?: unknown;
  naics?: unknown;
  psc?: unknown;
  fiscal_year?: unknown;
  fiscal_year_from?: unknown;
  fiscal_year_to?: unknown;
  date_from?: unknown;
  date_to?: unknown;
  rank_by?: unknown;
  limit?: unknown;
}

export interface BuyingOfficeRow {
  rank: number;
  office_name: string | null;
  office_code: string | null;
  /** dodaac for Department of Defense awarding offices; agency_office_code otherwise; null for funding offices (the source carries no funding-office code). */
  office_code_type: 'dodaac' | 'agency_office_code' | null;
  agency: string | null;
  sub_agency: string | null;
  award_count: number;
  transaction_count: number;
  obligated: number;
  share_pct: number;
  top_naics: Array<{ code: string | null; obligated: number }>;
  example_awards: Array<{ award_id: string; piid: string | null; obligated: number; url: string }>;
  /** rank_by awarding: the customers (funding offices) behind this contracting office. */
  top_funding_offices?: Array<{ name: string | null; obligated: number }>;
  /** rank_by funding: the contracting offices that bought for this customer. */
  top_awarding_offices?: Array<{ code: string | null; name: string | null; agency: string | null; obligated: number }>;
  top_places: Array<{ city: string | null; state: string | null; obligated: number }>;
}

export interface BuyingOfficesResult {
  scope: {
    location_basis: 'place_of_performance';
    state: string | null;
    cities: string[];
    naics: string[];
    psc: string[];
    window: string;
    rank_by: 'awarding' | 'funding';
  };
  offices: BuyingOfficeRow[];
  totals: { obligated: number; award_count: number; office_count: number; offices_returned: number; returned_share_pct: number } | null;
  /** Per requested city, what matched (only when cities were given). */
  cities_matched?: Array<{ city: string; obligated: number; award_count: number }>;
  /** Requested cities with no rows in scope: reported, never dropped silently. */
  cities_without_rows?: string[];
  notes: string[];
  validation_error?: string;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    count: number;
    source: string;
    applied_filters: Record<string, unknown>;
    ignored_args: IgnoredArg[];
    as_of: string | null;
    lag_note: string;
    result_state?: 'unavailable' | 'not_reported';
    validation_error?: string;
    incomplete_reason?: string;
    scan_gib?: number;
  };
}

interface Row {
  office_key: string;
  award_count: number;
  transaction_count: number;
  obligated: number;
  top_naics: Array<{ code: string | null; obligated: number }> | null;
  example_awards: Array<{ award_id: string; obligated: number }> | null;
  counterparts: Array<{ key: string | null; obligated: number }> | null;
  top_places: Array<{ city: string | null; state: string | null; obligated: number }> | null;
  total_obligated: number;
  total_awards: number;
  total_offices: number;
  as_of: unknown;
  scope_cities: Array<{ city: string; obligated: number; award_count: number }> | null;
}

const LAG_NOTE =
  'Source: USASpending contract actions in the Mindy BigQuery warehouse (prime contracts only; ingested weekly). ' +
  'as_of is the latest action date loaded for the last fiscal year in the window, not today.';

/**
 * Office key expressions per ranking role. A fixed whitelist: no user text reaches SQL structure.
 *
 * Byte budget (measured 2026-11-14 by dry run over FY2024-FY2026). The table is partitioned by
 * fiscal_year and clustered by recipient, so a state/city/NAICS filter prunes NOTHING and every
 * referenced column is read in full for each partition: award_id 0.99 GiB, naics_description
 * 0.96, funding_office 0.78, awarding_office 0.78, awarding_sub_agency 0.71, awarding_agency
 * 0.70, recipient_name 0.70, piid 0.53, pop_city 0.45, awarding_office_code 0.42, obligation
 * 0.42, action_date 0.42, naics_code 0.30, pop_state 0.30. Reading every display column in one
 * scan is ~10 GiB, over the 5 GiB runtime ceiling. So the ranking scan reads only keys, codes
 * and amounts (~3.7 GiB for three FYs), and names are resolved afterwards for the few ranked
 * keys from one partition at a time (resolveNames, ~0.9 GiB per partition).
 */
const ROLE_SQL = {
  awarding: {
    key: `IFNULL(NULLIF(TRIM(awarding_office_code), ''), '${NOT_REPORTED}')`,
    cp: "NULLIF(TRIM(funding_office), '')",
  },
  funding: {
    key: `IFNULL(NULLIF(TRIM(funding_office), ''), '${NOT_REPORTED}')`,
    cp: "NULLIF(TRIM(awarding_office_code), '')",
  },
} as const;

const CITY_EXPR = "UPPER(REGEXP_REPLACE(TRIM(IFNULL(pop_city, '')), r'\\s+', ' '))";

export function buildBuyingOfficesQuery(opts: {
  role: 'awarding' | 'funding';
  hasState: boolean;
  hasCities: boolean;
  hasNaics: boolean;
  hasPsc: boolean;
  windowSql: string;
}): string {
  const r = ROLE_SQL[opts.role];
  // Scope filters sit INSIDE `base`, before any ranking or LIMIT (rank-then-filter rule).
  const where = [opts.windowSql];
  if (opts.hasState) where.push('pop_state = @state');
  if (opts.hasCities) where.push(`${CITY_EXPR} IN UNNEST(@cities)`);
  if (opts.hasNaics) where.push("EXISTS (SELECT 1 FROM UNNEST(@naics) p WHERE STARTS_WITH(IFNULL(naics_code, ''), p))");
  if (opts.hasPsc) where.push("EXISTS (SELECT 1 FROM UNNEST(@psc) p WHERE STARTS_WITH(UPPER(IFNULL(psc_code, '')), p))");
  return `
WITH base AS (
  SELECT
    ${r.key} AS office_key,
    ${r.cp} AS cp_key,
    award_id, naics_code,
    ${CITY_EXPR} AS city,
    pop_state,
    obligation_amount AS obl
  FROM ${AWARDS_TABLE}
  WHERE ${where.join('\n    AND ')}
),
offices AS (
  SELECT office_key, COUNT(DISTINCT award_id) AS award_count, COUNT(*) AS transaction_count, SUM(obl) AS obligated
  FROM base GROUP BY office_key
),
ranked AS (SELECT * FROM offices ORDER BY obligated DESC LIMIT @limit),
naics AS (
  SELECT office_key, ARRAY_AGG(STRUCT(naics_code AS code, o AS obligated) ORDER BY o DESC LIMIT 3) AS top_naics
  FROM (SELECT b.office_key, b.naics_code, SUM(b.obl) AS o FROM base b JOIN ranked USING (office_key) GROUP BY 1, 2)
  GROUP BY office_key
),
awards AS (
  SELECT office_key, ARRAY_AGG(STRUCT(award_id, o AS obligated) ORDER BY o DESC LIMIT 3) AS example_awards
  FROM (SELECT b.office_key, b.award_id, SUM(b.obl) AS o FROM base b JOIN ranked USING (office_key)
        WHERE b.award_id IS NOT NULL GROUP BY 1, 2)
  GROUP BY office_key
),
counterparts AS (
  SELECT office_key, ARRAY_AGG(STRUCT(cp_key AS key, o AS obligated) ORDER BY o DESC LIMIT 3) AS counterparts
  FROM (SELECT b.office_key, b.cp_key, SUM(b.obl) AS o FROM base b JOIN ranked USING (office_key) GROUP BY 1, 2)
  GROUP BY office_key
),
places AS (
  SELECT office_key, ARRAY_AGG(STRUCT(city, state, o AS obligated) ORDER BY o DESC LIMIT 3) AS top_places
  FROM (SELECT b.office_key, NULLIF(b.city, '') AS city, b.pop_state AS state, SUM(b.obl) AS o
        FROM base b JOIN ranked USING (office_key) GROUP BY 1, 2, 3)
  GROUP BY office_key
),
tot AS (
  SELECT SUM(obl) AS total_obligated, COUNT(DISTINCT award_id) AS total_awards, COUNT(DISTINCT office_key) AS total_offices
  FROM base
),
city_tot AS (
  SELECT ARRAY_AGG(STRUCT(city, o AS obligated, n AS award_count) ORDER BY o DESC LIMIT 50) AS scope_cities
  FROM (SELECT city, SUM(obl) AS o, COUNT(DISTINCT award_id) AS n FROM base GROUP BY city)
),
fresh AS (
  -- Warehouse freshness from ONE partition (cheap): the latest action date loaded for the window's last FY.
  SELECT MAX(action_date) AS as_of FROM ${AWARDS_TABLE} WHERE fiscal_year = @fyTo
)
SELECT ranked.*, naics.top_naics, awards.example_awards, counterparts.counterparts, places.top_places,
  tot.total_obligated, tot.total_awards, tot.total_offices, fresh.as_of, city_tot.scope_cities
FROM ranked
LEFT JOIN naics USING (office_key)
LEFT JOIN awards USING (office_key)
LEFT JOIN counterparts USING (office_key)
LEFT JOIN places USING (office_key)
CROSS JOIN tot
CROSS JOIN city_tot
CROSS JOIN fresh
ORDER BY ranked.obligated DESC`;
}

/** Name lookup for awarding-office codes, one fiscal-year partition per query. */
export function buildOfficeNameQuery(): string {
  return `SELECT awarding_office_code AS code, ANY_VALUE(awarding_office) AS name,
  ANY_VALUE(awarding_agency) AS agency, ANY_VALUE(awarding_sub_agency) AS sub_agency
FROM ${AWARDS_TABLE}
WHERE fiscal_year = @fy AND awarding_office_code IN UNNEST(@codes)
GROUP BY 1`;
}

/** Agency lookup for funding-office names, one fiscal-year partition per query. */
export function buildFundingAgencyQuery(): string {
  return `SELECT funding_office AS name, ANY_VALUE(funding_agency) AS agency
FROM ${AWARDS_TABLE}
WHERE fiscal_year = @fy AND funding_office IN UNNEST(@names)
GROUP BY 1`;
}

interface NameRow { code?: string | null; name: string | null; agency: string | null; sub_agency?: string | null }

/**
 * Resolve names for a small set of keys, newest partition first, stopping once all are found.
 * Names are display data: a failed lookup keeps the ranking and is noted; it never voids it.
 */
async function resolveNames(
  kind: 'office' | 'funding',
  keys: string[],
  fyFrom: number,
  fyTo: number,
  deps?: ScopedAggregateDeps,
): Promise<{ map: Map<string, NameRow>; failed: boolean }> {
  const map = new Map<string, NameRow>();
  let failed = false;
  let missing = [...new Set(keys.filter((k) => k && k !== NOT_REPORTED))];
  for (let fy = fyTo; fy >= fyFrom && missing.length; fy--) {
    const sorted = [...missing].sort();
    const outcome = await runScopedAggregate<NameRow>(
      kind === 'office'
        ? { cacheKey: `ask:office-names:v1:${fy}:${sorted.join('|')}`, query: buildOfficeNameQuery(), params: { fy, codes: sorted }, tool: 'get_buying_offices', family: 'office_names' }
        : { cacheKey: `ask:funding-agency:v1:${fy}:${sorted.join('|')}`, query: buildFundingAgencyQuery(), params: { fy, names: sorted }, tool: 'get_buying_offices', family: 'funding_agency' },
      deps,
    );
    if (outcome.status !== 'ok') {
      failed = true;
      break;
    }
    for (const r of outcome.rows) {
      const k = kind === 'office' ? r.code : r.name;
      if (k && !map.has(k)) map.set(k, r);
    }
    missing = missing.filter((k) => !map.has(k));
  }
  return { map, failed };
}

function awardUrl(id: string): string {
  return `https://www.usaspending.gov/award/${encodeURIComponent(id)}`;
}

/** USASpending award ids are CONT_AWD_<PIID>_<AGENCY>_<PARENT PIID>_<AGENCY>; the PIID is the 3rd segment. */
export function piidFromAwardId(id: string): string | null {
  const m = /^CONT_(?:AWD|IDV)_([^_]+)_/.exec(id);
  return m ? m[1] : null;
}

function isDodOffice(agency: string | null | undefined): boolean {
  return /department of defense/i.test(agency ?? '');
}

export async function getBuyingOffices(
  input: BuyingOfficesInput,
  deps?: ScopedAggregateDeps,
  now: Date = new Date(),
): Promise<BuyingOfficesResult> {
  const ignored: IgnoredArg[] = [];
  const st = normalizeStateArg(input.state);
  ignored.push(...st.ignored);
  const cities = normalizeCities(input.city, input.cities);
  const naics = normalizeNaicsPrefixes(input.naics);
  ignored.push(...naics.ignored);
  const psc = normalizePscPrefixes(input.psc);
  ignored.push(...psc.ignored);
  const fy = resolveFyWindow(input, now);
  ignored.push(...fy.ignored);
  let role: 'awarding' | 'funding' = 'awarding';
  if (input.rank_by === 'funding') role = 'funding';
  else if (input.rank_by != null && input.rank_by !== 'awarding') {
    ignored.push({ arg: 'rank_by', value: String(input.rank_by), reason: 'invalid_value', detail: 'allowed: awarding, funding' });
  }
  const limitRaw = typeof input.limit === 'number' ? input.limit : Number(input.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(Math.floor(limitRaw), 50) : 10;

  const applied: Record<string, unknown> = {
    window: windowLabel(fy.window),
    fiscal_year_from: fy.window.fy_from,
    fiscal_year_to: fy.window.fy_to,
    location_basis: 'place_of_performance',
    rank_by: role,
    limit,
  };
  if (fy.window.date_from) applied.date_from = fy.window.date_from;
  if (fy.window.date_to) applied.date_to = fy.window.date_to;
  if (st.state) applied.state = st.state;
  if (cities.length) {
    if (input.city != null) applied.city = cities;
    if (input.cities != null) applied.cities = cities;
  }
  if (naics.codes.length) applied.naics = naics.codes;
  if (psc.codes.length) applied.psc = psc.codes;

  const scope: BuyingOfficesResult['scope'] = {
    location_basis: 'place_of_performance',
    state: st.state,
    cities,
    naics: naics.codes,
    psc: psc.codes,
    window: windowLabel(fy.window),
    rank_by: role,
  };
  const notes: string[] = [
    'Location is PLACE OF PERFORMANCE. The source does not record where the awarding office sits, so an office located elsewhere is ranked here when the work it bought is performed here (see top_places).',
    role === 'awarding'
      ? 'Ranked by AWARDING (contracting) office. top_funding_offices names the customer organization whose money it was; the two often differ (a regional contracting center buying for a local command).'
      : 'Ranked by FUNDING office (the customer). top_awarding_offices names the contracting offices that bought for it. Funding offices carry no office code in the source.',
    'Dollars are net obligations inside the window (de-obligations subtract), not lifetime award values.',
  ];
  if (cities.length && !st.state) notes.push('City matched in every state because no state was given; pass state to disambiguate.');
  if (fy.window.defaulted) notes.push(`No window given: defaulted to the latest three complete fiscal years (${windowLabel(fy.window)}).`);

  const baseMeta = {
    source: 'BigQuery usaspending.awards (USASpending contract actions)',
    applied_filters: applied,
    ignored_args: ignored,
    lag_note: LAG_NOTE,
  };

  if (!st.state && !naics.codes.length && !psc.codes.length) {
    return {
      scope,
      offices: [],
      totals: null,
      notes,
      validation_error: VALIDATION_ERROR,
      // _meta.validation_error makes the call non-billable (credit-integrity classifyBillingOutcome).
      _meta: { ...baseMeta, grounded: false, degraded: false, count: 0, as_of: null, result_state: 'not_reported', validation_error: VALIDATION_ERROR },
    };
  }

  const query = buildBuyingOfficesQuery({
    role,
    hasState: !!st.state,
    hasCities: cities.length > 0,
    hasNaics: naics.codes.length > 0,
    hasPsc: psc.codes.length > 0,
    windowSql: windowPredicate(fy.window),
  });
  const params: Record<string, unknown> = { ...windowParams(fy.window), limit };
  if (st.state) params.state = st.state;
  if (cities.length) params.cities = cities;
  if (naics.codes.length) params.naics = naics.codes;
  if (psc.codes.length) params.psc = psc.codes;

  const cacheKey = `ask:buying-offices:v1:${role}:${st.state ?? '-'}:${cities.join('|') || '-'}:${naics.codes.join('|') || '-'}:${psc.codes.join('|') || '-'}:${fy.window.fy_from}-${fy.window.fy_to}:${fy.window.date_from ?? ''}:${fy.window.date_to ?? ''}:${limit}`;
  const outcome = await runScopedAggregate<Row>({ cacheKey, query, params, tool: 'get_buying_offices', family: `buying_offices_${role}` }, deps);

  if (outcome.status === 'too_broad') {
    return {
      scope,
      offices: [],
      totals: null,
      notes: [...notes, `Scope too broad to scan safely (${outcome.gib.toFixed(1)} GiB). Narrow the fiscal-year window (for example one or two fiscal years). This is NOT a zero.`],
      _meta: { ...baseMeta, grounded: false, degraded: true, count: 0, as_of: null, result_state: 'unavailable', incomplete_reason: 'scope_too_broad', scan_gib: round2(outcome.gib) },
    };
  }
  if (outcome.status === 'failed') {
    return {
      scope,
      offices: [],
      totals: null,
      notes: [...notes, 'The award warehouse could not be queried. This is NOT a zero; retry later.'],
      _meta: { ...baseMeta, grounded: false, degraded: true, count: 0, as_of: null, result_state: 'unavailable', incomplete_reason: outcome.reason },
    };
  }

  const rows = outcome.rows;
  const first = rows[0];

  // Names for the ranked keys and their counterparts (display only).
  const officeCodes = role === 'awarding'
    ? rows.map((r) => r.office_key)
    : rows.flatMap((r) => (r.counterparts ?? []).map((c) => c.key ?? ''));
  const officeNames = officeCodes.length ? await resolveNames('office', officeCodes, fy.window.fy_from, fy.window.fy_to, deps) : { map: new Map<string, NameRow>(), failed: false };
  const fundingAgencies = role === 'funding' && rows.length
    ? await resolveNames('funding', rows.map((r) => r.office_key), fy.window.fy_from, fy.window.fy_to, deps)
    : { map: new Map<string, NameRow>(), failed: false };
  if (officeNames.failed || fundingAgencies.failed) notes.push('Some office names or agencies could not be looked up; codes and dollars are unaffected.');

  const totalObl = first ? num(first.total_obligated) : 0;
  const offices: BuyingOfficeRow[] = rows.map((r, i) => {
    const key = r.office_key === NOT_REPORTED ? null : r.office_key;
    const named = role === 'awarding' && key ? officeNames.map.get(key) : undefined;
    const fundingNamed = role === 'funding' && key ? fundingAgencies.map.get(key) : undefined;
    const row: BuyingOfficeRow = {
      rank: i + 1,
      office_name: role === 'awarding' ? (named?.name ?? null) : key,
      office_code: role === 'awarding' ? key : null,
      office_code_type: role === 'awarding' && key ? (isDodOffice(named?.agency) ? 'dodaac' : 'agency_office_code') : null,
      agency: role === 'awarding' ? (named?.agency ?? null) : (fundingNamed?.agency ?? null),
      sub_agency: role === 'awarding' ? (named?.sub_agency ?? null) : null,
      award_count: num(r.award_count),
      transaction_count: num(r.transaction_count),
      obligated: round2(num(r.obligated)),
      share_pct: totalObl ? round2((num(r.obligated) / totalObl) * 100) : 0,
      top_naics: (r.top_naics ?? []).map((n) => ({ code: n.code, obligated: round2(num(n.obligated)) })),
      example_awards: (r.example_awards ?? []).map((a) => ({ award_id: a.award_id, piid: piidFromAwardId(a.award_id), obligated: round2(num(a.obligated)), url: awardUrl(a.award_id) })),
      top_places: (r.top_places ?? []).map((p) => ({ city: p.city, state: p.state, obligated: round2(num(p.obligated)) })),
    };
    if (role === 'awarding') {
      row.top_funding_offices = (r.counterparts ?? []).map((c) => ({ name: c.key, obligated: round2(num(c.obligated)) }));
    } else {
      row.top_awarding_offices = (r.counterparts ?? []).map((c) => {
        const n = c.key ? officeNames.map.get(c.key) : undefined;
        return { code: c.key, name: n?.name ?? null, agency: n?.agency ?? null, obligated: round2(num(c.obligated)) };
      });
    }
    return row;
  });

  const result: BuyingOfficesResult = {
    scope,
    offices,
    totals: first
      ? {
          obligated: round2(totalObl),
          award_count: num(first.total_awards),
          office_count: num(first.total_offices),
          offices_returned: offices.length,
          returned_share_pct: totalObl ? round2((rows.reduce((s, o) => s + num(o.obligated), 0) / totalObl) * 100) : 0,
        }
      : null,
    notes,
    _meta: {
      ...baseMeta,
      grounded: offices.length > 0,
      degraded: false,
      count: offices.length,
      as_of: first ? bqDateString(first.as_of) : null,
    },
  };
  if (cities.length) {
    const seen = new Map((first?.scope_cities ?? []).map((c) => [c.city, c]));
    result.cities_matched = cities
      .filter((c) => seen.has(c))
      .map((c) => ({ city: c, obligated: round2(num(seen.get(c)!.obligated)), award_count: num(seen.get(c)!.award_count) }));
    result.cities_without_rows = cities.filter((c) => !seen.has(c));
    if (result.cities_without_rows.length && offices.length) {
      notes.push(`Checked, no awards in scope performed in: ${result.cities_without_rows.join(', ')} (the city must match the place-of-performance city spelling).`);
    }
  }
  return result;
}
