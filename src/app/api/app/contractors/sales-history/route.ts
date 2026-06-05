import { NextRequest, NextResponse } from 'next/server';
import { getContractorSalesHistory } from '@/lib/contractor-sales-history';
import { getBqContractorHistory } from '@/lib/bigquery/recipients';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const company = searchParams.get('company');
  const uei = searchParams.get('uei') || undefined;
  const slug = searchParams.get('slug') || undefined;

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  if (!company?.trim()) {
    return NextResponse.json(
      { success: false, error: 'Company name is required' },
      { status: 400 }
    );
  }

  // First try the static contractor DB (has SBLO contacts for the 2,768).
  let history = await getContractorSalesHistory({
    company,
    publicView: false,
    awardLimit: 50,
  });

  // BQ is the real source of award HISTORY. Use it when:
  //  (a) static returned nothing (most of the 317K BQ recipients), OR
  //  (b) static returned a row but with NO year-by-year series — the bug Eric
  //      hit: BL Harbert is in the static 2,768 (summary only, $10.1B/127) so
  //      the old code stopped there and showed "no cached awards", even though
  //      BQ has its full 11-year history. So: if there's no series and we have
  //      a uei/slug, build the real history from BQ.
  const hasSeries = !!(history && Array.isArray((history as { series?: unknown[] }).series) && (history as { series: unknown[] }).series.length > 0);
  if ((!history || !hasSeries) && (uei || slug)) {
    const bq = await getBqContractorHistory({ uei, slug });
    if (bq) history = bq;
  }

  if (!history) {
    return NextResponse.json(
      { success: false, error: 'Contractor not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(history);
}
