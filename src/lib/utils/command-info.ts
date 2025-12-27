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
  // Try detected command first
  if (detectedCommand) {
    const info = getCommandInfo(detectedCommand);
    if (info) {
      return {
        command: detectedCommand,
        commandInfo: info,
        forecastUrl: info.forecastUrl,
        samForecastUrl: info.samForecastUrl,
        smallBusinessContact: info.smallBusinessOffice,
        website: info.website
      };
    }
  }

  // Try to detect command from office name
  const commands = getAllCommands();
  const officeUpper = officeName.toUpperCase();

  for (const cmd of commands) {
    if (officeUpper.includes(cmd.abbreviation.toUpperCase()) ||
        officeUpper.includes(cmd.fullName.toUpperCase())) {
      return {
        command: cmd.abbreviation,
        commandInfo: cmd,
        forecastUrl: cmd.forecastUrl,
        samForecastUrl: cmd.samForecastUrl,
        smallBusinessContact: cmd.smallBusinessOffice,
        website: cmd.website
      };
    }
  }

  // Try sub-agency matching
  const subAgencyUpper = subAgency.toUpperCase();
  for (const cmd of commands) {
    if (subAgencyUpper.includes(cmd.abbreviation.toUpperCase()) ||
        subAgencyUpper.includes(cmd.fullName.toUpperCase())) {
      return {
        command: cmd.abbreviation,
        commandInfo: cmd,
        forecastUrl: cmd.forecastUrl,
        samForecastUrl: cmd.samForecastUrl,
        smallBusinessContact: cmd.smallBusinessOffice,
        website: cmd.website
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

  // Default fallback
  return {
    command: null,
    commandInfo: null,
    forecastUrl: null,
    samForecastUrl: `https://sam.gov/search/?index=opp&sort=-relevance&page=1&pageSize=25&sfm%5Bstatus%5D%5Bis_active%5D=true`,
    smallBusinessContact: null,
    website: null
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
