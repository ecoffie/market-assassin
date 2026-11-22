/**
 * NAICS-level queries — powers /naics/[code] pages with real BQ data.
 *
 * Replaces the contractors.json-derived /naics/top100 with real
 * USASpending totals across all 1,000+ NAICS codes.
 */
import { BQ_TABLES } from './client';
import { bqResultState, queryCached } from './cache';

export interface NaicsProfile {
  naics_code: string;
  naics_description: string;
  total_obligated: number;
  recipient_count: number;
  agency_count: number;
  transaction_count: number;
}

/**
 * What the profile read for one NAICS code ANSWERED.
 *
 * `absent` is a measured "naics_summary has no row for this code" and is the only state that
 * may become a 404. `unavailable` means we do not know (the read failed, or live BigQuery was
 * blocked) and must never be rendered as "not found" (CLAUDE.md rule 5).
 */
export type NaicsProfileLookup =
  | { kind: 'found'; profile: NaicsProfile }
  | { kind: 'absent' }
  | { kind: 'unavailable'; reason: 'unavailable' | 'failed' };

const NAICS_CODE_RE = /^\d{2,6}$/;

export async function lookupNaicsProfile(code: string): Promise<NaicsProfileLookup> {
  // Not a NAICS code at all: a real "no such page", and no BigQuery read for crawler junk.
  if (!NAICS_CODE_RE.test(code)) return { kind: 'absent' };
  const cacheKey = `naics:profile:${code}`;
  const rows = await queryCached<NaicsProfile>({
    // naics_summary is a pre-aggregated rollup (one row per NAICS, CLUSTER BY naics_code;
    // scripts/usaspending-ingest/build-derived.sql), so a cold read is a few MB, like the
    // /top rollup reads in top-listicles.ts. It used to be cache-only with nothing warming it,
    // so every /naics/<code> outside NAICS_TOP_100 read a cold cache, got [] and 404'd
    // (2026-11-22: /naics/236210 404 while /naics/236210/tx served 200).
    cacheOnly: false,
    maximumBytesBilled: String(100 * 1024 * 1024),
    cacheKey,
    query: `
      SELECT * FROM ${BQ_TABLES.naicsSummary}
      WHERE naics_code = @code LIMIT 1
    `,
    params: { code },
  });
  if (rows[0]) return { kind: 'found', profile: rows[0] };
  const state = bqResultState(cacheKey, rows.length);
  if (state === 'unavailable' || state === 'failed') return { kind: 'unavailable', reason: state };
  return { kind: 'absent' };
}

/** Profile or null. null does NOT mean absent; use lookupNaicsProfile to tell them apart. */
export async function getNaicsProfile(code: string): Promise<NaicsProfile | null> {
  const r = await lookupNaicsProfile(code);
  return r.kind === 'found' ? r.profile : null;
}

export interface TopRecipientForNaics {
  recipient_uei: string;
  recipient_name: string;
  total_amount: number;
  award_count: number;
}

export async function getTopRecipientsForNaics(
  code: string,
  limit = 25,
): Promise<TopRecipientForNaics[]> {
  // awards table is partitioned by fiscal_year and clustered by
  // recipient_uei + recipient_name. naics_code is neither — so this
  // query scans the full partition (~6 GB for popular NAICS like
  // 334515 electronic instrument manufacturing). The default 5 GiB
  // per-query cap rejects those. 10 GiB is plenty headroom and still
  // protected by the project-wide 5 TiB/day quota cap we set on the
  // service account.
  return queryCached<TopRecipientForNaics>({
    cacheKey: `naics:${code}:top-recipients:${limit}`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      SELECT
        recipient_uei,
        ANY_VALUE(recipient_name) AS recipient_name,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT award_id) AS award_count
      FROM ${BQ_TABLES.awards}
      WHERE naics_code = @code AND recipient_uei IS NOT NULL
      GROUP BY recipient_uei
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { code, limit },
  });
}

export interface TopAgencyForNaics {
  awarding_agency: string;
  total_amount: number;
  recipient_count: number;
}

export async function getTopAgenciesForNaics(
  code: string,
  limit = 10,
): Promise<TopAgencyForNaics[]> {
  // Same partition-scan story as getTopRecipientsForNaics — bump the
  // cap from default 5 GiB to 10 GiB for the large NAICS codes.
  return queryCached<TopAgencyForNaics>({
    cacheKey: `naics:${code}:top-agencies:${limit}`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      SELECT
        awarding_agency,
        SUM(obligation_amount) AS total_amount,
        COUNT(DISTINCT recipient_uei) AS recipient_count
      FROM ${BQ_TABLES.awards}
      WHERE naics_code = @code AND awarding_agency IS NOT NULL
      GROUP BY awarding_agency
      ORDER BY total_amount DESC
      LIMIT @limit
    `,
    params: { code, limit },
  });
}

// Set-aside accessibility + PSC mix for a NAICS — the "can a small firm win here?" signal
// USASpending doesn't surface. set_aside_share = fraction of DOLLARS awarded under a real
// small-business set-aside (SB/8A/SDVOSB/WOSB/HUBZone), i.e. NOT "no set aside used"/NULL.
export interface NaicsSetAsidePsc {
  total_amount: number;
  set_aside_amount: number;   // $ under any real set-aside
  top_psc: Array<{ psc_code: string; psc_description: string | null; total_amount: number }>;
}

export async function getNaicsSetAsideAndPsc(code: string): Promise<NaicsSetAsidePsc | null> {
  // ONE partition scan; same 10 GiB cap as the sibling helpers. The set-aside test excludes the
  // "NO SET ASIDE USED." literal + NULL/empty (the Full & Open bucket). Top PSC = what's actually
  // BOUGHT under this NAICS (the GovCon-pro insight that PSC > NAICS for what a buyer purchases).
  const rows = await queryCached<{
    total_amount: number; set_aside_amount: number;
    top_psc: Array<{ psc_code: string; psc_description: string | null; total_amount: number }>;
  }>({
    cacheKey: `naics:${code}:setaside-psc`,
    maximumBytesBilled: String(10 * 1024 * 1024 * 1024),
    query: `
      WITH base AS (
        SELECT obligation_amount, set_aside, psc_code, psc_description
        FROM ${BQ_TABLES.awards}
        WHERE naics_code = @code AND obligation_amount > 0
      ),
      totals AS (
        SELECT
          SUM(obligation_amount) AS total_amount,
          SUM(IF(set_aside IS NOT NULL AND set_aside != '' AND UPPER(set_aside) NOT LIKE 'NO SET ASIDE%', obligation_amount, 0)) AS set_aside_amount
        FROM base
      ),
      psc AS (
        SELECT ARRAY_AGG(STRUCT(psc_code, psc_description, total_amount) ORDER BY total_amount DESC LIMIT 6) AS top_psc
        FROM (
          SELECT psc_code, ANY_VALUE(psc_description) AS psc_description, SUM(obligation_amount) AS total_amount
          FROM base WHERE psc_code IS NOT NULL AND psc_code != ''
          GROUP BY psc_code
        )
      )
      SELECT totals.total_amount, totals.set_aside_amount, psc.top_psc FROM totals, psc
    `,
    params: { code },
  });
  const r = rows[0];
  if (!r || !r.total_amount) return null;
  return { total_amount: Number(r.total_amount), set_aside_amount: Number(r.set_aside_amount || 0), top_psc: r.top_psc || [] };
}
