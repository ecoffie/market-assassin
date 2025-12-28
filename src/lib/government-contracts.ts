// Helper utilities for government contract search

// Map zip code to state
export function getStateFromZip(zipCode: string): string | null {
  if (!zipCode || zipCode.length < 5) return null;
  const zip = parseInt(zipCode.substring(0, 5));

  const zipRanges: Record<string, number[][]> = {
    'AL': [[35000, 36999]], 'AK': [[99500, 99999]], 'AZ': [[85000, 86599]],
    'AR': [[71600, 72999]], 'CA': [[90000, 96199]], 'CO': [[80000, 81699]],
    'CT': [[6000, 6999]], 'DE': [[19700, 19999]], 'FL': [[32000, 34999]],
    'GA': [[30000, 31999]], 'HI': [[96700, 96899]], 'ID': [[83200, 83899]],
    'IL': [[60000, 62999]], 'IN': [[46000, 47999]], 'IA': [[50000, 52999]],
    'KS': [[66000, 67999]], 'KY': [[40000, 42799]], 'LA': [[70000, 71599]],
    'ME': [[3900, 4999]], 'MD': [[20600, 21999]], 'MA': [[1000, 2799]],
    'MI': [[48000, 49999]], 'MN': [[55000, 56799]], 'MS': [[38600, 39799]],
    'MO': [[63000, 65899]], 'MT': [[59000, 59999]], 'NE': [[68000, 69399]],
    'NV': [[88900, 89899]], 'NH': [[3000, 3899]], 'NJ': [[7000, 8999]],
    'NM': [[87000, 88499]], 'NY': [[10000, 14999]], 'NC': [[27000, 28999]],
    'ND': [[58000, 58899]], 'OH': [[43000, 45999]], 'OK': [[73000, 74999]],
    'OR': [[97000, 97999]], 'PA': [[15000, 19699]], 'RI': [[2800, 2999]],
    'SC': [[29000, 29999]], 'SD': [[57000, 57799]], 'TN': [[37000, 38599]],
    'TX': [[75000, 79999], [88500, 88599]], 'UT': [[84000, 84799]],
    'VT': [[5000, 5999]], 'VA': [[20100, 20199], [22000, 24699]],
    'WA': [[98000, 99499]], 'WV': [[24700, 26899]], 'WI': [[53000, 54999]],
    'WY': [[82000, 83199]], 'DC': [[20000, 20099], [20200, 20599]]
  };

  for (const [state, ranges] of Object.entries(zipRanges)) {
    for (const [min, max] of ranges) {
      if (zip >= min && zip <= max) {
        return state;
      }
    }
  }

  return null;
}

// Get bordering states for a given state
export function getBorderingStates(state: string): string[] {
  const borders: Record<string, string[]> = {
    'AL': ['FL', 'GA', 'MS', 'TN'],
    'AK': [],
    'AZ': ['CA', 'NV', 'UT', 'NM'],
    'AR': ['LA', 'MS', 'MO', 'OK', 'TN', 'TX'],
    'CA': ['AZ', 'NV', 'OR'],
    'CO': ['KS', 'NE', 'NM', 'OK', 'UT', 'WY'],
    'CT': ['MA', 'NY', 'RI'],
    'DE': ['MD', 'NJ', 'PA'],
    'FL': ['AL', 'GA'],
    'GA': ['AL', 'FL', 'NC', 'SC', 'TN'],
    'HI': [],
    'ID': ['MT', 'NV', 'OR', 'UT', 'WA', 'WY'],
    'IL': ['IN', 'IA', 'KY', 'MO', 'WI'],
    'IN': ['IL', 'KY', 'MI', 'OH'],
    'IA': ['IL', 'MN', 'MO', 'NE', 'SD', 'WI'],
    'KS': ['CO', 'MO', 'NE', 'OK'],
    'KY': ['IL', 'IN', 'MO', 'OH', 'TN', 'VA', 'WV'],
    'LA': ['AR', 'MS', 'TX'],
    'ME': ['NH'],
    'MD': ['DE', 'PA', 'VA', 'WV', 'DC'],
    'MA': ['CT', 'NH', 'NY', 'RI', 'VT'],
    'MI': ['IN', 'OH', 'WI'],
    'MN': ['IA', 'ND', 'SD', 'WI'],
    'MS': ['AL', 'AR', 'LA', 'TN'],
    'MO': ['AR', 'IL', 'IA', 'KS', 'KY', 'NE', 'OK', 'TN'],
    'MT': ['ID', 'ND', 'SD', 'WY'],
    'NE': ['CO', 'IA', 'KS', 'MO', 'SD', 'WY'],
    'NV': ['AZ', 'CA', 'ID', 'OR', 'UT'],
    'NH': ['ME', 'MA', 'VT'],
    'NJ': ['DE', 'NY', 'PA'],
    'NM': ['AZ', 'CO', 'OK', 'TX'],
    'NY': ['CT', 'MA', 'NJ', 'PA', 'VT'],
    'NC': ['GA', 'SC', 'TN', 'VA'],
    'ND': ['MN', 'MT', 'SD'],
    'OH': ['IN', 'KY', 'MI', 'PA', 'WV'],
    'OK': ['AR', 'CO', 'KS', 'MO', 'NM', 'TX'],
    'OR': ['CA', 'ID', 'NV', 'WA'],
    'PA': ['DE', 'MD', 'NJ', 'NY', 'OH', 'WV'],
    'RI': ['CT', 'MA'],
    'SC': ['GA', 'NC'],
    'SD': ['IA', 'MN', 'MT', 'NE', 'ND', 'WY'],
    'TN': ['AL', 'AR', 'GA', 'KY', 'MS', 'MO', 'NC', 'VA'],
    'TX': ['AR', 'LA', 'NM', 'OK'],
    'UT': ['AZ', 'CO', 'ID', 'NV', 'WY'],
    'VT': ['MA', 'NH', 'NY'],
    'VA': ['KY', 'MD', 'NC', 'TN', 'WV', 'DC'],
    'WA': ['ID', 'OR'],
    'WV': ['KY', 'MD', 'OH', 'PA', 'VA'],
    'WI': ['IL', 'IA', 'MI', 'MN'],
    'WY': ['CO', 'ID', 'MT', 'NE', 'SD', 'UT'],
    'DC': ['MD', 'VA']
  };

  return borders[state] || [];
}

// Get state full name
export function getStateName(stateCode: string): string {
  const stateNames: Record<string, string> = {
    'AL': 'ALABAMA', 'AK': 'ALASKA', 'AZ': 'ARIZONA', 'AR': 'ARKANSAS',
    'CA': 'CALIFORNIA', 'CO': 'COLORADO', 'CT': 'CONNECTICUT', 'DE': 'DELAWARE',
    'FL': 'FLORIDA', 'GA': 'GEORGIA', 'HI': 'HAWAII', 'ID': 'IDAHO',
    'IL': 'ILLINOIS', 'IN': 'INDIANA', 'IA': 'IOWA', 'KS': 'KANSAS',
    'KY': 'KENTUCKY', 'LA': 'LOUISIANA', 'ME': 'MAINE', 'MD': 'MARYLAND',
    'MA': 'MASSACHUSETTS', 'MI': 'MICHIGAN', 'MN': 'MINNESOTA', 'MS': 'MISSISSIPPI',
    'MO': 'MISSOURI', 'MT': 'MONTANA', 'NE': 'NEBRASKA', 'NV': 'NEVADA',
    'NH': 'NEW HAMPSHIRE', 'NJ': 'NEW JERSEY', 'NM': 'NEW MEXICO', 'NY': 'NEW YORK',
    'NC': 'NORTH CAROLINA', 'ND': 'NORTH DAKOTA', 'OH': 'OHIO', 'OK': 'OKLAHOMA',
    'OR': 'OREGON', 'PA': 'PENNSYLVANIA', 'RI': 'RHODE ISLAND', 'SC': 'SOUTH CAROLINA',
    'SD': 'SOUTH DAKOTA', 'TN': 'TENNESSEE', 'TX': 'TEXAS', 'UT': 'UTAH',
    'VT': 'VERMONT', 'VA': 'VIRGINIA', 'WA': 'WASHINGTON', 'WV': 'WEST VIRGINIA',
    'WI': 'WISCONSIN', 'WY': 'WYOMING', 'DC': 'DISTRICT OF COLUMBIA'
  };
  return stateNames[stateCode] || stateCode;
}

// Set-aside type mappings
export const setAsideMap: Record<string, string[]> = {
  'women-owned': ['WOSB', 'EDWOSB'],
  'hubzone': ['HZBZ', 'HUBZ'],
  '8a': ['8A', '8AN', '8A COMPETED', '8A SOLE SOURCE'],
  'small-business': ['SBA', 'SBP', 'SMALL BUSINESS SET-ASIDE', 'TOTAL SMALL BUSINESS SET-ASIDE (FAR 19.5)'],
  'dot-certified': ['SBP']
};

export const veteranMap: Record<string, string[]> = {
  'veteran-owned': ['VOSB', 'VO'],
  'service-disabled-veteran': ['SDVOSB', 'SDVOSBC']
};

// NAICS expansion mapping
export const naicsExpansion: Record<string, string[]> = {
  '236': ['236115', '236116', '236117', '236118', '236210', '236220'],
  '237': ['237110', '237120', '237130', '237210', '237310', '237990'],
  '238': ['238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190', '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350', '238390', '238910', '238990'],
  '541': ['541110', '541120', '541191', '541199', '541211', '541213', '541214', '541219', '541310', '541320', '541330', '541340', '541350', '541360', '541370', '541380', '541410', '541420', '541430', '541490', '541511', '541512', '541513', '541519', '541611', '541612', '541613', '541614', '541618', '541620', '541690', '541713', '541714', '541715', '541720', '541810', '541820', '541830', '541840', '541850', '541860', '541870', '541890', '541910', '541921', '541922', '541930', '541940', '541990'],
  '561': ['561110', '561210', '561311', '561312', '561320', '561330', '561410', '561421', '561422', '561431', '561439', '561440', '561450', '561491', '561492', '561499', '561510', '561520', '561591', '561599', '561611', '561612', '561613', '561621', '561622', '561710', '561720', '561730', '561740', '561790', '561910', '561920', '561990'],
  '518': ['518210'],
  '423': ['423110', '423120', '423130', '423140', '423210', '423220', '423310', '423320', '423330', '423390', '423410', '423420', '423430', '423440', '423450', '423460', '423490', '423510', '423520', '423610', '423620', '423690', '423710', '423720', '423730', '423740', '423810', '423820', '423830', '423840', '423850', '423860', '423910', '423920', '423930', '423940', '423990'],
  '811': ['811111', '811112', '811113', '811118', '811121', '811122', '811191', '811192', '811198', '811211', '811212', '811213', '811219', '811310', '811411', '811412', '811420', '811430', '811490'],
};

// Industry names for NAICS prefixes
export const industryNames: Record<string, string> = {
  '811': 'Repair and Maintenance',
  '541': 'Professional, Scientific, and Technical Services',
  '561': 'Administrative and Support Services',
  '236': 'Construction of Buildings',
  '237': 'Heavy and Civil Engineering Construction',
  '238': 'Specialty Trade Contractors',
  '518': 'Data Processing and Hosting',
  '423': 'Merchant Wholesalers, Durable Goods'
};

// Office name enhancements mapping
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

// Enhance office name
export function enhanceOfficeName(officeName: string | null | undefined): string {
  if (!officeName) return officeName || '';

  if (officeNameEnhancements[officeName]) {
    return officeNameEnhancements[officeName];
  }

  for (const [abbrev, fullName] of Object.entries(officeNameEnhancements)) {
    if (officeName.includes(abbrev)) {
      return fullName;
    }
  }

  return officeName;
}

// Office ID to full name mappings
export const officeNameMap: Record<string, string> = {
  '70SBUR': 'U.S. Citizenship and Immigration Services (USCIS)',
  '70RCSJ': 'Cybersecurity and Infrastructure Security Agency (CISA)',
  '70RCSA': 'Cybersecurity and Infrastructure Security Agency (CISA)',
  '70B06C': 'Department of Homeland Security - Mission Support',
  '70B04C': 'Department of Homeland Security - Information Technology Division',
  '70CMSD': 'Immigration and Customs Enforcement (ICE) - Dallas',
  '70Z023': 'U.S. Coast Guard Headquarters',
  '00042': 'U.S. Coast Guard Training Center Cape May',
  'SS001': 'U.S. Secret Service',
  'TFMSCD': 'U.S. Customs and Border Protection',
  'N00421': 'Naval Air Warfare Center Aircraft Division',
  'M95494': 'Marine Corps Systems Command',
  'N69450': 'Naval Facilities Engineering Systems Command (NAVFAC) Southeast',
  'N62473': 'Naval Facilities Engineering Systems Command (NAVFAC) Southwest',
  'N40085': 'Naval Facilities Engineering Systems Command (NAVFAC) Mid-Atlantic',
  'FA0021': 'Air Force Installation Contracting Agency',
  'FA4830': '23rd Contracting Squadron',
  'HT0011': 'Defense Health Agency',
  'W50S8P': 'U.S. Property and Fiscal Office - Ohio Army National Guard',
  'W9126G': 'U.S. Army Corps of Engineers - Fort Worth District',
  'W91278': 'U.S. Army Corps of Engineers - Mobile District',
  'W912DR': 'U.S. Army Corps of Engineers - Baltimore District',
  'W912PL': 'U.S. Army Corps of Engineers - Los Angeles District',
  'W912DY': 'U.S. Army Engineering Support Center - Huntsville',
  '1331L5': 'Department of Commerce - Small and Strategic Business Programs Office',
  '1333LB': 'U.S. Census Bureau',
  '1305M2': 'National Oceanic and Atmospheric Administration (NOAA)',
  '1305M3': 'National Oceanic and Atmospheric Administration (NOAA)',
  '75FCMC': 'Office of Acquisition and Grants Management',
  '75P001': 'Program Support Center Acquisition Management Services',
  '1605TB': 'Department of Labor - Information Technology Acquisition Services',
  '2033H6': 'Bureau of the Fiscal Service',
  '15JPSS': 'Department of Justice - Procurement Services Staff',
  '47QFCA': 'GSA Federal Acquisition Service - FEDSIM',
  '47PM10': 'GSA Public Buildings Service - Region 11 White House Branch',
  '19AQMM': 'GSA Acquisitions - AQM Momentum',
  '140P20': 'National Park Service - Denver Service Center',
  '140P42': 'National Park Service - Northeast Regional Office',
  'ITCD': 'Information Technology Contracting Division (DISA)',
  '15M102': 'Department of Justice - Procurement Division',
  '12505B': 'USDA Agricultural Research Service - Midwest Area',
};

// Abbreviation expansions
export const abbreviationExpansions: Record<string, string> = {
  'USCIS': 'U.S. Citizenship and Immigration Services',
  'CISA': 'Cybersecurity and Infrastructure Security Agency',
  'DHS': 'Department of Homeland Security',
  'ICE': 'Immigration and Customs Enforcement',
  'CBP': 'U.S. Customs and Border Protection',
  'TSA': 'Transportation Security Administration',
  'FEMA': 'Federal Emergency Management Agency',
  'USSS': 'U.S. Secret Service',
  'DOD': 'Department of Defense',
  'USACE': 'U.S. Army Corps of Engineers',
  'NAVFAC': 'Naval Facilities Engineering Systems Command',
  'NAVSEA': 'Naval Sea Systems Command',
  'NAVAIR': 'Naval Air Systems Command',
  'SPAWAR': 'Space and Naval Warfare Systems Command',
  'DISA': 'Defense Information Systems Agency',
  'DLA': 'Defense Logistics Agency',
  'DFAS': 'Defense Finance and Accounting Service',
  'GSA': 'General Services Administration',
  'NOAA': 'National Oceanic and Atmospheric Administration',
  'NASA': 'National Aeronautics and Space Administration',
  'EPA': 'Environmental Protection Agency',
  'DOE': 'Department of Energy',
  'DOT': 'Department of Transportation',
  'VA': 'Department of Veterans Affairs',
  'HHS': 'Department of Health and Human Services',
  'FDA': 'Food and Drug Administration',
  'NIH': 'National Institutes of Health',
};

// Expand office name abbreviations
export function expandOfficeName(name: string): string {
  if (!name) return name;

  let expanded = name;

  for (const [abbr, full] of Object.entries(abbreviationExpansions)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    expanded = expanded.replace(regex, full);
  }

  return expanded.replace(/\s+/g, ' ').trim();
}

// Lookup office name from SAM
export function lookupOfficeNameFromSAM(officeId: string, currentName: string = ''): string | null {
  if (!officeId || officeId === 'N/A') return null;

  if (officeNameMap[officeId]) {
    return officeNameMap[officeId];
  }

  if (currentName && currentName.length > 0) {
    return expandOfficeName(currentName);
  }

  return null;
}

// USACE District mapping
export const usaceDistrictMap: Record<string, string> = {
  'MOBILE': 'Mobile District',
  'SAVANNAH': 'Savannah District',
  'JACKSONVILLE': 'Jacksonville District',
  'CHARLESTON': 'Charleston District',
  'WILMINGTON': 'Wilmington District',
  'NORFOLK': 'Norfolk District',
  'BALTIMORE': 'Baltimore District',
  'PHILADELPHIA': 'Philadelphia District',
  'NEW YORK': 'New York District',
  'NEW ENGLAND': 'New England District',
  'BUFFALO': 'Buffalo District',
  'DETROIT': 'Detroit District',
  'CHICAGO': 'Chicago District',
  'ROCK ISLAND': 'Rock Island District',
  'ST. PAUL': 'St. Paul District',
  'ST. LOUIS': 'St. Louis District',
  'KANSAS CITY': 'Kansas City District',
  'OMAHA': 'Omaha District',
  'NEW ORLEANS': 'New Orleans District',
  'VICKSBURG': 'Vicksburg District',
  'MEMPHIS': 'Memphis District',
  'NASHVILLE': 'Nashville District',
  'LOUISVILLE': 'Louisville District',
  'HUNTSVILLE': 'Huntsville Center',
  'LITTLE ROCK': 'Little Rock District',
  'TULSA': 'Tulsa District',
  'FORT WORTH': 'Fort Worth District',
  'GALVESTON': 'Galveston District',
  'ALBUQUERQUE': 'Albuquerque District',
  'LOS ANGELES': 'Los Angeles District',
  'SAN FRANCISCO': 'San Francisco District',
  'SACRAMENTO': 'Sacramento District',
  'PORTLAND': 'Portland District',
  'SEATTLE': 'Seattle District',
  'ALASKA': 'Alaska District',
  'WALLA WALLA': 'Walla Walla District',
  'FORT BENNING': 'Mobile District',
  'BENNING': 'Mobile District',
  'FORT MOORE': 'Mobile District',
  'COLUMBUS': 'Mobile District'
};

// Interface definitions
export interface SearchFilters {
  award_type_codes: string[];
  time_period: { start_date: string; end_date: string }[];
  naics_codes?: string[];
  set_aside_type_codes?: string[];
  place_of_performance_locations?: { country: string; state: string }[];
}

export interface OfficeSpending {
  agencyId: string;
  agencyCode: string;
  subAgencyCode: string;
  searchableOfficeCode: string;
  contractingOffice: string;
  agencyName: string;
  parentAgency: string;
  location: string | null;
  city: string | null;
  primaryPlaceOfPerformance: string | null;
  totalSpending: number;
  setAsideSpending: number;
  contractCount: number;
  setAsideContractCount: number;
  totalOffers: number;
  offersData: number[];
  bidsPerContract5th?: number | null;
  bidsPerContractAvg?: number | null;
  bidsPerContract95th?: number | null;
}

export interface SearchSuggestion {
  type: string;
  label: string;
  value: string;
  estimatedContracts: number;
  description: string;
}

export interface SearchSuggestions {
  message: string;
  alternatives: SearchSuggestion[];
}
