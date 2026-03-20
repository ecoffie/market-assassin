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

/**
 * Get usage stats for authenticated user
 * Returns report and content generation limits
 */
export async function GET(request: NextRequest) {
  // Get email from cookie or query param
  const cookieStore = await cookies();
  const emailCookie = cookieStore.get('ma_access_email')?.value;
  const emailParam = request.nextUrl.searchParams.get('email');
  const email = emailCookie || emailParam;

  if (!email) {
    return NextResponse.json({
      success: false,
      error: 'Email required',
      reports: { used: 0, limit: 50, remaining: 50 },
      content: { used: 0, limit: 10, remaining: 10 },
    }, { headers: corsHeaders });
  }

  const [reportUsage, contentUsage] = await Promise.all([
    getReportUsage(email),
    getContentUsage(email),
  ]);

  return NextResponse.json({
    success: true,
    email,
    reports: {
      used: reportUsage.used,
      limit: reportUsage.limit,
      remaining: reportUsage.remaining,
      resetDate: new Date(reportUsage.resetAt * 1000).toISOString(),
    },
    content: {
      used: contentUsage.used,
      limit: contentUsage.limit,
      remaining: contentUsage.remaining,
      resetDate: new Date(contentUsage.resetAt * 1000).toISOString(),
    },
    // Legacy fields for backwards compatibility
    used: reportUsage.used,
    limit: reportUsage.limit,
    remaining: reportUsage.remaining,
    canGenerate: reportUsage.remaining > 0,
  }, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { action, email: bodyEmail, type = 'reports' } = body;

  // Get email from cookie or body
  const cookieStore = await cookies();
  const emailCookie = cookieStore.get('ma_access_email')?.value;
  const email = emailCookie || bodyEmail;

  if (!email) {
    return NextResponse.json({
      success: false,
      error: 'Email required',
    }, { headers: corsHeaders, status: 400 });
  }

  if (action === 'check') {
    const usage = type === 'content'
      ? await getContentUsage(email)
      : await getReportUsage(email);

    return NextResponse.json({
      success: true,
      used: usage.used,
      limit: usage.limit,
      remaining: usage.remaining,
      canGenerate: usage.remaining > 0,
      resetDate: new Date(usage.resetAt * 1000).toISOString(),
    }, { headers: corsHeaders });
  }

  // For increment/reset actions, just return current usage
  // (actual incrementing is done by the generate endpoints)
  const reportUsage = await getReportUsage(email);
  return NextResponse.json({
    success: true,
    used: reportUsage.used,
    limit: reportUsage.limit,
    remaining: reportUsage.remaining,
    canGenerate: reportUsage.remaining > 0,
  }, { headers: corsHeaders });
}
