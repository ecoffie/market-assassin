/**
 * Entity Lookup API
 *
 * GET /api/entity-lookup?uei=xxx
 * GET /api/entity-lookup?name=xxx&state=FL
 * GET /api/entity-lookup?naics=541512&certs=SDVOSB
 *
 * Returns SAM.gov entity registration data
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  searchEntities,
  getEntityByUEI,
  verifySAMStatus,
  getCertifications,
  findTeamingPartners
} from '@/lib/sam/entity-api';
import { resolveUei, ueiMessage } from '@/lib/sam/resolve-uei';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const uei = searchParams.get('uei');
  const cageCode = searchParams.get('cage');
  const name = searchParams.get('name');
  const naics = searchParams.get('naics');
  const state = searchParams.get('state');
  const certs = searchParams.get('certs'); // 8a, SDVOSB, WOSB, HUBZone
  const limit = parseInt(searchParams.get('limit') || '25');
  const mode = searchParams.get('mode') || 'search'; // search, verify, teaming

  try {
    // Mode: verify - quick SAM status check
    if (mode === 'verify' && uei) {
      const status = await verifySAMStatus(uei);
      return NextResponse.json({
        success: true,
        mode: 'verify',
        uei,
        ...status
      });
    }

    // Mode: teaming - find potential partners
    if (mode === 'teaming' && naics) {
      const certType = certs as '8a' | 'SDVOSB' | 'WOSB' | 'HUBZone' | undefined;
      const partners = await findTeamingPartners(naics, certType, state || undefined, limit);

      return NextResponse.json({
        success: true,
        mode: 'teaming',
        params: { naics, certs, state, limit },
        totalPartners: partners.length,
        partners: partners.map(p => ({
          uei: p.ueiSAM,
          cageCode: p.cageCode,
          name: p.legalBusinessName,
          dba: p.dbaName,
          state: p.physicalAddress?.stateOrProvince,
          city: p.physicalAddress?.city,
          status: p.registrationStatus,
          isActive: p.isActive,
          certifications: {
            has8a: p.has8a,
            hasSDVOSB: p.hasSDVOSB,
            hasWOSB: p.hasWOSB,
            hasHUBZone: p.hasHUBZone
          },
          naicsCodes: p.naicsList?.slice(0, 5).map(n => n.naicsCode) || []
        }))
      });
    }

    // Mode: search - find entities
    // Direct UEI lookup
    if (uei) {
      // ⚠️ P0 (2026-08-25): this used to call live SAM ALONE, so `null` — whether the UEI
      // genuinely did not exist OR SAM was down — became HTTP 404 "Entity not found". A user
      // typing their OWN UEI during a SAM outage was told their company does not exist, while
      // 910,123 entities sat in our local mirror. Existence now comes from the LOCAL registry;
      // live SAM only enriches. See src/lib/sam/resolve-uei.ts.
      const resolved = await resolveUei(uei);

      if (resolved.resolution === 'malformed') {
        return NextResponse.json({
          success: false, resolution: 'malformed',
          error: ueiMessage(resolved), detail: resolved.detail,
        }, { status: 400 });
      }
      // 503, NOT 404 — we failed to look, which is not the same as looking and finding nothing.
      // A 404 here is what told users their company was not registered.
      if (resolved.resolution === 'unavailable') {
        return NextResponse.json({
          success: false, resolution: 'unavailable', degraded: true,
          error: ueiMessage(resolved), detail: resolved.detail,
        }, { status: 503 });
      }
      if (resolved.resolution === 'not_found' || !resolved.entity) {
        return NextResponse.json({
          success: false, resolution: 'not_found',
          error: ueiMessage(resolved),
        }, { status: 404 });
      }

      const entity = resolved.entity;

      // Certifications are ENRICHMENT — their failure must not sink an established identity.
      let certData: Awaited<ReturnType<typeof getCertifications>> | null = null;
      try {
        certData = await getCertifications(uei);
      } catch (err) {
        console.warn('[entity-lookup] certifications unavailable (identity still resolved)', err);
      }

      return NextResponse.json({
        success: true,
        mode: 'detail',
        resolution: 'found',
        // HONEST PROVENANCE: a local hit is a CACHED registration, not a live check.
        // `degraded` tells the caller live SAM was unreachable; `asOf` dates the record so
        // the UI can say "as of <date>" instead of implying it re-checked SAM this second.
        source: resolved.source,
        degraded: resolved.degraded,
        asOf: resolved.asOf,
        notice: resolved.degraded ? ueiMessage(resolved) : null,
        entity: {
          uei: entity.ueiSAM,
          cageCode: entity.cageCode,
          name: entity.legalBusinessName,
          dba: entity.dbaName,
          status: entity.registrationStatus,
          isActive: entity.isActive,
          expirationDate: entity.registrationExpirationDate,
          daysUntilExpiration: entity.daysUntilExpiration,
          entityStructure: entity.entityStructure,
          address: {
            street: [entity.physicalAddress?.addressLine1, entity.physicalAddress?.addressLine2].filter(Boolean).join(', '),
            city: entity.physicalAddress?.city,
            state: entity.physicalAddress?.stateOrProvince,
            zip: entity.physicalAddress?.zipCode,
            country: entity.physicalAddress?.countryCode
          },
          certifications: certData,
          naicsCodes: entity.naicsList?.map(n => ({
            code: n.naicsCode,
            description: n.naicsDescription,
            isPrimary: n.isPrimary
          })) || [],
          pscCodes: entity.pscList?.map(p => ({
            code: p.pscCode,
            description: p.pscDescription
          })) || [],
          contacts: entity.pointsOfContact?.slice(0, 3).map(c => ({
            name: c.name,
            title: c.title,
            phone: c.phone,
            email: c.email,
            type: c.type
          })) || []
        }
      });
    }

    // Search by name or other criteria
    if (!name && !naics && !cageCode) {
      return NextResponse.json({
        success: false,
        error: 'At least one search parameter is required (uei, name, naics, or cage)'
      }, { status: 400 });
    }

    const result = await searchEntities({
      legalBusinessName: name || undefined,
      cageCode: cageCode || undefined,
      naicsCode: naics || undefined,
      stateCode: state || undefined,
      registrationStatus: 'Active',
      size: limit
    });

    return NextResponse.json({
      success: true,
      mode: 'search',
      params: { name, naics, state, limit },
      totalCount: result.totalCount,
      fromCache: result.fromCache,
      entities: result.entities.map(e => ({
        uei: e.ueiSAM,
        cageCode: e.cageCode,
        name: e.legalBusinessName,
        dba: e.dbaName,
        state: e.physicalAddress?.stateOrProvince,
        city: e.physicalAddress?.city,
        status: e.registrationStatus,
        isActive: e.isActive,
        expirationDate: e.registrationExpirationDate,
        certifications: {
          has8a: e.has8a,
          hasSDVOSB: e.hasSDVOSB,
          hasWOSB: e.hasWOSB,
          hasHUBZone: e.hasHUBZone
        },
        primaryNaics: e.naicsList?.find(n => n.isPrimary)?.naicsCode || e.naicsList?.[0]?.naicsCode
      }))
    });

  } catch (error) {
    console.error('[Entity Lookup Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to lookup entity'
    }, { status: 500 });
  }
}
