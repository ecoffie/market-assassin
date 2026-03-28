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
  SAM_API_CONFIGS,
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

// SBA Business Type Codes
const SBA_TYPE_MAP: Record<string, string> = {
  '2X': '8(a)',
  'XX': 'HUBZone',
  'XY': 'SDVOSB',
  '23': 'WOSB',
  'A2': 'EDWOSB',
  '27': 'Small Business'
};

/**
 * Transform raw API response to our SAMEntity type
 */
function transformEntity(raw: Record<string, unknown>): SAMEntity {
  const expirationDate = raw.registrationExpirationDate as string;
  const daysUntilExpiration = expirationDate
    ? Math.ceil((new Date(expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : undefined;

  const status = raw.registrationStatus as string || 'Unknown';
  const sbaTypes = (raw.sbaBusinessTypes as string[]) || [];

  // Parse NAICS list
  const naicsRaw = raw.naicsList as Array<Record<string, unknown>> || [];
  const naicsList = naicsRaw.map(n => ({
    naicsCode: String(n.naicsCode || ''),
    naicsDescription: String(n.naicsDescription || ''),
    isPrimary: Boolean(n.isPrimary)
  }));

  // Parse PSC list
  const pscRaw = raw.pscList as Array<Record<string, unknown>> || [];
  const pscList = pscRaw.map(p => ({
    pscCode: String(p.pscCode || ''),
    pscDescription: String(p.pscDescription || '')
  }));

  // Parse addresses
  const physAddr = raw.physicalAddress as Record<string, unknown> || {};
  const mailAddr = raw.mailingAddress as Record<string, unknown> || {};

  // Parse POCs
  const pocsRaw = raw.pocList as Array<Record<string, unknown>> || [];
  const pointsOfContact = pocsRaw.map(p => ({
    name: String(p.name || p.firstName || ''),
    title: String(p.title || ''),
    phone: String(p.phone || ''),
    email: String(p.email || ''),
    type: String(p.type || '')
  }));

  return {
    ueiSAM: String(raw.ueiSAM || ''),
    cageCode: String(raw.cageCode || ''),
    legalBusinessName: String(raw.legalBusinessName || ''),
    dbaName: raw.dbaName ? String(raw.dbaName) : undefined,
    registrationStatus: status as SAMEntity['registrationStatus'],
    registrationExpirationDate: expirationDate,
    purposeOfRegistration: raw.purposeOfRegistration ? String(raw.purposeOfRegistration) : undefined,
    entityStructure: raw.entityStructure ? String(raw.entityStructure) : undefined,
    physicalAddress: {
      addressLine1: physAddr.addressLine1 ? String(physAddr.addressLine1) : undefined,
      addressLine2: physAddr.addressLine2 ? String(physAddr.addressLine2) : undefined,
      city: physAddr.city ? String(physAddr.city) : undefined,
      stateOrProvince: physAddr.stateOrProvince ? String(physAddr.stateOrProvince) : undefined,
      zipCode: physAddr.zipCode ? String(physAddr.zipCode) : undefined,
      countryCode: physAddr.countryCode ? String(physAddr.countryCode) : undefined,
    },
    mailingAddress: {
      addressLine1: mailAddr.addressLine1 ? String(mailAddr.addressLine1) : undefined,
      addressLine2: mailAddr.addressLine2 ? String(mailAddr.addressLine2) : undefined,
      city: mailAddr.city ? String(mailAddr.city) : undefined,
      stateOrProvince: mailAddr.stateOrProvince ? String(mailAddr.stateOrProvince) : undefined,
      zipCode: mailAddr.zipCode ? String(mailAddr.zipCode) : undefined,
      countryCode: mailAddr.countryCode ? String(mailAddr.countryCode) : undefined,
    },
    naicsList,
    pscList,
    certifications: {
      sbaBusinessTypes: sbaTypes.map(t => SBA_TYPE_MAP[t] || t),
      certificationExpirations: [] // Would need additional parsing
    },
    pointsOfContact,
    // Computed fields
    isActive: status === 'Active',
    daysUntilExpiration,
    has8a: sbaTypes.includes('2X'),
    hasSDVOSB: sbaTypes.includes('XY'),
    hasWOSB: sbaTypes.includes('23') || sbaTypes.includes('A2'),
    hasHUBZone: sbaTypes.includes('XX')
  };
}

/**
 * Search for entities in SAM.gov
 */
export async function searchEntities(
  params: EntitySearchParams
): Promise<EntitySearchResult> {
  const config = SAM_API_CONFIGS.entity;

  // Build query parameters
  const queryParams: Record<string, string | number> = {
    page: params.page || 1,
    size: params.size || 25
  };

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
    queryParams.registrationStatus = params.registrationStatus;
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
