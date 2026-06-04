/**
 * SAM.gov Entity Management API
 *
 * Provides live SAM.gov registration data for contractors:
 * - SAM registration status (Active/Inactive/Expired)
 * - Certifications (8(a), SDVOSB, WOSB, HUBZone)
 * - UEI, CAGE code
 * - NAICS codes registered
 * - Points of contact
 */

import {
  getSAMAPIConfig,
  makeSAMRequest
} from './utils';

// Types
export interface SAMEntity {
  ueiSAM: string;
  cageCode: string;
  legalBusinessName: string;
  dbaName?: string;
  registrationStatus: 'Active' | 'Inactive' | 'Expired' | 'Unknown';
  registrationExpirationDate?: string;
  purposeOfRegistration?: string;
  entityStructure?: string;
  physicalAddress?: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    stateOrProvince?: string;
    zipCode?: string;
    countryCode?: string;
  };
  mailingAddress?: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    stateOrProvince?: string;
    zipCode?: string;
    countryCode?: string;
  };
  naicsList?: Array<{
    naicsCode: string;
    naicsDescription?: string;
    isPrimary?: boolean;
  }>;
  pscList?: Array<{
    pscCode: string;
    pscDescription?: string;
  }>;
  certifications?: {
    sbaBusinessTypes?: string[];
    certificationExpirations?: Array<{
      type: string;
      expirationDate: string;
    }>;
  };
  pointsOfContact?: Array<{
    name?: string;
    title?: string;
    phone?: string;
    email?: string;
    type?: string; // 'Government', 'Electronic', 'Alternate'
  }>;
  // Computed fields
  isActive: boolean;
  daysUntilExpiration?: number;
  has8a?: boolean;
  hasSDVOSB?: boolean;
  hasWOSB?: boolean;
  hasHUBZone?: boolean;
}

export interface EntitySearchParams {
  legalBusinessName?: string;
  uei?: string;
  cageCode?: string;
  naicsCode?: string;
  stateCode?: string;
  registrationStatus?: 'Active' | 'Inactive' | 'Expired';
  sbaBusinessTypes?: string; // 8a, SDVOSB, WOSB, HUBZone
  page?: number;
  size?: number;
}

export interface EntitySearchResult {
  entities: SAMEntity[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  fromCache: boolean;
}

// SBA Business Type Codes → normalized set-aside labels.
// CORRECTED 2026-06-04 against live SAM v3 data — the old map used
// guessed codes (2X/XY/23/A2) that DON'T appear in real responses, so
// certifications never normalized. Verified live codes:
//   A6 = "SBA Certified 8(a) Program Participant"   (n≈5,009)
//   JT = "SBA Certified 8(a) Joint Venture"          (n≈781)
//   XX = "SBA Certified HUBZone Firm"                (n≈4,603)
// (WOSB/EDWOSB/SDVOSB are self-certified and live in a different SAM
//  field, not this SBA-certified list — we read those elsewhere.)
const SBA_TYPE_MAP: Record<string, string> = {
  'A6': '8(a)',
  'JT': '8(a)',      // 8(a) joint venture — still 8(a)-eligible
  'XX': 'HUBZone',
  // Legacy guessed codes kept as harmless fallbacks:
  '2X': '8(a)',
  'XY': 'SDVOSB',
  '23': 'WOSB',
  'A2': 'EDWOSB',
};

// Normalize an SBA business-type label from the DESCRIPTION text, which
// is self-describing and more stable than the cryptic codes. Used as the
// primary signal; the code map is the fallback.
function sbaLabelFromDesc(desc: string): string | null {
  const d = desc.toLowerCase();
  if (d.includes('8(a)') || d.includes('8a')) return '8(a)';
  if (d.includes('hubzone')) return 'HUBZone';
  if (d.includes('service-disabled') || d.includes('sdvosb')) return 'SDVOSB';
  if (d.includes('women')) return d.includes('economically') ? 'EDWOSB' : 'WOSB';
  if (d.includes('small disadvantaged') || d.includes('sdb')) return 'Small Disadvantaged Business';
  return null;
}

/**
 * Transform raw API response to our SAMEntity type
 */
function transformEntity(raw: Record<string, unknown>): SAMEntity {
  // SAM v3 Entity API response shape is nested:
  //   entityRegistration: { ueiSAM, legalBusinessName, registrationStatus, ... }
  //   coreData: { entityInformation: {...}, physicalAddress, mailingAddress }
  //   assertions: { goodsAndServices: { naicsList, pscList } }
  //   pointsOfContact: { governmentBusinessPOC, electronicBusinessPOC, ... }
  //
  // Bug fixed 2026-05-26: transformer was reading top-level fields
  // that don't exist, so even valid entity rows returned empty fields.
  const er = (raw.entityRegistration as Record<string, unknown>) || {};
  const core = (raw.coreData as Record<string, unknown>) || {};
  const assertions = (raw.assertions as Record<string, unknown>) || {};
  const pocSection = (raw.pointsOfContact as Record<string, unknown>) || {};

  const expirationDate = (er.registrationExpirationDate as string) || (raw.registrationExpirationDate as string);
  const daysUntilExpiration = expirationDate
    ? Math.ceil((new Date(expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : undefined;

  const status = (er.registrationStatus as string) || (raw.registrationStatus as string) || 'Unknown';

  // SBA business types live under coreData.businessTypes.sbaBusinessTypeList
  // in the live v3 response (verified 2026-06-04). The old code read
  // assertions.goodsAndServices.sbaBusinessTypeList — which is undefined —
  // so 8(a)/WOSB/SDVOSB/HUBZone flags NEVER populated. Keep the old paths
  // as fallbacks in case the shape varies by entity.
  const goodsServices = (assertions.goodsAndServices as Record<string, unknown>) || {};
  const businessTypes = (core.businessTypes as Record<string, unknown>) || {};
  const sbaTypesArr =
    (businessTypes.sbaBusinessTypeList as Array<Record<string, unknown>>) ||
    (goodsServices.sbaBusinessTypeList as Array<Record<string, unknown>>) ||
    (raw.sbaBusinessTypes as unknown as Array<Record<string, unknown>>) ||
    [];
  // Normalize each SBA entry to a clean label: prefer the description
  // text (self-describing), fall back to the code map, then the raw code.
  // De-dupe (8(a) + 8(a) JV both normalize to '8(a)').
  const sbaTypes: string[] = Array.isArray(sbaTypesArr)
    ? Array.from(new Set(
        sbaTypesArr
          .map(t => {
            if (typeof t === 'string') return SBA_TYPE_MAP[t] || t;
            const desc = (t.sbaBusinessTypeDesc as string) || '';
            const code = (t.sbaBusinessTypeCode as string) || '';
            if (!desc && !code) return '';
            return sbaLabelFromDesc(desc) || SBA_TYPE_MAP[code] || code;
          })
          .filter(Boolean),
      ))
    : [];

  // NAICS list lives under assertions.goodsAndServices.naicsList
  const naicsRaw = (goodsServices.naicsList as Array<Record<string, unknown>>) || (raw.naicsList as Array<Record<string, unknown>>) || [];
  const naicsList = naicsRaw.map(n => ({
    naicsCode: String(n.naicsCode || ''),
    naicsDescription: String(n.naicsDescription || ''),
    isPrimary: Boolean(n.isPrimary === 'Y' || n.isPrimary === true || n.primaryNaics === 'Y')
  }));

  // PSC list
  const pscRaw = (goodsServices.pscList as Array<Record<string, unknown>>) || (raw.pscList as Array<Record<string, unknown>>) || [];
  const pscList = pscRaw.map(p => ({
    pscCode: String(p.pscCode || ''),
    pscDescription: String(p.pscDescription || '')
  }));

  // Addresses
  const physAddr = (core.physicalAddress as Record<string, unknown>) || (raw.physicalAddress as Record<string, unknown>) || {};
  const mailAddr = (core.mailingAddress as Record<string, unknown>) || (raw.mailingAddress as Record<string, unknown>) || {};

  // POCs — v3 nests them: governmentBusinessPOC, electronicBusinessPOC,
  // pastPerformancePOC. Flatten to an array.
  const pointsOfContact: SAMEntity['pointsOfContact'] = [];
  for (const [type, poc] of Object.entries(pocSection)) {
    if (poc && typeof poc === 'object') {
      const p = poc as Record<string, unknown>;
      pointsOfContact.push({
        name: String([p.firstName, p.lastName].filter(Boolean).join(' ') || p.fullName || ''),
        title: String(p.title || ''),
        phone: String(p.usPhone || p.phone || ''),
        email: String(p.email || ''),
        type,
      });
    }
  }

  return {
    ueiSAM: String(er.ueiSAM || raw.ueiSAM || ''),
    cageCode: String(er.cageCode || raw.cageCode || ''),
    legalBusinessName: String(er.legalBusinessName || raw.legalBusinessName || ''),
    dbaName: er.dbaName ? String(er.dbaName) : raw.dbaName ? String(raw.dbaName) : undefined,
    registrationStatus: status as SAMEntity['registrationStatus'],
    registrationExpirationDate: expirationDate,
    purposeOfRegistration: er.purposeOfRegistrationDesc ? String(er.purposeOfRegistrationDesc) : undefined,
    entityStructure: (core.entityStructure as Record<string, unknown>)?.entityStructureDesc as string | undefined,
    physicalAddress: {
      addressLine1: physAddr.addressLine1 ? String(physAddr.addressLine1) : undefined,
      addressLine2: physAddr.addressLine2 ? String(physAddr.addressLine2) : undefined,
      city: physAddr.city ? String(physAddr.city) : undefined,
      stateOrProvince: physAddr.stateOrProvinceCode ? String(physAddr.stateOrProvinceCode) : physAddr.stateOrProvince ? String(physAddr.stateOrProvince) : undefined,
      zipCode: physAddr.zipCode ? String(physAddr.zipCode) : undefined,
      countryCode: physAddr.countryCode ? String(physAddr.countryCode) : undefined,
    },
    mailingAddress: {
      addressLine1: mailAddr.addressLine1 ? String(mailAddr.addressLine1) : undefined,
      addressLine2: mailAddr.addressLine2 ? String(mailAddr.addressLine2) : undefined,
      city: mailAddr.city ? String(mailAddr.city) : undefined,
      stateOrProvince: mailAddr.stateOrProvinceCode ? String(mailAddr.stateOrProvinceCode) : mailAddr.stateOrProvince ? String(mailAddr.stateOrProvince) : undefined,
      zipCode: mailAddr.zipCode ? String(mailAddr.zipCode) : undefined,
      countryCode: mailAddr.countryCode ? String(mailAddr.countryCode) : undefined,
    },
    naicsList,
    pscList,
    certifications: {
      // sbaTypes already holds normalized labels (8(a)/HUBZone/...).
      sbaBusinessTypes: sbaTypes,
      certificationExpirations: [],
    },
    pointsOfContact,
    isActive: status === 'Active',
    daysUntilExpiration,
    has8a: sbaTypes.some(t => /8\(a\)/i.test(t)),
    hasSDVOSB: sbaTypes.some(t => /SDVOSB|Service.Disabled/i.test(t)),
    hasWOSB: sbaTypes.some(t => /WOSB|Women/i.test(t)),
    hasHUBZone: sbaTypes.some(t => /HUBZone/i.test(t)),
  };
}

/**
 * Search for entities in SAM.gov
 */
export async function searchEntities(
  params: EntitySearchParams
): Promise<EntitySearchResult> {
  // Use the dynamic config getter so we get a populated apiKey
  // (the static SAM_API_CONFIGS map sets apiKey='' as a stale default;
  // bug fixed 2026-05-26 — was making getEntityByUEI() return 404 even
  // for valid UEIs because the empty Bearer token rejected the call.)
  const config = getSAMAPIConfig('entity');

  // Build query parameters
  // SAM v3 Entity API quirk: when ueiSAM is provided, do NOT include
  // page/size — the API auto-narrows to 1 record and pagination params
  // cause it to return totalRecords=1 but entityData=[]. Bug fixed
  // 2026-05-26 — was making UEI lookups silently return null.
  const queryParams: Record<string, string | number> = {};

  if (!params.uei && !params.cageCode) {
    // Only add pagination for list searches, not single-record lookups
    queryParams.page = params.page || 1;
    queryParams.size = params.size || 25;
  }

  if (params.legalBusinessName) {
    queryParams.legalBusinessName = params.legalBusinessName;
  }

  if (params.uei) {
    queryParams.ueiSAM = params.uei;
  }

  if (params.cageCode) {
    queryParams.cageCode = params.cageCode;
  }

  if (params.naicsCode) {
    queryParams.naicsCode = params.naicsCode;
  }

  if (params.stateCode) {
    queryParams.stateCode = params.stateCode;
  }

  if (params.registrationStatus) {
    // SAM v3 entity API expects single-letter status CODES, not the
    // friendly word. Passing 'Active' silently returns totalRecords=0
    // (verified 2026-06-04 — this was making every NAICS entity search
    // come back empty). Translate to the code SAM actually filters on.
    const REG_STATUS_CODE: Record<string, string> = {
      Active: 'A', Inactive: 'I', Expired: 'E',
    };
    queryParams.registrationStatus =
      REG_STATUS_CODE[params.registrationStatus] || params.registrationStatus;
  }

  if (params.sbaBusinessTypes) {
    queryParams.sbaBusinessTypes = params.sbaBusinessTypes;
  }

  const result = await makeSAMRequest<{
    entityData: Record<string, unknown>[];
    totalRecords: number;
  }>(config, '/entities', queryParams);

  if (result.error) {
    console.error('[Entity Search Error]', result.error);
    return {
      entities: [],
      totalCount: 0,
      page: params.page || 1,
      pageSize: params.size || 25,
      hasMore: false,
      fromCache: false
    };
  }

  const data = result.data;
  const entities = (data?.entityData || []).map(transformEntity);

  return {
    entities,
    totalCount: data?.totalRecords || entities.length,
    page: params.page || 1,
    pageSize: params.size || 25,
    hasMore: entities.length === (params.size || 25),
    fromCache: result.fromCache
  };
}

/**
 * Get entity details by UEI
 */
export async function getEntityByUEI(uei: string): Promise<SAMEntity | null> {
  const result = await searchEntities({ uei, size: 1 });

  if (result.entities.length === 0) {
    return null;
  }

  return result.entities[0];
}

/**
 * Get entity details by CAGE code
 */
export async function getEntityByCAGE(cageCode: string): Promise<SAMEntity | null> {
  const result = await searchEntities({ cageCode, size: 1 });

  if (result.entities.length === 0) {
    return null;
  }

  return result.entities[0];
}

/**
 * Verify SAM.gov registration status
 */
export async function verifySAMStatus(uei: string): Promise<{
  isRegistered: boolean;
  isActive: boolean;
  status: string;
  expirationDate?: string;
  daysUntilExpiration?: number;
}> {
  const entity = await getEntityByUEI(uei);

  if (!entity) {
    return {
      isRegistered: false,
      isActive: false,
      status: 'Not Found'
    };
  }

  return {
    isRegistered: true,
    isActive: entity.isActive,
    status: entity.registrationStatus,
    expirationDate: entity.registrationExpirationDate,
    daysUntilExpiration: entity.daysUntilExpiration
  };
}

/**
 * Get all certifications for an entity
 */
export async function getCertifications(uei: string): Promise<{
  has8a: boolean;
  hasSDVOSB: boolean;
  hasWOSB: boolean;
  hasHUBZone: boolean;
  allCertifications: string[];
  expirations: Array<{ type: string; expirationDate: string }>;
} | null> {
  const entity = await getEntityByUEI(uei);

  if (!entity) {
    return null;
  }

  return {
    has8a: entity.has8a || false,
    hasSDVOSB: entity.hasSDVOSB || false,
    hasWOSB: entity.hasWOSB || false,
    hasHUBZone: entity.hasHUBZone || false,
    allCertifications: entity.certifications?.sbaBusinessTypes || [],
    expirations: entity.certifications?.certificationExpirations || []
  };
}

/**
 * Search for entities by certification type
 */
export async function searchByCertification(
  certType: '8a' | 'SDVOSB' | 'WOSB' | 'HUBZone',
  options: { naicsCode?: string; stateCode?: string; limit?: number } = {}
): Promise<SAMEntity[]> {
  const certMap: Record<string, string> = {
    '8a': '2X',
    'SDVOSB': 'XY',
    'WOSB': '23',
    'HUBZone': 'XX'
  };

  const result = await searchEntities({
    sbaBusinessTypes: certMap[certType],
    naicsCode: options.naicsCode,
    stateCode: options.stateCode,
    registrationStatus: 'Active',
    size: options.limit || 50
  });

  return result.entities;
}

/**
 * Get NAICS codes registered by an entity
 */
export async function getEntityNAICS(uei: string): Promise<Array<{
  naicsCode: string;
  naicsDescription: string;
  isPrimary: boolean;
}>> {
  const entity = await getEntityByUEI(uei);

  if (!entity || !entity.naicsList) {
    return [];
  }

  return entity.naicsList.map(n => ({
    naicsCode: n.naicsCode,
    naicsDescription: n.naicsDescription || '',
    isPrimary: n.isPrimary || false
  }));
}

/**
 * Find potential teaming partners by NAICS and certification
 */
export async function findTeamingPartners(
  naicsCode: string,
  certType?: '8a' | 'SDVOSB' | 'WOSB' | 'HUBZone',
  stateCode?: string,
  limit: number = 20
): Promise<SAMEntity[]> {
  const params: EntitySearchParams = {
    naicsCode,
    stateCode,
    registrationStatus: 'Active',
    size: limit
  };

  if (certType) {
    const certMap: Record<string, string> = {
      '8a': '2X',
      'SDVOSB': 'XY',
      'WOSB': '23',
      'HUBZone': 'XX'
    };
    params.sbaBusinessTypes = certMap[certType];
  }

  const result = await searchEntities(params);
  return result.entities;
}
