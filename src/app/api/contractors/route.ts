import { NextRequest, NextResponse } from 'next/server';
import {
  searchContractors,
  getDatabaseStats,
  getUniqueAgencies,
  getUniqueNAICS,
  getUniqueSources,
  ContractorSearchOptions
} from '@/lib/contractor-database';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // Check for special endpoints
  const action = searchParams.get('action');

  if (action === 'stats') {
    return NextResponse.json(getDatabaseStats());
  }

  if (action === 'agencies') {
    return NextResponse.json(getUniqueAgencies());
  }

  if (action === 'naics') {
    return NextResponse.json(getUniqueNAICS());
  }

  if (action === 'sources') {
    return NextResponse.json(getUniqueSources());
  }

  // Regular search
  const options: ContractorSearchOptions = {
    search: searchParams.get('search') || undefined,
    naics: searchParams.get('naics') || undefined,
    agency: searchParams.get('agency') || undefined,
    source: searchParams.get('source') || undefined,
    hasContact: searchParams.get('hasContact') === 'true' ? true :
                searchParams.get('hasContact') === 'false' ? false : undefined,
    hasEmail: searchParams.get('hasEmail') === 'true' ? true :
              searchParams.get('hasEmail') === 'false' ? false : undefined,
    minContractValue: searchParams.get('minContractValue')
      ? parseFloat(searchParams.get('minContractValue')!)
      : undefined,
    maxContractValue: searchParams.get('maxContractValue')
      ? parseFloat(searchParams.get('maxContractValue')!)
      : undefined,
    limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50,
    offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
    sortBy: (searchParams.get('sortBy') as 'company' | 'contract_value' | 'contract_count') || 'contract_value',
    sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc'
  };

  try {
    const results = searchContractors(options);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Contractor search error:', error);
    return NextResponse.json(
      { error: 'Failed to search contractors' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const options: ContractorSearchOptions = await request.json();
    const results = searchContractors(options);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Contractor search error:', error);
    return NextResponse.json(
      { error: 'Failed to search contractors' },
      { status: 500 }
    );
  }
}
