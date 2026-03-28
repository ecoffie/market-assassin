/**
 * Test USASpending API fallback
 *
 * GET /api/admin/test-usaspending?password=xxx&naics=541512
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchUSASpendingAwards, getUSASpendingAward } from '@/lib/sam/usaspending-fallback';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const naics = searchParams.get('naics') || '541512';
  const awardId = searchParams.get('award_id');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // If award_id provided, fetch single award details
    if (awardId) {
      const award = await getUSASpendingAward(awardId);

      if (!award) {
        return NextResponse.json({
          success: false,
          message: 'Award not found',
          awardId
        });
      }

      return NextResponse.json({
        success: true,
        source: 'USASpending',
        award: {
          piid: award.piid,
          recipientName: award.recipientName,
          numberOfOffersReceived: award.numberOfOffersReceived,
          competitionLevel: award.competitionLevel,
          extentCompeted: award.extentCompeted,
          extentCompetedDescription: award.extentCompetedDescription,
          naicsCode: award.naicsCode,
          totalObligation: award.totalObligation,
          periodOfPerformanceCurrentEndDate: award.periodOfPerformanceCurrentEndDate,
          daysUntilExpiration: award.daysUntilExpiration
        }
      });
    }

    // Search by NAICS
    const startTime = Date.now();
    const result = await searchUSASpendingAwards({
      naicsCode: naics,
      size: 10
    });
    const duration = Date.now() - startTime;

    // Extract key competition data
    const contractsSummary = result.contracts.map(c => ({
      piid: c.piid,
      recipientName: c.recipientName?.substring(0, 40),
      numberOfOffersReceived: c.numberOfOffersReceived,
      competitionLevel: c.competitionLevel,
      extentCompetedDescription: c.extentCompetedDescription,
      totalObligation: c.totalObligation,
      daysUntilExpiration: c.daysUntilExpiration
    }));

    // Stats
    const withBidCount = result.contracts.filter(c => c.numberOfOffersReceived > 0).length;
    const soleSource = result.contracts.filter(c => c.competitionLevel === 'sole_source').length;
    const lowCompetition = result.contracts.filter(c => c.competitionLevel === 'low').length;

    return NextResponse.json({
      success: true,
      source: 'USASpending',
      duration: `${duration}ms`,
      naics,
      totalCount: result.totalCount,
      returnedCount: result.contracts.length,
      stats: {
        withBidCount,
        soleSource,
        lowCompetition,
        bidCountPercentage: `${Math.round((withBidCount / result.contracts.length) * 100)}%`
      },
      contracts: contractsSummary
    });

  } catch (err) {
    console.error('[USASpending Test Error]', err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    }, { status: 500 });
  }
}
