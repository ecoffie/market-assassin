/**
 * /api/cron/build-recent-spending — daily rebuild of the "latest big federal
 * contracts" Discover feed (/spending).
 *
 * Dispatcher-fired (cron_jobs 'build-recent-spending', NOT vercel.json). Pulls the biggest
 * federal obligations of the LAST 14 DAYS from the live USASpending API into
 * recent_big_awards; the page reads cheap from Supabase.
 *
 * Source is the LIVE API, not the BigQuery snapshot: the BQ awards table is loaded by a
 * manual bulk ingest (scripts/usaspending-ingest/) and goes months between refreshes —
 * on 2026-07-23 its newest action_date was 2026-04-23, so a page titled "the latest"
 * was showing April. The live transaction search is always current (~week ingest lag).
 * Every row is a real transaction (real amount, real generated_internal_id →
 * usaspending.gov/award/<id> proof) — grounded.
 */
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getWriteClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const USASPENDING_TRANSACTIONS = 'https://api.usaspending.gov/api/v2/search/spending_by_transaction/';
const WINDOW_DAYS = 14;
const MIN_AMOUNT = 1_000_000;

interface TxnRow {
  'Award ID': string | null;
  'Recipient Name': string | null;
  'Transaction Amount': number | null;
  'Action Date': string | null;
  'Awarding Agency': string | null;
  'Transaction Description': string | null;
  naics_description: string | null;
  recipient_location_state_code: string | null;
  generated_internal_id: string | null;
}

export async function GET() {
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  let results: TxnRow[];
  try {
    const res = await fetch(USASPENDING_TRANSACTIONS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          award_type_codes: ['A', 'B', 'C', 'D'],
          time_period: [{ start_date: day(start), end_date: day(end) }],
        },
        fields: [
          'Award ID', 'Recipient Name', 'Transaction Amount', 'Action Date',
          'Awarding Agency', 'Transaction Description',
          'naics_description', 'recipient_location_state_code',
        ],
        sort: 'Transaction Amount',
        order: 'desc',
        limit: 100,
        page: 1,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`USASpending ${res.status}: ${body.slice(0, 200)}`);
    }
    results = (await res.json())?.results ?? [];
  } catch (e) {
    console.error('[build-recent-spending] USASpending fetch failed:', e);
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Dedup by award (an award can have several transactions in the window); results are
  // amount-desc, so first-seen is the biggest. Cap ~50, floor $1M.
  const seen = new Set<string>();
  const picked: TxnRow[] = [];
  for (const r of results) {
    const id = r.generated_internal_id;
    if (!id || seen.has(id)) continue;
    if ((Number(r['Transaction Amount']) || 0) < MIN_AMOUNT) continue;
    seen.add(id);
    picked.push(r);
    if (picked.length >= 50) break;
  }

  if (!picked.length) {
    // An empty window would blank the page — keep yesterday's rows and say so loudly.
    return NextResponse.json(
      { success: false, scanned: results.length, written: 0, error: `no transactions over $1M in the last ${WINDOW_DAYS} days — kept existing rows` },
      { status: 500 },
    );
  }

  const payload = picked.map((r) => ({
    award_id: r.generated_internal_id,
    piid: r['Award ID'],
    recipient_name: r['Recipient Name'],
    awarding_agency: r['Awarding Agency'],
    obligation_amount: Number(r['Transaction Amount']) || 0,
    description: r['Transaction Description'],
    naics_description: r.naics_description,
    action_date: r['Action Date'],
    recipient_state: r.recipient_location_state_code,
  }));

  const sb = getWriteClient();
  const del = await sb.from('recent_big_awards').delete().neq('award_id', '');
  if (del.error) return NextResponse.json({ success: false, error: `delete: ${del.error.message}` }, { status: 500 });
  const ins = await sb.from('recent_big_awards').insert(payload);
  if (ins.error) return NextResponse.json({ success: false, error: `insert: ${ins.error.message}` }, { status: 500 });

  revalidatePath('/spending');
  return NextResponse.json({
    success: true,
    scanned: results.length,
    written: payload.length,
    window: { start: day(start), end: day(end) },
    newest_action_date: payload.reduce((m, p) => (p.action_date && p.action_date > m ? p.action_date : m), ''),
  });
}
