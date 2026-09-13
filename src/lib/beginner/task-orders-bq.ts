/**
 * /try awarded fallback — task/delivery orders in the BigQuery warehouse.
 *
 * SAM Award Notices are only the awards posted to SAM.gov. The real task-order
 * stream is `market-assasin.usaspending.awards` where parent_piid is set
 * (the IDV the order was placed against). Clustered on recipient_uei, so a
 * keyword search cannot prune by firm — fiscal_year partition is the bound.
 *
 * Measured 2026-09-13 (dry-run, free):
 *   FY current only          0.73 GiB
 *   FY >= current-1          2.05 GiB processed / ~2.61 GiB billed live
 * Runtime ceiling is 5 GiB; this job caps at 3 GiB so a schema drift fails
 * closed instead of scanning the full 63M-row table. Cached 7 days.
 *
 * Not the USASpending HTTP API. Fail-open: a BQ error returns [] and /try
 * still shows SAM Award Notices if those matched.
 */

import { BQ_TABLES, bqJobOptions } from '@/lib/bigquery/client';
import { queryCached } from '@/lib/bigquery/cache';
import type { SamSearchItem } from './types';

const MAX_BYTES = String(3 * 1024 * 1024 * 1024);
const TTL_SECONDS = 7 * 24 * 60 * 60;
const CACHE_PREFIX = 'try:task-orders:v1';

export interface BqTaskOrderRow {
  award_id: string | null;
  piid: string | null;
  parent_piid: string | null;
  recipient_name: string | null;
  awarding_agency: string | null;
  naics_code: string | null;
  naics_description: string | null;
  description: string | null;
  obligation_amount: number | string | null;
  action_date: string | null;
  pop_state: string | null;
  pop_city: string | null;
}

export function sanitizeTaskOrderKeyword(raw: string): string | null {
  const kw = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const letters = kw.replace(/[^a-z]/g, '');
  if (letters.length < 4) return null;
  return kw;
}

export function mapBqTaskOrderRow(row: BqTaskOrderRow): SamSearchItem {
  const id = String(row.award_id || '').trim();
  const piid = String(row.piid || '').trim();
  const rawAmt = row.obligation_amount;
  const n =
    rawAmt == null || rawAmt === ''
      ? NaN
      : typeof rawAmt === 'number'
        ? rawAmt
        : Number(rawAmt);
  const title = (row.description || '').replace(/\s+/g, ' ').trim();
  return {
    title: title || null,
    agency: (row.awarding_agency || '').trim() || null,
    naics: (row.naics_code || '').trim() || null,
    set_aside: null,
    type: 'Task Order',
    deadline: row.action_date ? String(row.action_date).slice(0, 10) : null,
    solicitation: piid || id || null,
    link: id ? `https://www.usaspending.gov/award/${encodeURIComponent(id)}` : null,
    amount: Number.isFinite(n) ? n : undefined,
    location: {
      pop_state: row.pop_state ? String(row.pop_state) : null,
      pop_city: row.pop_city ? String(row.pop_city) : null,
      office_state: null,
    },
  };
}

export async function searchBqTaskOrders(input: {
  keyword: string;
  limit?: number;
}): Promise<SamSearchItem[]> {
  const keyword = sanitizeTaskOrderKeyword(input.keyword);
  if (!keyword) return [];
  const limit = Math.max(1, Math.min(input.limit ?? 20, 40));
  const minFy = new Date().getUTCFullYear() - 1;
  const cacheKey = `${CACHE_PREFIX}:${keyword}:${minFy}:${limit}`;
  const rows = await queryCached<BqTaskOrderRow>({
    cacheKey,
    cacheOnly: false,
    ttlSeconds: TTL_SECONDS,
    maximumBytesBilled: MAX_BYTES,
    ...bqJobOptions({
      feature: 'try',
      tool: 'beginner',
      queryFamily: 'task_orders_kw',
      maximumBytesBilled: MAX_BYTES,
    }),
    query: `
      SELECT
        award_id,
        piid,
        parent_piid,
        recipient_name,
        awarding_agency,
        naics_code,
        naics_description,
        description,
        obligation_amount,
        CAST(action_date AS STRING) AS action_date,
        pop_state,
        pop_city
      FROM ${BQ_TABLES.awards}
      WHERE fiscal_year >= @minFy
        AND parent_piid IS NOT NULL AND TRIM(parent_piid) != ''
        AND obligation_amount > 0
        AND STRPOS(LOWER(IFNULL(description, '')), @keyword) > 0
      QUALIFY ROW_NUMBER() OVER (PARTITION BY award_id ORDER BY action_date DESC) = 1
      ORDER BY action_date DESC
      LIMIT @limit
    `,
    params: { minFy, keyword, limit },
  });
  return rows.map(mapBqTaskOrderRow).filter((item) => item.title);
}
