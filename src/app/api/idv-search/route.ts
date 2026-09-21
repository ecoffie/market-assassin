import { NextRequest, NextResponse } from 'next/server';
import { searchIDVContracts, IDVSearchOptions } from '@/lib/idv-search';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const options: IDVSearchOptions = {
    naicsCode: searchParams.get('naicsCode') || undefined,
    pscCode: searchParams.get('pscCode') || undefined,
    agency: searchParams.get('agency') || undefined,
    minValue: searchParams.get('minValue') ? parseInt(searchParams.get('minValue')!) : undefined,
    dateFrom: searchParams.get('dateFrom') || undefined,
    dateTo: searchParams.get('dateTo') || undefined,
    state: searchParams.get('state') || undefined,
    stateFilterType: (searchParams.get('stateFilterType') as 'recipient' | 'pop') || 'recipient',
    limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50,
    page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1
  };

  try {
    const results = await searchIDVContracts(options);
    return NextResponse.json(results);
  } catch (error) {
    console.error('IDV Search error:', error);
    return NextResponse.json(
      { error: 'Failed to search IDV contracts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const options: IDVSearchOptions = await request.json();
    const results = await searchIDVContracts(options);
    return NextResponse.json(results);
  } catch (error) {
    console.error('IDV Search error:', error);
    return NextResponse.json(
      { error: 'Failed to search IDV contracts' },
      { status: 500 }
    );
  }
}
