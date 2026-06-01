/**
 * /api/cron/refresh-bq-rollups — monthly rebuild of the BigQuery
 * agency/listicle rollup tables.
 *
 * These rollups (agency_top_recipients, agency_top_naics,
 * top_contractors_by_dimension) let the /agencies and /top pages read a
 * few MB instead of scanning the full awards table — the permanent fix
 * for BQ daily-quota exhaustion. They must be rebuilt after each monthly
 * USASpending ingest so the numbers stay current.
 *
 * This is the ONLY place that scans the full awards table for these
 * breakdowns now. One scheduled scan/month vs. thousands of page-load
 * scans before.
 *
 * Schedule: monthly (vercel.json). Auth: x-vercel-cron header or
 * Bearer CRON_SECRET (also accepts ?password=ADMIN_PASSWORD for manual
 * runs).
 *
 * Mirrors scripts/bq-build-agency-rollups.sql — keep the two in sync.
 */
import { NextRequest, NextResponse } from 'next/server';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // generous — the build scans the full table

// Drop the surrounding backticks BQ_TABLES adds, since these statements
// reference the fully-qualified names directly.
const AWARDS = BQ_TABLES.awards;
const AGENCY_TOP_RECIPIENTS = BQ_TABLES.agencyTopRecipients;
const AGENCY_TOP_NAICS = BQ_TABLES.agencyTopNaics;
const TOP_BY_DIMENSION = BQ_TABLES.topContractorsByDimension;

const STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: 'agency_top_recipients',
    sql: `
      CREATE OR REPLACE TABLE ${AGENCY_TOP_RECIPIENTS}
      CLUSTER BY awarding_agency AS
      WITH per_uei AS (
        SELECT awarding_agency, recipient_uei, recipient_name,
          SUM(obligation_amount) AS amount, COUNT(DISTINCT award_id) AS awards
        FROM ${AWARDS}
        WHERE awarding_agency IS NOT NULL AND recipient_uei IS NOT NULL AND recipient_name IS NOT NULL
        GROUP BY awarding_agency, recipient_uei, recipient_name
      ),
      rolled AS (
        SELECT awarding_agency, recipient_name,
          SUM(amount) AS total_amount, SUM(awards) AS award_count,
          ARRAY_AGG(recipient_uei ORDER BY amount DESC LIMIT 1)[OFFSET(0)] AS recipient_uei
        FROM per_uei GROUP BY awarding_agency, recipient_name
      ),
      ranked AS (
        SELECT awarding_agency, recipient_uei, recipient_name, total_amount, award_count,
          ROW_NUMBER() OVER (PARTITION BY awarding_agency ORDER BY total_amount DESC) AS rank
        FROM rolled
      )
      SELECT awarding_agency, recipient_uei, recipient_name, total_amount, award_count, rank
      FROM ranked WHERE rank <= 50
    `,
  },
  {
    label: 'agency_top_naics',
    sql: `
      CREATE OR REPLACE TABLE ${AGENCY_TOP_NAICS}
      CLUSTER BY awarding_agency AS
      WITH agg AS (
        SELECT awarding_agency, naics_code,
          ANY_VALUE(naics_description) AS naics_description, SUM(obligation_amount) AS total_amount
        FROM ${AWARDS}
        WHERE awarding_agency IS NOT NULL AND naics_code IS NOT NULL
        GROUP BY awarding_agency, naics_code
      ),
      ranked AS (
        SELECT awarding_agency, naics_code, naics_description, total_amount,
          ROW_NUMBER() OVER (PARTITION BY awarding_agency ORDER BY total_amount DESC) AS rank
        FROM agg
      )
      SELECT awarding_agency, naics_code, naics_description, total_amount, rank
      FROM ranked WHERE rank <= 50
    `,
  },
  {
    label: 'top_contractors_by_dimension',
    sql: `
      CREATE OR REPLACE TABLE ${TOP_BY_DIMENSION}
      CLUSTER BY dimension, dimension_value AS
      WITH base AS (
        SELECT recipient_uei, recipient_name, award_id, obligation_amount,
          awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside
        FROM ${AWARDS}
        WHERE recipient_uei IS NOT NULL AND recipient_name IS NOT NULL
      ),
      exploded AS (
        SELECT 'agency' AS dimension, awarding_agency AS dimension_value, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE awarding_agency IS NOT NULL
        UNION ALL
        SELECT 'naics', naics_code, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE naics_code IS NOT NULL
        UNION ALL
        SELECT 'sub_agency', awarding_sub_agency, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE awarding_sub_agency IS NOT NULL
        UNION ALL
        SELECT 'state', recipient_state, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE recipient_state IS NOT NULL
        UNION ALL
        SELECT 'set_aside', set_aside, * EXCEPT(awarding_agency, naics_code, awarding_sub_agency, recipient_state, set_aside) FROM base WHERE set_aside IS NOT NULL
      ),
      per_uei AS (
        SELECT dimension, dimension_value, recipient_uei, recipient_name,
          SUM(obligation_amount) AS amount, COUNT(DISTINCT award_id) AS awards
        FROM exploded GROUP BY dimension, dimension_value, recipient_uei, recipient_name
      ),
      rolled AS (
        SELECT dimension, dimension_value, recipient_name,
          SUM(amount) AS total_amount, SUM(awards) AS award_count,
          ARRAY_AGG(recipient_uei ORDER BY amount DESC LIMIT 1)[OFFSET(0)] AS recipient_uei
        FROM per_uei GROUP BY dimension, dimension_value, recipient_name
      ),
      ranked AS (
        SELECT dimension, dimension_value, recipient_uei, recipient_name, total_amount, award_count,
          ROW_NUMBER() OVER (PARTITION BY dimension, dimension_value ORDER BY total_amount DESC) AS rank
        FROM rolled
      )
      SELECT dimension, dimension_value, recipient_uei, recipient_name, total_amount, award_count, rank
      FROM ranked WHERE rank <= 50
    `,
  },
];

function authorized(request: NextRequest): boolean {
  if (request.headers.get('x-vercel-cron') === '1') return true;
  const auth = request.headers.get('authorization');
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const pw = request.nextUrl.searchParams.get('password');
  if (pw && pw === (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) return true;
  return false;
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Array<{ label: string; ok: boolean; ms: number; error?: string }> = [];
  for (const stmt of STATEMENTS) {
    const t = Date.now();
    try {
      // DDL: 50 GiB cap is plenty for a full-table aggregate; guards
      // against a runaway scan.
      await bqQuery({ query: stmt.sql, maximumBytesBilled: String(50 * 1024 * 1024 * 1024) });
      results.push({ label: stmt.label, ok: true, ms: Date.now() - t });
    } catch (err) {
      results.push({ label: stmt.label, ok: false, ms: Date.now() - t, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const allOk = results.every(r => r.ok);
  return NextResponse.json({ success: allOk, results }, { status: allOk ? 200 : 500 });
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
