import { NextRequest, NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  // Return unlimited usage for now
  return NextResponse.json({
    success: true,
    used: 0,
    limit: 999,
    remaining: 999,
    resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  if (action === 'check' || action === 'increment' || action === 'reset') {
    return NextResponse.json({
      success: true,
      used: 0,
      limit: 999,
      remaining: 999,
      canGenerate: true
    }, { headers: corsHeaders });
  }

  return NextResponse.json({
    success: true,
    used: 0,
    limit: 999,
    remaining: 999
  }, { headers: corsHeaders });
}
