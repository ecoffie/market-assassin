// Federal Agency Information Utility Functions
// Provides access to DoD command and Civilian agency websites, forecast URLs, and OSBP contacts

import commandInfoData from '@/data/dod-command-info.json';

// Types for command information
export interface SmallBusinessOffice {
  name: string;
  director: string;
  phone: string;
  email: string;
  address: string;
}

export interface AcquisitionOffice {
  name: string;
  website: string;
}

export interface CommandInfo {
  fullName: string;
  abbreviation: string;
  parentAgency: string;
  website: string;
  forecastUrl: string;
  samForecastUrl: string;
  smallBusinessOffice: SmallBusinessOffice;
  acquisitionOffice: AcquisitionOffice;
  keyCapabilities: string[];
}

export interface ServiceBranchInfo {
  website: string;
  smallBusinessWebsite: string;
  smallBusinessOffice: SmallBusinessOffice;
}

// Get command info by command name/abbreviation
export function getCommandInfo(command: string): CommandInfo | null {
  const commands = commandInfoData.commands as Record<string, CommandInfo>;

  // Direct match
  if (commands[command]) {
    return commands[command];
  }

  // Try to find by abbreviation
  const commandUpper = command.toUpperCase();
  for (const [key, info] of Object.entries(commands)) {
    if (info.abbreviation.toUpperCase() === commandUpper) {
      return info;
    }
  }

  // Try partial match (for variations like "Naval Facilities" matching "NAVFAC")
  for (const [key, info] of Object.entries(commands)) {
    if (key.toUpperCase().includes(commandUpper) ||
        info.fullName.toUpperCase().includes(commandUpper)) {
      return info;
    }
  }

  return null;
}

// Get service branch info (Navy, Army, Air Force, DoD)
export function getServiceBranchInfo(branch: string): ServiceBranchInfo | null {
  const branches = commandInfoData.serviceBranches as Record<string, ServiceBranchInfo>;

  // Direct match
  if (branches[branch]) {
    return branches[branch];
  }

  // Try partial match
  const branchUpper = branch.toUpperCase();
  for (const [key, info] of Object.entries(branches)) {
    if (key.toUpperCase().includes(branchUpper)) {
      return info;
    }
  }

  return null;
}

// Get all commands
export function getAllCommands(): CommandInfo[] {
  return Object.values(commandInfoData.commands as Record<string, CommandInfo>);
}

// Get commands by parent agency
export function getCommandsByParentAgency(parentAgency: string): CommandInfo[] {
  const commands = commandInfoData.commands as Record<string, CommandInfo>;
  const parentUpper = parentAgency.toUpperCase();

  return Object.values(commands).filter(cmd =>
    cmd.parentAgency.toUpperCase().includes(parentUpper)
  );
}

// Get forecast URL for a command or agency
export function getForecastUrl(commandOrAgency: string): {
  forecastUrl: string | null;
  samForecastUrl: string;
  source: string;
} {
  // Try to get command-specific forecast URL
  const commandInfo = getCommandInfo(commandOrAgency);
  if (commandInfo) {
    return {
      forecastUrl: commandInfo.forecastUrl,
      samForecastUrl: commandInfo.samForecastUrl,
      source: commandInfo.abbreviation
    };
  }

  // Try to get service branch forecast URL
  const branchInfo = getServiceBranchInfo(commandOrAgency);
  if (branchInfo) {
    return {
      forecastUrl: branchInfo.smallBusinessWebsite,
      samForecastUrl: `https://sam.gov/search/?index=opp&sort=-relevance&page=1&pageSize=25&sfm%5Bstatus%5D%5Bis_active%5D=true&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&sfm%5BsimpleSearch%5D%5BkeywordTags%5D%5B0%5D%5Bkey%5D=${encodeURIComponent(commandOrAgency)}`,
      source: commandOrAgency
    };
  }

  // Default SAM.gov search
  return {
    forecastUrl: null,
    samForecastUrl: `https://sam.gov/search/?index=opp&sort=-relevance&page=1&pageSize=25&sfm%5Bstatus%5D%5Bis_active%5D=true&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&sfm%5BsimpleSearch%5D%5BkeywordTags%5D%5B0%5D%5Bkey%5D=${encodeURIComponent(commandOrAgency)}`,
    source: 'SAM.gov'
  };
}

// Get small business office contact for a command or agency
export function getSmallBusinessContact(commandOrAgency: string): {
  contact: SmallBusinessOffice | null;
  source: string;
} {
  // Try command first
  const commandInfo = getCommandInfo(commandOrAgency);
  if (commandInfo) {
    return {
      contact: commandInfo.smallBusinessOffice,
      source: commandInfo.abbreviation
    };
  }

  // Try service branch
  const branchInfo = getServiceBranchInfo(commandOrAgency);
  if (branchInfo) {
    return {
      contact: branchInfo.smallBusinessOffice,
      source: commandOrAgency
    };
  }

  return {
    contact: null,
    source: 'Not Found'
  };
}

// Get website for a command or agency
export function getCommandWebsite(commandOrAgency: string): string | null {
  const commandInfo = getCommandInfo(commandOrAgency);
  if (commandInfo) {
    return commandInfo.website;
  }

  const branchInfo = getServiceBranchInfo(commandOrAgency);
  if (branchInfo) {
    return branchInfo.website;
  }

  return null;
}

// Detect command from office name and get enhanced info
export function getEnhancedAgencyInfo(
  officeName: string,
  subAgency: string,
  parentAgency: string,
  detectedCommand?: string | null
): {
  command: string | null;
  commandInfo: CommandInfo | null;
  forecastUrl: string | null;
  samForecastUrl: string;
  smallBusinessContact: SmallBusinessOffice | null;
  website: string | null;
} {
  const commands = getAllCommands();
  const officeUpper = officeName.toUpperCase();
  const subAgencyUpper = subAgency.toUpperCase();
  const parentAgencyUpper = parentAgency.toUpperCase();

  // Helper to return command info
  const returnCommandInfo = (cmd: CommandInfo) => ({
    command: cmd.abbreviation,
    commandInfo: cmd,
    forecastUrl: cmd.forecastUrl,
    samForecastUrl: cmd.samForecastUrl,
    smallBusinessContact: cmd.smallBusinessOffice,
    website: cmd.website
  });

  // 1. Try detected command first (from FPDS API)
  if (detectedCommand) {
    const info = getCommandInfo(detectedCommand);
    if (info) {
      return returnCommandInfo(info);
    }
  }

  // 2. PRIORITY: Try to match specific sub-agencies/offices using the mapping table
  // This is the most specific and accurate matching - do it FIRST
  const subAgencyToParentMap: Record<string, string> = {
    // DHS sub-agencies
    'PUBLIC BUILDINGS SERVICE': 'PBS',
    'CUSTOMS AND BORDER PROTECTION': 'CBP',
    'U.S. CUSTOMS AND BORDER PROTECTION': 'CBP',
    'TRANSPORTATION SECURITY ADMINISTRATION': 'TSA',
    'IMMIGRATION AND CUSTOMS ENFORCEMENT': 'ICE',
    'U.S. IMMIGRATION AND CUSTOMS ENFORCEMENT': 'ICE',
    'U.S. COAST GUARD': 'USCG',
    'COAST GUARD': 'USCG',
    'CYBERSECURITY AND INFRASTRUCTURE SECURITY AGENCY': 'CISA',
    'FEDERAL EMERGENCY MANAGEMENT AGENCY': 'FEMA',
    'U.S. SECRET SERVICE': 'USSS',
    'SECRET SERVICE': 'USSS',
    'FEDERAL LAW ENFORCEMENT TRAINING CENTER': 'FLETC',
    'FEDERAL LAW ENFORCEMENT TRAINING CENTERS': 'FLETC',

    // DOJ sub-agencies
    'FEDERAL BUREAU OF INVESTIGATION': 'FBI',
    'DRUG ENFORCEMENT ADMINISTRATION': 'DEA',
    'BUREAU OF ALCOHOL, TOBACCO, FIREARMS AND EXPLOSIVES': 'ATF',
    'BUREAU OF ALCOHOL TOBACCO FIREARMS AND EXPLOSIVES': 'ATF',
    'ATF': 'ATF',
    'FEDERAL BUREAU OF PRISONS': 'BOP',
    'BUREAU OF PRISONS': 'BOP',
    'U.S. MARSHALS SERVICE': 'USMS',
    'UNITED STATES MARSHALS SERVICE': 'USMS',
    'MARSHALS SERVICE': 'USMS',

    // HHS sub-agencies
    'CENTERS FOR MEDICARE AND MEDICAID SERVICES': 'CMS',
    'CENTERS FOR MEDICARE & MEDICAID SERVICES': 'CMS',
    'CENTERS FOR DISEASE CONTROL AND PREVENTION': 'CDC',
    'NATIONAL INSTITUTES OF HEALTH': 'NIH',
    'FOOD AND DRUG ADMINISTRATION': 'FDA',
    'INDIAN HEALTH SERVICE': 'IHS',

    // DOT sub-agencies
    'FEDERAL AVIATION ADMINISTRATION': 'FAA',
    'FEDERAL HIGHWAY ADMINISTRATION': 'FHWA',
    'FEDERAL RAILROAD ADMINISTRATION': 'FRA',
    'FEDERAL TRANSIT ADMINISTRATION': 'FTA',
    'MARITIME ADMINISTRATION': 'MARAD',

    // DOL sub-agencies
    'OCCUPATIONAL SAFETY AND HEALTH ADMINISTRATION': 'OSHA',
    'EMPLOYMENT AND TRAINING ADMINISTRATION': 'ETA',
    'MINE SAFETY AND HEALTH ADMINISTRATION': 'MSHA',
    'OFFICE OF THE ASSISTANT SECRETARY FOR ADMINISTRATION AND MANAGEMENT': 'OASAM',

    // DOC sub-agencies
    'NATIONAL OCEANIC AND ATMOSPHERIC ADMINISTRATION': 'NOAA',
    'U.S. CENSUS BUREAU': 'Census',
    'CENSUS BUREAU': 'Census',
    'NATIONAL INSTITUTE OF STANDARDS AND TECHNOLOGY': 'NIST',
    'U.S. PATENT AND TRADEMARK OFFICE': 'USPTO',
    'PATENT AND TRADEMARK OFFICE': 'USPTO',

    // DOI sub-agencies
    'NATIONAL PARK SERVICE': 'NPS',
    'U.S. FISH AND WILDLIFE SERVICE': 'FWS',
    'FISH AND WILDLIFE SERVICE': 'FWS',
    'BUREAU OF LAND MANAGEMENT': 'BLM',
    'U.S. GEOLOGICAL SURVEY': 'USGS',
    'GEOLOGICAL SURVEY': 'USGS',
    'BUREAU OF RECLAMATION': 'BOR',
    'BUREAU OF INDIAN AFFAIRS': 'BIA',
    'BUREAU OF OCEAN ENERGY MANAGEMENT': 'BOEM',
    'BUREAU OF SAFETY AND ENVIRONMENTAL ENFORCEMENT': 'BSEE',

    // USDA sub-agencies
    'FOREST SERVICE': 'USFS',
    'U.S. FOREST SERVICE': 'USFS',
    'USFS': 'USFS',
    'AGRICULTURAL RESEARCH SERVICE': 'ARS',
    'ANIMAL AND PLANT HEALTH INSPECTION SERVICE': 'APHIS',
    'NATURAL RESOURCES CONSERVATION SERVICE': 'NRCS',
    'FARM SERVICE AGENCY': 'FSA',
    'RURAL DEVELOPMENT': 'RD',

    // VA sub-agencies
    'VETERANS HEALTH ADMINISTRATION': 'VHA',
    'VETERANS BENEFITS ADMINISTRATION': 'VBA',
    'NATIONAL CEMETERY ADMINISTRATION': 'NCA',

    // GSA sub-agencies
    'FEDERAL ACQUISITION SERVICE': 'FAS',

    // Treasury
    'INTERNAL REVENUE SERVICE': 'IRS',
    'FINANCIAL CRIMES ENFORCEMENT NETWORK': 'FinCEN',
    'FINCEN': 'FinCEN',
    'OFFICE OF THE COMPTROLLER OF THE CURRENCY': 'OCC',
    'COMPTROLLER OF THE CURRENCY': 'OCC',
    'ALCOHOL AND TOBACCO TAX AND TRADE BUREAU': 'TTB',

    // State Department
    'BUREAU OF OVERSEAS BUILDINGS OPERATIONS': 'OBO',
    'OVERSEAS BUILDINGS OPERATIONS': 'OBO',
    'BUREAU OF DIPLOMATIC SECURITY': 'DS',
    'DIPLOMATIC SECURITY': 'DS',

    // Additional HHS
    'HEALTH RESOURCES AND SERVICES ADMINISTRATION': 'HRSA',
    'ADMINISTRATION FOR CHILDREN AND FAMILIES': 'ACF',
    'SUBSTANCE ABUSE AND MENTAL HEALTH SERVICES ADMINISTRATION': 'SAMHSA',

    // Defense-Wide Agencies
    'DEFENSE FINANCE AND ACCOUNTING SERVICE': 'DFAS',
    'DEFENSE THREAT REDUCTION AGENCY': 'DTRA',
    'NATIONAL GEOSPATIAL-INTELLIGENCE AGENCY': 'NGA',
    'NATIONAL SECURITY AGENCY': 'NSA',
    'DEFENSE INTELLIGENCE AGENCY': 'DIA',
    'WASHINGTON HEADQUARTERS SERVICES': 'WHS',

    // Air Force Commands
    'AIR FORCE LIFE CYCLE MANAGEMENT CENTER': 'AFLCMC',
    'SPACE AND MISSILE SYSTEMS CENTER': 'SMC',
    'AIR FORCE NUCLEAR WEAPONS CENTER': 'AFNWC',
    'AIR FORCE DISTRICT OF WASHINGTON': 'AFDW',
    'AIR FORCE CIVIL ENGINEER CENTER': 'AFCEC',

    // Army PEOs
    'PROGRAM EXECUTIVE OFFICE SOLDIER': 'PEO Soldier',
    'PROGRAM EXECUTIVE OFFICE AVIATION': 'PEO Aviation',
    'PROGRAM EXECUTIVE OFFICE COMMAND CONTROL COMMUNICATIONS TACTICAL': 'PEO C3T',
    'PROGRAM EXECUTIVE OFFICE COMBAT SUPPORT': 'PEO CS CSS',
    'PROGRAM EXECUTIVE OFFICE ENTERPRISE INFORMATION SYSTEMS': 'PEO EIS',
    'PROGRAM EXECUTIVE OFFICE GROUND COMBAT SYSTEMS': 'PEO GCS',
    'PROGRAM EXECUTIVE OFFICE INTELLIGENCE ELECTRONIC WARFARE': 'PEO IEW&S',
    'PROGRAM EXECUTIVE OFFICE MISSILES AND SPACE': 'PEO M&S',
    'PROGRAM EXECUTIVE OFFICE SIMULATION TRAINING': 'PEO STRI',

    // Army Life Cycle Management Commands
    'COMMUNICATIONS ELECTRONICS COMMAND': 'CECOM',
    'TANK AUTOMOTIVE AND ARMAMENTS COMMAND': 'TACOM',
    'AVIATION AND MISSILE COMMAND': 'AMCOM',

    // Navy PEOs
    'PROGRAM EXECUTIVE OFFICE SHIPS': 'PEO Ships',
    'PROGRAM EXECUTIVE OFFICE AIRCRAFT CARRIERS': 'PEO Carriers',
    'PROGRAM EXECUTIVE OFFICE SUBMARINES': 'PEO Subs',
    'PROGRAM EXECUTIVE OFFICE UNMANNED AND SMALL COMBATANTS': 'PEO USC',

    // Navy Warfare Centers
    'NAVAL SURFACE WARFARE CENTER DAHLGREN': 'NSWCDD',
    'NAVAL SURFACE WARFARE CENTER CRANE': 'NSWC Crane',
    'NAVAL SURFACE WARFARE CENTER CORONA': 'NSWC Corona',
    'NAVAL UNDERSEA WARFARE CENTER': 'NUWC',
    'NAVAL AIR WARFARE CENTER': 'NAWC',
  };

  const mappedAbbr = subAgencyToParentMap[officeUpper] || subAgencyToParentMap[subAgencyUpper];
  if (mappedAbbr) {
    const mappedCmd = commands.find(cmd => cmd.abbreviation.toUpperCase() === mappedAbbr.toUpperCase());
    if (mappedCmd) {
      return {
        command: mappedCmd.abbreviation,
        commandInfo: mappedCmd,
        forecastUrl: mappedCmd.forecastUrl,
        samForecastUrl: mappedCmd.samForecastUrl,
        smallBusinessContact: mappedCmd.smallBusinessOffice,
        website: mappedCmd.website
      };
    }
  }

  // Fall back to parent agency/service branch (DoD)
  const branchInfo = getServiceBranchInfo(parentAgency);
  if (branchInfo) {
    return {
      command: null,
      commandInfo: null,
      forecastUrl: branchInfo.smallBusinessWebsite,
      samForecastUrl: `https://sam.gov/search/?index=opp&sort=-relevance&page=1&pageSize=25&sfm%5Bstatus%5D%5Bis_active%5D=true&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&sfm%5BsimpleSearch%5D%5BkeywordTags%5D%5B0%5D%5Bkey%5D=${encodeURIComponent(parentAgency)}`,
      smallBusinessContact: branchInfo.smallBusinessOffice,
      website: branchInfo.website
    };
  }

  // Also try subAgency for service branch matching (e.g., when subAgency is "Department of the Navy")
  if (subAgency && subAgency !== parentAgency) {
    const subBranchInfo = getServiceBranchInfo(subAgency);
    if (subBranchInfo) {
      return {
        command: null,
        commandInfo: null,
        forecastUrl: subBranchInfo.smallBusinessWebsite,
        samForecastUrl: `https://sam.gov/search/?index=opp&sort=-relevance&page=1&pageSize=25&sfm%5Bstatus%5D%5Bis_active%5D=true&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&sfm%5BsimpleSearch%5D%5BkeywordTags%5D%5B0%5D%5Bkey%5D=${encodeURIComponent(subAgency)}`,
        smallBusinessContact: subBranchInfo.smallBusinessOffice,
        website: subBranchInfo.website
      };
    }
  }

  // Try to match civilian agency by parent agency name
  const civilianAgencyInfo = getAgencyInfoByParentAgency(parentAgency);
  if (civilianAgencyInfo) {
    return {
      command: civilianAgencyInfo.abbreviation,
      commandInfo: civilianAgencyInfo,
      forecastUrl: civilianAgencyInfo.forecastUrl,
      samForecastUrl: civilianAgencyInfo.samForecastUrl,
      smallBusinessContact: civilianAgencyInfo.smallBusinessOffice,
      website: civilianAgencyInfo.website
    };
  }

  // Final fallback: Create a generic OSBP contact based on parent agency
  // This ensures EVERY agency gets an OSBP contact, even if we don't have specific data
  const genericOSBP = createGenericOSBP(parentAgency, subAgency);

  return {
    command: null,
    commandInfo: null,
    forecastUrl: null,
    samForecastUrl: `https://sam.gov/search/?index=opp&sort=-relevance&page=1&pageSize=25&sfm%5Bstatus%5D%5Bis_active%5D=true&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&sfm%5BsimpleSearch%5D%5BkeywordTags%5D%5B0%5D%5Bkey%5D=${encodeURIComponent(parentAgency)}`,
    smallBusinessContact: genericOSBP,
    website: null
  };
}

// Create a generic OSBP contact when no specific match is found
function createGenericOSBP(parentAgency: string, subAgency: string): SmallBusinessOffice {
  // Common OSBP directory - these are well-known agency OSBP contacts
  const osbpDirectory: Record<string, SmallBusinessOffice> = {
    'DEPARTMENT OF DEFENSE': {
      name: 'DoD Office of Small Business Programs',
      director: 'DoD OSBP Director',
      phone: '(571) 372-6088',
      email: 'osbp@osd.mil',
      address: '1777 N Kent Street, Arlington, VA 22209'
    },
    'DEPARTMENT OF THE ARMY': {
      name: 'Army Office of Small Business Programs',
      director: 'Army OSBP Director',
      phone: '(703) 697-2868',
      email: 'usarmy.pentagon.hqda-osbp.mbx.hqda-osbp-helpdesk@army.mil',
      address: '106 Army Pentagon, Washington, DC 20310'
    },
    'DEPARTMENT OF THE NAVY': {
      name: 'Navy Office of Small Business Programs',
      director: 'Navy OSBP Director',
      phone: '(202) 685-6485',
      email: 'navsba@navy.mil',
      address: '720 Kennon Street SE, Washington Navy Yard, DC 20374'
    },
    'DEPARTMENT OF THE AIR FORCE': {
      name: 'Air Force Office of Small Business Programs',
      director: 'Air Force OSBP Director',
      phone: '(571) 256-8052',
      email: 'usaf.pentagon.saf-sb.mbx.saf-sb-workflow@mail.mil',
      address: '1060 Air Force Pentagon, Washington, DC 20330'
    },
    'GENERAL SERVICES ADMINISTRATION': {
      name: 'GSA Office of Small and Disadvantaged Business Utilization',
      director: 'GSA OSDBU Director',
      phone: '(202) 501-1021',
      email: 'small.business@gsa.gov',
      address: '1800 F Street NW, Washington, DC 20405'
    },
    'DEPARTMENT OF VETERANS AFFAIRS': {
      name: 'VA Office of Small and Disadvantaged Business Utilization',
      director: 'VA OSDBU Director',
      phone: '(202) 461-4300',
      email: 'osdbu@va.gov',
      address: '810 Vermont Avenue NW, Washington, DC 20420'
    },
    'DEPARTMENT OF HOMELAND SECURITY': {
      name: 'DHS Office of Small and Disadvantaged Business Utilization',
      director: 'DHS OSDBU Director',
      phone: '(202) 447-0826',
      email: 'osdbu@hq.dhs.gov',
      address: '245 Murray Lane SW, Washington, DC 20528'
    },
    'DEPARTMENT OF HEALTH AND HUMAN SERVICES': {
      name: 'HHS Office of Small and Disadvantaged Business Utilization',
      director: 'HHS OSDBU Director',
      phone: '(202) 690-7235',
      email: 'osdbu@hhs.gov',
      address: '200 Independence Avenue SW, Washington, DC 20201'
    },
    'DEPARTMENT OF TRANSPORTATION': {
      name: 'DOT Office of Small and Disadvantaged Business Utilization',
      director: 'DOT OSDBU Director',
      phone: '(202) 366-1930',
      email: 'osdbu@dot.gov',
      address: '1200 New Jersey Avenue SE, Washington, DC 20590'
    },
    'DEPARTMENT OF JUSTICE': {
      name: 'DOJ Office of Small and Disadvantaged Business Utilization',
      director: 'DOJ OSDBU Director',
      phone: '(202) 616-0521',
      email: 'osdbu@usdoj.gov',
      address: '145 N Street NE, Washington, DC 20530'
    },
    'DEPARTMENT OF THE INTERIOR': {
      name: 'DOI Office of Small and Disadvantaged Business Utilization',
      director: 'DOI OSDBU Director',
      phone: '(202) 208-3493',
      email: 'osdbu@ios.doi.gov',
      address: '1849 C Street NW, Washington, DC 20240'
    },
    'DEPARTMENT OF AGRICULTURE': {
      name: 'USDA Office of Small and Disadvantaged Business Utilization',
      director: 'USDA OSDBU Director',
      phone: '(202) 720-7117',
      email: 'osdbu@usda.gov',
      address: '1400 Independence Avenue SW, Washington, DC 20250'
    },
    'DEPARTMENT OF COMMERCE': {
      name: 'DOC Office of Small and Disadvantaged Business Utilization',
      director: 'DOC OSDBU Director',
      phone: '(202) 482-1472',
      email: 'osdbu@doc.gov',
      address: '1401 Constitution Avenue NW, Washington, DC 20230'
    },
    'DEPARTMENT OF LABOR': {
      name: 'DOL Office of Small and Disadvantaged Business Utilization',
      director: 'DOL OSDBU Director',
      phone: '(202) 693-7262',
      email: 'osdbu@dol.gov',
      address: '200 Constitution Avenue NW, Washington, DC 20210'
    },
    'DEPARTMENT OF ENERGY': {
      name: 'DOE Office of Small and Disadvantaged Business Utilization',
      director: 'DOE OSDBU Director',
      phone: '(202) 586-7377',
      email: 'osdbu@hq.doe.gov',
      address: '1000 Independence Avenue SW, Washington, DC 20585'
    },
    'DEPARTMENT OF THE TREASURY': {
      name: 'Treasury Office of Small and Disadvantaged Business Utilization',
      director: 'Treasury OSDBU Director',
      phone: '(202) 622-0530',
      email: 'osdbu@treasury.gov',
      address: '1500 Pennsylvania Avenue NW, Washington, DC 20220'
    },
    'DEPARTMENT OF STATE': {
      name: 'State Department Office of Small and Disadvantaged Business Utilization',
      director: 'State OSDBU Director',
      phone: '(703) 875-6822',
      email: 'smallbusiness@state.gov',
      address: '2201 C Street NW, Washington, DC 20520'
    },
    'ENVIRONMENTAL PROTECTION AGENCY': {
      name: 'EPA Office of Small and Disadvantaged Business Utilization',
      director: 'EPA OSDBU Director',
      phone: '(202) 566-2075',
      email: 'osdbu@epa.gov',
      address: '1200 Pennsylvania Avenue NW, Washington, DC 20460'
    },
    'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION': {
      name: 'NASA Office of Small Business Programs',
      director: 'NASA OSBP Director',
      phone: '(202) 358-2088',
      email: 'smallbusiness@nasa.gov',
      address: '300 E Street SW, Washington, DC 20546'
    },
    'DEPARTMENT OF EDUCATION': {
      name: 'ED Office of Small and Disadvantaged Business Utilization',
      director: 'ED OSDBU Director',
      phone: '(202) 245-6301',
      email: 'osdbu@ed.gov',
      address: '400 Maryland Avenue SW, Washington, DC 20202'
    },
    'DEPARTMENT OF HOUSING AND URBAN DEVELOPMENT': {
      name: 'HUD Office of Small and Disadvantaged Business Utilization',
      director: 'HUD OSDBU Director',
      phone: '(202) 402-5713',
      email: 'osdbu@hud.gov',
      address: '451 7th Street SW, Washington, DC 20410'
    },
    'SMALL BUSINESS ADMINISTRATION': {
      name: 'SBA Office of Government Contracting',
      director: 'SBA GC Director',
      phone: '(202) 205-6460',
      email: 'gcbd@sba.gov',
      address: '409 3rd Street SW, Washington, DC 20416'
    },
    'SOCIAL SECURITY ADMINISTRATION': {
      name: 'SSA Office of Small and Disadvantaged Business Utilization',
      director: 'SSA OSDBU Director',
      phone: '(410) 965-9458',
      email: 'osdbu.ssa@ssa.gov',
      address: '6401 Security Boulevard, Baltimore, MD 21235'
    },
    'OFFICE OF PERSONNEL MANAGEMENT': {
      name: 'OPM Office of Small and Disadvantaged Business Utilization',
      director: 'OPM OSDBU Director',
      phone: '(202) 606-2862',
      email: 'osdbu@opm.gov',
      address: '1900 E Street NW, Washington, DC 20415'
    }
  };

  // Try to find matching OSBP from directory
  const parentUpper = parentAgency.toUpperCase();

  for (const [key, osbp] of Object.entries(osbpDirectory)) {
    if (parentUpper.includes(key) || key.includes(parentUpper)) {
      return osbp;
    }
  }

  // If still no match, return a generic federal OSBP contact
  return {
    name: `${parentAgency} Office of Small Business Programs`,
    director: 'OSBP Director',
    phone: '(202) 205-6460',  // SBA main line as backup
    email: 'gcbd@sba.gov',    // SBA GC as backup
    address: 'Washington, DC'
  };
}

// Get key capabilities for a command
export function getCommandCapabilities(command: string): string[] {
  const commandInfo = getCommandInfo(command);
  return commandInfo?.keyCapabilities || [];
}

// Check if an agency is a DoD entity
export function isDoDAgency(parentAgency: string): boolean {
  const dodAgencies = [
    'Department of Defense',
    'Department of the Army',
    'Department of the Navy',
    'Department of the Air Force',
    'U.S. Space Force'
  ];

  return dodAgencies.some(agency =>
    parentAgency.toUpperCase().includes(agency.toUpperCase())
  );
}

// Check if an agency is a civilian (non-DoD) federal agency
export function isCivilianAgency(parentAgency: string): boolean {
  return !isDoDAgency(parentAgency);
}

// Get agency info by parent agency name (for civilian agencies)
export function getAgencyInfoByParentAgency(parentAgency: string): CommandInfo | null {
  const commands = commandInfoData.commands as Record<string, CommandInfo>;
  const parentUpper = parentAgency.toUpperCase();

  // Common abbreviations mapping
  const abbreviationMap: Record<string, string[]> = {
    'DHS': ['HOMELAND SECURITY'],
    'DOJ': ['JUSTICE'],
    'GSA': ['GENERAL SERVICES'],
    'VA': ['VETERANS AFFAIRS'],
    'HHS': ['HEALTH AND HUMAN SERVICES', 'HEALTH & HUMAN'],
    'DOE': ['ENERGY'],
    'NASA': ['AERONAUTICS', 'SPACE ADMINISTRATION'],
    'Treasury': ['TREASURY'],
    'DOI': ['INTERIOR'],
    'State': ['STATE'],
    'Commerce': ['COMMERCE'],
    'DOL': ['LABOR'],
    'USDA': ['AGRICULTURE'],
    'DOT': ['TRANSPORTATION'],
    'HUD': ['HOUSING', 'URBAN DEVELOPMENT'],
    'Education': ['EDUCATION'],
    'EPA': ['ENVIRONMENTAL PROTECTION'],
    'SBA': ['SMALL BUSINESS ADMINISTRATION'],
    'SSA': ['SOCIAL SECURITY'],
    'OPM': ['PERSONNEL MANAGEMENT']
  };

  // Try direct match first
  for (const [key, info] of Object.entries(commands)) {
    if (info.parentAgency.toUpperCase() === parentUpper) {
      return info;
    }
  }

  // Try abbreviation mapping
  for (const [abbr, keywords] of Object.entries(abbreviationMap)) {
    for (const keyword of keywords) {
      if (parentUpper.includes(keyword)) {
        const info = commands[abbr];
        if (info) return info;
      }
    }
  }

  // Try partial match
  for (const [key, info] of Object.entries(commands)) {
    if (info.parentAgency.toUpperCase().includes(parentUpper) ||
        parentUpper.includes(info.parentAgency.toUpperCase())) {
      return info;
    }
  }

  return null;
}

// Get all civilian agencies
export function getCivilianAgencies(): CommandInfo[] {
  const commands = commandInfoData.commands as Record<string, CommandInfo>;
  return Object.values(commands).filter(cmd => !isDoDAgency(cmd.parentAgency));
}

// Get all DoD commands
export function getDoDCommands(): CommandInfo[] {
  const commands = commandInfoData.commands as Record<string, CommandInfo>;
  return Object.values(commands).filter(cmd => isDoDAgency(cmd.parentAgency));
}

// Get commands by sub-agency (e.g., "Department of the Navy" -> NAVFAC, NAVSEA, etc.)
export function getCommandsBySubAgency(subAgency: string): CommandInfo[] {
  const commands = commandInfoData.commands as Record<string, CommandInfo>;
  const subAgencyUpper = subAgency.toUpperCase();

  // Map sub-agency names to parent agency for matching
  const subAgencyToParent: Record<string, string> = {
    'DEPARTMENT OF THE NAVY': 'Department of the Navy',
    'DEPT OF THE NAVY': 'Department of the Navy',
    'NAVY': 'Department of the Navy',
    'DEPARTMENT OF THE ARMY': 'Department of the Army',
    'DEPT OF THE ARMY': 'Department of the Army',
    'ARMY': 'Department of the Army',
    'DEPARTMENT OF THE AIR FORCE': 'Department of the Air Force',
    'DEPT OF THE AIR FORCE': 'Department of the Air Force',
    'AIR FORCE': 'Department of the Air Force',
  };

  // Find the matching parent agency
  let targetParent: string | null = null;
  for (const [key, parent] of Object.entries(subAgencyToParent)) {
    if (subAgencyUpper.includes(key)) {
      targetParent = parent;
      break;
    }
  }

  if (!targetParent) {
    return [];
  }

  // Return commands that belong to this parent agency
  return Object.values(commands).filter(cmd =>
    cmd.parentAgency.toUpperCase() === targetParent?.toUpperCase()
  );
}

// Expand a generic DOD agency into specific commands
// Returns an array of agencies with command-level detail
export interface ExpandedDoDAgency {
  id: string;
  name: string;
  contractingOffice: string;
  subAgency: string;
  parentAgency: string;
  setAsideSpending: number;
  contractCount: number;
  location: string;
  command: string;
  website: string | null;
  forecastUrl: string | null;
  samForecastUrl: string;
  hasSpecificOffice: boolean;
  osbp?: {
    name: string;
    director: string;
    phone: string;
    email: string;
    address: string;
  } | null;
}

export function expandGenericDoDAgency(
  genericAgency: {
    id: string;
    name: string;
    subAgency: string;
    parentAgency: string;
    setAsideSpending: number;
    contractCount: number;
    location: string;
  },
  maxCommands: number = 5
): ExpandedDoDAgency[] {
  // Get commands for this sub-agency
  const commands = getCommandsBySubAgency(genericAgency.subAgency);

  if (commands.length === 0) {
    // No expansion available, return original
    return [];
  }

  // Sort commands by priority (main acquisition commands first)
  const priorityCommands = [
    'NAVFAC', 'NAVSEA', 'NAVAIR', 'NAVWAR', 'NAVSUP', // Navy acquisition
    'USACE', 'ACC', 'AMC', 'TRADOC', // Army acquisition
    'AFLCMC', 'AFSPC', 'AFMC', 'AFDW' // Air Force acquisition
  ];

  const sortedCommands = [...commands].sort((a, b) => {
    const aIndex = priorityCommands.indexOf(a.abbreviation);
    const bIndex = priorityCommands.indexOf(b.abbreviation);

    // Priority commands come first
    if (aIndex !== -1 && bIndex === -1) return -1;
    if (aIndex === -1 && bIndex !== -1) return 1;
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;

    // Alphabetical for others
    return a.abbreviation.localeCompare(b.abbreviation);
  });

  // Take top N commands
  const selectedCommands = sortedCommands.slice(0, maxCommands);

  // Distribute spending across commands (proportionally based on typical patterns)
  // Major acquisition commands (NAVFAC, NAVSEA, USACE, ACC) get more
  const totalSpending = genericAgency.setAsideSpending;
  const totalContracts = genericAgency.contractCount;

  return selectedCommands.map((cmd, index) => {
    // Give higher proportion to first commands (main acquisition)
    const weight = Math.max(1, maxCommands - index);
    const totalWeight = selectedCommands.reduce((sum, _, i) => sum + Math.max(1, maxCommands - i), 0);

    const commandSpending = Math.round(totalSpending * (weight / totalWeight));
    const commandContracts = Math.max(1, Math.round(totalContracts * (weight / totalWeight)));

    return {
      id: `${genericAgency.id}-${cmd.abbreviation}`,
      name: cmd.fullName,
      contractingOffice: cmd.fullName,
      subAgency: genericAgency.subAgency,
      parentAgency: genericAgency.parentAgency,
      setAsideSpending: commandSpending,
      contractCount: commandContracts,
      location: genericAgency.location,
      command: cmd.abbreviation,
      website: cmd.website,
      forecastUrl: cmd.forecastUrl,
      samForecastUrl: cmd.samForecastUrl,
      hasSpecificOffice: true,
      osbp: cmd.smallBusinessOffice ? {
        name: cmd.smallBusinessOffice.name,
        director: cmd.smallBusinessOffice.director,
        phone: cmd.smallBusinessOffice.phone,
        email: cmd.smallBusinessOffice.email,
        address: cmd.smallBusinessOffice.address,
      } : null,
    };
  });
}
