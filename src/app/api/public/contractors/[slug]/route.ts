import { NextResponse } from 'next/server';
import {
  findContractorBySlug,
  getContractorSalesHistory,
} from '@/lib/contractor-sales-history';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const contractor = findContractorBySlug(slug);

  if (!contractor) {
    return NextResponse.json(
      { success: false, error: 'Contractor not found' },
      { status: 404 }
    );
  }

  const history = await getContractorSalesHistory({
    company: contractor.company,
    publicView: true,
    awardLimit: 5,
  });

  if (!history) {
    return NextResponse.json(
      { success: false, error: 'Contractor not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(history);
}
