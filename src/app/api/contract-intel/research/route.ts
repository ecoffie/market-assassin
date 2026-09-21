/**
 * Contract Intelligence API - Research
 *
 * GET /api/contract-intel/research?piid=xxx
 *
 * Returns full contract history including all modifications
 */

import { NextRequest, NextResponse } from 'next/server';
import { getContractFamily } from '@/lib/sam';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const piid = searchParams.get('piid');

  if (!piid) {
    return NextResponse.json({
      success: false,
      error: 'piid parameter is required'
    }, { status: 400 });
  }

  try {
    const family = await getContractFamily(piid);

    if (!family) {
      return NextResponse.json({
        success: false,
        error: 'Contract not found'
      }, { status: 404 });
    }

    // Analyze the contract
    const analysis = {
      troubleIndicator: family.totalModifications >= 4 ? 'HIGH' :
                       family.totalModifications >= 2 ? 'MEDIUM' : 'LOW',
      incumbentStrength: family.baseAward.numberOfOffersReceived <= 2 ? 'VULNERABLE' :
                        family.baseAward.numberOfOffersReceived <= 4 ? 'MODERATE' : 'STRONG',
      valueGrowth: family.totalObligated > family.baseAward.currentTotalValueOfAward * 1.5 ?
                   'SIGNIFICANT_GROWTH' : 'NORMAL',
      insights: [] as string[]
    };

    // Generate insights
    if (family.totalModifications >= 4) {
      analysis.insights.push(`Contract has ${family.totalModifications} modifications - may indicate performance issues or scope changes`);
    }

    if (family.baseAward.competitionLevel === 'sole_source') {
      analysis.insights.push('Original award was sole source - incumbent may be vulnerable on recompete');
    }

    if (family.baseAward.numberOfOffersReceived <= 2) {
      analysis.insights.push(`Only ${family.baseAward.numberOfOffersReceived} bidder(s) on original award - low competition market`);
    }

    const valueIncrease = family.totalObligated - family.baseAward.currentTotalValueOfAward;
    if (valueIncrease > 0) {
      analysis.insights.push(`Contract value increased by $${valueIncrease.toLocaleString()} through modifications`);
    }

    return NextResponse.json({
      success: true,
      piid,
      baseAward: {
        piid: family.baseAward.piid,
        title: family.baseAward.contractDescription,
        incumbent: {
          name: family.baseAward.recipientName,
          uei: family.baseAward.recipientUei
        },
        agency: family.baseAward.awardingAgencyName,
        subAgency: family.baseAward.awardingSubAgencyName,
        naics: family.baseAward.naicsCode,
        naicsDescription: family.baseAward.naicsDescription,
        originalValue: family.baseAward.currentTotalValueOfAward,
        bidsReceived: family.baseAward.numberOfOffersReceived,
        competitionType: family.baseAward.extentCompetedDescription,
        competitionLevel: family.baseAward.competitionLevel,
        contractType: family.baseAward.typeOfContractPricing,
        startDate: family.baseAward.periodOfPerformanceStartDate,
        originalEndDate: family.baseAward.periodOfPerformanceCurrentEndDate,
        awardDate: family.baseAward.actionDate
      },
      modifications: family.modifications.map(mod => ({
        modNumber: mod.modificationNumber,
        date: mod.actionDate,
        value: mod.totalObligation,
        description: mod.contractDescription,
        newEndDate: mod.periodOfPerformanceCurrentEndDate
      })),
      summary: {
        totalModifications: family.totalModifications,
        totalObligated: family.totalObligated,
        currentEndDate: family.latestEndDate,
        daysUntilExpiration: family.baseAward.daysUntilExpiration
      },
      analysis
    });

  } catch (error) {
    console.error('[Contract Intel Research Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch contract details'
    }, { status: 500 });
  }
}
