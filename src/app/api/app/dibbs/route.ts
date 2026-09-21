/**
 * /api/app/dibbs
 *
 * GET ?email=&q=&nsn=&fsc=&sort=&limit=&offset=&includeExpired=
 *   → search DLA DIBBS small-buy RFQs (dibbs_rfqs table).
 *
 * DIBBS = DLA Internet Bid Board System: ~3.3M small-buy NSN/parts RFQs DLA posts
 * on its own board (not SAM). Sourced via the Apify parseforge/dibbs-rfq-scraper
 * actor (US residential proxy) → dibbs_rfqs table (see sync-dibbs cron). This route
 * surfaces that table to the DIBBS panel.
 *
 * Default: keyword (description) + NSN + FSC search, soonest-deadline first,
 * expired RFQs hidden unless includeExpired=1.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function getSupabase() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

// Escape a value for a PostgREST ilike filter inside an .or() string: commas and
// parens would break the filter grammar, so strip them from user input.
function sanitize(term: string): string {
  return term.replace(/[(),*]/g, ' ').trim();
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const q = sanitize(sp.get('q') || '');
  const nsn = sanitize(sp.get('nsn') || '');
  const fsc = sanitize(sp.get('fsc') || '');
  const sort = sp.get('sort') || 'deadline'; // 'deadline' (soonest) | 'newest'
  const includeExpired = sp.get('includeExpired') === '1';
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10) || 50, 100);
  const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0);

  const sb = getSupabase();
  let query = sb.from('dibbs_rfqs').select('*', { count: 'exact' });

  // Keyword → match description OR solicitation_number (users paste either).
  if (q) query = query.or(`description.ilike.%${q}%,solicitation_number.ilike.%${q}%`);
  // NSN / FSC are exact-prefix (indexed) — a partial NSN like "8415" should match.
  if (nsn) query = query.ilike('nsn', `${nsn}%`);
  if (fsc) query = query.ilike('fsc', `${fsc}%`);

  // Hide already-closed RFQs by default (deadline in the past). Rows with a null
  // return_by_date are kept — we don't know they're expired.
  if (!includeExpired) {
    const today = new Date().toISOString().slice(0, 10);
    query = query.or(`return_by_date.gte.${today},return_by_date.is.null`);
  }

  if (sort === 'newest') {
    query = query.order('scraped_at', { ascending: false, nullsFirst: false });
  } else {
    // soonest deadline first; nulls last
    query = query.order('return_by_date', { ascending: true, nullsFirst: false });
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const rows = (data || []).map((r: Record<string, unknown>) => ({
    solicitationNumber: r.solicitation_number,
    nsn: r.nsn,
    fsc: r.fsc,
    description: r.description,
    quantity: r.quantity,
    unitOfIssue: r.unit_of_issue,
    returnByDate: r.return_by_date,
    buyer: r.buyer,
    status: r.status,
    url: r.url,
    pdfUrl: r.pdf_url,
  }));

  return NextResponse.json({
    success: true,
    total: count ?? rows.length,
    count: rows.length,
    offset,
    limit,
    hasMore: (count ?? 0) > offset + rows.length,
    rfqs: rows,
  });
}
