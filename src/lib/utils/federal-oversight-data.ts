// Federal Oversight Data Fetchers
// Pulls real data from GAO, IG reports, and agency budget justifications
// to provide grounded context for AI pain point generation

export interface GAOHighRiskArea {
  area: string;
  description: string;
  relatedAgencies: string[];
  yearDesignated?: number;
}

export interface IGChallenge {
  challenge: string;
  source: string;
}

export interface AgencyOversightContext {
  gaoHighRiskAreas: string[];
  igChallenges: string[];
  budgetPriorities: string[];
  recentFindings: string[];
}

// GAO High Risk List — 38 areas mapped to relevant agencies
// Source: gao.gov/high-risk-list (updated biennially)
// Hardcoded because the GAO page is not a clean API — this is the authoritative list
const GAO_HIGH_RISK_AREAS: GAOHighRiskArea[] = [
  {
    area: 'Ensuring the Cybersecurity of the Nation',
    description: 'Federal systems face increasing threats; agencies struggle with security frameworks, incident response, and workforce gaps',
    relatedAgencies: ['all'],
    yearDesignated: 1997
  },
  {
    area: 'Government-wide Personnel Security Clearance Process',
    description: 'Timeliness of security clearance investigations and adjudications; backlog reduction',
    relatedAgencies: ['Department of Defense', 'Office of Personnel Management', 'Defense Counterintelligence and Security Agency'],
    yearDesignated: 2018
  },
  {
    area: 'Strategic Human Capital Management',
    description: 'Recruiting, retaining, and managing a skilled federal workforce amid competition from private sector',
    relatedAgencies: ['all'],
    yearDesignated: 2001
  },
  {
    area: 'Managing Federal Real Property',
    description: 'Excess and underutilized properties; deferred maintenance backlog; disposal challenges',
    relatedAgencies: ['General Services Administration', 'Department of Defense', 'Department of Veterans Affairs', 'Department of Energy'],
    yearDesignated: 2003
  },
  {
    area: 'Improving the Management of IT Acquisitions and Operations',
    description: 'Legacy systems, failed modernizations, duplicative investments, IT workforce gaps',
    relatedAgencies: ['all'],
    yearDesignated: 2015
  },
  {
    area: 'DOD Weapon Systems Acquisition',
    description: 'Cost overruns, schedule delays, and performance shortfalls in major defense programs',
    relatedAgencies: ['Department of Defense'],
    yearDesignated: 1990
  },
  {
    area: 'DOD Approach to Business Transformation',
    description: 'Financial management, business systems modernization, and enterprise resource planning',
    relatedAgencies: ['Department of Defense'],
    yearDesignated: 2005
  },
  {
    area: 'DOD Financial Management',
    description: 'Inability to pass financial audits; accounting system deficiencies',
    relatedAgencies: ['Department of Defense'],
    yearDesignated: 1995
  },
  {
    area: 'DOD Contract Management',
    description: 'Inadequate oversight of contractor performance, cost, and schedule',
    relatedAgencies: ['Department of Defense'],
    yearDesignated: 1992
  },
  {
    area: 'NASA Acquisition Management',
    description: 'Cost growth and schedule delays in major NASA projects',
    relatedAgencies: ['National Aeronautics and Space Administration'],
    yearDesignated: 1990
  },
  {
    area: 'DOE Contract and Project Management',
    description: 'Cost overruns and schedule delays in cleanup and construction projects',
    relatedAgencies: ['Department of Energy'],
    yearDesignated: 1990
  },
  {
    area: 'Modernizing the U.S. Financial Regulatory System',
    description: 'Fragmented regulatory structure; gaps in oversight of financial institutions',
    relatedAgencies: ['Department of the Treasury', 'Securities and Exchange Commission', 'Federal Deposit Insurance Corporation'],
    yearDesignated: 2009
  },
  {
    area: 'Resolving the Federal Role in Housing Finance',
    description: 'Government-sponsored enterprises and mortgage market reform',
    relatedAgencies: ['Department of Housing and Urban Development', 'Federal Housing Finance Agency'],
    yearDesignated: 2013
  },
  {
    area: 'USPS Financial Viability',
    description: 'Revenue decline, unfunded liabilities, and need for business model reform',
    relatedAgencies: ['United States Postal Service'],
    yearDesignated: 2009
  },
  {
    area: 'Management of Federal Oil and Gas Resources',
    description: 'Revenue collection, environmental oversight, and leasing practices',
    relatedAgencies: ['Department of the Interior'],
    yearDesignated: 2011
  },
  {
    area: 'Limiting the Federal Government\'s Fiscal Exposure by Better Managing Climate Change Risks',
    description: 'Infrastructure resilience, disaster response costs, and climate adaptation planning',
    relatedAgencies: ['all'],
    yearDesignated: 2013
  },
  {
    area: 'Improving Federal Programs That Serve Tribes and Their Members',
    description: 'Fragmented service delivery, data gaps, and consultation challenges with tribal communities',
    relatedAgencies: ['Department of the Interior', 'Department of Health and Human Services', 'Department of Education'],
    yearDesignated: 2017
  },
  {
    area: 'VA Acquisition Management',
    description: 'Procurement inefficiencies, contract oversight gaps, and medical supply chain issues',
    relatedAgencies: ['Department of Veterans Affairs'],
    yearDesignated: 2019
  },
  {
    area: 'VA Health Care',
    description: 'Access to care, wait times, staffing shortages, and electronic health record modernization',
    relatedAgencies: ['Department of Veterans Affairs'],
    yearDesignated: 2015
  },
  {
    area: 'Transforming EPA\'s Process for Assessing and Controlling Toxic Chemicals',
    description: 'Slow chemical risk assessments, resource constraints, and outdated processes',
    relatedAgencies: ['Environmental Protection Agency'],
    yearDesignated: 2009
  },
  {
    area: 'Protecting Public Health through Enhanced Oversight of Medical Products',
    description: 'Drug and device safety oversight, supply chain vulnerabilities, and inspection capacity',
    relatedAgencies: ['Department of Health and Human Services', 'Food and Drug Administration'],
    yearDesignated: 2009
  },
  {
    area: 'Transforming DOD Supply Chain Management',
    description: 'Inventory management inefficiencies, spare parts shortages, and distribution challenges',
    relatedAgencies: ['Department of Defense', 'Defense Logistics Agency'],
    yearDesignated: 1990
  },
  {
    area: 'Strengthening DHS Management Functions',
    description: 'Acquisition, financial, IT, and human capital management challenges at DHS',
    relatedAgencies: ['Department of Homeland Security'],
    yearDesignated: 2003
  },
  {
    area: 'National Flood Insurance Program',
    description: 'Financial sustainability, rate-setting methodology, and flood mapping accuracy',
    relatedAgencies: ['Federal Emergency Management Agency', 'Department of Homeland Security'],
    yearDesignated: 2006
  },
  {
    area: 'Decennial Census',
    description: 'Operational planning, IT systems, and cost management for census operations',
    relatedAgencies: ['Department of Commerce', 'Census Bureau'],
    yearDesignated: 2017
  },
  {
    area: 'Enforcement of Tax Laws',
    description: 'Tax gap, IRS modernization, customer service, and compliance enforcement',
    relatedAgencies: ['Department of the Treasury', 'Internal Revenue Service'],
    yearDesignated: 1990
  },
  {
    area: 'Medicare Program & Improper Payments',
    description: 'Fraud, waste, and abuse in Medicare; improper payment rates',
    relatedAgencies: ['Department of Health and Human Services', 'Centers for Medicare & Medicaid Services'],
    yearDesignated: 1990
  },
  {
    area: 'Medicaid Program',
    description: 'Federal-state oversight gaps, improper payments, and program integrity',
    relatedAgencies: ['Department of Health and Human Services', 'Centers for Medicare & Medicaid Services'],
    yearDesignated: 2003
  },
  {
    area: 'Mitigating Gaps in Weather Satellite Data',
    description: 'Continuity of weather observations, satellite program delays, and data gaps',
    relatedAgencies: ['Department of Commerce', 'National Oceanic and Atmospheric Administration'],
    yearDesignated: 2013
  },
  {
    area: 'U.S. Government\'s Environmental Liability',
    description: 'Nuclear waste cleanup costs at DOE and DOD sites; growing environmental remediation liabilities',
    relatedAgencies: ['Department of Energy', 'Department of Defense'],
    yearDesignated: 2017
  },
  {
    area: 'Nuclear Weapons Complex: Safety, Security, and Environment',
    description: 'Aging infrastructure, workforce challenges, and environmental compliance at nuclear facilities',
    relatedAgencies: ['Department of Energy', 'National Nuclear Security Administration'],
    yearDesignated: 2017
  },
  {
    area: 'Government-wide: Improper Payments',
    description: 'Estimated $175B+ annually in improper payments across federal programs',
    relatedAgencies: ['all'],
    yearDesignated: 2018
  },
  {
    area: 'Pandemic Preparedness and Response',
    description: 'Medical supply stockpile management, surge capacity, and interagency coordination',
    relatedAgencies: ['Department of Health and Human Services', 'Department of Homeland Security', 'Federal Emergency Management Agency'],
    yearDesignated: 2022
  },
  {
    area: 'Emergency Loans for Small Businesses',
    description: 'SBA disaster loan processing, fraud prevention, and program oversight',
    relatedAgencies: ['Small Business Administration'],
    yearDesignated: 2022
  },
  {
    area: 'Unemployment Insurance',
    description: 'State UI program integrity, fraud prevention, and IT modernization',
    relatedAgencies: ['Department of Labor'],
    yearDesignated: 2022
  },
  {
    area: 'Border Security',
    description: 'Technology deployment, staffing, and processing at ports of entry and between ports',
    relatedAgencies: ['Department of Homeland Security', 'Customs and Border Protection'],
    yearDesignated: 2005
  },
];

// IG Top Management Challenges — pre-mapped for major agencies
// These are extracted from OIG semiannual reports and Top Management Challenges reports
// Source: Individual agency IG websites and oversight.gov
const IG_CHALLENGES_BY_AGENCY: Record<string, string[]> = {
  'Department of Defense': [
    'Financial management and audit readiness',
    'Cybersecurity of weapons systems and networks',
    'Contractor oversight and performance accountability',
    'Supply chain risk management and foreign dependency',
    'IT modernization and legacy system retirement',
    'Acquisition reform and cost control',
  ],
  'Department of Health and Human Services': [
    'Medicare and Medicaid fraud, waste, and abuse',
    'Prescription drug pricing transparency',
    'Health IT interoperability and data sharing',
    'Grant management and oversight',
    'Pandemic preparedness infrastructure',
    'Cybersecurity of health data systems',
  ],
  'Department of Homeland Security': [
    'Border security technology deployment',
    'Cybersecurity mission effectiveness',
    'Acquisition management and oversight',
    'Immigration processing and case management',
    'FEMA disaster assistance and grant management',
    'Transportation security technology modernization',
  ],
  'Department of Veterans Affairs': [
    'Electronic health record modernization (Oracle/Cerner)',
    'Access to care and wait time management',
    'Supply chain and medical logistics',
    'Construction project management and cost control',
    'IT security and data protection',
    'Claims processing and benefits delivery',
  ],
  'Department of Energy': [
    'Environmental cleanup and waste management',
    'Nuclear weapons modernization and stockpile stewardship',
    'Cybersecurity of energy infrastructure',
    'Contract and project management',
    'National laboratory management and oversight',
    'Grid modernization and resilience',
  ],
  'Department of the Interior': [
    'Wildfire management and prescribed burning',
    'Oil and gas revenue collection and royalty management',
    'Information technology security',
    'Infrastructure maintenance backlog (parks, dams, facilities)',
    'Tribal trust fund management',
    'Water infrastructure and drought resilience',
  ],
  'Department of Justice': [
    'Cybersecurity and counter-cyber threats',
    'Prison overcrowding and facility conditions',
    'Grant management and oversight',
    'IT modernization and case management systems',
    'Forensic laboratory accreditation and capacity',
    'Counterterrorism and intelligence integration',
  ],
  'Department of Transportation': [
    'Aviation safety modernization (NextGen)',
    'Highway and bridge infrastructure condition',
    'Autonomous vehicle safety standards',
    'Pipeline safety oversight',
    'IT security and air traffic control systems',
    'Grant oversight for state and local projects',
  ],
  'Environmental Protection Agency': [
    'PFAS and emerging contaminant remediation',
    'Superfund site cleanup acceleration',
    'Water infrastructure modernization',
    'Chemical risk assessment and TSCA implementation',
    'Environmental justice in permitting and enforcement',
    'IT modernization and data management',
  ],
  'Department of Education': [
    'Student loan servicing and borrower protection',
    'School safety and emergency preparedness',
    'IT security and student data protection',
    'Grant management and improper payments',
    'Distance learning and technology access equity',
  ],
  'Department of Agriculture': [
    'Food safety inspection modernization',
    'Farm program payment integrity',
    'IT security and infrastructure',
    'Forest management and wildfire prevention',
    'SNAP program integrity and fraud prevention',
    'Rural broadband and infrastructure investment',
  ],
  'Department of Commerce': [
    'Census operations and data quality',
    'Weather satellite program management',
    'Export control and technology transfer',
    'IT infrastructure modernization',
    'Broadband mapping and NTIA grant oversight',
    'NOAA vessel and aircraft fleet management',
  ],
  'Department of State': [
    'Diplomatic security and embassy construction',
    'IT modernization and cybersecurity',
    'Passport processing and consular services',
    'Contract oversight in conflict zones',
    'Foreign assistance program monitoring',
  ],
  'Department of the Treasury': [
    'IRS modernization and taxpayer services',
    'Financial sanctions enforcement (OFAC)',
    'Cybersecurity of financial systems',
    'Anti-money laundering oversight',
    'Pandemic relief program oversight',
    'Debt management and fiscal operations',
  ],
  'Department of Labor': [
    'Unemployment insurance fraud prevention',
    'Workplace safety enforcement (OSHA)',
    'Worker training program effectiveness',
    'IT modernization and cybersecurity',
    'Wage and hour compliance enforcement',
    'Mine safety and health regulation',
  ],
  'General Services Administration': [
    'Federal building management and maintenance',
    'IT procurement and shared services',
    'Fleet management and electrification',
    'Cybersecurity of government networks',
    'Contract vehicle management (GSA schedules)',
    'Real property disposal and excess property',
  ],
  'Small Business Administration': [
    'Disaster loan processing and fraud prevention',
    'Certification program integrity (8(a), HUBZone, WOSB)',
    'IT modernization and cybersecurity',
    'Government contracting goal achievement',
    'Lender oversight and guarantee programs',
  ],
  'National Aeronautics and Space Administration': [
    'Major project cost and schedule management',
    'IT security and mission data protection',
    'Contractor oversight and performance',
    'Human space exploration program management',
    'Facility maintenance and infrastructure aging',
    'Workforce planning and STEM pipeline',
  ],
  'Social Security Administration': [
    'Disability claims processing backlogs',
    'IT modernization and legacy system replacement',
    'Improper payments and fraud prevention',
    'Field office service delivery',
    'Cybersecurity and data protection',
  ],
  'Nuclear Regulatory Commission': [
    'Reactor oversight and safety inspections',
    'Cybersecurity of nuclear facilities',
    'Emergency preparedness and response',
    'Spent fuel management and waste storage',
    'Advanced reactor licensing framework',
  ],
  'Office of Personnel Management': [
    'Federal employee retirement processing',
    'Security clearance reform and timeliness',
    'IT modernization and legacy systems',
    'Healthcare program management (FEHB)',
    'Cybersecurity after 2015 data breach',
  ],
};

/**
 * Get GAO High Risk areas relevant to a specific agency
 */
export function getGAOHighRiskAreasForAgency(agencyName: string): string[] {
  const agencyLower = agencyName.toLowerCase();
  const results: string[] = [];

  for (const area of GAO_HIGH_RISK_AREAS) {
    const isRelevant = area.relatedAgencies.includes('all') ||
      area.relatedAgencies.some(a => {
        const aLower = a.toLowerCase();
        return agencyLower.includes(aLower) || aLower.includes(agencyLower);
      });

    if (isRelevant) {
      results.push(`${area.area}: ${area.description}`);
    }
  }

  return results;
}

/**
 * Get IG Top Management Challenges for a specific agency
 */
export function getIGChallengesForAgency(agencyName: string): string[] {
  // Direct match
  if (IG_CHALLENGES_BY_AGENCY[agencyName]) {
    return IG_CHALLENGES_BY_AGENCY[agencyName];
  }

  // Partial match
  const agencyLower = agencyName.toLowerCase();
  for (const [key, challenges] of Object.entries(IG_CHALLENGES_BY_AGENCY)) {
    if (agencyLower.includes(key.toLowerCase()) || key.toLowerCase().includes(agencyLower)) {
      return challenges;
    }
  }

  // For sub-agencies, try to match parent
  const parentMappings: Record<string, string> = {
    'navy': 'Department of Defense',
    'army': 'Department of Defense',
    'air force': 'Department of Defense',
    'marine': 'Department of Defense',
    'navfac': 'Department of Defense',
    'navsea': 'Department of Defense',
    'navair': 'Department of Defense',
    'usace': 'Department of Defense',
    'dla': 'Department of Defense',
    'disa': 'Department of Defense',
    'darpa': 'Department of Defense',
    'fema': 'Department of Homeland Security',
    'cbp': 'Department of Homeland Security',
    'tsa': 'Department of Homeland Security',
    'ice': 'Department of Homeland Security',
    'coast guard': 'Department of Homeland Security',
    'irs': 'Department of the Treasury',
    'fda': 'Department of Health and Human Services',
    'cdc': 'Department of Health and Human Services',
    'nih': 'Department of Health and Human Services',
    'cms': 'Department of Health and Human Services',
    'faa': 'Department of Transportation',
    'fhwa': 'Department of Transportation',
    'nhtsa': 'Department of Transportation',
    'forest service': 'Department of Agriculture',
    'usda': 'Department of Agriculture',
    'noaa': 'Department of Commerce',
    'census': 'Department of Commerce',
    'nist': 'Department of Commerce',
    'fish and wildlife': 'Department of the Interior',
    'national park': 'Department of the Interior',
    'bureau of reclamation': 'Department of the Interior',
    'blm': 'Department of the Interior',
    'bureau of land management': 'Department of the Interior',
    'fbi': 'Department of Justice',
    'dea': 'Department of Justice',
    'atf': 'Department of Justice',
    'bureau of prisons': 'Department of Justice',
    'marshals': 'Department of Justice',
  };

  for (const [keyword, parent] of Object.entries(parentMappings)) {
    if (agencyLower.includes(keyword)) {
      return IG_CHALLENGES_BY_AGENCY[parent] || [];
    }
  }

  return [];
}

/**
 * Get comprehensive oversight context for an agency
 * Combines GAO, IG, and general findings into a structured prompt context
 */
export function getOversightContextForAgency(
  agencyName: string,
  budget?: number
): AgencyOversightContext {
  const gaoHighRiskAreas = getGAOHighRiskAreasForAgency(agencyName);
  const igChallenges = getIGChallengesForAgency(agencyName);

  const budgetPriorities: string[] = [];
  if (budget && budget > 0) {
    if (budget > 100_000_000_000) {
      budgetPriorities.push(`Major federal agency with $${(budget / 1_000_000_000).toFixed(1)}B annual budget`);
    } else if (budget > 10_000_000_000) {
      budgetPriorities.push(`Large federal agency with $${(budget / 1_000_000_000).toFixed(1)}B annual budget`);
    } else if (budget > 1_000_000_000) {
      budgetPriorities.push(`Mid-size federal agency with $${(budget / 1_000_000_000).toFixed(1)}B annual budget`);
    } else {
      budgetPriorities.push(`Federal agency with $${(budget / 1_000_000).toFixed(0)}M annual budget`);
    }
  }

  // Cross-cutting findings that apply to all agencies
  const recentFindings: string[] = [
    'Executive Order on AI: agencies must implement AI governance frameworks by 2025',
    'Zero Trust Architecture: OMB M-22-09 requires zero trust implementation',
    'FITARA scorecard compliance: IT spending transparency and CIO authority',
    'Supply chain risk management: SCRM requirements under Section 889',
  ];

  return {
    gaoHighRiskAreas,
    igChallenges,
    budgetPriorities,
    recentFindings,
  };
}

/**
 * Format oversight context as a prompt-friendly string
 */
export function formatOversightContextForPrompt(context: AgencyOversightContext): string {
  const sections: string[] = [];

  if (context.gaoHighRiskAreas.length > 0) {
    sections.push(`GAO HIGH RISK AREAS (documented problems):\n${context.gaoHighRiskAreas.map(a => `- ${a}`).join('\n')}`);
  }

  if (context.igChallenges.length > 0) {
    sections.push(`INSPECTOR GENERAL TOP CHALLENGES:\n${context.igChallenges.map(c => `- ${c}`).join('\n')}`);
  }

  if (context.budgetPriorities.length > 0) {
    sections.push(`BUDGET CONTEXT:\n${context.budgetPriorities.map(b => `- ${b}`).join('\n')}`);
  }

  if (context.recentFindings.length > 0) {
    sections.push(`CROSS-CUTTING MANDATES:\n${context.recentFindings.map(f => `- ${f}`).join('\n')}`);
  }

  return sections.join('\n\n');
}
