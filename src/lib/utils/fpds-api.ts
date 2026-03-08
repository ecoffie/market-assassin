// FPDS (Federal Procurement Data System) API Integration
// Provides command-level contracting office data that USAspending doesn't expose
//
// NOTE: FPDS is migrating to SAM.gov. This file includes:
// 1. Primary: Legacy FPDS ATOM feed (fpds.gov)
// 2. Fallback: SAM.gov Contract Data API (api.sam.gov)
// 3. Health monitoring to detect when FPDS goes down

import { translateOfficeName } from './office-names';

// Track FPDS health status
let fpdsHealthy = true;
let lastFpdsCheck = 0;
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_FALLBACK = 3;

// SAM.gov Contract Data API Base URL
const SAM_CONTRACT_API_URL = 'https://api.sam.gov/opportunities/v2/search';

/**
 * Check if FPDS API is healthy
 * Returns true if FPDS is responding, false if we should use fallback
 */
async function checkFPDSHealth(): Promise<boolean> {
  const now = Date.now();

  // Use cached result if recent
  if (now - lastFpdsCheck < HEALTH_CHECK_INTERVAL) {
    return fpdsHealthy;
  }

  lastFpdsCheck = now;

  try {
    // Simple health check - fetch a small query
    const response = await fetch(
      `${FPDS_BASE_URL}?FEEDNAME=PUBLIC&q=PRINCIPAL_NAICS_CODE:541512&start=0&rows=1`,
      {
        method: 'GET',
        headers: { 'Accept': 'application/xml' },
        signal: AbortSignal.timeout(10000), // 10 second timeout for health check
      }
    );

    if (response.ok) {
      const text = await response.text();
      // Verify we got valid XML with entries
      if (text.includes('<feed') || text.includes('<entry>')) {
        fpdsHealthy = true;
        consecutiveFailures = 0;
        console.log('✅ FPDS health check passed');
        return true;
      }
    }

    // Response not OK or invalid content
    consecutiveFailures++;
    console.warn(`⚠️ FPDS health check failed (attempt ${consecutiveFailures}): status ${response.status}`);

    if (consecutiveFailures >= MAX_FAILURES_BEFORE_FALLBACK) {
      fpdsHealthy = false;
      console.warn('🔄 FPDS marked as unhealthy, will use SAM.gov fallback');
    }

    return fpdsHealthy;
  } catch (error) {
    consecutiveFailures++;
    console.error(`⚠️ FPDS health check error (attempt ${consecutiveFailures}):`, error);

    if (consecutiveFailures >= MAX_FAILURES_BEFORE_FALLBACK) {
      fpdsHealthy = false;
      console.warn('🔄 FPDS marked as unhealthy, will use SAM.gov fallback');
    }

    return fpdsHealthy;
  }
}

/**
 * Fetch contract data from SAM.gov Contract Data API (fallback)
 * This is used when FPDS is unavailable
 */
async function fetchFromSAMContractAPI(
  naicsCode: string,
  options: { maxRecords?: number } = {}
): Promise<FPDSSearchResult> {
  const { maxRecords = 100 } = options;

  console.log(`🔄 Using SAM.gov Contract Data API fallback for NAICS: ${naicsCode}`);

  const awards: FPDSAward[] = [];
  const offices = new Map<string, FPDSContractingOffice>();

  try {
    // SAM.gov API requires API key
    const apiKey = process.env.SAM_API_KEY;

    if (!apiKey) {
      console.warn('⚠️ SAM_API_KEY not configured, cannot use SAM.gov fallback');
      return { awards: [], totalCount: 0, offices: new Map() };
    }

    // Query SAM.gov for contract opportunities with this NAICS
    // Note: SAM.gov opportunities API is different from FPDS awards
    // This is a best-effort fallback that returns opportunities instead of historical awards
    const params = new URLSearchParams({
      api_key: apiKey,
      naics: naicsCode,
      postedFrom: getDateMonthsAgo(6), // Last 6 months
      limit: String(Math.min(maxRecords, 100)),
    });

    const response = await fetch(`${SAM_CONTRACT_API_URL}?${params}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`SAM.gov API error: ${response.status}`);
      return { awards: [], totalCount: 0, offices: new Map() };
    }

    const data = await response.json();
    const opportunities = data.opportunitiesData || [];

    // Map SAM.gov opportunity format to FPDS award format (best effort)
    for (const opp of opportunities) {
      const officeName = opp.officeAddress?.city
        ? `${opp.organizationAcronym || opp.organizationName || 'Unknown'} - ${opp.officeAddress.city}`
        : opp.organizationAcronym || opp.organizationName || 'Unknown Office';

      const award: FPDSAward = {
        contractingOffice: {
          officeId: opp.organizationId || '',
          officeName: cleanOfficeName(officeName),
          agencyId: opp.organizationHierarchy?.cgac || '',
          agencyName: opp.organizationHierarchy?.toptierAgencyName || opp.organizationName || '',
          departmentId: opp.organizationHierarchy?.fpds || '',
          departmentName: opp.organizationHierarchy?.toptierAgencyName || '',
          obligatedAmount: parseFloat(opp.award?.amount || '0'),
          contractCount: 1,
        },
        naicsCode: opp.naicsCode || naicsCode,
        naicsDescription: opp.naicsDescription || '',
        vendorName: opp.awardee?.name || 'TBD',
        obligatedAmount: parseFloat(opp.award?.amount || '0'),
        signedDate: opp.postedDate || '',
        placeOfPerformanceState: opp.placeOfPerformance?.state?.code || '',
        setAsideType: opp.setAside,
        isSmallBusiness: !!opp.setAside?.includes('Small'),
        isWomenOwned: !!opp.setAside?.includes('WOSB'),
        isVeteranOwned: !!opp.setAside?.includes('VOSB'),
        isServiceDisabledVeteranOwned: !!opp.setAside?.includes('SDVOSB'),
        is8aProgram: !!opp.setAside?.includes('8(a)'),
        isHubZone: !!opp.setAside?.includes('HUBZone'),
      };

      awards.push(award);

      // Aggregate by office
      const officeKey = `${award.contractingOffice.officeId}|${award.contractingOffice.officeName}`;
      const existing = offices.get(officeKey);
      if (existing) {
        existing.obligatedAmount += award.obligatedAmount;
        existing.contractCount += 1;
      } else {
        offices.set(officeKey, { ...award.contractingOffice });
      }
    }

    console.log(`📊 SAM.gov fallback returned ${awards.length} records`);

    return {
      awards,
      totalCount: awards.length,
      offices,
    };
  } catch (error) {
    console.error('SAM.gov fallback error:', error);
    return { awards: [], totalCount: 0, offices: new Map() };
  }
}

/**
 * Get date string for N months ago in YYYY-MM-DD format
 */
function getDateMonthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().split('T')[0];
}

/**
 * Force reset FPDS health status (for testing/admin)
 */
export function resetFPDSHealth(): void {
  fpdsHealthy = true;
  consecutiveFailures = 0;
  lastFpdsCheck = 0;
  console.log('🔄 FPDS health status reset');
}

/**
 * Get current FPDS health status
 */
export function getFPDSHealthStatus(): { healthy: boolean; consecutiveFailures: number; lastCheck: number } {
  return {
    healthy: fpdsHealthy,
    consecutiveFailures,
    lastCheck: lastFpdsCheck,
  };
}

interface FPDSContractingOffice {
  officeId: string;           // e.g., "N68711"
  officeName: string;         // e.g., "NAVFAC ENGINEERING FIELD DIVISION"
  agencyId: string;           // e.g., "1700"
  agencyName: string;         // e.g., "DEPT OF THE NAVY"
  departmentId: string;       // e.g., "9700"
  departmentName: string;     // e.g., "DEPT OF DEFENSE"
  obligatedAmount: number;
  contractCount: number;
}

interface FPDSAward {
  contractingOffice: FPDSContractingOffice;
  naicsCode: string;
  naicsDescription: string;
  vendorName: string;
  obligatedAmount: number;
  signedDate: string;
  placeOfPerformanceState: string;
  setAsideType?: string;
  isSmallBusiness: boolean;
  isWomenOwned: boolean;
  isVeteranOwned: boolean;
  isServiceDisabledVeteranOwned: boolean;
  is8aProgram: boolean;
  isHubZone: boolean;
}

interface FPDSSearchResult {
  awards: FPDSAward[];
  totalCount: number;
  offices: Map<string, FPDSContractingOffice>;
}

// FPDS ATOM Feed Base URL
const FPDS_BASE_URL = 'https://www.fpds.gov/ezsearch/FEEDS/ATOM';

// Build FPDS query parameters
function buildFPDSQuery(params: {
  naicsCode?: string;
  contractingAgency?: string;
  setAsideType?: string[];
}): string {
  const queryParts: string[] = [];

  if (params.naicsCode) {
    queryParts.push(`PRINCIPAL_NAICS_CODE:${params.naicsCode}`);
  }

  if (params.contractingAgency) {
    // Use wildcard for partial matching
    queryParts.push(`CONTRACTING_OFFICE_NAME:*${params.contractingAgency}*`);
  }

  // Note: Date filter removed as FPDS date format causes issues
  // FPDS returns most recent data first anyway

  return queryParts.join('+');
}

// Parse XML namespace-prefixed element
function getElementValue(xml: string, elementName: string): string | null {
  // Try with ns1: prefix first
  const ns1Regex = new RegExp(`<ns1:${elementName}[^>]*>([^<]*)</ns1:${elementName}>`, 'i');
  const ns1Match = xml.match(ns1Regex);
  if (ns1Match) return ns1Match[1].trim();

  // Try without namespace prefix
  const plainRegex = new RegExp(`<${elementName}[^>]*>([^<]*)</${elementName}>`, 'i');
  const plainMatch = xml.match(plainRegex);
  if (plainMatch) return plainMatch[1].trim();

  return null;
}

// Parse XML element attribute
function getElementAttribute(xml: string, elementName: string, attributeName: string): string | null {
  const regex = new RegExp(`<ns1:${elementName}[^>]*${attributeName}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

// Parse a single FPDS award entry from XML
function parseAwardEntry(entryXml: string): FPDSAward | null {
  try {
    // Extract purchaserInformation section
    const purchaserMatch = entryXml.match(/<ns1:purchaserInformation>([\s\S]*?)<\/ns1:purchaserInformation>/i);
    if (!purchaserMatch) return null;
    const purchaserXml = purchaserMatch[1];

    // Extract contracting office details
    const officeAgencyName = getElementAttribute(purchaserXml, 'contractingOfficeAgencyID', 'name') || 'Unknown';
    const officeAgencyId = getElementValue(purchaserXml, 'contractingOfficeAgencyID') || '';
    const departmentId = getElementAttribute(purchaserXml, 'contractingOfficeAgencyID', 'departmentID') || '';
    const departmentName = getElementAttribute(purchaserXml, 'contractingOfficeAgencyID', 'departmentName') || '';

    const officeName = getElementAttribute(purchaserXml, 'contractingOfficeID', 'name') || 'Unknown Office';
    const officeId = getElementValue(purchaserXml, 'contractingOfficeID') || '';

    // Extract dollar values
    const dollarMatch = entryXml.match(/<ns1:dollarValues>([\s\S]*?)<\/ns1:dollarValues>/i);
    let obligatedAmount = 0;
    if (dollarMatch) {
      const amountStr = getElementValue(dollarMatch[1], 'obligatedAmount');
      obligatedAmount = amountStr ? parseFloat(amountStr) : 0;
    }

    // Extract NAICS info
    const productMatch = entryXml.match(/<ns1:productOrServiceInformation>([\s\S]*?)<\/ns1:productOrServiceInformation>/i);
    let naicsCode = '';
    let naicsDescription = '';
    if (productMatch) {
      naicsCode = getElementValue(productMatch[1], 'principalNAICSCode') || '';
      naicsDescription = getElementAttribute(productMatch[1], 'principalNAICSCode', 'description') || '';
    }

    // Extract vendor info
    const vendorMatch = entryXml.match(/<ns1:vendorHeader>([\s\S]*?)<\/ns1:vendorHeader>/i);
    const vendorName = vendorMatch ? getElementValue(vendorMatch[1], 'vendorName') || 'Unknown Vendor' : 'Unknown Vendor';

    // Extract dates
    const datesMatch = entryXml.match(/<ns1:relevantContractDates>([\s\S]*?)<\/ns1:relevantContractDates>/i);
    let signedDate = '';
    if (datesMatch) {
      signedDate = getElementValue(datesMatch[1], 'signedDate') || '';
    }

    // Extract place of performance
    const popMatch = entryXml.match(/<ns1:placeOfPerformance>([\s\S]*?)<\/ns1:placeOfPerformance>/i);
    let placeOfPerformanceState = '';
    if (popMatch) {
      placeOfPerformanceState = getElementValue(popMatch[1], 'stateCode') || '';
    }

    // Extract vendor socioeconomic indicators
    const socioMatch = entryXml.match(/<ns1:vendorSocioEconomicIndicators>([\s\S]*?)<\/ns1:vendorSocioEconomicIndicators>/i);
    let isSmallBusiness = false;
    let isWomenOwned = false;
    let isVeteranOwned = false;
    let isServiceDisabledVeteranOwned = false;
    let is8aProgram = false;
    let isHubZone = false;

    if (socioMatch) {
      const socioXml = socioMatch[1];
      isSmallBusiness = getElementValue(socioXml, 'isSmallBusiness') === 'true';
      isWomenOwned = getElementValue(socioXml, 'isWomenOwned') === 'true';
      isVeteranOwned = getElementValue(socioXml, 'isVeteranOwned') === 'true';
      isServiceDisabledVeteranOwned = getElementValue(socioXml, 'isServiceRelatedDisabledVeteranOwnedBusiness') === 'true';
    }

    // Extract certifications
    const certMatch = entryXml.match(/<ns1:vendorCertifications>([\s\S]*?)<\/ns1:vendorCertifications>/i);
    if (certMatch) {
      const certXml = certMatch[1];
      is8aProgram = getElementValue(certXml, 'isSBACertified8AProgramParticipant') === 'true';
      isHubZone = getElementValue(certXml, 'isSBACertifiedHUBZone') === 'true';
    }

    return {
      contractingOffice: {
        officeId,
        officeName: cleanOfficeName(officeName),
        agencyId: officeAgencyId,
        agencyName: officeAgencyName,
        departmentId,
        departmentName,
        obligatedAmount,
        contractCount: 1,
      },
      naicsCode,
      naicsDescription,
      vendorName,
      obligatedAmount,
      signedDate,
      placeOfPerformanceState,
      isSmallBusiness,
      isWomenOwned,
      isVeteranOwned,
      isServiceDisabledVeteranOwned,
      is8aProgram,
      isHubZone,
    };
  } catch (error) {
    console.error('Error parsing FPDS award entry:', error);
    return null;
  }
}

// Clean up office name abbreviations
function cleanOfficeName(name: string): string {
  let cleaned = name;

  // Remove DODAAC prefixes (like W6qm, W7nv, etc.)
  cleaned = cleaned.replace(/^[A-Z][0-9][A-Za-z0-9]{2}\s+/i, '');

  // Handle specific patterns first
  // ACA = Army Contracting Activity
  if (/^aca,?\s+/i.test(cleaned)) {
    cleaned = cleaned.replace(/^aca,?\s+/i, 'Army Contracting Activity - ');
  }

  // MICC = Mission and Installation Contracting Command
  if (/micc-?/i.test(cleaned)) {
    cleaned = cleaned.replace(/micc-?/gi, 'MICC ');
  }

  // CONS = Contracting Squadron (Air Force)
  if (/\d+\s*cons/i.test(cleaned)) {
    cleaned = cleaned.replace(/(\d+)\s*cons\/?\w*/gi, (match, num) => {
      const n = parseInt(num);
      const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
      return `${n}${suffix} Contracting Squadron`;
    });
  }

  // Common abbreviation expansions
  const cleanups: Record<string, string> = {
    'NAVFAC ENGINEERING FIELD DIVISIION': 'NAVFAC Engineering Field Division',
    'NAVFAC': 'Naval Facilities Engineering Command',
    'NAVSEA': 'Naval Sea Systems Command',
    'NAVAIR': 'Naval Air Systems Command',
    'NAVWAR': 'Naval Information Warfare Systems Command',
    'SPAWAR': 'Space and Naval Warfare Systems Command',
    'USACE': 'U.S. Army Corps of Engineers',
    'ACC-': 'Army Contracting Command - ',
    'AFMC': 'Air Force Materiel Command',
    'AFLCMC': 'Air Force Life Cycle Management Center',
    'AFSC': 'Air Force Sustainment Center',
    'DLA': 'Defense Logistics Agency',
    'DCMA': 'Defense Contract Management Agency',
    'DISA': 'Defense Information Systems Agency',
    'MDA': 'Missile Defense Agency',
    'NGA': 'National Geospatial-Intelligence Agency',
  };

  // Direct replacement for known abbreviations
  for (const [abbrev, fullName] of Object.entries(cleanups)) {
    if (cleaned.toUpperCase().includes(abbrev)) {
      cleaned = cleaned.replace(new RegExp(abbrev, 'gi'), fullName);
    }
  }

  // Clean up installation names (Ft -> Fort, Jb -> Joint Base)
  cleaned = cleaned.replace(/\bFt\b/gi, 'Fort');
  cleaned = cleaned.replace(/\bJb\b/gi, 'Joint Base');

  // Title case helper function
  const toTitleCase = (str: string): string => {
    return str
      .toLowerCase()
      .split(' ')
      .map(word => {
        if (word.length === 0) return word;
        // Keep acronyms uppercase
        if (['micc', 'usa', 'dod'].includes(word.toLowerCase())) {
          return word.toUpperCase();
        }
        // Handle McXxx names
        if (word.toLowerCase().startsWith('mc') && word.length > 2) {
          return 'Mc' + word.charAt(2).toUpperCase() + word.slice(3).toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  };

  // Title case if contains uppercase words (like FORT CARSON)
  // But preserve "Army Contracting Activity - " prefix
  if (/[A-Z]{2,}/.test(cleaned)) {
    const match = cleaned.match(/^(Army Contracting Activity - |MICC )?(.*)$/);
    if (match) {
      const prefix = match[1] || '';
      const rest = match[2];
      cleaned = prefix + toTitleCase(rest);
    }
  }

  return cleaned;
}

// Fetch FPDS data for a specific NAICS code
export async function fetchFPDSByNaics(
  naicsCode: string,
  options: {
    maxRecords?: number;
    skipHealthCheck?: boolean; // For internal use when we know FPDS is working
  } = {}
): Promise<FPDSSearchResult> {
  const { maxRecords = 100, skipHealthCheck = false } = options;

  // Check FPDS health before making request (unless skipped)
  if (!skipHealthCheck) {
    const isHealthy = await checkFPDSHealth();
    if (!isHealthy) {
      console.log('⚠️ FPDS unhealthy, using SAM.gov fallback');
      return fetchFromSAMContractAPI(naicsCode, { maxRecords });
    }
  }

  // Build query (FPDS returns most recent data first, so no date filter needed)
  const query = buildFPDSQuery({
    naicsCode,
  });

  const url = `${FPDS_BASE_URL}?FEEDNAME=PUBLIC&q=${encodeURIComponent(query)}`;
  console.log(`🔍 FPDS Query: ${url}`);

  const awards: FPDSAward[] = [];
  const offices = new Map<string, FPDSContractingOffice>();
  let currentUrl = url;
  let totalFetched = 0;

  // FPDS returns 10 records per page, fetch multiple pages
  const maxPages = Math.ceil(maxRecords / 10);

  for (let page = 0; page < maxPages && totalFetched < maxRecords; page++) {
    try {
      const response = await fetch(currentUrl, {
        headers: {
          'Accept': 'application/xml',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.error(`FPDS API error: ${response.status}`);
        break;
      }

      const xml = await response.text();

      // Parse entries
      const entryMatches = xml.match(/<entry>([\s\S]*?)<\/entry>/gi);
      if (!entryMatches || entryMatches.length === 0) {
        console.log(`   Page ${page + 1}: No more entries`);
        break;
      }

      for (const entryXml of entryMatches) {
        const award = parseAwardEntry(entryXml);
        if (award) {
          awards.push(award);

          // Aggregate by office
          const officeKey = `${award.contractingOffice.officeId}|${award.contractingOffice.officeName}`;
          const existing = offices.get(officeKey);
          if (existing) {
            existing.obligatedAmount += award.obligatedAmount;
            existing.contractCount += 1;
          } else {
            offices.set(officeKey, { ...award.contractingOffice });
          }
        }
      }

      totalFetched += entryMatches.length;
      console.log(`   Page ${page + 1}: ${entryMatches.length} entries (total: ${totalFetched})`);

      // Get next page URL
      const nextMatch = xml.match(/<link rel="next"[^>]*href="([^"]+)"/i);
      if (nextMatch) {
        // Decode HTML entities in URL
        currentUrl = nextMatch[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
      } else {
        break;
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error fetching FPDS page ${page + 1}:`, error);
      consecutiveFailures++;

      // If we're seeing failures mid-request, mark as unhealthy
      if (consecutiveFailures >= MAX_FAILURES_BEFORE_FALLBACK && awards.length === 0) {
        fpdsHealthy = false;
        console.log('⚠️ FPDS failed during fetch, switching to SAM.gov fallback');
        return fetchFromSAMContractAPI(naicsCode, { maxRecords });
      }

      break;
    }
  }

  // If we got results, reset failure counter
  if (awards.length > 0) {
    consecutiveFailures = 0;
    fpdsHealthy = true;
  }

  return {
    awards,
    totalCount: awards.length,
    offices,
  };
}

// Fetch FPDS data for DoD with specific commands/offices
export async function fetchFPDSForDoD(
  naicsCode: string,
  options: {
    maxRecords?: number;
    department?: 'NAVY' | 'ARMY' | 'AIR FORCE' | 'DEFENSE';
  } = {}
): Promise<FPDSSearchResult> {
  const { maxRecords = 200, department } = options;

  // For DoD, we want to get data that shows specific commands
  // We'll search by NAICS and aggregate by contracting office

  const offices = ['NAVFAC', 'NAVSEA', 'NAVAIR', 'USACE', 'ACC', 'AFMC'];
  const allAwards: FPDSAward[] = [];
  const allOffices = new Map<string, FPDSContractingOffice>();

  // Fetch by NAICS first
  const naicsResults = await fetchFPDSByNaics(naicsCode, { maxRecords });

  for (const award of naicsResults.awards) {
    allAwards.push(award);

    const officeKey = `${award.contractingOffice.officeId}|${award.contractingOffice.officeName}`;
    const existing = allOffices.get(officeKey);
    if (existing) {
      existing.obligatedAmount += award.obligatedAmount;
      existing.contractCount += 1;
    } else {
      allOffices.set(officeKey, { ...award.contractingOffice });
    }
  }

  return {
    awards: allAwards,
    totalCount: allAwards.length,
    offices: allOffices,
  };
}

// Detect the specific DoD command from office name (for pain points matching)
function detectCommand(officeName: string, officeId: string): string | null {
  const nameUpper = officeName.toUpperCase();

  // Navy Commands
  if (nameUpper.includes('NAVFAC') || nameUpper.includes('NAVAL FACILITIES')) {
    return 'NAVFAC';
  }
  if (nameUpper.includes('NAVSEA') || nameUpper.includes('NAVAL SEA SYSTEMS')) {
    return 'NAVSEA';
  }
  if (nameUpper.includes('NAVAIR') || nameUpper.includes('NAVAL AIR SYSTEMS') || nameUpper.includes('NAVAL AIR WARFARE')) {
    return 'NAVAIR';
  }
  if (nameUpper.includes('NAVWAR') || nameUpper.includes('SPAWAR') || nameUpper.includes('NAVAL INFORMATION WARFARE')) {
    return 'NAVWAR';
  }
  if (nameUpper.includes('MARINE CORPS SYSTEMS COMMAND') || nameUpper.includes('MARCORSYSCOM')) {
    return 'Marine Corps Systems Command';
  }
  if (nameUpper.includes('NAVAL SPECIAL WARFARE')) {
    return 'Department of the Navy'; // Falls back to Navy pain points
  }

  // Army Commands
  if (nameUpper.includes('USACE') || nameUpper.includes('CORPS OF ENGINEERS') || nameUpper.includes('ENGINEER DISTRICT')) {
    return 'USACE';
  }
  if (nameUpper.includes('ARMY CONTRACTING COMMAND') || nameUpper.includes('ACC-') || officeId?.startsWith('W50S')) {
    return 'Army Contracting Command';
  }
  if (nameUpper.includes('ARMY MATERIEL COMMAND') || nameUpper.includes('AMC')) {
    return 'Army Materiel Command';
  }
  if (nameUpper.includes('MICC') || nameUpper.includes('MISSION AND INSTALLATION CONTRACTING')) {
    return 'Army Contracting Command'; // MICC is part of ACC
  }
  if (nameUpper.includes('TACOM') || nameUpper.includes('TANK-AUTOMOTIVE')) {
    return 'Army Materiel Command'; // TACOM is part of AMC
  }
  if (nameUpper.includes('CECOM') || nameUpper.includes('COMMUNICATIONS-ELECTRONICS')) {
    return 'Army Materiel Command'; // CECOM is part of AMC
  }
  if (nameUpper.includes('AMCOM') || nameUpper.includes('AVIATION AND MISSILE')) {
    return 'Army Materiel Command'; // AMCOM is part of AMC
  }
  if (nameUpper.includes('USPFO') || nameUpper.includes('PROPERTY AND FISCAL')) {
    return 'Department of the Army'; // National Guard offices
  }

  // Air Force Commands
  if (nameUpper.includes('AFMC') || nameUpper.includes('AIR FORCE MATERIEL COMMAND')) {
    return 'Air Force Materiel Command';
  }
  if (nameUpper.includes('AFLCMC') || nameUpper.includes('LIFE CYCLE MANAGEMENT')) {
    return 'Air Force Materiel Command'; // AFLCMC is part of AFMC
  }
  if (nameUpper.includes('AFSC') || nameUpper.includes('AIR FORCE SUSTAINMENT')) {
    return 'Air Force Sustainment Center';
  }
  if (nameUpper.includes('CONTRACTING SQUADRON') || nameUpper.match(/\d+\s*CONS/i)) {
    return 'Department of the Air Force'; // Falls back to Air Force pain points
  }
  if (nameUpper.includes('SPACE SYSTEMS COMMAND') || nameUpper.includes('SSC')) {
    return 'Space Systems Command';
  }

  // Defense Agencies
  if (nameUpper.includes('DLA') || nameUpper.includes('DEFENSE LOGISTICS')) {
    return 'Defense Logistics Agency';
  }
  if (nameUpper.includes('DISA') || nameUpper.includes('DEFENSE INFORMATION SYSTEMS')) {
    return 'Defense Information Systems Agency';
  }
  if (nameUpper.includes('DCMA') || nameUpper.includes('DEFENSE CONTRACT MANAGEMENT')) {
    return 'Defense Contract Management Agency';
  }
  if (nameUpper.includes('MDA') || nameUpper.includes('MISSILE DEFENSE')) {
    return 'Missile Defense Agency';
  }
  if (nameUpper.includes('DARPA') || nameUpper.includes('DEFENSE ADVANCED RESEARCH')) {
    return 'DARPA';
  }
  if (nameUpper.includes('DHA') || nameUpper.includes('DEFENSE HEALTH')) {
    return 'Defense Health Agency';
  }

  return null; // No specific command detected
}

// Detect service branch from office name and code
function detectServiceBranch(officeName: string, officeId: string, agencyName: string): string {
  const nameUpper = officeName.toUpperCase();
  const agencyUpper = agencyName.toUpperCase();

  // Check agency name first (most reliable if available)
  if (agencyUpper.includes('NAVY') || agencyUpper.includes('MARINE')) {
    return 'Department of the Navy';
  }
  if (agencyUpper.includes('ARMY')) {
    return 'Department of the Army';
  }
  if (agencyUpper.includes('AIR FORCE')) {
    return 'Department of the Air Force';
  }

  // Navy indicators in office name
  if (nameUpper.includes('NAVAL') || nameUpper.includes('NAVY') ||
      nameUpper.includes('NAVFAC') || nameUpper.includes('NAVSEA') ||
      nameUpper.includes('NAVAIR') || nameUpper.includes('NAVWAR') ||
      nameUpper.includes('SPAWAR') || nameUpper.includes('MARINE') ||
      nameUpper.includes('FLEET') || nameUpper.includes('SUBMARINE')) {
    return 'Department of the Navy';
  }

  // Army indicators in office name
  if (nameUpper.includes('ARMY') || nameUpper.includes('FORT ') ||
      nameUpper.includes('MICC') || nameUpper.includes('USACE') ||
      nameUpper.includes('ACC ') || nameUpper.includes('ACA ') ||
      nameUpper.includes('TACOM') || nameUpper.includes('CECOM') ||
      nameUpper.includes('AMCOM') || nameUpper.includes('PEO ')) {
    return 'Department of the Army';
  }

  // Air Force indicators in office name
  if (nameUpper.includes('AIR FORCE') || nameUpper.includes('AFMC') ||
      nameUpper.includes('AFLCMC') || nameUpper.includes('CONTRACTING SQUADRON') ||
      nameUpper.includes('CONS') || nameUpper.includes('AFDW') ||
      nameUpper.includes('AFSPC') || nameUpper.includes('USAF')) {
    return 'Department of the Air Force';
  }

  // Check office ID prefix patterns
  // N = Navy, M = Marines, W = Army, F/FA = Air Force, H = Special programs (often Navy)
  if (officeId) {
    const prefix = officeId.charAt(0).toUpperCase();
    if (prefix === 'N' || prefix === 'M') {
      return 'Department of the Navy';
    }
    if (prefix === 'W') {
      return 'Department of the Army';
    }
    if (prefix === 'F') {
      return 'Department of the Air Force';
    }
    if (prefix === 'H') {
      // H codes are often special programs - check second char
      const second = officeId.charAt(1);
      if (second === '9') return 'Department of the Navy'; // H9 is often Navy special warfare
      return 'Department of Defense'; // Generic DoD
    }
  }

  // Default to what FPDS provided or generic DoD
  if (agencyName && !agencyUpper.includes('DEFENSE')) {
    return agencyName;
  }
  return 'Department of Defense';
}

// Map FPDS office data to Agency format for the UI
export function mapFPDSToAgencies(fpdsResult: FPDSSearchResult): Array<{
  id: string;
  name: string;
  contractingOffice: string;
  subAgency: string;
  parentAgency: string;
  setAsideSpending: number;
  contractCount: number;
  location: string;
  officeId: string;
  subAgencyCode: string;
  command?: string; // The specific DoD command for pain points matching
}> {
  const agencies: Array<{
    id: string;
    name: string;
    contractingOffice: string;
    subAgency: string;
    parentAgency: string;
    setAsideSpending: number;
    contractCount: number;
    location: string;
    officeId: string;
    subAgencyCode: string;
    command?: string;
  }> = [];

  for (const [key, office] of fpdsResult.offices) {
    // Detect service branch from office details
    const serviceBranch = detectServiceBranch(office.officeName, office.officeId, office.agencyName);

    // Detect specific command for pain points matching
    const command = detectCommand(office.officeName, office.officeId);

    // Translate cryptic office name to readable format
    const translatedName = translateOfficeName(office.officeName, office.officeId);

    agencies.push({
      id: key,
      name: translatedName,
      contractingOffice: translatedName,
      subAgency: serviceBranch,
      parentAgency: serviceBranch, // Use service branch as parent for OSBP lookup (e.g., "Department of the Navy")
      setAsideSpending: office.obligatedAmount,
      contractCount: office.contractCount,
      location: 'USA', // FPDS doesn't aggregate by location
      officeId: office.officeId,
      subAgencyCode: office.agencyId,
      command: command || undefined, // Include command if detected
    });
  }

  // Sort by spending
  agencies.sort((a, b) => b.setAsideSpending - a.setAsideSpending);

  return agencies;
}

// Export types
export type { FPDSContractingOffice, FPDSAward, FPDSSearchResult };
