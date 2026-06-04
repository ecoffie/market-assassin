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

  // BQ FALLBACK: the Contractors panel now lists all 317K BQ recipients, but
  // most aren't in the static DB → getContractorSalesHistory returns null
  // ("Contractor not found" — Eric saw this on EXCELL CONSTRUCTION CORP).
  // When a UEI/slug is provided (BQ rows carry it), build history from BQ —
  // the same source the list came from.
  if (!history && (uei || slug)) {
    history = await getBqContractorHistory({ uei, slug });
  }

  if (!history) {
    return NextResponse.json(
      { success: false, error: 'Contractor not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(history);
}
