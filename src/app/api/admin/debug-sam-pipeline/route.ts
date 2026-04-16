/**
 * Admin: Debug SAM.gov Pipeline
 *
 * GET /api/admin/debug-sam-pipeline?password=...&naics=541512
 *
 * Tests the full sam-gov.ts pipeline and returns comprehensive debug info.
 */

import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// Helper: Get date N days ago in MM/dd/yyyy format for SAM.gov
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

function getTodayDate(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const naics = searchParams.get('naics') || '541512';
  const mode = searchParams.get('mode') || 'pipeline'; // 'pipeline' or 'direct'

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SAM_API_KEY = (process.env.SAM_API_KEY || '').trim();
  const naicsCodes = naics.split(',').map(n => n.trim());
  const postedFrom = getDateDaysAgo(30);
  const postedTo = getTodayDate();

  const debugInfo = {
    timestamp: new Date().toISOString(),
    keyPresent: !!SAM_API_KEY,
    keyPrefix: SAM_API_KEY ? SAM_API_KEY.substring(0, 15) + '...' : 'NO KEY',
    keyLength: SAM_API_KEY?.length || 0,
    inputNaics: naicsCodes,
    postedFrom,
    postedTo,
    mode,
  };

  console.log('[debug-sam-pipeline] Starting test with:', JSON.stringify(debugInfo));

  // Test with DIRECT fetch to isolate the issue
  const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2';

  try {
    const startTime = Date.now();

    // Build URL exactly like sam-gov.ts does
    const baseParams = new URLSearchParams();
    baseParams.set('limit', '10');
    baseParams.set('postedFrom', postedFrom);
    baseParams.set('postedTo', postedTo);
    baseParams.set('api_key', SAM_API_KEY);
    baseParams.set('naics', naicsCodes[0]);

    const url = `${SAM_API_BASE}/search?${baseParams.toString()}`;
    const urlForLog = url.replace(SAM_API_KEY, 'SAM-REDACTED');

    console.log('[debug-sam-pipeline] Built URL:', urlForLog);
    console.log('[debug-sam-pipeline] Full params:', Object.fromEntries(baseParams.entries()));

    // Make the fetch directly (same as sam-gov.ts does)
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    const elapsed = Date.now() - startTime;
    console.log('[debug-sam-pipeline] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({
        success: false,
        debug: debugInfo,
        url: urlForLog,
        status: response.status,
        error: errorText.substring(0, 500),
      });
    }

    const responseText = await response.text();
    console.log('[debug-sam-pipeline] Response length:', responseText.length);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr) {
      return NextResponse.json({
        success: false,
        debug: debugInfo,
        url: urlForLog,
        error: 'JSON parse failed',
        responsePreview: responseText.substring(0, 500),
      });
    }

    const opps = data.opportunitiesData || [];

    return NextResponse.json({
      success: true,
      debug: debugInfo,
      elapsed: `${elapsed}ms`,
      url: urlForLog,
      result: {
        totalRecords: data.totalRecords || 0,
        opportunitiesReturned: opps.length,
        sampleTitles: opps.slice(0, 3).map((o: { title?: string; naicsCode?: string; noticeId?: string }) => ({
          title: o.title?.substring(0, 60),
          naicsCode: o.naicsCode,
          noticeId: o.noticeId,
        })),
      },
    });
  } catch (err) {
    console.error('[debug-sam-pipeline] Error:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      debug: debugInfo,
    }, { status: 500 });
  }
}
