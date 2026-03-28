/**
 * Admin endpoint to test SAM.gov Entity Management API
 *
 * GET /api/admin/test-sam-entity?password=xxx&name=Booz
 * GET /api/admin/test-sam-entity?password=xxx&uei=xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  searchEntities,
  getEntityByUEI,
  verifySAMStatus,
  getCertifications,
  findTeamingPartners
} from '@/lib/sam/entity-api';
import { getRateLimitStatus } from '@/lib/sam/utils';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  // Auth check
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const name = searchParams.get('name');
  const uei = searchParams.get('uei');
  const naics = searchParams.get('naics');
  const state = searchParams.get('state');
  const mode = searchParams.get('mode') || 'search'; // search, verify, teaming

  try {
    const startTime = Date.now();
    let result;

    switch (mode) {
      case 'verify':
        // Verify SAM status
        if (!uei) {
          return NextResponse.json({
            success: false,
            error: 'uei parameter required for verify mode'
          }, { status: 400 });
        }
        result = await verifySAMStatus(uei);
        break;

      case 'teaming':
        // Find teaming partners
        if (!naics) {
          return NextResponse.json({
            success: false,
            error: 'naics parameter required for teaming mode'
          }, { status: 400 });
        }
        result = await findTeamingPartners(naics, undefined, state || undefined, 10);
        break;

      case 'certs':
        // Get certifications
        if (!uei) {
          return NextResponse.json({
            success: false,
            error: 'uei parameter required for certs mode'
          }, { status: 400 });
        }
        result = await getCertifications(uei);
        break;

      case 'search':
      default:
        // Basic search
        if (uei) {
          result = await getEntityByUEI(uei);
        } else {
          result = await searchEntities({
            legalBusinessName: name || undefined,
            naicsCode: naics || undefined,
            stateCode: state || undefined,
            registrationStatus: 'Active',
            size: 10
          });
        }
        break;
    }

    const elapsed = Date.now() - startTime;
    const rateLimits = getRateLimitStatus();

    return NextResponse.json({
      success: true,
      mode,
      params: { name, uei, naics, state },
      elapsedMs: elapsed,
      rateLimits,
      result,
      summary: Array.isArray(result)
        ? {
            count: result.length,
            sampleEntities: result.slice(0, 3).map((e) => ({
              name: e.legalBusinessName,
              uei: e.ueiSAM,
              state: e.physicalAddress?.stateOrProvince,
              certifications: [
                e.has8a && '8(a)',
                e.hasSDVOSB && 'SDVOSB',
                e.hasWOSB && 'WOSB',
                e.hasHUBZone && 'HUBZone'
              ].filter(Boolean)
            }))
          }
        : result && 'entities' in result
        ? {
            totalCount: result.totalCount,
            fromCache: result.fromCache,
            sampleEntities: result.entities.slice(0, 3).map((e) => ({
              name: e.legalBusinessName,
              uei: e.ueiSAM,
              state: e.physicalAddress?.stateOrProvince,
              status: e.registrationStatus
            }))
          }
        : { single: result }
    });

  } catch (error) {
    console.error('[Test SAM Entity Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      rateLimits: getRateLimitStatus()
    }, { status: 500 });
  }
}
