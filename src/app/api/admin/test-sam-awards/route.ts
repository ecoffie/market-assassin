/**
 * Admin endpoint to test SAM.gov Contract Awards API
 *
 * GET /api/admin/test-sam-awards?password=xxx&naics=541512
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  searchContractAwards,
  getExpiringContracts,
  getLowCompetitionContracts,
  getRateLimitStatus
} from '@/lib/sam';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  // Auth check
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const naics = searchParams.get('naics') || '541512';
  const piid = searchParams.get('piid');
  const uei = searchParams.get('uei');
  const mode = searchParams.get('mode') || 'search'; // search, expiring, low-competition

  try {
    const startTime = Date.now();
    let result;

    switch (mode) {
      case 'expiring':
        // Get contracts expiring in next 12 months
        result = await getExpiringContracts(naics, 12);
        break;

      case 'low-competition':
        // Get low competition contracts
        result = await getLowCompetitionContracts(naics, 12);
        break;

      case 'search':
      default:
        // Basic search
        result = await searchContractAwards({
          naicsCode: naics,
          vendorUei: uei || undefined,
          size: 25
        });
        break;
    }

    const elapsed = Date.now() - startTime;

    // Get rate limit status
    const rateLimits = getRateLimitStatus();

    return NextResponse.json({
      success: true,
      mode,
      params: { naics, piid, uei },
      elapsedMs: elapsed,
      rateLimits,
      result,
      summary: Array.isArray(result)
        ? {
            count: result.length,
            sampleTitles: result.slice(0, 3).map((c) => ({
              piid: c.piid,
              recipient: c.recipientName,
              value: c.currentTotalValueOfAward,
              bids: c.numberOfOffersReceived,
              expires: c.periodOfPerformanceCurrentEndDate
            }))
          }
        : {
            count: result.contracts?.length || 0,
            totalCount: result.totalCount,
            fromCache: result.fromCache,
            sampleContracts: result.contracts?.slice(0, 3).map((c) => ({
              piid: c.piid,
              recipient: c.recipientName,
              agency: c.awardingAgencyName,
              value: c.currentTotalValueOfAward,
              bids: c.numberOfOffersReceived,
              competition: c.competitionLevel,
              expires: c.periodOfPerformanceCurrentEndDate,
              daysLeft: c.daysUntilExpiration
            }))
          }
    });

  } catch (error) {
    console.error('[Test SAM Awards Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      rateLimits: getRateLimitStatus()
    }, { status: 500 });
  }
}
