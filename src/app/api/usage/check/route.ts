import { NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  return NextResponse.json({
    success: true,
    canGenerate: true,
    used: 0,
    limit: 999,
    remaining: 999
  }, { headers: corsHeaders });
}

export async function POST() {
  return NextResponse.json({
    success: true,
    canGenerate: true,
    used: 0,
    limit: 999,
    remaining: 999
  }, { headers: corsHeaders });
}
