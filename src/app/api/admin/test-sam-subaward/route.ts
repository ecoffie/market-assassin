/**
 * Admin endpoint to test SAM.gov Subaward Reporting API
 *
 * GET /api/admin/test-sam-subaward?password=xxx&prime_uei=xxx
 * GET /api/admin/test-sam-subaward?password=xxx&sub_uei=xxx
 * GET /api/admin/test-sam-subaward?password=xxx&naics=541512&state=FL
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  searchSubawards,
  getSubsForPrime,
  getPrimesForSub,
  buildTeamingNetwork,
  findTeamingOpportunities
} from '@/lib/sam/subaward-api';
import { getRateLimitStatus } from '@/lib/sam/utils';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  // Auth check
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const primeUei = searchParams.get('prime_uei');
  const subUei = searchParams.get('sub_uei');
  const naics = searchParams.get('naics');
  const state = searchParams.get('state');
  const mode = searchParams.get('mode') || 'auto'; // auto, subs-for, primes-for, network, opportunities, search

  try {
    const startTime = Date.now();
    let result;
    let actualMode = mode;

    // Auto-detect mode based on parameters
    if (mode === 'auto') {
      if (primeUei && !subUei) {
        actualMode = 'subs-for';
      } else if (subUei && !primeUei && !naics) {
        actualMode = 'primes-for';
      } else if (subUei && naics) {
        actualMode = 'opportunities';
      } else if (naics) {
        actualMode = 'network';
      } else {
        actualMode = 'search';
      }
    }

    switch (actualMode) {
      case 'subs-for': {
        if (!primeUei) {
          return NextResponse.json({
            success: false,
            error: 'prime_uei parameter required for subs-for mode'
          }, { status: 400 });
        }

        const subs = await getSubsForPrime(primeUei);
        result = {
          primeUei,
          totalSubs: subs.length,
          totalSubawardValue: subs.reduce((sum, s) => sum + s.totalSubawardValue, 0),
          subs: subs.slice(0, 10).map(s => ({
            subUei: s.subUei,
            subName: s.subName,
            totalValue: s.totalSubawardValue,
            subawardCount: s.subawardCount,
            naicsCodes: s.naicsCodes.slice(0, 3),
            mostRecentDate: s.mostRecentDate
          }))
        };
        break;
      }

      case 'primes-for': {
        if (!subUei) {
          return NextResponse.json({
            success: false,
            error: 'sub_uei parameter required for primes-for mode'
          }, { status: 400 });
        }

        const primes = await getPrimesForSub(subUei);
        result = {
          subUei,
          totalPrimes: primes.length,
          totalReceived: primes.reduce((sum, p) => sum + p.totalSubawardValue, 0),
          primes: primes.slice(0, 10).map(p => ({
            primeUei: p.primeUei,
            primeName: p.primeName,
            totalValue: p.totalSubawardValue,
            subawardCount: p.subawardCount,
            naicsCodes: p.naicsCodes.slice(0, 3),
            mostRecentDate: p.mostRecentDate
          }))
        };
        break;
      }

      case 'network': {
        if (!naics) {
          return NextResponse.json({
            success: false,
            error: 'naics parameter required for network mode'
          }, { status: 400 });
        }

        const network = await buildTeamingNetwork(naics, state || undefined);
        result = {
          naics,
          state,
          topPrimes: network.primes.slice(0, 5).map(p => ({
            name: p.name,
            uei: p.uei,
            subsUsed: p.subsUsed,
            totalSubawarded: p.totalSubawarded
          })),
          topSubs: network.subs.slice(0, 5).map(s => ({
            name: s.name,
            uei: s.uei,
            primesWorkedWith: s.primesWorkedWith,
            totalReceived: s.totalReceived
          })),
          topRelationships: network.relationships.slice(0, 5).map(r => ({
            prime: r.primeName,
            sub: r.subName,
            totalValue: r.totalSubawardValue,
            contracts: r.subawardCount
          }))
        };
        break;
      }

      case 'opportunities': {
        if (!subUei || !naics) {
          return NextResponse.json({
            success: false,
            error: 'sub_uei and naics parameters required for opportunities mode'
          }, { status: 400 });
        }

        const opportunities = await findTeamingOpportunities(
          subUei,
          naics,
          state || undefined
        );

        const existing = opportunities.filter(o => o.alreadyWorksWith);
        const newOpps = opportunities.filter(o => !o.alreadyWorksWith);

        result = {
          subUei,
          naics,
          state,
          existingRelationships: existing.length,
          newOpportunities: newOpps.length,
          recommendations: newOpps.slice(0, 5).map(o => ({
            primeUei: o.primeUei,
            primeName: o.primeName,
            totalSubawardValue: o.totalSubawardValue,
            subsUsed: o.subsUsed,
            whyRecommended: `Uses ${o.subsUsed} subs, $${(o.totalSubawardValue / 1e6).toFixed(1)}M subawarded`
          })),
          alreadyTeaming: existing.slice(0, 3).map(o => ({
            primeUei: o.primeUei,
            primeName: o.primeName
          }))
        };
        break;
      }

      case 'search':
      default: {
        const searchResult = await searchSubawards({
          primeAwardeeUei: primeUei || undefined,
          subAwardeeUei: subUei || undefined,
          naicsCode: naics || undefined,
          state: state || undefined,
          size: 10
        });

        result = {
          totalCount: searchResult.totalCount,
          fromCache: searchResult.fromCache,
          subawards: searchResult.subawards.map(s => ({
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
        };
        break;
      }
    }

    const elapsed = Date.now() - startTime;
    const rateLimits = getRateLimitStatus();

    return NextResponse.json({
      success: true,
      mode: actualMode,
      params: { primeUei, subUei, naics, state },
      elapsedMs: elapsed,
      rateLimits,
      result
    });

  } catch (error) {
    console.error('[Test Subaward Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      rateLimits: getRateLimitStatus()
    }, { status: 500 });
  }
}
