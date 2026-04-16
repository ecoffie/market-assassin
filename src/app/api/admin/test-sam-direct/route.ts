/**
 * Admin: Direct SAM.gov API Test
 *
 * GET /api/admin/test-sam-direct?password=...&naics=541512
 *
 * Bypasses all our pipeline code and calls SAM.gov API directly
 * to isolate where the issue is.
 */

import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const naics = searchParams.get('naics') || '541512';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SAM_API_KEY = (process.env.SAM_API_KEY || '').trim();

  // Build date range
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const formatDate = (d: Date) => {
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${month}/${day}/${d.getFullYear()}`;
  };

  const postedFrom = formatDate(thirtyDaysAgo);
  const postedTo = formatDate(today);

  // Build URL exactly like the working curl command
  const url = `https://api.sam.gov/opportunities/v2/search?api_key=${SAM_API_KEY}&limit=5&postedFrom=${postedFrom}&postedTo=${postedTo}&naics=${naics}`;

  const debugInfo = {
    keyPresent: !!SAM_API_KEY,
    keyPrefix: SAM_API_KEY ? SAM_API_KEY.substring(0, 15) + '...' : 'NO KEY',
    keyLength: SAM_API_KEY?.length || 0,
    url: url.replace(SAM_API_KEY, 'SAM-REDACTED'),
    postedFrom,
    postedTo,
    naics,
  };

  console.log('[test-sam-direct] Debug:', JSON.stringify(debugInfo));

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    const responseText = await response.text();
    console.log('[test-sam-direct] Response status:', response.status);
    console.log('[test-sam-direct] Response length:', responseText.length);
    console.log('[test-sam-direct] Response preview:', responseText.substring(0, 500));

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return NextResponse.json({
        error: 'Failed to parse JSON',
        status: response.status,
        responsePreview: responseText.substring(0, 500),
        debug: debugInfo,
      });
    }

    return NextResponse.json({
      success: true,
      status: response.status,
      totalRecords: data.totalRecords,
      count: data.opportunitiesData?.length || 0,
      firstTitle: data.opportunitiesData?.[0]?.title || 'none',
      debug: debugInfo,
    });
  } catch (err) {
    console.error('[test-sam-direct] Fetch error:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      debug: debugInfo,
    }, { status: 500 });
  }
}
