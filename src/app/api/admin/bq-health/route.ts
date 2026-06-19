/**
 * /api/admin/bq-health?password=...
 *
 * Diagnoses the production BigQuery connection — the contractor search returns 0
 * results even though the table has 317K rows (so the failure is being swallowed
 * as empty instead of erroring). Reports: which service-account the app is using,
 * whether GCP_SA_JSON is present/parsable, and a LIVE count + sample query against
 * the recipients table (errors surfaced, not hidden).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceAccountEmail, bqQuery, BQ_TABLES } from '@/lib/bigquery/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function authorized(request: NextRequest): boolean {
  const p = new URL(request.url).searchParams.get('password');
  return p === process.env.ADMIN_PASSWORD;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result: Record<string, unknown> = {
    serviceAccount: getServiceAccountEmail(),
    gcpSaJsonPresent: Boolean(process.env.GCP_SA_JSON),
    gcpSaJsonLength: (process.env.GCP_SA_JSON || '').length,
    recipientsTable: BQ_TABLES.recipients,
  };

  // Live count — the truth test. Surface the error if it fails.
  try {
    const rows = await bqQuery<{ n: number }>({
      query: `SELECT COUNT(*) AS n FROM ${BQ_TABLES.recipients}`,
    });
    result.recipientsCount = rows?.[0]?.n ?? null;
    result.countOk = true;
  } catch (err) {
    result.countOk = false;
    result.countError = err instanceof Error ? err.message : String(err);
  }

  // Sample name search (the exact pattern the contractor search uses).
  try {
    const rows = await bqQuery<{ recipient_name: string }>({
      query: `SELECT recipient_name FROM ${BQ_TABLES.recipients} WHERE LOWER(recipient_name) LIKE '%boeing%' LIMIT 3`,
    });
    result.boeingSampleCount = rows?.length ?? 0;
    result.boeingSample = (rows || []).map((r) => r.recipient_name);
    result.searchOk = true;
  } catch (err) {
    result.searchOk = false;
    result.searchError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(result);
}
