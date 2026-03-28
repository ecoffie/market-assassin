/**
 * Teaming Intelligence API
 *
 * GET /api/teaming-intel/primes?naics=541512&state=FL
 * GET /api/teaming-intel/subs-for?prime_uei=xxx
 * GET /api/teaming-intel/primes-for?sub_uei=xxx
 * GET /api/teaming-intel/network?naics=541512&state=FL
 * GET /api/teaming-intel/opportunities?sub_uei=xxx&naics=541512
 *
 * Returns prime→sub teaming relationships
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  searchSubawards,
  getSubsForPrime,
  getPrimesForSub,
  buildTeamingNetwork,
  findTeamingOpportunities
} from '@/lib/sam/subaward-api';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get('mode') || 'search';
  const naics = searchParams.get('naics');
  const state = searchParams.get('state');
  const primeUei = searchParams.get('prime_uei');
  const subUei = searchParams.get('sub_uei');
  const limit = parseInt(searchParams.get('limit') || '50');

  try {
    switch (mode) {
      // Get subs for a prime
      case 'subs-for': {
        if (!primeUei) {
          return NextResponse.json({
            success: false,
            error: 'prime_uei parameter is required'
          }, { status: 400 });
        }

        const subs = await getSubsForPrime(primeUei);

        return NextResponse.json({
          success: true,
          mode: 'subs-for',
          primeUei,
          totalSubs: subs.length,
          totalSubawardValue: subs.reduce((sum, s) => sum + s.totalSubawardValue, 0),
          subs: subs.slice(0, limit).map(s => ({
            subUei: s.subUei,
            subName: s.subName,
            totalValue: s.totalSubawardValue,
            subawardCount: s.subawardCount,
            naicsCodes: s.naicsCodes,
            mostRecentDate: s.mostRecentDate
          }))
        });
      }

      // Get primes for a sub
      case 'primes-for': {
        if (!subUei) {
          return NextResponse.json({
            success: false,
            error: 'sub_uei parameter is required'
          }, { status: 400 });
        }

        const primes = await getPrimesForSub(subUei);

        return NextResponse.json({
          success: true,
          mode: 'primes-for',
          subUei,
          totalPrimes: primes.length,
          totalReceived: primes.reduce((sum, p) => sum + p.totalSubawardValue, 0),
          primes: primes.slice(0, limit).map(p => ({
            primeUei: p.primeUei,
            primeName: p.primeName,
            totalValue: p.totalSubawardValue,
            subawardCount: p.subawardCount,
            naicsCodes: p.naicsCodes,
            mostRecentDate: p.mostRecentDate
          }))
        });
      }

      // Build teaming network for NAICS/state
      case 'network': {
        if (!naics) {
          return NextResponse.json({
            success: false,
            error: 'naics parameter is required'
          }, { status: 400 });
        }

        const network = await buildTeamingNetwork(naics, state || undefined);

        return NextResponse.json({
          success: true,
          mode: 'network',
          naics,
          state,
          topPrimes: network.primes,
          topSubs: network.subs,
          topRelationships: network.relationships.slice(0, 20).map(r => ({
            prime: { uei: r.primeUei, name: r.primeName },
            sub: { uei: r.subUei, name: r.subName },
            totalValue: r.totalSubawardValue,
            contracts: r.subawardCount
          }))
        });
      }

      // Find teaming opportunities for a sub
      case 'opportunities': {
        if (!subUei || !naics) {
          return NextResponse.json({
            success: false,
            error: 'sub_uei and naics parameters are required'
          }, { status: 400 });
        }

        const opportunities = await findTeamingOpportunities(
          subUei,
          naics,
          state || undefined
        );

        // Separate existing vs new
        const existing = opportunities.filter(o => o.alreadyWorksWith);
        const newOpps = opportunities.filter(o => !o.alreadyWorksWith);

        return NextResponse.json({
          success: true,
          mode: 'opportunities',
          subUei,
          naics,
          state,
          existingRelationships: existing.length,
          newOpportunities: newOpps.length,
          recommendations: newOpps.slice(0, 10).map(o => ({
            primeUei: o.primeUei,
            primeName: o.primeName,
            totalSubawardValue: o.totalSubawardValue,
            subsUsed: o.subsUsed,
            whyRecommended: `Uses ${o.subsUsed} subs, $${(o.totalSubawardValue / 1e6).toFixed(1)}M subawarded`
          })),
          alreadyTeaming: existing.slice(0, 5).map(o => ({
            primeUei: o.primeUei,
            primeName: o.primeName
          }))
        });
      }

      // Basic search
      case 'search':
      default: {
        const result = await searchSubawards({
          naicsCode: naics || undefined,
          state: state || undefined,
          primeAwardeeUei: primeUei || undefined,
          subAwardeeUei: subUei || undefined,
          size: limit
        });

        return NextResponse.json({
          success: true,
          mode: 'search',
          params: { naics, state, primeUei, subUei },
          totalCount: result.totalCount,
          fromCache: result.fromCache,
          subawards: result.subawards.map(s => ({
            primeAwardPiid: s.primeAwardPiid,
            prime: { uei: s.primeAwardeeUei, name: s.primeAwardeeName },
            sub: { uei: s.subAwardeeUei, name: s.subAwardeeName },
            amount: s.subAwardAmount,
            date: s.subAwardDate,
            naics: s.naicsCode,
            location: {
              city: s.placeOfPerformanceCity,
              state: s.placeOfPerformanceState
            }
          }))
        });
      }
    }
  } catch (error) {
    console.error('[Teaming Intel Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch teaming data'
    }, { status: 500 });
  }
}
