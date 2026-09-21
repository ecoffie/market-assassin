import { NextRequest, NextResponse } from 'next/server';
import { checkReportRateLimit, checkContentRateLimit } from '@/lib/rate-limit';
import { cookies } from 'next/headers';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Increment usage counter for a user
 * Note: This is typically called by generate endpoints automatically
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { email: bodyEmail, type = 'reports' } = body;

  const cookieStore = await cookies();
  const emailCookie = cookieStore.get('ma_access_email')?.value;
  const email = emailCookie || bodyEmail;

  if (!email) {
    return NextResponse.json({
      success: false,
      error: 'Email required',
    }, { headers: corsHeaders, status: 400 });
  }

  // Increment by checking rate limit (which uses atomic INCR)
  const result = type === 'content'
    ? await checkContentRateLimit(email)
    : await checkReportRateLimit(email);

  return NextResponse.json({
    success: true,
    used: result.limit - result.remaining,
    limit: result.limit,
    remaining: result.remaining,
    canGenerate: result.allowed,
  }, { headers: corsHeaders });
}
