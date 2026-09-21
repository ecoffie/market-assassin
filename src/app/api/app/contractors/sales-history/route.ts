import { NextRequest, NextResponse } from 'next/server';
import { getContractorSalesHistory } from '@/lib/contractor-sales-history';
import { getBqContractorHistory } from '@/lib/bigquery/recipients';
import { getContractorHistoryByUei } from '@/lib/contractor/history-by-uei';
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

  // Phase 1: UEI present → shared Map/MCP history service is the sole award
  // authority. Never load contractors.json / getContractorSalesHistory.
  if (uei?.trim()) {
    const shared = await getContractorHistoryByUei({
      uei: uei.trim(),
      coldPolicy: 'always',
      actor: email || undefined,
    });

    if (shared.resolution === 'malformed') {
      return NextResponse.json(
        { success: false, error: shared.detail || 'Invalid UEI' },
        { status: 400 },
      );
    }
    if (shared.resolution === 'unavailable') {
      return NextResponse.json(
        {
          success: false,
          error: shared.detail || 'Warehouse history temporarily unavailable',
          degraded: true,
        },
        { status: 503 },
      );
    }
    // found + registered_zero both carry a history payload (empty series for zero).
    if (shared.history) {
      return NextResponse.json(shared.history);
    }
    // not_found (and any history-less terminal that is not unavailable/malformed)
    return NextResponse.json(
      { success: false, error: 'Contractor not found' },
      { status: 404 },
    );
  }

  // Name/slug path (no UEI): legacy JSON first, then slug-scoped BQ — unchanged.
  let history = await getContractorSalesHistory({
    company,
    publicView: false,
    awardLimit: 50,
  });

  const hasSeries = !!(
    history &&
    Array.isArray((history as { series?: unknown[] }).series) &&
    (history as { series: unknown[] }).series.length > 0
  );
  if ((!history || !hasSeries) && slug) {
    const bq = await getBqContractorHistory({ slug, liveBq: true });
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
