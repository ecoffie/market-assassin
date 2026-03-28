/**
 * Contract Intelligence API - Expiring Contracts
 *
 * GET /api/contract-intel/expiring?naics=541512&months=12&competition=low
 *
 * Returns contracts expiring within the specified timeframe
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getExpiringContracts,
  getLowCompetitionContracts,
  ContractAward
} from '@/lib/sam';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const naics = searchParams.get('naics');
  const months = parseInt(searchParams.get('months') || '12');
  const competition = searchParams.get('competition'); // 'low', 'sole_source', 'all'
  const state = searchParams.get('state');
  const limit = parseInt(searchParams.get('limit') || '50');

  if (!naics) {
    return NextResponse.json({
      success: false,
      error: 'naics parameter is required'
    }, { status: 400 });
  }

  try {
    let contracts: ContractAward[];

    if (competition === 'low') {
      contracts = await getLowCompetitionContracts(naics, months);
    } else {
      contracts = await getExpiringContracts(naics, months);
    }

    // Filter by competition level if specified
    if (competition === 'sole_source') {
      contracts = contracts.filter(c => c.competitionLevel === 'sole_source');
    }

    // Filter by state if specified
    if (state) {
      contracts = contracts.filter(c =>
        c.placeOfPerformanceState?.toUpperCase() === state.toUpperCase()
      );
    }

    // Apply limit
    contracts = contracts.slice(0, limit);

    // Calculate summary stats
    const totalValue = contracts.reduce((sum, c) => sum + c.currentTotalValueOfAward, 0);
    const avgBids = contracts.length > 0
      ? contracts.reduce((sum, c) => sum + c.numberOfOffersReceived, 0) / contracts.length
      : 0;
    const soleSourceCount = contracts.filter(c => c.competitionLevel === 'sole_source').length;
    const lowCompCount = contracts.filter(c => c.competitionLevel === 'low').length;
    const urgentCount = contracts.filter(c => c.daysUntilExpiration && c.daysUntilExpiration <= 90).length;

    return NextResponse.json({
      success: true,
      params: { naics, months, competition, state, limit },
      summary: {
        totalContracts: contracts.length,
        totalValue,
        avgBidsPerContract: Math.round(avgBids * 10) / 10,
        soleSourceContracts: soleSourceCount,
        lowCompetitionContracts: lowCompCount,
        urgentContracts: urgentCount
      },
      contracts: contracts.map(c => ({
        piid: c.piid,
        title: c.contractDescription,
        incumbent: {
          name: c.recipientName,
          uei: c.recipientUei
        },
        agency: c.awardingAgencyName,
        subAgency: c.awardingSubAgencyName,
        naics: c.naicsCode,
        value: c.currentTotalValueOfAward,
        potentialValue: c.potentialTotalValueOfAward,
        expirationDate: c.periodOfPerformanceCurrentEndDate,
        daysUntilExpiration: c.daysUntilExpiration,
        bidsReceived: c.numberOfOffersReceived,
        competitionLevel: c.competitionLevel,
        competitionType: c.extentCompetedDescription,
        location: {
          city: c.placeOfPerformanceCity,
          state: c.placeOfPerformanceState,
          zip: c.placeOfPerformanceZip
        }
      }))
    });

  } catch (error) {
    console.error('[Contract Intel Expiring Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch expiring contracts'
    }, { status: 500 });
  }
}
