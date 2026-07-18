/**
 * /api/cron/build-recent-spending — weekly rebuild of the "This Week in Government
 * Spending" Discover feed (/spending).
 *
 * Dispatcher-fired (cron_jobs 'build-recent-spending', NOT vercel.json). Pulls the biggest
 * recent federal obligations into recent_big_awards; the page reads cheap from Supabase.
 * Every row is a real award (real amount, real award_id → /awards/[id] proof) — grounded.
 *
 * Cost: one bounded scan of the recent action_date range per WEEK. Never per page-load.
 */
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';
import { getWriteClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Row {
  award_id: string;
  piid: string | null;
  recipient_name: string | null;
  awarding_agency: string | null;
  obligation_amount: number;
  description: string | null;
  naics_description: string | null;
  action_date: string | null;
  recipient_state: string | null;
}

export async function GET() {
  let rows: Row[];
  try {
    rows = await bqQuery<Row>({
      // Filter by fiscal_year (like getLatestAwards) + order by action_date DESC to get the
      // MOST RECENT big awards. A tight action_date window returned 0 — federal award data
      // lags ingestion by weeks/months, so "last 60 calendar days" is often empty. FY does not.
      maximumBytesBilled: String(25 * 1024 * 1024 * 1024),
      query: `
        SELECT award_id, piid, recipient_name, awarding_agency, obligation_amount,
               description, naics_description, CAST(action_date AS STRING) AS action_date, recipient_state
        FROM ${BQ_TABLES.awards}
        WHERE obligation_amount >= 1000000
          AND fiscal_year >= @minFy
        ORDER BY action_date DESC
        LIMIT 300
      `,
      params: { minFy: new Date().getFullYear() - 1 },
    });
  } catch (e) {
    console.error('[build-recent-spending] BQ scan failed:', e);
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Dedup by award_id (the table can carry multiple transactions per award); keep the
  // biggest, cap ~50.
  const seen = new Set<string>();
  const picked: Row[] = [];
  for (const r of rows) {
    if (!r.award_id || seen.has(r.award_id)) continue;
    seen.add(r.award_id);
    picked.push(r);
    if (picked.length >= 50) break;
  }

  if (!picked.length) {
    return NextResponse.json({ success: true, scanned: rows.length, written: 0, note: 'no recent awards over $1M found' });
  }

  const sb = getWriteClient();
  const del = await sb.from('recent_big_awards').delete().neq('award_id', '');
  if (del.error) return NextResponse.json({ success: false, error: `delete: ${del.error.message}` }, { status: 500 });

  const payload = picked.map((r) => ({
    award_id: r.award_id,
    piid: r.piid,
    recipient_name: r.recipient_name,
    awarding_agency: r.awarding_agency,
    obligation_amount: Number(r.obligation_amount) || 0,
    description: r.description,
    naics_description: r.naics_description,
    action_date: r.action_date,
    recipient_state: r.recipient_state,
  }));
  const ins = await sb.from('recent_big_awards').insert(payload);
  if (ins.error) return NextResponse.json({ success: false, error: `insert: ${ins.error.message}` }, { status: 500 });

  revalidatePath('/spending');
  return NextResponse.json({ success: true, scanned: rows.length, written: payload.length });
}
