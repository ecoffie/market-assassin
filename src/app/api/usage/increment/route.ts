import { NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST() {
  return NextResponse.json({
    success: true,
    used: 1,
    limit: 999,
    remaining: 998
  }, { headers: corsHeaders });
}
