import { NextResponse } from 'next/server';
import agenciesData from '@/data/agencies/index.json';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle OPTIONS preflight request
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// GET endpoint to return list of agencies
export async function GET() {
  try {
    // Extract agency names from the index
    const agencyNames = Object.keys(agenciesData.agencies);

    return NextResponse.json({
      success: true,
      agencies: agencyNames,
      count: agencyNames.length
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Error fetching agencies:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch agencies'
    }, { status: 500, headers: corsHeaders });
  }
}
