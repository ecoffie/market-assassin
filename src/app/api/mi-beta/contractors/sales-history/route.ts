import { NextRequest, NextResponse } from 'next/server';
import { getContractorSalesHistory } from '@/lib/contractor-sales-history';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const company = searchParams.get('company');

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  if (!company?.trim()) {
    return NextResponse.json(
      { success: false, error: 'Company name is required' },
      { status: 400 }
    );
  }

  const history = await getContractorSalesHistory({
    company,
    publicView: false,
    awardLimit: 50,
  });

  if (!history) {
    return NextResponse.json(
      { success: false, error: 'Contractor not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(history);
}
