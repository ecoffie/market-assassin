import { NextRequest, NextResponse } from 'next/server';
import { getReportUsage, getContentUsage } from '@/lib/rate-limit';
import { cookies } from 'next/headers';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const emailCookie = cookieStore.get('ma_access_email')?.value;
  const emailParam = request.nextUrl.searchParams.get('email');
  const type = request.nextUrl.searchParams.get('type') || 'reports';
  const email = emailCookie || emailParam;

  if (!email) {
    return NextResponse.json({
      success: true,
      canGenerate: true,
      used: 0,
      limit: 50,
      remaining: 50,
    }, { headers: corsHeaders });
  }

  const usage = type === 'content'
    ? await getContentUsage(email)
    : await getReportUsage(email);

  return NextResponse.json({
    success: true,
    canGenerate: usage.remaining > 0,
    used: usage.used,
    limit: usage.limit,
    remaining: usage.remaining,
    resetDate: new Date(usage.resetAt * 1000).toISOString(),
  }, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { email: bodyEmail, type = 'reports' } = body;

  const cookieStore = await cookies();
  const emailCookie = cookieStore.get('ma_access_email')?.value;
  const email = emailCookie || bodyEmail;

  if (!email) {
    return NextResponse.json({
      success: true,
      canGenerate: true,
      used: 0,
      limit: 50,
      remaining: 50,
    }, { headers: corsHeaders });
  }

  const usage = type === 'content'
    ? await getContentUsage(email)
    : await getReportUsage(email);

  return NextResponse.json({
    success: true,
    canGenerate: usage.remaining > 0,
    used: usage.used,
    limit: usage.limit,
    remaining: usage.remaining,
    resetDate: new Date(usage.resetAt * 1000).toISOString(),
  }, { headers: corsHeaders });
}
