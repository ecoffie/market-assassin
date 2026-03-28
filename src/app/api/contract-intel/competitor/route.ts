/**
 * Contract Intelligence API - Competitor Tracking
 *
 * GET /api/contract-intel/competitor?uei=xxx
 * GET /api/contract-intel/competitor?company=Booz+Allen
 *
 * Returns all contracts for a specific competitor
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getContractsByIncumbent,
  searchContractAwards,
  ContractAward
} from '@/lib/sam';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const uei = searchParams.get('uei');
  const company = searchParams.get('company');
  const naics = searchParams.get('naics');

  if (!uei && !company) {
    return NextResponse.json({
      success: false,
      error: 'Either uei or company parameter is required'
    }, { status: 400 });
  }

  try {
    let contracts: ContractAward[] = [];

    if (uei) {
      // Direct UEI lookup
      contracts = await getContractsByIncumbent(uei);
    } else if (company) {
      // Search by company name - need to search and filter
      const result = await searchContractAwards({
        naicsCode: naics || undefined,
        size: 100
      });

      contracts = result.contracts.filter(c =>
        c.recipientName.toLowerCase().includes(company.toLowerCase())
      );
    }

    // Filter by NAICS if specified
    if (naics) {
      contracts = contracts.filter(c =>
        c.naicsCode === naics || c.naicsCode.startsWith(naics)
      );
    }

    // Calculate competitor profile
    const totalValue = contracts.reduce((sum, c) => sum + c.currentTotalValueOfAward, 0);
    const avgContractValue = contracts.length > 0 ? totalValue / contracts.length : 0;

    // Group by agency
    const agencyBreakdown = contracts.reduce((acc, c) => {
      const agency = c.awardingAgencyName || 'Unknown';
      if (!acc[agency]) {
        acc[agency] = { count: 0, value: 0 };
      }
      acc[agency].count++;
      acc[agency].value += c.currentTotalValueOfAward;
      return acc;
    }, {} as Record<string, { count: number; value: number }>);

    // Group by NAICS
    const naicsBreakdown = contracts.reduce((acc, c) => {
      const code = c.naicsCode || 'Unknown';
      if (!acc[code]) {
        acc[code] = { count: 0, value: 0, description: c.naicsDescription };
      }
      acc[code].count++;
      acc[code].value += c.currentTotalValueOfAward;
      return acc;
    }, {} as Record<string, { count: number; value: number; description: string }>);

    // Find expiring contracts (recompete opportunities)
    const expiringContracts = contracts
      .filter(c => c.daysUntilExpiration && c.daysUntilExpiration <= 365 && c.daysUntilExpiration > 0)
      .sort((a, b) => (a.daysUntilExpiration || 999) - (b.daysUntilExpiration || 999));

    // Competition analysis
    const lowCompetitionWins = contracts.filter(c =>
      c.competitionLevel === 'sole_source' || c.competitionLevel === 'low'
    ).length;

    return NextResponse.json({
      success: true,
      competitor: {
        uei: uei || contracts[0]?.recipientUei || null,
        name: company || contracts[0]?.recipientName || 'Unknown'
      },
      profile: {
        totalContracts: contracts.length,
        totalValue,
        avgContractValue: Math.round(avgContractValue),
        lowCompetitionWins,
        lowCompetitionRate: contracts.length > 0
          ? Math.round((lowCompetitionWins / contracts.length) * 100)
          : 0
      },
      agencyPresence: Object.entries(agencyBreakdown)
        .map(([agency, data]) => ({
          agency,
          contracts: data.count,
          value: data.value
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
      naicsCapabilities: Object.entries(naicsBreakdown)
        .map(([code, data]) => ({
          naics: code,
          description: data.description,
          contracts: data.count,
          value: data.value
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
      recompeteOpportunities: expiringContracts.slice(0, 10).map(c => ({
        piid: c.piid,
        title: c.contractDescription,
        agency: c.awardingAgencyName,
        naics: c.naicsCode,
        value: c.currentTotalValueOfAward,
        expirationDate: c.periodOfPerformanceCurrentEndDate,
        daysUntilExpiration: c.daysUntilExpiration,
        bidsReceived: c.numberOfOffersReceived,
        competitionLevel: c.competitionLevel
      })),
      recentContracts: contracts
        .sort((a, b) => (b.actionDate || '').localeCompare(a.actionDate || ''))
        .slice(0, 20)
        .map(c => ({
          piid: c.piid,
          title: c.contractDescription,
          agency: c.awardingAgencyName,
          naics: c.naicsCode,
          value: c.currentTotalValueOfAward,
          awardDate: c.actionDate,
          endDate: c.periodOfPerformanceCurrentEndDate,
          bidsReceived: c.numberOfOffersReceived
        }))
    });

  } catch (error) {
    console.error('[Contract Intel Competitor Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch competitor data'
    }, { status: 500 });
  }
}
