// DoD Contracting Office Name Mappings
// Translates cryptic office codes and abbreviations to readable names

// State abbreviations used in office names
const stateAbbreviations: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
  'PR': 'Puerto Rico', 'VI': 'Virgin Islands', 'GU': 'Guam',
};

// Common DoD acronyms and their full names
const dodAcronyms: Record<string, string> = {
  // Army
  'USPFO': 'U.S. Property and Fiscal Office',
  'ARNG': 'Army National Guard',
  'ACA': 'Army Contracting Activity',
  'ACC': 'Army Contracting Command',
  'MICC': 'Mission and Installation Contracting Command',
  'USACE': 'U.S. Army Corps of Engineers',
  'TACOM': 'Tank-automotive and Armaments Command',
  'CECOM': 'Communications-Electronics Command',
  'AMCOM': 'Aviation and Missile Command',
  'PEO': 'Program Executive Office',
  'AMC': 'Army Materiel Command',
  'TRADOC': 'Training and Doctrine Command',
  'FORSCOM': 'Forces Command',
  'INSCOM': 'Intelligence and Security Command',
  'MEDCOM': 'Medical Command',
  'IMCOM': 'Installation Management Command',
  'SDDC': 'Surface Deployment and Distribution Command',
  'ASC': 'Army Sustainment Command',
  'JMC': 'Joint Munitions Command',
  'RDECOM': 'Research, Development and Engineering Command',
  'DEVCOM': 'Combat Capabilities Development Command',
  'CCDC': 'Combat Capabilities Development Command',

  // Navy
  'NAVFAC': 'Naval Facilities Engineering Systems Command',
  'NAVSEA': 'Naval Sea Systems Command',
  'NAVAIR': 'Naval Air Systems Command',
  'NAVWAR': 'Naval Information Warfare Systems Command',
  'SPAWAR': 'Space and Naval Warfare Systems Command',
  'NAVSUP': 'Naval Supply Systems Command',
  'NSWC': 'Naval Surface Warfare Center',
  'NAWC': 'Naval Air Warfare Center',
  'NUWC': 'Naval Undersea Warfare Center',
  'FISC': 'Fleet Industrial Supply Center',
  'FLC': 'Fleet Logistics Center',
  'NEXCOM': 'Navy Exchange Service Command',
  'CNRMA': 'Commander Navy Region Mid-Atlantic',
  'CNIC': 'Commander Navy Installations Command',
  'BUMED': 'Bureau of Medicine and Surgery',
  'ONR': 'Office of Naval Research',
  'MCICOM': 'Marine Corps Installations Command',
  'MCSC': 'Marine Corps Systems Command',
  'MCLB': 'Marine Corps Logistics Base',
  'MWTC': 'Mountain Warfare Training Center',

  // Air Force
  'AFMC': 'Air Force Materiel Command',
  'AFLCMC': 'Air Force Life Cycle Management Center',
  'AFSC': 'Air Force Sustainment Center',
  'AFDW': 'Air Force District of Washington',
  'AFSPC': 'Air Force Space Command',
  // Note: ACC (Air Combat Command) omitted - conflicts with Army Contracting Command
  // Note: AMC (Air Mobility Command) omitted - conflicts with Army Materiel Command
  'AF ACC': 'Air Combat Command',
  'AF AMC': 'Air Mobility Command',
  'AETC': 'Air Education and Training Command',
  'PACAF': 'Pacific Air Forces',
  'USAFE': 'U.S. Air Forces in Europe',
  'AFGSC': 'Air Force Global Strike Command',
  'AFSOC': 'Air Force Special Operations Command',
  'AFRL': 'Air Force Research Laboratory',
  'CONS': 'Contracting Squadron',
  'ECONS': 'Expeditionary Contracting Squadron',
  'SOCONS': 'Special Operations Contracting Squadron',

  // Defense Agencies
  'DLA': 'Defense Logistics Agency',
  'DISA': 'Defense Information Systems Agency',
  'DCMA': 'Defense Contract Management Agency',
  'DCAA': 'Defense Contract Audit Agency',
  'DARPA': 'Defense Advanced Research Projects Agency',
  'MDA': 'Missile Defense Agency',
  'NGA': 'National Geospatial-Intelligence Agency',
  'NSA': 'National Security Agency',
  'DHA': 'Defense Health Agency',
  'DFAS': 'Defense Finance and Accounting Service',
  'DTRA': 'Defense Threat Reduction Agency',
  'DPAA': 'Defense POW/MIA Accounting Agency',
  'WHS': 'Washington Headquarters Services',
  'OSD': 'Office of the Secretary of Defense',
  'OUSD': 'Office of the Under Secretary of Defense',

  // Joint Commands
  'USSOCOM': 'U.S. Special Operations Command',
  'USTRANSCOM': 'U.S. Transportation Command',
  'USCYBERCOM': 'U.S. Cyber Command',
  'USSTRATCOM': 'U.S. Strategic Command',
  'USCENTCOM': 'U.S. Central Command',
  'USINDOPACOM': 'U.S. Indo-Pacific Command',
  'USEUCOM': 'U.S. European Command',
  'USNORTHCOM': 'U.S. Northern Command',
  'USSOUTHCOM': 'U.S. Southern Command',
  'USAFRICOM': 'U.S. Africa Command',

  // Other common abbreviations
  'RCO': 'Regional Contracting Office',
  'ENDIST': 'Engineer District',
  'HQ': 'Headquarters',
  'CMD': 'Command',
  'CTR': 'Center',
  'DIV': 'Division',
  'BDE': 'Brigade',
  'BN': 'Battalion',
  'CO': 'Company',
  'DET': 'Detachment',
  'SQN': 'Squadron',
  'GRP': 'Group',
  'WG': 'Wing',
};

// Known office code to full name mappings
const officeCodeMappings: Record<string, string> = {
  // Army
  'W6QK': 'Mission and Installation Contracting Command',
  'W6QM': 'Mission and Installation Contracting Command',
  'W912DQ': 'U.S. Army Corps of Engineers - Far East District',
  'W912DR': 'U.S. Army Corps of Engineers - Pacific Ocean Division',

  // Navy
  'N00024': 'Naval Sea Systems Command',
  'N00189': 'Naval Supply Systems Command',
  'N00244': 'Naval Facilities Engineering Systems Command',
  'N62470': 'Naval Facilities Engineering Systems Command - Southwest',
  'N62473': 'Naval Facilities Engineering Systems Command - Mid-Atlantic',
  'N69450': 'Naval Air Warfare Center - Aircraft Division',
  'N61331': 'Naval Information Warfare Center - Atlantic',
  'N66001': 'Naval Information Warfare Center - Pacific',
  'H92240': 'Naval Special Warfare Command',
  'M00264': 'Marine Corps Systems Command',
  'M67854': 'Marine Corps Logistics Command',

  // Air Force
  'FA8501': 'Air Force Life Cycle Management Center',
  'FA8601': 'Air Force Sustainment Center',
  'FA8701': 'Air Force Research Laboratory',
  'FA2517': 'Air Force Materiel Command',

  // Defense Agencies
  'HQ0034': 'Defense Logistics Agency',
  'HQ0147': 'Defense Information Systems Agency',
  'SP0600': 'Defense Logistics Agency Energy',
};

/**
 * Translate a cryptic office name to a readable format
 */
export function translateOfficeName(officeName: string, officeId?: string): string {
  let translated = officeName;

  // Check if we have a direct mapping for the office code
  if (officeId) {
    const prefix = officeId.substring(0, 6).toUpperCase();
    if (officeCodeMappings[prefix]) {
      return officeCodeMappings[prefix];
    }
    // Try shorter prefixes
    const shortPrefix = officeId.substring(0, 5).toUpperCase();
    if (officeCodeMappings[shortPrefix]) {
      return officeCodeMappings[shortPrefix];
    }
  }

  // Expand state abbreviations in USPFO names
  // Pattern: "Uspfo Activity XX Arng" → "U.S. Property and Fiscal Office - XX Army National Guard"
  const uspfoMatch = translated.match(/uspfo\s+(?:activity\s+)?(\w{2})\s+arng/i);
  if (uspfoMatch) {
    const stateAbbr = uspfoMatch[1].toUpperCase();
    const stateName = stateAbbreviations[stateAbbr] || stateAbbr;
    return `U.S. Property and Fiscal Office - ${stateName} Army National Guard`;
  }

  // Pattern: "Uspfo For State" → "U.S. Property and Fiscal Office for State"
  const uspfoForMatch = translated.match(/uspfo\s+for\s+(\w+)/i);
  if (uspfoForMatch) {
    const stateName = uspfoForMatch[1];
    return `U.S. Property and Fiscal Office for ${stateName.charAt(0).toUpperCase() + stateName.slice(1).toLowerCase()}`;
  }

  // Expand known acronyms
  for (const [acronym, fullName] of Object.entries(dodAcronyms)) {
    const regex = new RegExp(`\\b${acronym}\\b`, 'gi');
    if (regex.test(translated)) {
      // For short names, just replace the acronym
      if (translated.toUpperCase() === acronym.toUpperCase()) {
        return fullName;
      }
      // For compound names, expand the acronym
      translated = translated.replace(regex, fullName);
    }
  }

  // Clean up contracting squadron names
  // Pattern: "FA3047 802th Contracting Squadron Cc Jbsa" → "802nd Contracting Squadron - Joint Base San Antonio"
  const consMatch = translated.match(/(?:fa\d+\s+)?(\d+)(?:st|nd|rd|th)?\s*(?:contracting\s+squadron|cons)/i);
  if (consMatch) {
    const num = parseInt(consMatch[1]);
    const suffix = num === 1 ? 'st' : num === 2 ? 'nd' : num === 3 ? 'rd' : 'th';
    translated = `${num}${suffix} Contracting Squadron`;

    // Try to extract base name
    const baseMatch = officeName.match(/(?:jb|joint\s+base|afb|ab)\s*(\w+)/i);
    if (baseMatch) {
      translated += ` - ${baseMatch[1]}`;
    }
  }

  // Clean up MICC names
  // Pattern: "MICC Fort Riley" → "Mission and Installation Contracting Command - Fort Riley"
  const miccMatch = translated.match(/micc[- ]+(.*)/i);
  if (miccMatch) {
    const location = miccMatch[1].trim();
    return `Mission and Installation Contracting Command - ${toTitleCase(location)}`;
  }

  // Clean up Army Contracting Activity names
  // Pattern: "Army Contracting Activity - Fort Carson" - already good

  // Clean up generic names
  translated = translated
    .replace(/\bLad\s+Contr\s+Off\b/gi, 'Logistics Acquisition Division Contracting Office')
    .replace(/\bAcc\s+Rrad\b/gi, 'Army Contracting Command - Rock Island')
    .replace(/\bEndist\b/gi, 'Engineer District')
    .replace(/\bRco\b/gi, 'Regional Contracting Office')
    .replace(/\bHq,?\s*Eusa\b/gi, 'Headquarters, Eighth U.S. Army')
    .replace(/\bOfc\s+Pm\b/gi, 'Office of Program Manager')
    .replace(/\bSang\s+Mod\s+Prog\b/gi, 'Saudi Arabian National Guard Modernization Program');

  return toTitleCase(translated);
}

/**
 * Convert string to title case, preserving acronyms
 */
function toTitleCase(str: string): string {
  const acronymsToPreserve = ['MICC', 'NAVFAC', 'NAVSEA', 'NAVAIR', 'USACE', 'DLA', 'DISA', 'USA', 'USN', 'USAF', 'USMC'];

  return str
    .toLowerCase()
    .split(' ')
    .map(word => {
      // Check if this word is a known acronym
      const upperWord = word.toUpperCase();
      if (acronymsToPreserve.includes(upperWord)) {
        return upperWord;
      }
      // Handle hyphenated words
      if (word.includes('-')) {
        return word.split('-').map(part =>
          part.charAt(0).toUpperCase() + part.slice(1)
        ).join('-');
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Get a description for the office based on its type
 */
export function getOfficeDescription(officeName: string, officeId?: string): string {
  const upperName = officeName.toUpperCase();

  if (upperName.includes('USPFO') || upperName.includes('PROPERTY AND FISCAL')) {
    return 'Manages federal property and fiscal operations for the National Guard';
  }
  if (upperName.includes('MICC') || upperName.includes('MISSION AND INSTALLATION')) {
    return 'Provides contracting support for Army installations worldwide';
  }
  if (upperName.includes('NAVFAC')) {
    return 'Provides facilities engineering and acquisition services for the Navy';
  }
  if (upperName.includes('NAVSEA')) {
    return 'Designs, builds, and maintains Navy ships and combat systems';
  }
  if (upperName.includes('NAVAIR')) {
    return 'Provides aircraft and weapons for naval aviation';
  }
  if (upperName.includes('CONTRACTING SQUADRON') || upperName.includes('CONS')) {
    return 'Provides contracting support for Air Force base operations';
  }
  if (upperName.includes('CORPS OF ENGINEERS') || upperName.includes('USACE') || upperName.includes('ENDIST')) {
    return 'Provides engineering and construction services';
  }
  if (upperName.includes('DLA') || upperName.includes('DEFENSE LOGISTICS')) {
    return 'Provides logistics, acquisition, and technical services to military services';
  }

  return 'DoD contracting activity';
}

export { stateAbbreviations, dodAcronyms, officeCodeMappings };
