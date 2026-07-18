/**
 * /api/cron/build-weird-awards — monthly rebuild of the Weird Awards Discover feed.
 *
 * Dispatcher-fired (cron_jobs 'build-weird-awards', NOT vercel.json). Scans the awards
 * table ONCE for a curated set of unmistakably-odd purchase descriptions and stores the
 * real hits in weird_awards; the /weird page then reads cheap from Supabase. Every row is
 * a real award (real amount, real award_id → /awards/[id] proof) — grounded, never faked.
 *
 * Cost: one description scan (~17-20 GB, capped by maximumBytesBilled) per MONTH ≈ pennies.
 * Never run per page-load. See tasks/bigquery-cost-spike-2026-06.md.
 */
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { WEIRD_TERMS } from '@/lib/discover/weird-awards';

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
  psc_description: string | null;
  action_date: string | null;
  recipient_state: string | null;
}

// The curious hook that matched a description → the category stored on the row.
function categorize(description: string | null): string | null {
  if (!description) return null;
  const up = description.toUpperCase();
  for (const t of WEIRD_TERMS) if (up.includes(t.like)) return t.hook;
  return null;
}

export async function GET() {
  // Weird = small-ish and specific; a $2B award is not "weird", it's just big. Recent-ish
  // so it feels current. One OR-clause per curated term.
  const likeClause = WEIRD_TERMS.map((_, i) => `UPPER(description) LIKE @t${i}`).join(' OR ');
  // ⚠️ CREDIBILITY CAP. The description only MENTIONS the item; the obligation is the whole
  // award. A $1.6M "dunk tank" is really a festival-services contract that lists one — so
  // attributing the full amount "to a dunk tank" is misleading, and misleading kills the
  // "cited source" thesis. Cap at $100K so the shown figure plausibly IS the item itself.
  // The small absurd ones ("$12K on a clown") are the unimpeachable, screenshot-proof gold.
  const params: Record<string, string | number> = { minAmt: 500, maxAmt: 100_000, minFy: new Date().getFullYear() - 8 };
  WEIRD_TERMS.forEach((t, i) => { params[`t${i}`] = `%${t.like}%`; });

  let rows: Row[];
  try {
    rows = await bqQuery<Row>({
      maximumBytesBilled: String(25 * 1024 * 1024 * 1024),
      query: `
        SELECT award_id, piid, recipient_name, awarding_agency, obligation_amount,
               description, psc_description, CAST(action_date AS STRING) AS action_date, recipient_state
        FROM ${BQ_TABLES.awards}
        WHERE obligation_amount BETWEEN @minAmt AND @maxAmt
          AND fiscal_year >= @minFy
          AND description IS NOT NULL
          AND (${likeClause})
        ORDER BY obligation_amount DESC
        LIMIT 800
      `,
      params,
    });
  } catch (e) {
    console.error('[build-weird-awards] BQ scan failed:', e);
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Categorize + dedup by award_id + keep a SPREAD (max 4 per category) so the feed is
  // varied, not 40 dunk tanks. Cap ~40.
  const perCat = new Map<string, number>();
  const seen = new Set<string>();
  const picked: (Row & { category: string })[] = [];
  for (const r of rows) {
    const category = categorize(r.description);
    if (!category || !r.award_id || seen.has(r.award_id)) continue;
    const n = perCat.get(category) ?? 0;
    if (n >= 5) continue;
    perCat.set(category, n + 1);
    seen.add(r.award_id);
    picked.push({ ...r, category });
    if (picked.length >= 60) break;
  }

  if (!picked.length) {
    return NextResponse.json({ success: true, scanned: rows.length, written: 0, note: 'no matches this run' });
  }

  const sb = getWriteClient();
  // Full replace: clear the old feed, insert the fresh pick. (Small table, monthly.)
  const del = await sb.from('weird_awards').delete().neq('award_id', '');
  if (del.error) return NextResponse.json({ success: false, error: `delete: ${del.error.message}` }, { status: 500 });

  const payload = picked.map((r) => ({
    award_id: r.award_id,
    piid: r.piid,
    recipient_name: r.recipient_name,
    awarding_agency: r.awarding_agency,
    obligation_amount: Number(r.obligation_amount) || 0,
    description: r.description,
    psc_description: r.psc_description,
    category: r.category,
    action_date: r.action_date,
    recipient_state: r.recipient_state,
  }));
  const ins = await sb.from('weird_awards').insert(payload);
  if (ins.error) return NextResponse.json({ success: false, error: `insert: ${ins.error.message}` }, { status: 500 });

  revalidatePath('/weird');
  return NextResponse.json({ success: true, scanned: rows.length, written: payload.length, categories: [...perCat.keys()] });
}
