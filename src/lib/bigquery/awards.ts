/**
 * Award-level queries — powers /awards landing page + /awards/[id]
 * detail pages.
 *
 * Awards are the most granular USAspending entity. The `awards` table
 * has 63M transactions; we surface a curated slice publicly:
 *   - Landing page: latest 50 dollar-bearing awards
 *   - Detail pages: top 10K awards by obligation amount get their own
 *     URL (these are the awards search engines actually rank for)
 */
import { BQ_TABLES } from './client';
import { queryCached } from './cache';

export interface AwardListRow {
  award_id: string;
  piid: string | null;
  recipient_uei: string;
  recipient_name: string;
  awarding_agency: string | null;
  awarding_office: string | null;
  naics_code: string | null;
  naics_description: string | null;
  obligation_amount: number;
  action_date: string;
  description: string | null;
}

export interface AwardDetailRow extends AwardListRow {
  pop_start_date: string | null;
  pop_end_date: string | null;
  pop_state: string | null;
  pop_city: string | null;
  pop_country: string | null;
  set_aside: string | null;
  contract_pricing_type: string | null;
  awarding_sub_agency: string | null;
  funding_agency: string | null;
  funding_office: string | null;
  psc_code: string | null;
  psc_description: string | null;
  parent_uei: string | null;
  parent_name: string | null;
  cage_code: string | null;
  recipient_state: string | null;
  recipient_city: string | null;
  fiscal_year: number;
}

/**
 * Latest N awards across all agencies, dollar-bearing only.
 * Powers /awards landing page table.
 */
export async function getLatestAwards(limit = 50): Promise<AwardListRow[]> {
  return queryCached<AwardListRow>({
    cacheKey: `awards:latest:${limit}`,
    // Even with the fiscal_year >= currentYear-1 filter, ORDER BY
    // action_date DESC on dollar-bearing rows scans the recent
    // partitions fully (~10-15 GB). Cache hit cost is zero —
    // queryCached + KV means this runs once per 24h max.
    maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
    query: `
      SELECT
        award_id,
        piid,
        recipient_uei,
        recipient_name,
        awarding_agency,
        awarding_office,
        naics_code,
        naics_description,
        obligation_amount,
        CAST(action_date AS STRING) AS action_date,
        description
      FROM ${BQ_TABLES.awards}
      WHERE obligation_amount > 0
        AND fiscal_year >= ${new Date().getFullYear() - 1}
      ORDER BY action_date DESC
      LIMIT @limit
    `,
    params: { limit },
  });
}

/**
 * Top N awards by single-action obligation amount, all-time.
 * Used both for the landing page "Largest Awards" section AND for
 * generateStaticParams on /awards/[id] (so the top 10K are
 * prerendered/sitemapped).
 */
export async function getLargestAwards(limit = 50): Promise<AwardListRow[]> {
  return queryCached<AwardListRow>({
    cacheKey: `awards:largest:${limit}`,
    // Full-table sort by obligation_amount across 63M rows scans
    // ~17 GB. Bumped from default 5 GiB. Cache hit cost is zero,
    // and KV TTL is 7 days so this runs ~weekly.
    maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
    query: `
      SELECT
        award_id,
        piid,
        recipient_uei,
        recipient_name,
        awarding_agency,
        awarding_office,
        naics_code,
        naics_description,
        obligation_amount,
        CAST(action_date AS STRING) AS action_date,
        description
      FROM ${BQ_TABLES.awards}
      WHERE obligation_amount > 0
      ORDER BY obligation_amount DESC
      LIMIT @limit
    `,
    params: { limit },
  });
}

/**
 * One award detail by award_id.
 * Powers /awards/[id] page.
 */
export async function getAwardById(awardId: string): Promise<AwardDetailRow | null> {
  const rows = await queryCached<AwardDetailRow>({
    cacheKey: `awards:detail:${awardId}`,
    // award_id is a globally-unique string and the WHERE clause is
    // a single equality filter, but award_id isn't in the cluster
    // key so this still scans 10-15 GB per cold lookup. Bumped from
    // default 5 GiB.
    maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
    query: `
      SELECT
        award_id,
        piid,
        recipient_uei,
        recipient_name,
        parent_uei,
        parent_name,
        cage_code,
        recipient_city,
        recipient_state,
        awarding_agency,
        awarding_sub_agency,
        awarding_office,
        funding_agency,
        funding_office,
        naics_code,
        naics_description,
        psc_code,
        psc_description,
        contract_pricing_type,
        set_aside,
        obligation_amount,
        CAST(action_date AS STRING) AS action_date,
        CAST(pop_start_date AS STRING) AS pop_start_date,
        CAST(pop_end_date AS STRING) AS pop_end_date,
        pop_state,
        pop_city,
        pop_country,
        fiscal_year,
        description
      FROM ${BQ_TABLES.awards}
      WHERE award_id = @id
      ORDER BY action_date DESC
      LIMIT 1
    `,
    params: { id: awardId },
  });
  return rows[0] ?? null;
}

/**
 * Slugs for the top 10K awards — fed to generateStaticParams so
 * each is prerendered as a stable URL in the sitemap.
 */
export async function getTopAwardIdsForStatic(limit = 10000): Promise<string[]> {
  const rows = await queryCached<{ award_id: string }>({
    cacheKey: `awards:top-ids:${limit}`,
    maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
    ttlSeconds: 30 * 24 * 60 * 60, // 30d (this list is stable enough)
    query: `
      SELECT award_id
      FROM ${BQ_TABLES.awards}
      WHERE obligation_amount > 0
      ORDER BY obligation_amount DESC
      LIMIT @limit
    `,
    params: { limit },
  });
  return rows.map((r) => r.award_id).filter(Boolean);
}
