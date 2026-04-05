/**
 * Generate comprehensive spending patterns and vehicle data for all 250 agencies
 *
 * This script reads the pain points database and generates realistic
 * spending patterns, vehicles, and procurement sources for each agency
 * based on their type, parent, and mission.
 */

const fs = require('fs');
const path = require('path');

// Load pain points data
const painPointsPath = path.join(__dirname, '../src/data/agency-pain-points.json');
const painPointsData = JSON.parse(fs.readFileSync(painPointsPath, 'utf8'));

// Vehicle definitions by category
const vehiclesByCategory = {
  defense_it: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'Alliant 3', manager: 'GSA', naics: ['541512', '541513', '541519'] },
    { name: 'CIO-SP4', manager: 'NIH', naics: ['541512', '541513', '541519'] },
    { name: '8(a) STARS III', manager: 'GSA', naics: ['541512', '541513', '541519'] },
  ],
  defense_engineering: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'SeaPort-NxG', manager: 'Navy', naics: ['541330', '541715', '541714'] },
    { name: 'ASTRO', manager: 'GSA', naics: ['541330', '541712'] },
  ],
  navy: [
    { name: 'SeaPort-NxG', manager: 'Navy', naics: ['541330', '541715', '541714'] },
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'N00189 Navy MACC', manager: 'Navy', naics: ['236220', '238XXX'] },
  ],
  army: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'RS3', manager: 'Army', naics: ['541512', '541330', '541611'] },
    { name: 'ITES-3S', manager: 'Army', naics: ['541512', '541513'] },
  ],
  air_force: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'NETCENTS-3', manager: 'USAF', naics: ['541512', '541513'] },
    { name: 'ABMS', manager: 'USAF', naics: ['541512', '541330'] },
  ],
  health: [
    { name: 'CIO-SP4', manager: 'NIH', naics: ['541512', '541513', '541519'] },
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'PACS IV', manager: 'HHS', naics: ['541512', '621XXX'] },
  ],
  civilian_it: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'Alliant 3', manager: 'GSA', naics: ['541512', '541513', '541519'] },
    { name: 'GSA MAS', manager: 'GSA', naics: ['541512', '541611'] },
  ],
  construction: [
    { name: 'MATOC', manager: 'USACE', naics: ['236220', '237310'] },
    { name: 'GSA PBS', manager: 'GSA', naics: ['236220', '531XXX'] },
    { name: 'NAVFAC MACC', manager: 'Navy', naics: ['236220', '238XXX'] },
  ],
  research: [
    { name: 'CIO-SP4', manager: 'NIH', naics: ['541512', '541714', '541715'] },
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'SEWP V', manager: 'NASA', naics: ['541512', '334111'] },
  ],
  homeland_security: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'FirstSource III', manager: 'DHS', naics: ['541512', '541611'] },
    { name: 'EAGLE II', manager: 'DHS', naics: ['541512', '541513'] },
  ],
  energy: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'EECM III', manager: 'DOE', naics: ['541330', '541620'] },
    { name: 'EMCBC MATOC', manager: 'DOE', naics: ['562910', '541620'] },
  ],
  transportation: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'TAPS', manager: 'DOT', naics: ['541330', '541611'] },
    { name: 'GSA MAS', manager: 'GSA', naics: ['541512', '541611'] },
  ],
  va: [
    { name: 'T4NG2', manager: 'VA', naics: ['541512', '541513', '541519'] },
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'MSPV-NG', manager: 'VA', naics: ['339XXX', '621XXX'] },
  ],
  justice: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'ITSS-5', manager: 'DOJ', naics: ['541512', '541513'] },
    { name: 'GSA MAS', manager: 'GSA', naics: ['541512', '541611'] },
  ],
  interior: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'BPA IDIQ', manager: 'DOI', naics: ['541620', '541330'] },
    { name: 'GSA MAS', manager: 'GSA', naics: ['541512', '541611'] },
  ],
  agriculture: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'GSA MAS', manager: 'GSA', naics: ['541512', '541611'] },
    { name: 'USDA IDIQ', manager: 'USDA', naics: ['541715', '541620'] },
  ],
  nasa: [
    { name: 'SEWP V', manager: 'NASA', naics: ['541512', '334111'] },
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'JETS II', manager: 'NASA', naics: ['541330', '541712'] },
  ],
  state: [
    { name: 'OASIS+', manager: 'GSA', naics: ['541XXX'] },
    { name: 'GSA MAS', manager: 'GSA', naics: ['541512', '541611'] },
    { name: 'DOSECM', manager: 'State', naics: ['541512', '561612'] },
  ],
  small_agency: [
    { name: 'GSA MAS', manager: 'GSA', naics: ['541512', '541611'] },
    { name: '8(a) STARS III', manager: 'GSA', naics: ['541512', '541513'] },
  ],
  grants_focused: [
    { name: 'GSA MAS', manager: 'GSA', naics: ['541512', '541611'] },
  ],
};

// Spending pattern templates
const spendingPatterns = {
  defense_heavy: { samPosted: 15, gsaSchedule: 30, idiqVehicles: 45, directAwards: 10 },
  defense_moderate: { samPosted: 20, gsaSchedule: 35, idiqVehicles: 35, directAwards: 10 },
  navy_specific: { samPosted: 15, gsaSchedule: 25, seaport: 35, idiqVehicles: 15, directAwards: 10 },
  army_specific: { samPosted: 20, gsaSchedule: 30, idiqVehicles: 40, directAwards: 10 },
  air_force_specific: { samPosted: 18, gsaSchedule: 32, idiqVehicles: 40, directAwards: 10 },
  health_agency: { samPosted: 30, gsaSchedule: 25, grants: 35, directAwards: 10 },
  research_heavy: { samPosted: 20, gsaSchedule: 15, grants: 55, directAwards: 10 },
  civilian_standard: { samPosted: 45, gsaSchedule: 35, bpa: 10, directAwards: 10 },
  civilian_it: { samPosted: 35, gsaSchedule: 40, idiqVehicles: 15, directAwards: 10 },
  construction_focused: { samPosted: 40, gsaSchedule: 20, matoc: 30, directAwards: 10 },
  homeland_security: { samPosted: 25, gsaSchedule: 35, idiqVehicles: 30, directAwards: 10 },
  energy_focused: { samPosted: 25, gsaSchedule: 25, grants: 30, idiqVehicles: 10, directAwards: 10 },
  va_specific: { samPosted: 30, gsaSchedule: 35, vaVehicles: 25, directAwards: 10 },
  grants_only: { samPosted: 15, gsaSchedule: 10, grants: 65, directAwards: 10 },
  small_agency: { samPosted: 55, gsaSchedule: 30, bpa: 5, directAwards: 10 },
  regulatory: { samPosted: 50, gsaSchedule: 35, directAwards: 15 },
  intelligence: { samPosted: 10, gsaSchedule: 20, idiqVehicles: 50, directAwards: 20 },
};

// Secondary sources by category
const secondarySources = {
  defense: [
    { name: 'Defense Acquisition Portal', url: 'https://www.acq.osd.mil/', type: 'procurement_info', notes: 'DoD acquisition policy and guidance' },
    { name: 'DFARS/PGI', url: 'https://www.acq.osd.mil/dpap/dars/', type: 'regulations', notes: 'Defense contracting regulations' },
  ],
  navy: [
    { name: 'Navy OSBP Events', url: 'https://www.secnav.navy.mil/smallbusiness/', type: 'events', notes: 'Navy small business outreach' },
    { name: 'SeaPort Portal', url: 'https://www.seaport.navy.mil/', type: 'vehicle_portal', notes: 'SeaPort-NxG task orders' },
  ],
  army: [
    { name: 'Army OSBP', url: 'https://www.army.mil/osbp', type: 'events', notes: 'Army small business programs' },
    { name: 'Army Contracting Command', url: 'https://www.acc.army.mil/', type: 'procurement_info', notes: 'Army contracting opportunities' },
  ],
  air_force: [
    { name: 'AF Small Business', url: 'https://www.airforcesmallbiz.af.mil/', type: 'events', notes: 'USAF small business outreach' },
    { name: 'SAF/AQ', url: 'https://www.safaq.hq.af.mil/', type: 'procurement_info', notes: 'Air Force acquisition' },
  ],
  health: [
    { name: 'NIH RePORTER', url: 'https://reporter.nih.gov/', type: 'research', notes: 'NIH-funded research projects' },
    { name: 'HHS OSDBU', url: 'https://www.hhs.gov/about/agencies/asfr/ogapa/osdbu/', type: 'small_business', notes: 'HHS small business programs' },
  ],
  gsa: [
    { name: 'GSA Interact', url: 'https://interact.gsa.gov/', type: 'events', notes: 'GSA industry days and events' },
    { name: 'GSA Advantage', url: 'https://www.gsaadvantage.gov/', type: 'marketplace', notes: 'GSA Schedule ordering' },
  ],
  energy: [
    { name: 'DOE OSDBU', url: 'https://www.energy.gov/osdbu', type: 'small_business', notes: 'DOE small business programs' },
    { name: 'Lab Partnering Service', url: 'https://labpartnering.org/', type: 'technology_transfer', notes: 'National Lab partnerships' },
  ],
  homeland: [
    { name: 'DHS OSDBU', url: 'https://www.dhs.gov/small-business', type: 'small_business', notes: 'DHS small business programs' },
    { name: 'CISA Cyber', url: 'https://www.cisa.gov/cybersecurity', type: 'requirements', notes: 'Cybersecurity requirements' },
  ],
  va: [
    { name: 'VA OSDBU', url: 'https://www.va.gov/osdbu/', type: 'small_business', notes: 'VA small business, SDVOSB programs' },
    { name: 'VetBiz', url: 'https://vetbiz.va.gov/', type: 'verification', notes: 'SDVOSB verification' },
  ],
  nasa: [
    { name: 'NASA OSBP', url: 'https://www.nasa.gov/osbp', type: 'small_business', notes: 'NASA small business programs' },
    { name: 'NASA SBIR/STTR', url: 'https://sbir.nasa.gov/', type: 'research', notes: 'NASA SBIR opportunities' },
  ],
  justice: [
    { name: 'DOJ OSDBU', url: 'https://www.justice.gov/osdbu', type: 'small_business', notes: 'DOJ small business programs' },
  ],
  interior: [
    { name: 'DOI OSDBU', url: 'https://www.doi.gov/pmb/osdbu', type: 'small_business', notes: 'Interior small business programs' },
  ],
  commerce: [
    { name: 'Commerce OSDBU', url: 'https://www.commerce.gov/osdbu', type: 'small_business', notes: 'Commerce small business programs' },
  ],
  agriculture: [
    { name: 'USDA OSDBU', url: 'https://www.dm.usda.gov/smallbus/', type: 'small_business', notes: 'USDA small business programs' },
  ],
  transportation: [
    { name: 'DOT OSDBU', url: 'https://www.transportation.gov/osdbu', type: 'small_business', notes: 'DOT small business programs' },
  ],
  treasury: [
    { name: 'Treasury OSDBU', url: 'https://home.treasury.gov/about/offices/management/office-of-small-and-disadvantaged-business-utilization', type: 'small_business', notes: 'Treasury small business programs' },
  ],
  state: [
    { name: 'State OSDBU', url: 'https://www.state.gov/small-and-disadvantaged-business-utilization/', type: 'small_business', notes: 'State Dept small business programs' },
  ],
  education: [
    { name: 'ED OSDBU', url: 'https://www2.ed.gov/about/offices/list/osdbu/', type: 'small_business', notes: 'Education small business programs' },
  ],
  labor: [
    { name: 'DOL OSDBU', url: 'https://www.dol.gov/agencies/osdbu', type: 'small_business', notes: 'Labor small business programs' },
  ],
  hud: [
    { name: 'HUD OSDBU', url: 'https://www.hud.gov/program_offices/sdb', type: 'small_business', notes: 'HUD small business programs' },
  ],
  grants: [
    { name: 'Grants.gov', url: 'https://www.grants.gov/', type: 'grants', notes: 'Federal grant opportunities' },
    { name: 'SBIR.gov', url: 'https://www.sbir.gov/', type: 'sbir', notes: 'SBIR/STTR programs' },
  ],
  research: [
    { name: 'SBIR.gov', url: 'https://www.sbir.gov/', type: 'sbir', notes: 'SBIR/STTR across agencies' },
    { name: 'NSF Awards', url: 'https://www.nsf.gov/awardsearch/', type: 'research', notes: 'NSF funded research' },
  ],
};

// Determine agency category
function categorizeAgency(name) {
  const nameLower = name.toLowerCase();

  // Navy
  if (nameLower.includes('navy') || nameLower.includes('naval') ||
      nameLower.includes('navsea') || nameLower.includes('navfac') ||
      nameLower.includes('navair') || nameLower.includes('navwar')) {
    return 'navy';
  }

  // Army
  if (nameLower.includes('army') || nameLower.includes('usace')) {
    return 'army';
  }

  // Air Force
  if (nameLower.includes('air force') || nameLower.includes('usaf') ||
      nameLower.includes('space force')) {
    return 'air_force';
  }

  // Defense general
  if (nameLower.includes('defense') || nameLower.includes('dod') ||
      nameLower.includes('darpa') || nameLower.includes('dtra') ||
      nameLower.includes('dia') || nameLower.includes('nsa') ||
      nameLower.includes('nro') || nameLower.includes('nga')) {
    return 'defense';
  }

  // VA
  if (nameLower.includes('veterans') || nameLower.includes(' va ') ||
      name === 'VA' || nameLower.startsWith('va ')) {
    return 'va';
  }

  // Health
  if (nameLower.includes('health') || nameLower.includes('hhs') ||
      nameLower.includes('cdc') || nameLower.includes('fda') ||
      nameLower.includes('cms') || nameLower.includes('nih') ||
      nameLower.includes('medical') || nameLower.includes('medicare') ||
      nameLower.includes('disease')) {
    return 'health';
  }

  // Research/Science
  if (nameLower.includes('research') || nameLower.includes('science') ||
      nameLower.includes('laboratory') || nameLower.includes('nsf') ||
      nameLower.includes('arpa-') || nameLower.includes('institute')) {
    return 'research';
  }

  // Homeland Security
  if (nameLower.includes('homeland') || nameLower.includes('dhs') ||
      nameLower.includes('fema') || nameLower.includes('cbp') ||
      nameLower.includes('ice') || nameLower.includes('tsa') ||
      nameLower.includes('coast guard') || nameLower.includes('cisa') ||
      nameLower.includes('secret service')) {
    return 'homeland';
  }

  // Energy
  if (nameLower.includes('energy') || nameLower.includes('doe') ||
      nameLower.includes('nuclear') || nameLower.includes('bonneville') ||
      nameLower.includes('power admin')) {
    return 'energy';
  }

  // NASA
  if (nameLower.includes('nasa') || nameLower.includes('aeronautics') ||
      nameLower.includes('space')) {
    return 'nasa';
  }

  // GSA
  if (nameLower.includes('general services') || nameLower.includes('gsa')) {
    return 'gsa';
  }

  // Transportation
  if (nameLower.includes('transportation') || nameLower.includes('dot') ||
      nameLower.includes('faa') || nameLower.includes('fhwa') ||
      nameLower.includes('fra') || nameLower.includes('fta') ||
      nameLower.includes('highway') || nameLower.includes('aviation') ||
      nameLower.includes('railroad') || nameLower.includes('transit')) {
    return 'transportation';
  }

  // Justice
  if (nameLower.includes('justice') || nameLower.includes('doj') ||
      nameLower.includes('fbi') || nameLower.includes('dea') ||
      nameLower.includes('atf') || nameLower.includes('marshals') ||
      nameLower.includes('prisons') || nameLower.includes('attorney')) {
    return 'justice';
  }

  // Interior
  if (nameLower.includes('interior') || nameLower.includes('doi') ||
      nameLower.includes('national park') || nameLower.includes('blm') ||
      nameLower.includes('fish and wildlife') || nameLower.includes('reclamation') ||
      nameLower.includes('geological') || nameLower.includes('indian affairs') ||
      nameLower.includes('land management')) {
    return 'interior';
  }

  // Agriculture
  if (nameLower.includes('agriculture') || nameLower.includes('usda') ||
      nameLower.includes('forest service') || nameLower.includes('farm') ||
      nameLower.includes('food and nutrition') || nameLower.includes('aphis') ||
      nameLower.includes('agricultural')) {
    return 'agriculture';
  }

  // Commerce
  if (nameLower.includes('commerce') || nameLower.includes('doc') ||
      nameLower.includes('census') || nameLower.includes('noaa') ||
      nameLower.includes('nist') || nameLower.includes('patent') ||
      nameLower.includes('economic') || nameLower.includes('trade')) {
    return 'commerce';
  }

  // Treasury
  if (nameLower.includes('treasury') || nameLower.includes('irs') ||
      nameLower.includes('mint') || nameLower.includes('fiscal') ||
      nameLower.includes('comptroller') || nameLower.includes('alcohol') ||
      nameLower.includes('engraving')) {
    return 'treasury';
  }

  // State
  if (nameLower.includes('state') && (nameLower.includes('department') || nameLower.includes('secretary')) ||
      nameLower.includes('diplomatic') || nameLower.includes('consular') ||
      nameLower.includes('foreign')) {
    return 'state';
  }

  // Education
  if (nameLower.includes('education')) {
    return 'education';
  }

  // Labor
  if (nameLower.includes('labor') || nameLower.includes('employment') ||
      nameLower.includes('osha') || nameLower.includes('wage')) {
    return 'labor';
  }

  // HUD
  if (nameLower.includes('housing') || nameLower.includes('hud') ||
      nameLower.includes('urban development')) {
    return 'hud';
  }

  // Grants-focused agencies
  if (nameLower.includes('foundation') || nameLower.includes('endowment') ||
      nameLower.includes('humanities') || nameLower.includes('arts')) {
    return 'grants';
  }

  // Construction-focused
  if (nameLower.includes('construction') || nameLower.includes('facilities') ||
      nameLower.includes('architect')) {
    return 'construction';
  }

  // Regulatory/small agencies
  if (nameLower.includes('commission') || nameLower.includes('board') ||
      nameLower.includes('office of') || nameLower.includes('bureau')) {
    return 'regulatory';
  }

  return 'small_agency';
}

// Get vehicles for category
function getVehicles(category) {
  const vehicleMap = {
    'navy': vehiclesByCategory.navy,
    'army': vehiclesByCategory.army,
    'air_force': vehiclesByCategory.air_force,
    'defense': vehiclesByCategory.defense_it,
    'va': vehiclesByCategory.va,
    'health': vehiclesByCategory.health,
    'research': vehiclesByCategory.research,
    'homeland': vehiclesByCategory.homeland_security,
    'energy': vehiclesByCategory.energy,
    'nasa': vehiclesByCategory.nasa,
    'gsa': vehiclesByCategory.civilian_it,
    'transportation': vehiclesByCategory.transportation,
    'justice': vehiclesByCategory.justice,
    'interior': vehiclesByCategory.interior,
    'agriculture': vehiclesByCategory.agriculture,
    'commerce': vehiclesByCategory.civilian_it,
    'treasury': vehiclesByCategory.civilian_it,
    'state': vehiclesByCategory.state,
    'education': vehiclesByCategory.civilian_it,
    'labor': vehiclesByCategory.civilian_it,
    'hud': vehiclesByCategory.civilian_it,
    'grants': vehiclesByCategory.grants_focused,
    'construction': vehiclesByCategory.construction,
    'regulatory': vehiclesByCategory.small_agency,
    'small_agency': vehiclesByCategory.small_agency,
  };

  return vehicleMap[category] || vehiclesByCategory.small_agency;
}

// Get spending pattern for category
function getSpendingPattern(category) {
  const patternMap = {
    'navy': spendingPatterns.navy_specific,
    'army': spendingPatterns.army_specific,
    'air_force': spendingPatterns.air_force_specific,
    'defense': spendingPatterns.defense_heavy,
    'va': spendingPatterns.va_specific,
    'health': spendingPatterns.health_agency,
    'research': spendingPatterns.research_heavy,
    'homeland': spendingPatterns.homeland_security,
    'energy': spendingPatterns.energy_focused,
    'nasa': spendingPatterns.research_heavy,
    'gsa': spendingPatterns.civilian_it,
    'transportation': spendingPatterns.civilian_it,
    'justice': spendingPatterns.civilian_it,
    'interior': spendingPatterns.civilian_standard,
    'agriculture': spendingPatterns.civilian_standard,
    'commerce': spendingPatterns.civilian_standard,
    'treasury': spendingPatterns.civilian_it,
    'state': spendingPatterns.civilian_standard,
    'education': spendingPatterns.civilian_standard,
    'labor': spendingPatterns.civilian_standard,
    'hud': spendingPatterns.civilian_standard,
    'grants': spendingPatterns.grants_only,
    'construction': spendingPatterns.construction_focused,
    'regulatory': spendingPatterns.regulatory,
    'small_agency': spendingPatterns.small_agency,
  };

  return patternMap[category] || spendingPatterns.small_agency;
}

// Get secondary sources for category
function getSecondarySources(category) {
  const sourceMap = {
    'navy': [...secondarySources.defense, ...secondarySources.navy],
    'army': [...secondarySources.defense, ...secondarySources.army],
    'air_force': [...secondarySources.defense, ...secondarySources.air_force],
    'defense': secondarySources.defense,
    'va': secondarySources.va,
    'health': secondarySources.health,
    'research': [...secondarySources.research, ...secondarySources.grants],
    'homeland': secondarySources.homeland,
    'energy': secondarySources.energy,
    'nasa': secondarySources.nasa,
    'gsa': secondarySources.gsa,
    'transportation': secondarySources.transportation,
    'justice': secondarySources.justice,
    'interior': secondarySources.interior,
    'agriculture': secondarySources.agriculture,
    'commerce': secondarySources.commerce,
    'treasury': secondarySources.treasury,
    'state': secondarySources.state,
    'education': secondarySources.education,
    'labor': secondarySources.labor,
    'hud': secondarySources.hud,
    'grants': secondarySources.grants,
    'construction': secondarySources.gsa,
    'regulatory': [],
    'small_agency': [],
  };

  return sourceMap[category] || [];
}

// Get primary sources
function getPrimarySources(category) {
  const sources = ['sam.gov'];

  if (['defense', 'navy', 'army', 'air_force', 'homeland', 'va', 'civilian_it'].includes(category)) {
    sources.push('gsa_schedule', 'idiq_vehicles');
  } else if (['research', 'grants', 'health'].includes(category)) {
    sources.push('gsa_schedule', 'grants.gov');
  } else {
    sources.push('gsa_schedule');
  }

  return sources;
}

// Determine parent agency
function getParentAgency(name, category) {
  const nameLower = name.toLowerCase();

  if (['navy', 'army', 'air_force'].includes(category) ||
      nameLower.includes('defense') || nameLower.includes('darpa') ||
      nameLower.includes('dla') || nameLower.includes('disa')) {
    return 'Department of Defense';
  }

  if (category === 'health' || nameLower.includes('hhs') ||
      nameLower.includes('cdc') || nameLower.includes('fda') ||
      nameLower.includes('cms') || nameLower.includes('nih')) {
    return 'Department of Health and Human Services';
  }

  if (category === 'homeland' || nameLower.includes('dhs') ||
      nameLower.includes('fema') || nameLower.includes('cbp') ||
      nameLower.includes('ice') || nameLower.includes('tsa') ||
      nameLower.includes('cisa')) {
    return 'Department of Homeland Security';
  }

  if (category === 'energy' || nameLower.includes('doe')) {
    return 'Department of Energy';
  }

  if (category === 'justice' || nameLower.includes('doj') ||
      nameLower.includes('fbi') || nameLower.includes('dea')) {
    return 'Department of Justice';
  }

  if (category === 'interior' || nameLower.includes('doi')) {
    return 'Department of the Interior';
  }

  if (category === 'agriculture' || nameLower.includes('usda')) {
    return 'Department of Agriculture';
  }

  if (category === 'commerce' || nameLower.includes('doc')) {
    return 'Department of Commerce';
  }

  if (category === 'treasury') {
    return 'Department of the Treasury';
  }

  if (category === 'transportation' || nameLower.includes('dot')) {
    return 'Department of Transportation';
  }

  return null;
}

// Extract or generate abbreviation
function getAbbreviation(name) {
  const match = name.match(/\(([A-Z]{2,10})\)/);
  if (match) return match[1];

  // Known abbreviations
  const known = {
    'Department of Defense': 'DOD',
    'Department of the Navy': 'Navy',
    'Department of the Army': 'Army',
    'Department of the Air Force': 'USAF',
    'Department of Veterans Affairs': 'VA',
    'Department of Health and Human Services': 'HHS',
    'General Services Administration': 'GSA',
    'Department of Homeland Security': 'DHS',
    'National Aeronautics and Space Administration': 'NASA',
    'Department of Energy': 'DOE',
    'Small Business Administration': 'SBA',
    'Environmental Protection Agency': 'EPA',
    'Department of Justice': 'DOJ',
    'Department of State': 'State',
    'Department of Transportation': 'DOT',
    'Department of the Treasury': 'Treasury',
    'Department of Agriculture': 'USDA',
    'Department of the Interior': 'DOI',
    'Department of Labor': 'DOL',
    'Department of Education': 'ED',
    'Department of Housing and Urban Development': 'HUD',
    'Department of Commerce': 'DOC',
  };

  if (known[name]) return known[name];

  // Generate abbreviation
  const words = name.split(' ').filter(w => !['of', 'the', 'and', 'for'].includes(w.toLowerCase()));
  if (words.length <= 3) {
    return words.map(w => w[0]?.toUpperCase() || '').join('');
  }
  return words.slice(0, 3).map(w => w[0]?.toUpperCase() || '').join('');
}

// Generate tips
function generateTips(name, category, pattern) {
  const tips = [];
  const hiddenMarket = 100 - (pattern.samPosted || 30);

  if (hiddenMarket > 70) {
    tips.push(`${hiddenMarket}% of spending is NOT on SAM.gov - focus on contract vehicles and relationships.`);
  }

  if (pattern.gsaSchedule > 30) {
    tips.push('GSA Schedule is critical for entry. Apply at GSA eOffer.');
  }

  if (pattern.idiqVehicles > 25) {
    tips.push('IDIQ vehicles dominate - position for next recompete or team with vehicle holders.');
  }

  if (pattern.grants > 30) {
    tips.push('Heavy grants usage - check Grants.gov and SBIR.gov for opportunities.');
  }

  if (pattern.seaport > 20) {
    tips.push('SeaPort-NxG is essential for Navy work. Apply during next on-ramp.');
  }

  if (category === 'va') {
    tips.push('SDVOSB verification provides significant advantage at VA.');
  }

  if (category === 'defense' || category === 'navy' || category === 'army' || category === 'air_force') {
    tips.push('CMMC certification will be required for most DoD contracts.');
  }

  return tips.join(' ');
}

// Main generation
const agencies = {};
const agencyNames = Object.keys(painPointsData.agencies);

for (const name of agencyNames) {
  const category = categorizeAgency(name);
  const pattern = getSpendingPattern(category);
  const vehicles = getVehicles(category);
  const sources = getSecondarySources(category);
  const primary = getPrimarySources(category);
  const parent = getParentAgency(name, category);
  const abbr = getAbbreviation(name);
  const tips = generateTips(name, category, pattern);

  agencies[name] = {
    abbreviation: abbr,
    parent: parent,
    category: category,
    primarySources: primary,
    secondarySources: sources,
    spendingPatterns: pattern,
    topVehicles: vehicles,
    tips: tips,
  };
}

// Output
const output = {
  lastUpdated: new Date().toISOString().split('T')[0],
  totalAgencies: Object.keys(agencies).length,
  agencies: agencies,
  vehicleTypes: {
    gsa_schedule: {
      name: 'GSA Multiple Award Schedule (MAS)',
      description: 'Base requirement for most federal contracting. Gateway to government sales.',
      howToGet: 'Apply at GSA eOffer. 6-12 month process. Need 2 years commercial sales history.',
      benefits: ['Access to all agencies', 'Pre-negotiated pricing', 'Streamlined ordering'],
      url: 'https://www.gsa.gov/buy-through-us/purchasing-programs/gsa-multiple-award-schedule'
    },
    idiq_vehicles: {
      name: 'Indefinite Delivery/Indefinite Quantity (IDIQ)',
      description: 'Pre-competed contract vehicles for specific services/products.',
      howToGet: 'Watch SAM.gov for solicitations. Highly competitive, requires past performance.',
      examples: ['OASIS+', 'Alliant 3', 'CIO-SP4', 'SeaPort-NxG', '8(a) STARS III'],
      benefits: ['Sole access to task orders', 'Multi-year revenue', 'Reduced competition per order']
    },
    bpa: {
      name: 'Blanket Purchase Agreement (BPA)',
      description: 'Simplified acquisition for repeat purchases.',
      howToGet: 'Usually awarded from GSA Schedule or open competition.',
      benefits: ['Streamlined ordering', 'Established relationship', 'Predictable revenue']
    },
    seaport: {
      name: 'SeaPort-NxG',
      description: 'Navy IDIQ for professional services, engineering, and technical support.',
      howToGet: 'Apply during open enrollment periods. Requires Navy-relevant past performance.',
      benefits: ['Direct access to Navy task orders', 'Multiple functional areas', '5-year base + options'],
      url: 'https://www.seaport.navy.mil/'
    }
  },
  recommendations: {
    new_contractor: [
      'Start with SAM.gov registration and GSA Schedule application',
      'Attend free PTAC training sessions',
      'Focus on set-asides if eligible (8(a), WOSB, SDVOSB, HUBZone)',
      'Build past performance through subcontracting first',
      'Get capability statement reviewed before marketing'
    ],
    established_contractor: [
      'Position for IDIQ vehicle competitions (OASIS+, CIO-SP4, etc.)',
      'Track recompetes 12-18 months before expiration',
      'Attend Industry Days for target agencies',
      'Build prime relationships for teaming on large contracts',
      'Maintain CMMC certification for defense work'
    ],
    certification_seeking: [
      '8(a) certification through SBA for socially/economically disadvantaged',
      'SDVOSB verification through VA for veteran-owned',
      'WOSB certification through SBA or third-party certifiers',
      'HUBZone certification for businesses in designated areas'
    ]
  }
};

// Write to file
const outputPath = path.join(__dirname, '../src/data/agency-spending-complete.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`Generated spending data for ${Object.keys(agencies).length} agencies`);
console.log(`Output written to: ${outputPath}`);

// Print category distribution
const categories = {};
for (const [name, data] of Object.entries(agencies)) {
  categories[data.category] = (categories[data.category] || 0) + 1;
}
console.log('\nCategory distribution:');
Object.entries(categories).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
  console.log(`  ${cat}: ${count}`);
});
