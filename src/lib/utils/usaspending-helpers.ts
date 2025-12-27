// USAspending API Helper Functions
import type { AlternativeSearchOption } from '@/types/federal-market-assassin';

// Map business types to USAspending set-aside codes
export const setAsideMap: Record<string, string[]> = {
  'Women Owned': ['WOSB', 'EDWOSB'],
  'HUBZone': ['HZBZ', 'HUBZ'],
  '8(a) Certified': ['8A', '8AN', '8A COMPETED', '8A SOLE SOURCE'],
  'Small Business': ['SBA', 'SBP', 'SMALL BUSINESS SET-ASIDE', 'TOTAL SMALL BUSINESS SET-ASIDE (FAR 19.5)'],
  'DOT Certified': ['SBP'],
  'Native American/Tribal': ['IND']
};

export const veteranMap: Record<string, string[]> = {
  'Veteran Owned': ['VOSB', 'VO'],
  'Service Disabled Veteran': ['SDVOSB', 'SDVOSBC']
};

// NAICS expansion mapping for common prefixes
export const naicsExpansion: Record<string, string[]> = {
  // 2-digit sector expansions
  '23': ['236115', '236116', '236117', '236118', '236210', '236220', '237110', '237120', '237130', '237210', '237310', '237990', '238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190', '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350', '238390', '238910', '238990'],
  '54': ['541110', '541120', '541191', '541199', '541211', '541213', '541214', '541219', '541310', '541320', '541330', '541340', '541350', '541360', '541370', '541380', '541410', '541420', '541430', '541490', '541511', '541512', '541513', '541519', '541611', '541612', '541613', '541614', '541618', '541620', '541690', '541713', '541714', '541715', '541720', '541810', '541820', '541830', '541840', '541850', '541860', '541870', '541890', '541910', '541921', '541922', '541930', '541940', '541990'],
  '56': ['561110', '561210', '561311', '561312', '561320', '561330', '561410', '561421', '561422', '561431', '561439', '561440', '561450', '561491', '561492', '561499', '561510', '561520', '561591', '561599', '561611', '561612', '561613', '561621', '561622', '561710', '561720', '561730', '561740', '561790', '561910', '561920', '561990', '562111', '562112', '562119', '562211', '562212', '562213', '562219', '562910', '562920', '562991', '562998'],
  '81': ['811111', '811112', '811113', '811118', '811121', '811122', '811191', '811192', '811198', '811211', '811212', '811213', '811219', '811310', '811411', '811412', '811420', '811430', '811490', '812111', '812112', '812113', '812191', '812199', '812210', '812220', '812310', '812320', '812331', '812332', '812910', '812921', '812922', '812930', '812990', '813110', '813211', '813212', '813219', '813311', '813312', '813319', '813410', '813910', '813920', '813930', '813940', '813990'],
  // 3-digit subsector expansions
  '236': ['236115', '236116', '236117', '236118', '236210', '236220'],
  '237': ['237110', '237120', '237130', '237210', '237310', '237990'],
  '238': ['238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190', '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350', '238390', '238910', '238990'],
  '541': ['541110', '541120', '541191', '541199', '541211', '541213', '541214', '541219', '541310', '541320', '541330', '541340', '541350', '541360', '541370', '541380', '541410', '541420', '541430', '541490', '541511', '541512', '541513', '541519', '541611', '541612', '541613', '541614', '541618', '541620', '541690', '541713', '541714', '541715', '541720', '541810', '541820', '541830', '541840', '541850', '541860', '541870', '541890', '541910', '541921', '541922', '541930', '541940', '541990'],
  '561': ['561110', '561210', '561311', '561312', '561320', '561330', '561410', '561421', '561422', '561431', '561439', '561440', '561450', '561491', '561492', '561499', '561510', '561520', '561591', '561599', '561611', '561612', '561613', '561621', '561622', '561710', '561720', '561730', '561740', '561790', '561910', '561920', '561990'],
  '518': ['518210'],
  '423': ['423110', '423120', '423130', '423140', '423210', '423220', '423310', '423320', '423330', '423390', '423410', '423420', '423430', '423440', '423450', '423460', '423490', '423510', '423520', '423610', '423620', '423690', '423710', '423720', '423730', '423740', '423810', '423820', '423830', '423840', '423850', '423860', '423910', '423920', '423930', '423940', '423990'],
  '811': ['811111', '811112', '811113', '811118', '811121', '811122', '811191', '811192', '811198', '811211', '811212', '811213', '811219', '811310', '811411', '811412', '811420', '811430', '811490'],
  '812': ['812111', '812112', '812113', '812191', '812199', '812210', '812220', '812310', '812320', '812331', '812332', '812910', '812921', '812922', '812930', '812990'],
  '813': ['813110', '813211', '813212', '813219', '813311', '813312', '813319', '813410', '813910', '813920', '813930', '813940', '813990'],
};

// Industry names for NAICS prefixes
export const industryNames: Record<string, string> = {
  // 2-digit sectors
  '23': 'Construction',
  '54': 'Professional, Scientific, and Technical Services',
  '56': 'Administrative and Support and Waste Management',
  '81': 'Other Services (except Public Administration)',
  // 3-digit subsectors
  '811': 'Repair and Maintenance',
  '812': 'Personal and Laundry Services',
  '813': 'Religious, Grantmaking, Civic, Professional Organizations',
  '541': 'Professional, Scientific, and Technical Services',
  '561': 'Administrative and Support Services',
  '236': 'Construction of Buildings',
  '237': 'Heavy and Civil Engineering Construction',
  '238': 'Specialty Trade Contractors',
  '518': 'Data Processing and Hosting',
  '423': 'Merchant Wholesalers, Durable Goods'
};

// Office name enhancements
export const officeNameEnhancements: Record<string, string> = {
  'Endist Omaha': 'U.S. Army Engineer District, Omaha',
  'W071': 'U.S. Army Engineer District, Omaha',
  'Endist Sacramento': 'U.S. Army Engineer District, Sacramento',
  'Endist Louisville': 'U.S. Army Engineer District, Louisville',
  'Endist Norfolk': 'U.S. Army Engineer District, Norfolk',
  'USA Eng Spt Ctr Huntsvil': 'U.S. Army Engineering and Support Center, Huntsville, Alabama',
  '2V6': 'U.S. Army Engineering and Support Center, Huntsville, Alabama',
  'ACC-PICA': 'Army Contracting Command - Program Integration and Contracting Activity',
  'W6QK': 'Army Contracting Command',
  'ACC-APG Natick': 'Army Contracting Command - Aberdeen Proving Ground, Natick',
  'ACC-RSA': 'Army Contracting Command - Redstone Arsenal',
  'ACC-APG': 'Army Contracting Command - Aberdeen Proving Ground',
  'Afmc Wpafb Oh': 'Air Force Materiel Command - Wright-Patterson AFB, Ohio',
  'Afsc Maxwell Afb Al': 'Air Force Sustainment Center - Maxwell AFB, Alabama',
  '772 ESS PKD': '772 Enterprise Sourcing Squadron - Wright-Patterson AFB',
  'Navfac Northwest': 'Naval Facilities Engineering Command Northwest',
  'Navfac Atlantic': 'Naval Facilities Engineering Command Atlantic',
  'Navfac Pacific': 'Naval Facilities Engineering Command Pacific',
  'Navsup Flc Norfolk': 'Naval Supply Systems Command Fleet Logistics Center Norfolk',
  'Cbp Oaq': 'U.S. Customs and Border Protection - Office of Acquisition',
  'Svc': 'Service',
  'Dept': 'Department',
  'Hq': 'Headquarters',
  'Cmd': 'Command',
  'Ctr': 'Center'
};

export function enhanceOfficeName(officeName: string | null): string | null {
  if (!officeName) return officeName;

  // Check for direct match
  if (officeNameEnhancements[officeName]) {
    return officeNameEnhancements[officeName];
  }

  // Check for partial matches
  for (const [abbrev, fullName] of Object.entries(officeNameEnhancements)) {
    if (officeName.includes(abbrev)) {
      return fullName;
    }
  }

  return officeName;
}

// State mapping (ZIP code to state) - Comprehensive implementation
export function getStateFromZip(zip: string): string | null {
  const zipNum = parseInt(zip.substring(0, 3));

  // New England
  if (zipNum >= 10 && zipNum <= 27) return 'MA';
  if (zipNum >= 28 && zipNum <= 29) return 'RI';
  if (zipNum >= 30 && zipNum <= 38) return 'NH';
  if (zipNum >= 39 && zipNum <= 49) return 'ME';
  if (zipNum >= 50 && zipNum <= 54) return 'VT';
  if (zipNum >= 60 && zipNum <= 69) return 'CT';

  // Mid-Atlantic
  if (zipNum >= 70 && zipNum <= 89) return 'NJ';
  if (zipNum >= 100 && zipNum <= 149) return 'NY';
  if (zipNum >= 150 && zipNum <= 196) return 'PA';
  if (zipNum >= 197 && zipNum <= 199) return 'DE';

  // DC/MD/VA Area
  if (zipNum >= 200 && zipNum <= 205) return 'DC';
  if (zipNum >= 206 && zipNum <= 219) return 'MD';
  if (zipNum >= 220 && zipNum <= 246) return 'VA';
  if (zipNum >= 247 && zipNum <= 268) return 'WV';

  // Southeast
  if (zipNum >= 270 && zipNum <= 289) return 'NC';
  if (zipNum >= 290 && zipNum <= 299) return 'SC';
  if (zipNum >= 300 && zipNum <= 319) return 'GA';
  if (zipNum >= 320 && zipNum <= 349) return 'FL';
  if (zipNum >= 350 && zipNum <= 369) return 'AL';
  if (zipNum >= 370 && zipNum <= 385) return 'TN';
  if (zipNum >= 386 && zipNum <= 397) return 'MS';
  if (zipNum >= 400 && zipNum <= 427) return 'KY';

  // Midwest
  if (zipNum >= 430 && zipNum <= 459) return 'OH';
  if (zipNum >= 460 && zipNum <= 479) return 'IN';
  if (zipNum >= 480 && zipNum <= 499) return 'MI';
  if (zipNum >= 500 && zipNum <= 528) return 'IA';
  if (zipNum >= 530 && zipNum <= 549) return 'WI';
  if (zipNum >= 550 && zipNum <= 567) return 'MN';
  if (zipNum >= 570 && zipNum <= 577) return 'SD';
  if (zipNum >= 580 && zipNum <= 588) return 'ND';
  if (zipNum >= 590 && zipNum <= 599) return 'MT';
  if (zipNum >= 600 && zipNum <= 629) return 'IL';
  if (zipNum >= 630 && zipNum <= 658) return 'MO';
  if (zipNum >= 660 && zipNum <= 679) return 'KS';
  if (zipNum >= 680 && zipNum <= 693) return 'NE';

  // South Central
  if (zipNum >= 700 && zipNum <= 714) return 'LA';
  if (zipNum >= 716 && zipNum <= 729) return 'AR';
  if (zipNum >= 730 && zipNum <= 749) return 'OK';
  if (zipNum >= 750 && zipNum <= 799) return 'TX';

  // Mountain West
  if (zipNum >= 800 && zipNum <= 816) return 'CO';
  if (zipNum >= 820 && zipNum <= 831) return 'WY';
  if (zipNum >= 832 && zipNum <= 838) return 'ID';
  if (zipNum >= 840 && zipNum <= 847) return 'UT';
  if (zipNum >= 850 && zipNum <= 865) return 'AZ';
  if (zipNum >= 870 && zipNum <= 884) return 'NM';
  if (zipNum >= 889 && zipNum <= 898) return 'NV';

  // Pacific
  if (zipNum >= 900 && zipNum <= 961) return 'CA';
  if (zipNum >= 967 && zipNum <= 968) return 'HI';
  if (zipNum >= 970 && zipNum <= 979) return 'OR';
  if (zipNum >= 980 && zipNum <= 994) return 'WA';
  if (zipNum >= 995 && zipNum <= 999) return 'AK';

  return null;
}

// Comprehensive bordering states mapping
const stateBorders: Record<string, string[]> = {
  // New England
  'ME': ['NH'],
  'NH': ['ME', 'VT', 'MA'],
  'VT': ['NH', 'MA', 'NY'],
  'MA': ['NH', 'VT', 'NY', 'CT', 'RI'],
  'RI': ['MA', 'CT'],
  'CT': ['MA', 'RI', 'NY'],

  // Mid-Atlantic
  'NY': ['VT', 'MA', 'CT', 'NJ', 'PA'],
  'NJ': ['NY', 'PA', 'DE'],
  'PA': ['NY', 'NJ', 'DE', 'MD', 'WV', 'OH'],
  'DE': ['PA', 'MD', 'NJ'],

  // DC/MD/VA Area
  'DC': ['VA', 'MD'],
  'MD': ['VA', 'DC', 'WV', 'PA', 'DE'],
  'VA': ['MD', 'DC', 'WV', 'KY', 'TN', 'NC'],
  'WV': ['VA', 'MD', 'PA', 'OH', 'KY'],

  // Southeast
  'NC': ['VA', 'TN', 'GA', 'SC'],
  'SC': ['NC', 'GA'],
  'GA': ['FL', 'AL', 'TN', 'NC', 'SC'],
  'FL': ['GA', 'AL'],
  'AL': ['FL', 'GA', 'TN', 'MS'],
  'TN': ['KY', 'VA', 'NC', 'GA', 'AL', 'MS', 'AR', 'MO'],
  'MS': ['TN', 'AL', 'LA', 'AR'],
  'KY': ['IN', 'OH', 'WV', 'VA', 'TN', 'MO', 'IL'],

  // Midwest
  'OH': ['PA', 'WV', 'KY', 'IN', 'MI'],
  'IN': ['MI', 'OH', 'KY', 'IL'],
  'MI': ['OH', 'IN', 'WI'],
  'IL': ['WI', 'IN', 'KY', 'MO', 'IA'],
  'WI': ['MI', 'IL', 'IA', 'MN'],
  'MN': ['WI', 'IA', 'SD', 'ND'],
  'IA': ['MN', 'WI', 'IL', 'MO', 'NE', 'SD'],
  'MO': ['IA', 'IL', 'KY', 'TN', 'AR', 'OK', 'KS', 'NE'],

  // Great Plains
  'ND': ['MN', 'SD', 'MT'],
  'SD': ['ND', 'MN', 'IA', 'NE', 'WY', 'MT'],
  'NE': ['SD', 'IA', 'MO', 'KS', 'CO', 'WY'],
  'KS': ['NE', 'MO', 'OK', 'CO'],

  // South Central
  'LA': ['TX', 'AR', 'MS'],
  'AR': ['MO', 'TN', 'MS', 'LA', 'TX', 'OK'],
  'OK': ['KS', 'MO', 'AR', 'TX', 'NM', 'CO'],
  'TX': ['LA', 'AR', 'OK', 'NM'],

  // Mountain West
  'MT': ['ND', 'SD', 'WY', 'ID'],
  'WY': ['MT', 'SD', 'NE', 'CO', 'UT', 'ID'],
  'CO': ['WY', 'NE', 'KS', 'OK', 'NM', 'AZ', 'UT'],
  'NM': ['CO', 'OK', 'TX', 'AZ'],
  'AZ': ['CA', 'NV', 'UT', 'CO', 'NM'],
  'UT': ['ID', 'WY', 'CO', 'AZ', 'NV'],
  'ID': ['MT', 'WY', 'UT', 'NV', 'OR', 'WA'],
  'NV': ['CA', 'OR', 'ID', 'UT', 'AZ'],

  // Pacific
  'WA': ['ID', 'OR'],
  'OR': ['WA', 'ID', 'NV', 'CA'],
  'CA': ['OR', 'NV', 'AZ'],

  // Non-contiguous
  'AK': [],
  'HI': [],
};

// Get bordering states (Tier 1 - immediate neighbors)
export function getBorderingStates(state: string): string[] {
  return stateBorders[state] || [];
}

// Get extended region states (Tier 2 - neighbors of neighbors, ~100-200 mile radius)
export function getExtendedRegionStates(state: string): string[] {
  const tier1 = getBorderingStates(state);
  const tier2Set = new Set<string>();

  // Add all states that border our bordering states
  for (const borderState of tier1) {
    const tier2States = getBorderingStates(borderState);
    for (const s of tier2States) {
      if (s !== state && !tier1.includes(s)) {
        tier2Set.add(s);
      }
    }
  }

  return Array.from(tier2Set);
}

// Get states in progressive tiers for search expansion
export function getStatesByTier(state: string): {
  tier1: string[];  // Just the state
  tier2: string[];  // State + bordering states
  tier3: string[];  // State + bordering + extended region
  nationwide: null; // All states (no filter)
} {
  const bordering = getBorderingStates(state);
  const extended = getExtendedRegionStates(state);

  return {
    tier1: [state],
    tier2: [state, ...bordering],
    tier3: [state, ...bordering, ...extended],
    nationwide: null,
  };
}


/**
 * Generate alternative search options when no results are found
 * Progressively relaxes filters to find more results
 */
export function generateAlternativeSearchOptions(inputs: {
  businessType?: string;
  naicsCode?: string;
  zipCode?: string;
  veteranStatus?: string;
  goodsOrServices?: string;
}): AlternativeSearchOption[] {
  const alternatives: AlternativeSearchOption[] = [];
  
  // Alternative 1: Remove location filter (keep NAICS and set-aside)
  if (inputs.zipCode) {
    alternatives.push({
      label: 'Expand to All Locations',
      description: `Remove location restriction (${inputs.zipCode}) but keep your NAICS code and business type filters`,
      filters: {
        naicsCode: inputs.naicsCode,
        businessType: inputs.businessType,
        veteranStatus: inputs.veteranStatus,
        zipCode: null,
      }
    });
  }

  // Alternative 2: Expand NAICS to 3-digit prefix
  if (inputs.naicsCode && inputs.naicsCode.length >= 4) {
    const prefix = inputs.naicsCode.substring(0, 3);
    if (naicsExpansion[prefix]) {
      const industryName = industryNames[prefix] || `${prefix}xx industry`;
      alternatives.push({
        label: `Expand to ${prefix}xx Industry (${industryName})`,
        description: `Search all codes in the ${prefix}xx industry category instead of just ${inputs.naicsCode}`,
        filters: {
          naicsCode: prefix,
          businessType: inputs.businessType,
          veteranStatus: inputs.veteranStatus,
          zipCode: inputs.zipCode,
        }
      });
    }
  }

  // Alternative 3: Remove set-aside restrictions (keep NAICS and location)
  if (inputs.businessType || inputs.veteranStatus) {
    alternatives.push({
      label: 'Remove Business Type Filter',
      description: 'Search all business types but keep your NAICS code and location filters',
      filters: {
        naicsCode: inputs.naicsCode,
        businessType: null,
        veteranStatus: null,
        zipCode: inputs.zipCode,
      }
    });
  }

  // Alternative 4: Remove both location and set-aside (keep NAICS only)
  if (inputs.zipCode && (inputs.businessType || inputs.veteranStatus)) {
    alternatives.push({
      label: 'Keep NAICS Only',
      description: `Remove location and business type filters, search only by NAICS code ${inputs.naicsCode}`,
      filters: {
        naicsCode: inputs.naicsCode,
        businessType: null,
        veteranStatus: null,
        zipCode: null,
      }
    });
  }

  // Alternative 5: Expand NAICS to 3-digit and remove location
  if (inputs.naicsCode && inputs.naicsCode.length >= 4 && inputs.zipCode) {
    const prefix = inputs.naicsCode.substring(0, 3);
    if (naicsExpansion[prefix]) {
      const industryName = industryNames[prefix] || `${prefix}xx industry`;
      alternatives.push({
        label: `Expand to ${prefix}xx Industry, All Locations`,
        description: `Search all codes in ${prefix}xx industry across all locations`,
        filters: {
          naicsCode: prefix,
          businessType: inputs.businessType,
          veteranStatus: inputs.veteranStatus,
          zipCode: null,
        }
      });
    }
  }

  // Alternative 6: Remove all filters except set-aside
  if (inputs.naicsCode && inputs.zipCode && (inputs.businessType || inputs.veteranStatus)) {
    alternatives.push({
      label: 'Keep Business Type Only',
      description: 'Remove NAICS and location filters, search only by your business type',
      filters: {
        naicsCode: null,
        businessType: inputs.businessType,
        veteranStatus: inputs.veteranStatus,
        zipCode: null,
      }
    });
  }

  // Alternative 7: Remove all filters (broadest search)
  if (inputs.naicsCode || inputs.zipCode || inputs.businessType || inputs.veteranStatus) {
    alternatives.push({
      label: 'Remove All Filters',
      description: 'Perform the broadest search with no filters applied',
      filters: {
        naicsCode: null,
        businessType: null,
        veteranStatus: null,
        zipCode: null,
      }
    });
  }

  return alternatives;
}

/**
 * Quick test search to estimate result count for an alternative search option
 * This makes a minimal API call to get result count
 */
export async function estimateAlternativeSearchResults(
  filters: AlternativeSearchOption['filters']
): Promise<number> {
  try {
    const apiFilters: any = {
      award_type_codes: ['A', 'B', 'C', 'D'],
      time_period: [{
        start_date: '2022-10-01',
        end_date: '2025-09-30'
      }]
    };

    // Add NAICS filter if provided
    if (filters.naicsCode) {
      const trimmedNaics = filters.naicsCode.trim();
      if (trimmedNaics.length === 3) {
        const expandedCodes = naicsExpansion[trimmedNaics];
        if (expandedCodes && expandedCodes.length > 0) {
          apiFilters.naics_codes = expandedCodes;
        } else {
          apiFilters.naics_codes = [trimmedNaics];
        }
      } else {
        apiFilters.naics_codes = [trimmedNaics];
      }
    }

    // Add set-aside filter if provided
    const setAsideTypeCodes: string[] = [];
    if (filters.businessType && setAsideMap[filters.businessType]) {
      setAsideTypeCodes.push(...setAsideMap[filters.businessType]);
    }
    if (filters.veteranStatus && veteranMap[filters.veteranStatus]) {
      setAsideTypeCodes.push(...veteranMap[filters.veteranStatus]);
    }
    if (setAsideTypeCodes.length > 0) {
      apiFilters.set_aside_type_codes = setAsideTypeCodes;
    }

    // Add location filter if provided
    if (filters.zipCode) {
      const stateFromZip = getStateFromZip(filters.zipCode);
      if (stateFromZip) {
        const borderingStates = getBorderingStates(stateFromZip);
        const stateCodes = [stateFromZip, ...borderingStates];
        apiFilters.place_of_performance_locations = stateCodes.map(state => ({
          country: 'USA',
          state: state
        }));
      }
    }

    const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: apiFilters,
        fields: ['Award ID'],
        page: 1,
        limit: 100,
        order: 'desc',
        sort: 'Award Amount'
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return 0;

    const data = await response.json();
    
    // Estimate based on first page results
    if (data?.results && data.results.length > 0) {
      // If we got 100 results, there are likely more
      if (data.results.length === 100) {
        return 500; // Estimate "500+"
      }
      // Otherwise, return actual count (this is just first page, so multiply by estimated pages)
      return data.results.length * 5; // Rough estimate
    }
    
    return 0;
  } catch (error) {
    console.error('Error estimating alternative search results:', error);
    return 0;
  }
}
