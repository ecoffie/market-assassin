/**
 * Canonical Players query — FILTER, then RANK, then paginate. Pure SQL builder (no client) so the
 * filter-before-rank order is unit-testable rather than a comment.
 *
 * Every scope the caller supplies (NAICS codes, HQ state, visible cities, name search) is a WHERE
 * predicate on `players_naics_recipients` BEFORE the GROUP BY / ORDER BY / LIMIT. Nothing is
 * ranked nationally and narrowed afterward.
 */
import { createHash } from 'node:crypto';
import { PLAYERS_DATASET_VERSION } from './dataset';

export type PlayersSort = 'total_obligated' | 'award_count' | 'recipient_name';

export interface PlayersQueryInput {
  naicsCodes: string[];        // 2–6 digit; <6 = prefix
  state?: string;              // 2-letter HQ state
  /** Visible cities (UPPERCASE) in that state — sub-state geography, applied before ranking. */
  cities?: string[];
  /** Also keep firms whose HQ city is NOT in the geocode table (they place at the state centroid,
   *  which is in view). Requires `knownCities` = every geocodable city in the state. */
  includeUngeocodedCities?: boolean;
  knownCities?: string[];
  search?: string;
  sortBy: PlayersSort;
  limit: number;
  offset: number;
}

/**
 * Sub-state geography predicate on a city column. Shared by every Players path so a viewport that
 * shows part of a state is filtered BEFORE ranking no matter which population answers.
 * Returns null when no city scope applies. Mutates `params` (adds @cities / @knownCities).
 */
export function cityScopeSql(
  col: string,
  g: { cities?: string[]; includeUngeocodedCities?: boolean; knownCities?: string[] },
  params: Record<string, unknown>,
): string | null {
  if (!g.cities) return null;
  const c = `UPPER(TRIM(IFNULL(${col}, '')))`;
  params.cities = g.cities;
  if (g.includeUngeocodedCities && g.knownCities) {
    params.knownCities = g.knownCities;
    return `(${c} IN UNNEST(@cities) OR ${c} NOT IN UNNEST(@knownCities))`;
  }
  return `${c} IN UNNEST(@cities)`;
}

export function geoCacheToken(g?: { cities?: string[]; includeUngeocodedCities?: boolean }): string {
  if (!g?.cities) return '-';
  return createHash('md5').update(JSON.stringify([g.cities, g.includeUngeocodedCities ? 1 : 0])).digest('hex').slice(0, 12);
}

export function buildPlayersQuery(table: string, q: PlayersQueryInput): { sql: string; params: Record<string, unknown>; cacheKey: string } {
  const params: Record<string, unknown> = { limit: q.limit, offset: q.offset };
  const conds: string[] = [];

  const naicsConds = q.naicsCodes.map((code, i) => {
    params[`n${i}`] = code;
    return code.length >= 6 ? `naics_code = @n${i}` : `STARTS_WITH(naics_code, @n${i})`;
  });
  conds.push(`(${naicsConds.join(' OR ')})`);

  if (q.state) { conds.push('state = @state'); params.state = q.state; }

  const cityCond = cityScopeSql('city', q, params);
  if (cityCond) conds.push(cityCond);

  if (q.search) {
    const isUei = /^[A-Za-z0-9]{12}$/.test(q.search);
    params.search = `%${q.search.toLowerCase()}%`;
    if (isUei) { conds.push('(LOWER(recipient_name) LIKE @search OR recipient_uei = @uei)'); params.uei = q.search.toUpperCase(); }
    else conds.push('LOWER(recipient_name) LIKE @search');
  }

  const order = q.sortBy === 'recipient_name' ? 'recipient_name ASC'
    : q.sortBy === 'award_count' ? 'award_count DESC'
    : 'total_obligated DESC';

  const sql = `
    WITH matched AS (
      SELECT
        recipient_uei,
        ANY_VALUE(recipient_name)       AS recipient_name,
        ANY_VALUE(city)                 AS city,
        ANY_VALUE(state)                AS state,
        SUM(total_obligated)            AS total_obligated,
        SUM(award_count)                AS award_count,
        MAX(distinct_agency_count)      AS distinct_agency_count,
        MAX(last_action_date)           AS last_action_date,
        ANY_VALUE(source_action_max)    AS source_action_max
      FROM ${table}
      WHERE ${conds.join(' AND ')}
      GROUP BY recipient_uei
    )
    SELECT recipient_uei, recipient_name, city, state, total_obligated, award_count,
      distinct_agency_count, CAST(last_action_date AS STRING) AS last_action_date,
      CAST(source_action_max AS STRING) AS source_action_max,
      COUNT(*) OVER() AS total_rows
    FROM matched
    ORDER BY ${order}, recipient_uei
    LIMIT @limit OFFSET @offset
  `;

  // City lists can be thousands long — hash them so the KV key stays bounded and stable.
  const geoHash = geoCacheToken(q);
  const cacheKey = [
    'players', PLAYERS_DATASET_VERSION, q.naicsCodes.join('_'), q.state || '-', geoHash,
    q.search || '-', q.sortBy, q.limit, q.offset,
  ].join(':');

  return { sql, params, cacheKey };
}
