#!/usr/bin/env node

/**
 * Import NSF Acquisition Forecast PDF
 *
 * Source: https://nsf.gov/about/contracting/forecast.jsp
 * File: ~/Market Assasin/Eric Docs/NSF-Acquisition-Forecast.pdf
 *
 * Contains ~55 records from NSF divisions:
 * - Office of Budget, Finance, and Award Management (DFM, RIO, DACS)
 * - Office of Chief Information Officer (OCIO)
 * - Directorate for Computer and Information Science & Engineering (CSE)
 * - Office of the Director (OIA)
 * - Directorate for Engineering (ENG)
 * - Directorate for Geosciences (GEO)
 * - Other directorates
 *
 * Note: This uses hardcoded data extracted from the PDF since PDF parsing
 * is unreliable. The PDF was read manually and data extracted.
 *
 * Usage:
 *   node scripts/import-nsf-forecasts.js --dry-run    # Preview
 *   node scripts/import-nsf-forecasts.js              # Import
 */

const { createClient } = require('@supabase/supabase-js');

// Environment
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Dollar range mapping (from PDF legend)
// 1 = $250,000 to $1,000,000
// 2 = $1,000,000 to $5,000,000
// 3 = Over $5,000,000
function parseValueRange(dollarRange) {
  switch (String(dollarRange).trim()) {
    case '1':
      return { min: 250000, max: 1000000 };
    case '2':
      return { min: 1000000, max: 5000000 };
    case '3':
      return { min: 5000000, max: null }; // Over $5M
    default:
      return { min: null, max: null };
  }
}

// Normalize set-aside type
function normalizeSetAside(setAside) {
  if (!setAside) return null;
  const sa = setAside.toLowerCase().trim();

  if (sa.includes('8(a)') || sa.includes('8a') || sa === 'sdb (8a)') return '8(a)';
  if (sa.includes('hubzone')) return 'HUBZone';
  if (sa.includes('sdvosb')) return 'SDVOSB';
  if (sa.includes('wosb')) return 'WOSB';
  if (sa.includes('sb') || sa === 'sb') return 'Small Business';
  if (sa.includes('n/a') || sa === 'n/a') return null;
  if (sa.includes('tbd')) return 'TBD';

  return setAside;
}

// NSF Forecast data extracted from PDF (July 24, 2025)
// Source: NSF-Acquisition-Forecast.pdf
const NSF_FORECASTS = [
  // Office of Budget, Finance, and Award Management
  { division: 'DFM', title: 'iTRAK Recompete', description: 'This action re-procures services to support the NSF commercial off-the-shelf (COTS) core financial management system, iTRAK, and related interfaces in a hosted environment.', prevContract: 'Recompete', contractNo: '49100419F1050', expDate: '3/31/2026', dollarRange: '3', naics: '541512', quarter: '1st Quarter', setAside: 'N/A', status: 'Closed' },
  { division: 'RIO', title: 'Business System Review Support Tasks', description: 'Contract to support NSF oversight of large facilities through business system reviews.', prevContract: 'Recompete', contractNo: '49100422F0054', expDate: '12/31/2024', dollarRange: '2', naics: '541611', quarter: '1st Quarter', setAside: 'SDB (8A)', status: 'Closed' },
  { division: 'DACS', title: 'Closeout Support', description: 'Support for tasks to closeout contracts.', prevContract: 'Recompete', contractNo: '49100420C0027', expDate: '3/31/2025', dollarRange: '2', naics: '541611', quarter: '2nd Quarter', setAside: 'SDB (8A)', status: null },

  // OCIO
  { division: 'OCIO', title: 'Chief Data Officer Support', description: 'Support for the Chief Data Officer (CDO) team focusing on governance, data management, and emerging technologies.', prevContract: 'Follow-on', contractNo: '49100423C0051', expDate: '9/30/2025', dollarRange: '2', naics: '541519', quarter: '3rd Quarter', setAside: 'SDB (8A)', status: 'Terminated' },
  { division: 'OCIO', title: 'Wireless Telecommunications Expense Management Services (WTEMS)', description: 'Provide wireless telecommunications and expense management services.', prevContract: 'Recompete', contractNo: '49100424F0039', expDate: '1/20/2025', dollarRange: '2', naics: '517312', quarter: '1st Quarter', setAside: 'SB', status: 'Closed' },
  { division: 'OCIO', title: 'Acquisition Support (ACAP)', description: 'Provide OCIO with acquisition support services.', prevContract: 'Follow-on', contractNo: '49100420C0008', expDate: '3/31/2025', dollarRange: '2', naics: '541611', quarter: '1st Quarter', setAside: 'SDB (8A)', status: 'Terminated' },
  { division: 'OCIO', title: 'NSF Web Support Services', description: 'Web application maintenance and development support for NSF.gov and Java-based applications.', prevContract: 'Follow-on', contractNo: '49100421C0034', expDate: '8/31/2025', dollarRange: '2', naics: '541511', quarter: '2nd Quarter', setAside: 'SDB (8A)', status: 'Terminated' },
  { division: 'OCIO', title: 'ServiceNow', description: 'Renew licenses for ServiceNow Service Desk operations and management tools.', prevContract: 'Recompete', contractNo: '4910024F0120', expDate: '8/24/2025', dollarRange: '3', naics: '541519', quarter: '3rd Quarter', setAside: 'SDB (8A)', status: 'Market Research' },
  { division: 'OCIO', title: 'Zoom', description: 'Web conferencing virtual collaboration tool with support services.', prevContract: 'Recompete', contractNo: '4910020C0004', expDate: '1/29/2025', dollarRange: '1', naics: '517911', quarter: '1st Quarter', setAside: 'SDB (8A)', status: 'Awarded' },
  { division: 'OCIO', title: 'Cisco Smartnet', description: 'Maintenance for Cisco products including switches, routers, UCS, and Telepresence.', prevContract: 'Recompete', contractNo: '4910024F0091', expDate: '6/30/2025', dollarRange: '1', naics: '541519', quarter: '3rd Quarter', setAside: 'SB', status: 'Market Research' },
  { division: 'OCIO', title: 'FireEye Trellix', description: 'Network monitoring security product to protect against advanced attacks.', prevContract: 'Recompete', contractNo: '4910024F0158', expDate: '8/12/2025', dollarRange: '1', naics: '541519', quarter: '3rd Quarter', setAside: 'SDB (8A)', status: 'Market Research' },
  { division: 'OCIO', title: 'Adobe Enterprise Term License Agreement (ETLA)', description: 'Adobe Acrobat Pro, Creative Cloud, and Sign for Enterprise licensing.', prevContract: 'Recompete', contractNo: '4910022F0121', expDate: '8/31/2025', dollarRange: '1', naics: '541519', quarter: '3rd Quarter', setAside: 'HUBZone', status: 'Market Research' },
  { division: 'OCIO', title: 'Tableau Server', description: 'Server environment supporting Tableau Creator for publishing and sharing work.', prevContract: 'Recompete', contractNo: '4910024F0088', expDate: '10/30/2025', dollarRange: '1', naics: '541519', quarter: '4th Quarter', setAside: 'SB', status: 'Awarded' },
  { division: 'OCIO', title: 'Cohesity', description: 'Backup, retention and recovery for server and storage environment.', prevContract: 'Recompete', contractNo: '4910024F0040', expDate: '3/31/2025', dollarRange: '1', naics: '541519', quarter: '2nd Quarter', setAside: 'SB', status: 'Awarded' },
  { division: 'OCIO', title: 'Forge Rock OpenAM/OpenDJ', description: 'Authentication & authorization for single sign-on for NSF systems.', prevContract: 'Recompete', contractNo: '4910024F0151', expDate: '8/13/2025', dollarRange: '1', naics: '541519', quarter: '3rd Quarter', setAside: 'SB', status: 'Terminated' },
  { division: 'OCIO', title: 'Druva InSync', description: 'SaaS platform for unified data protection and management across endpoints.', prevContract: 'Recompete', contractNo: '4910022F0145', expDate: '10/3/2025', dollarRange: '1', naics: '541519', quarter: '4th Quarter', setAside: 'SDVOSB', status: 'Market Research' },
  { division: 'OCIO', title: 'FireEye Managed Defense', description: 'Advanced real-time network monitoring and security remediation services.', prevContract: 'Recompete', contractNo: '4910022F0197', expDate: '9/29/2025', dollarRange: '1', naics: '541519', quarter: '3rd Quarter', setAside: 'SB', status: 'Market Research' },
  { division: 'OCIO', title: 'Gartner', description: 'Technical advice for architecture, engineering, and implementation decisions.', prevContract: 'Recompete', contractNo: '4910024F0056', expDate: '1/31/2025', dollarRange: '1', naics: '541519', quarter: '4th Quarter', setAside: 'N/A', status: 'Closed' },
  { division: 'OCIO', title: 'Oracle Sparc', description: 'Oracle maintenance support for SPARC mid-size servers.', prevContract: 'Recompete', contractNo: '4910022F0196', expDate: '10/31/2025', dollarRange: '1', naics: '541519', quarter: '4th Quarter', setAside: 'WOSB', status: 'Acquisition Planning' },
  { division: 'OCIO', title: 'Okta IDaaS', description: 'Identity-as-a-Service platform for Zero-Trust Architecture.', prevContract: 'Recompete', contractNo: '4910024F0216', expDate: '9/9/2025', dollarRange: '1', naics: '541519', quarter: '3rd Quarter', setAside: 'SB', status: 'Awaiting solicitation' },
  { division: 'OCIO', title: 'Salesforce', description: 'Customer Relationship Management tool and platform licenses.', prevContract: 'Recompete', contractNo: '49100424F0092', expDate: '5/12/2024', dollarRange: '1', naics: '541519', quarter: '2nd Quarter', setAside: 'SDB (8A)', status: 'Terminated' },
  { division: 'OCIO', title: 'Cloudflare', description: 'Wide-area networking tools with security over cloud service.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '1', naics: 'TBD', quarter: '2nd Quarter', setAside: 'TBD', status: 'Acquisition Planning' },
  { division: 'OCIO', title: 'Varonis Licensing', description: 'Varonis Data Security Platform for zero trust security requirements.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '1', naics: 'TBD', quarter: '2nd Quarter', setAside: 'TBD', status: 'Acquisition Planning' },

  // CISE
  { division: 'CSE', title: 'SEATS', description: 'Science and Engineering Technical and Analytical Support Services.', prevContract: 'Recompete', contractNo: '49100421F0194', expDate: '9/1/2024', dollarRange: '2', naics: '541330', quarter: '1st Quarter FY24', setAside: 'N/A', status: 'Solicitation canceled' },
  { division: 'CSE', title: 'Agile', description: 'Data and analytics support services for CISE to improve organizational efficiency.', prevContract: 'Follow-on', contractNo: '49100421D0003', expDate: '1/4/2024', dollarRange: '1', naics: '541330', quarter: '1st Quarter FY24', setAside: 'WOSB', status: 'Exercising option' },
  { division: 'CSE', title: 'CISE Research Expansion (CISE MSI)', description: 'Evaluation and assessment of CISE Research Expansion program for Year 5.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '1', naics: '541511, 541519', quarter: '1st Quarter FY24', setAside: 'TBD', status: 'Canceled' },
  { division: 'CSE', title: 'CSforAll Evaluation', description: 'Evaluation of Computer Science for All Researcher Practitioner Partnerships.', prevContract: 'Follow-on', contractNo: '49100421D0013', expDate: '7/13/2025', dollarRange: '1', naics: null, quarter: null, setAside: null, status: 'Closed' },
  { division: 'CSE', title: 'BPC Pilot Evaluation', description: 'Evaluation of CISE Broadening Participation in Computing Pilot.', prevContract: 'Follow-on', contractNo: '49100421D0016', expDate: '4/10/2025', dollarRange: '1', naics: null, quarter: null, setAside: null, status: 'Closed' },
  { division: 'CSE', title: 'NAIRR', description: 'Administrative support for National Artificial Intelligence Research Resource Pilot.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: null, naics: null, quarter: '2nd Quarter', setAside: 'TBD', status: 'Awarded' },

  // Office of the Director
  { division: 'OIA', title: 'EPSCoR Data Outcomes Portal', description: 'Standardized data collection portal for EPSCoR Research Infrastructure Improvement tracks.', prevContract: 'Recompete', contractNo: '47QTCB22D0122', expDate: '3/31/2025', dollarRange: '2', naics: '541511, 541519', quarter: '1st Quarter', setAside: 'TBD', status: 'Anticipated on STARS GWAC' },
  { division: 'OIA', title: 'Qualtrics software purchase', description: 'Procurement of survey software licenses.', prevContract: 'Recompete', contractNo: 'NG15SD79B 49100423F02', expDate: '9/29/2026', dollarRange: '2', naics: '513210', quarter: '4th Quarter', setAside: 'TBD', status: 'Market Research' },
  { division: 'OIA', title: 'Data for Outcome Measurements, Innovations, and Operations (DOMINO)', description: 'Acquire data to support assessment and evaluation of NSF portfolio.', prevContract: 'Follow-on', contractNo: '49100421C0040', expDate: '3/14/2025', dollarRange: '3', naics: '541519', quarter: '3rd Quarter', setAside: 'TBD', status: 'Canceled' },

  // Engineering
  { division: 'ENG/EEC', title: 'Program-level Database and Associated Support Services', description: 'Upgrade and enhance ERC website and data collection.', prevContract: 'Recompete', contractNo: '49100422C0012', expDate: '9/9/2025', dollarRange: '3', naics: '519190', quarter: '2nd Quarter', setAside: 'TBD', status: 'Acquisition Planning' },
  { division: 'ENG/EFMA', title: 'Improving public perceptions of engineering', description: 'Research for awareness campaign to improve recognition of engineering careers.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '1', naics: '541990', quarter: '1st Quarter', setAside: null, status: 'Canceled' },

  // Geosciences
  { division: 'GEO', title: 'GEO Facilities Knowledge Management', description: 'Expert/advisor support for GEO oversight and knowledge management.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: null, naics: '541511, 541618', quarter: '1st Quarter', setAside: 'SB', status: 'Terminated' },
  { division: 'OPP', title: 'Antarctic Science and Engineering Support', description: 'Logistic support for Antarctic research operations (ASESC successor).', prevContract: 'Recompete', contractNo: 'NSFDACS1219442', expDate: '3/31/2025', dollarRange: '3', naics: '561210', quarter: '1st Quarter', setAside: 'TBD', status: 'Solicitation released on SAM.gov' },
  { division: 'RISE', title: 'X-Prize Climate Challenge', description: 'Challenge competition addressing climate issues in partnership with X-Prize.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: null, naics: null, quarter: '3rd Quarter', setAside: 'TBD', status: 'Acquisition Planning' },

  // Office of Information & Resource Management
  { division: 'DAS', title: 'Personnel Security Adjudicators/Assistants', description: 'Support for Personnel Security and Suitability Program.', prevContract: 'Recompete', contractNo: '49100423C0023', expDate: '7/31/2025', dollarRange: '2', naics: '541611', quarter: 'Quarter 3', setAside: 'SDB (8A)', status: 'Closed' },
  { division: 'DAS', title: 'Integrated Operational Support', description: 'Strategic communications, graphic design, and facility management.', prevContract: 'Recompete', contractNo: '49100421C0016', expDate: '9/30/2025', dollarRange: '2', naics: '561499', quarter: 'Quarter 4', setAside: 'SDB (8A)', status: 'Closed' },
  { division: 'DAS', title: 'Maintenance of Physical Access Control System', description: 'Maintenance and extended warranty of secure command center.', prevContract: 'Recompete', contractNo: '49100419F0087', expDate: '3/15/2025', dollarRange: '2', naics: '315999', quarter: 'Quarter 2', setAside: 'TBD', status: 'Awarded' },
  { division: 'DAS', title: 'Library Journals and Periodicals', description: 'Library media purchasing including management systems and subscriptions.', prevContract: 'Recompete', contractNo: '100424F0014(BPA 19A10)', expDate: '1/30/2025', dollarRange: '3', naics: '511130', quarter: 'Quarter 1', setAside: 'TBD', status: 'Awarded' },
  { division: 'HRM', title: 'Human Capital Management (HCM) solution', description: 'Comprehensive HCM solution for learning ecosystem and career development.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '3', naics: '511210, 541511, 541519', quarter: '1st Quarter', setAside: 'TBD', status: 'Awarded' },

  // Math and Physical Sciences
  { division: 'AST', title: 'Arecibo Site Maintenance', description: 'Building and equipment maintenance, landscaping, security for Arecibo Site.', prevContract: 'Recompete', contractNo: '49100423C0032', expDate: '9/30/2025', dollarRange: '3', naics: '561210', quarter: '2nd Quarter', setAside: 'SDB (8A)', status: 'Acquisition Planning' },
  { division: 'AST', title: 'Arecibo Site Programmatic Suite Construction', description: 'Construction services for building alterations on Arecibo Site.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '2', naics: '236220', quarter: '1st Quarter', setAside: 'SDB (8A)', status: 'Acquisition Planning' },
  { division: 'AST', title: 'National Spectrum Strategy Spectrum Pipeline Studies', description: 'Studies for spectrum reallocation or sharing in 3.1-3.45 GHz and 7.125-8.4 GHz bands.', prevContract: 'New', contractNo: null, expDate: '9/30/2027', dollarRange: '2', naics: '541330', quarter: '1st Quarter', setAside: 'TBD', status: 'Closed, proceeding as Cooperative Agreement' },

  // Social, Behavioral & Economic Sciences
  { division: 'NCSES', title: 'Preparation of Bibliometric, Patent, and Trademark Data Tables', description: 'Bibliometric and patent data for Science and Engineering Indicators.', prevContract: 'Recompete', contractNo: '49100419F0051', expDate: '2/16/2024', dollarRange: '1', naics: '541611', quarter: 'Quarter 1', setAside: 'N/A', status: 'Awarded' },
  { division: 'NCSES', title: 'NSDS Data Concierge Build', description: 'Central component for National Secure Data Service supporting evidence-building.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '2', naics: '541720', quarter: 'Quarter 1', setAside: 'TBD', status: 'Closed' },
  { division: 'NCSES', title: 'NSDS Data Usage Platform Build', description: 'Build pilot Data Usage Platform dashboard for federal data assets.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '2', naics: '541720', quarter: 'Quarter 3', setAside: 'TBD', status: 'Closed' },
  { division: 'NCSES', title: 'Capacity Building Center Build', description: 'Development of capacity building center for National Secure Data Service.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '2', naics: '541720', quarter: 'Quarter 1', setAside: 'TBD', status: 'Closed' },
  { division: 'NCSES', title: 'Survey Portfolio Review', description: 'Review and assessment of NCSES education, workforce, and R&D surveys.', prevContract: 'New', contractNo: null, expDate: null, dollarRange: '1', naics: '541611', quarter: 'Quarter 1', setAside: 'N/A', status: 'Acquisition Planning' },
  { division: 'NCSES', title: '2026-2028 Survey of Earned Doctorates (SED)', description: 'Conduct next three cycles of the Survey of Earned Doctorates.', prevContract: 'Recompete', contractNo: '49100422F0033', expDate: '3/31/2027', dollarRange: '3', naics: '541611', quarter: '2nd Quarter', setAside: 'TBD', status: 'Awarded' },
  { division: 'NCSES', title: 'Standard Application Process (SAP) Portal', description: 'Application portal for confidential data from 16 statistical agencies.', prevContract: 'Recompete', contractNo: '49100421C0005', expDate: '12/10/2025', dollarRange: '2', naics: '541512', quarter: 'Quarter 1', setAside: 'TBD', status: 'Solicitation issued via GSA MAS' },

  // TIP
  { division: 'TIP', title: 'Salesforce Management and Operations Support Services', description: 'Broadly scoped Salesforce support for TIP programs.', prevContract: 'Follow-on', contractNo: '4910022D0010', expDate: '9/24/2025', dollarRange: '2', naics: '541512', quarter: 'Quarter 4', setAside: 'SDB (8A)', status: 'Acquisition Planning' },
  { division: 'TIP', title: 'NSF Salesforce Licensing and Professional Services Support', description: 'TIP and Enterprise Salesforce licensing task orders.', prevContract: 'Follow-on', contractNo: '4910022D0005', expDate: '5/14/2025', dollarRange: null, naics: '541511', quarter: '3rd Quarter', setAside: 'SDB (8A)', status: 'Closed, pending award' },
  { division: 'TIP/ITE', title: 'Team Science', description: 'Convergence Accelerator Phase 1 Innovation Curriculum, Team Science.', prevContract: 'New', contractNo: '49100422P0046', expDate: '7/31/2024', dollarRange: '3', naics: '541000', quarter: '2nd Quarter', setAside: 'N/A', status: 'Moved to FY26' },
  { division: 'TIP', title: 'Science and Engineering Technical and Analytical Support', description: 'Science and Engineering Technical and Analytical Support recompete.', prevContract: 'Recompete', contractNo: '49100421F0194', expDate: '3/6/2025', dollarRange: '3', naics: '541330', quarter: '1st Quarter', setAside: 'N/A', status: 'Closed' },
];

/**
 * Transform record to database format
 */
function transformRecord(row, index) {
  const { min, max } = parseValueRange(row.dollarRange);

  return {
    source_agency: 'NSF',
    source_type: 'excel', // Using 'excel' since it's from a document
    source_url: 'https://nsf.gov/about/contracting/forecast.jsp',
    external_id: `NSF-${row.division}-${row.contractNo || index}-${Date.now()}`,

    title: row.title || 'NSF Forecast',
    description: row.description || null,

    department: 'National Science Foundation',
    bureau: row.division || null,
    contracting_office: row.division || null,

    naics_code: row.naics ? row.naics.split(',')[0].trim() : null, // Take first NAICS if multiple
    psc_code: null,

    fiscal_year: 2025, // FY2025 forecast
    anticipated_quarter: row.quarter || null,
    anticipated_award_date: row.expDate || null,

    estimated_value_min: min,
    estimated_value_max: max,
    estimated_value_range: row.dollarRange ? `Range ${row.dollarRange}` : null,

    set_aside_type: normalizeSetAside(row.setAside),
    contract_type: row.prevContract || null,
    competition_type: null,

    incumbent_name: null,

    pop_state: null,

    poc_name: null,
    poc_email: 'OSDBU@nsf.gov',
    poc_phone: null,

    status: row.status || 'forecast',
    raw_data: JSON.stringify(row),
  };
}

/**
 * Main import function
 */
async function importForecasts(dryRun = false) {
  console.log('='.repeat(60));
  console.log('NSF Acquisition Forecast Import');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no database writes)' : 'LIVE IMPORT'}\n`);

  console.log(`Total records: ${NSF_FORECASTS.length}`);

  // Count by division
  const byDivision = {};
  NSF_FORECASTS.forEach(r => {
    const div = r.division || 'Unknown';
    byDivision[div] = (byDivision[div] || 0) + 1;
  });

  console.log('\nRecords by Division:');
  Object.entries(byDivision)
    .sort((a, b) => b[1] - a[1])
    .forEach(([div, count]) => {
      console.log(`  ${div}: ${count}`);
    });
  console.log('');

  // Transform records
  const transformed = NSF_FORECASTS.map((r, i) => transformRecord(r, i));

  // Show sample
  console.log('Sample transformed record:');
  console.log(JSON.stringify(transformed[0], null, 2));
  console.log('');

  if (dryRun) {
    console.log('DRY RUN complete. No data written.');
    return { imported: 0, errors: 0 };
  }

  // Check for existing NSF records
  console.log('Checking for existing NSF records...');
  const { data: existing } = await supabase
    .from('agency_forecasts')
    .select('external_id')
    .eq('source_agency', 'NSF');

  const existingCount = (existing || []).length;
  console.log(`Found ${existingCount} existing NSF records`);

  // Import
  const BATCH_SIZE = 50;
  let imported = 0;
  let errors = 0;

  console.log(`Importing ${transformed.length} records...`);

  for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
    const batch = transformed.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from('agency_forecasts')
      .insert(batch);

    if (error) {
      console.error(`Batch error:`, error.message);
      errors += batch.length;
    } else {
      imported += batch.length;
      process.stdout.write(`\rImported: ${imported}/${transformed.length}`);
    }
  }

  console.log('\n\n' + '='.repeat(60));
  console.log('IMPORT COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total imported: ${imported}`);
  console.log(`Total errors: ${errors}`);

  return { imported, errors };
}

// Run
const dryRun = process.argv.includes('--dry-run');
importForecasts(dryRun).catch(console.error);
