/**
 * agencies-seo.ts — Derived dataset for /agencies/* SEO pages.
 *
 * Built from:
 *   - agency-toptier-codes.json   (49 federal agency canonical list)
 *   - agency-budget-data.json     (FY25/FY26 budget authority)
 *   - agency-pain-points.json     (per-agency pain points + priorities)
 *   - agency-procurement-sources.json (where they post opportunities)
 *   - agency-spending-complete.json (contract vehicles + spend patterns)
 *
 * Regenerate via `python3 scripts/build-agencies-seo.py` if source
 * data changes. Do not hand-edit — that will get clobbered on the
 * next regeneration.
 */

export interface AgencyProcurement {
  primarySources: string[];
  secondarySources: Array<{
    name: string;
    url: string;
    type: string;
    notes: string;
  }>;
  spendingPatterns: Record<string, number>;
  topVehicles: Array<{
    name: string;
    manager?: string;
    naics?: string[];
  }>;
  tips: string;
}

export interface AgencySeo {
  slug: string;
  name: string;
  abbreviation: string;
  cgac: string;
  /** index-page grouping: defense | health | civilian | independent | small */
  group: 'defense' | 'health' | 'civilian' | 'independent' | 'small';
  /** FY26 budget authority in $B. null when no source data. */
  fy26BudgetB: number | null;
  fy25BudgetB: number | null;
  budgetTrend: string | null;
  budgetChangePct: number | null;
  painPoints: string[];
  priorities: string[];
  procurement: AgencyProcurement;
}

export const AGENCIES_SEO: AgencySeo[] = [
  {
    "slug": "department-of-defense",
    "name": "Department of Defense",
    "abbreviation": "DOD",
    "cgac": "097",
    "group": "defense",
    "fy26BudgetB": 961.6,
    "fy25BudgetB": 848.3,
    "budgetTrend": "growing",
    "budgetChangePct": 1.133561,
    "painPoints": [
      "Cybersecurity modernization and zero-trust architecture implementation",
      "Cloud migration and DevSecOps adoption",
      "Supply chain security and resilience",
      "AI/ML integration for decision support",
      "5G and advanced communications infrastructure",
      "FY2026 NDAA: AI/ML security policy implementation (180-day mandate) - model tampering, prompt injection, lifecycle security"
    ],
    "priorities": [
      "$6.2B allocated for hypersonic weapons development in FY2025-2026, with contracts for offensive and defensive systems open to aerospace and defense primes",
      "$9.1B committed to the Pacific Deterrence Initiative (PDI) for Indo-Pacific military posture, including infrastructure projects and equipment procurement in FY2025",
      "$3.7B invested in Joint All-Domain Command and Control (JADC2) across services for network-centric warfare, with opportunities for IT and communications contractors through FY2027",
      "$30B budgeted for Space Force growth in FY2025-2026, focusing on resilient space architectures and proliferated LEO constellations with upcoming satellite and launch contracts",
      "$1.8B allocated for the Replicator Initiative to field attritable autonomous systems at scale, with RFPs for AI and robotics contractors expected in FY2025"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule",
        "idiq_vehicles"
      ],
      "secondarySources": [
        {
          "name": "Defense Logistics Agency Internet Bid Board System (DIBBS)",
          "url": "https://www.dibbs.bsm.dla.mil/",
          "type": "commodities",
          "notes": "Product-specific, commodities and supplies"
        }
      ],
      "spendingPatterns": {
        "samPosted": 15,
        "gsaSchedule": 35,
        "idiqVehicles": 40,
        "directAwards": 10
      },
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "Alliant 3",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        },
        {
          "name": "SeaPort-NxG",
          "manager": "Navy",
          "naics": [
            "541330",
            "541715",
            "541714"
          ]
        }
      ],
      "tips": "Most DoD IT and professional services go through GSA Schedule or SeaPort. Get on a vehicle first."
    }
  },
  {
    "slug": "department-of-veterans-affairs",
    "name": "Department of Veterans Affairs",
    "abbreviation": "VA",
    "cgac": "036",
    "group": "civilian",
    "fy26BudgetB": 187.2,
    "fy25BudgetB": 159.7,
    "budgetTrend": "growing",
    "budgetChangePct": 1.172198,
    "painPoints": [
      "Electronic health records (EHR) modernization",
      "Telehealth and virtual care expansion",
      "Claims processing automation",
      "IT infrastructure modernization",
      "Veteran homelessness prevention",
      "Mental health services expansion - addressing growing demand for PTSD, suicide prevention, and substance abuse treatment"
    ],
    "priorities": [
      "$5.1B allocated for Electronic Health Record Modernization (EHRM) with Oracle/Cerner, offering opportunities for IT integration and support services through FY2027",
      "$22B for VA MISSION Act community care programs, enabling contractors to provide private healthcare services and network management for veterans through FY2025",
      "$583M dedicated to suicide prevention initiatives, including mental health outreach and crisis line support, with contracts for clinical and tech solutions in FY2025",
      "$2.7B for infrastructure modernization under the PACT Act, focusing on toxic exposure facilities and clinic expansions with construction contracts available through FY2026",
      "$1B for cybersecurity and zero trust architecture implementation across 1,200 VA facilities, with opportunities for IT security and network solutions in FY2025-2026"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule",
        "va_vehicles"
      ],
      "secondarySources": [
        {
          "name": "VA eCMS",
          "url": "https://www.va.gov/opal/nac/ecms/",
          "type": "solicitations",
          "notes": "VA-specific procurement portal"
        }
      ],
      "spendingPatterns": {
        "samPosted": 20,
        "gsaSchedule": 40,
        "vaVehicles": 30,
        "directAwards": 10
      },
      "topVehicles": [
        {
          "name": "T4NG",
          "manager": "VA",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        },
        {
          "name": "VA FSS",
          "manager": "VA",
          "naics": [
            "medical",
            "621XXX"
          ]
        }
      ],
      "tips": "VA strongly prefers SDVOSB set-asides. Get CVE verified for massive advantage."
    }
  },
  {
    "slug": "department-of-homeland-security",
    "name": "Department of Homeland Security",
    "abbreviation": "DHS",
    "cgac": "070",
    "group": "defense",
    "fy26BudgetB": 107.4,
    "fy25BudgetB": 65.1,
    "budgetTrend": "surging",
    "budgetChangePct": 1.64977,
    "painPoints": [
      "Border security technology and infrastructure",
      "Cybersecurity for critical infrastructure",
      "Emergency response and preparedness",
      "Biometric identification systems",
      "Counter-terrorism technology",
      "Immigration processing systems - modernizing asylum, visa, and case management backlogs"
    ],
    "priorities": [
      "$2.1B allocated by CBP for border surveillance technology, including towers and sensors, with contracts expected in FY2025 for system integration and maintenance",
      "$3.1B for CISA\u2019s cybersecurity programs, including Continuous Diagnostics and Mitigation (CDM), with opportunities for endpoint detection and response solutions in FY2025-2026",
      "$20B+ in FEMA\u2019s Disaster Relief Fund for natural disaster response, with ongoing contracts for logistics, temporary housing, and debris removal services through FY2027",
      "$800M for TSA\u2019s checkpoint technology modernization, focusing on CT scanners and credential authentication systems, with procurement opportunities in FY2025",
      "$2.8B for Coast Guard fleet recapitalization, including Offshore Patrol Cutters, with shipbuilding and systems integration contracts active through FY2026"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule",
        "eagle_ii"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 22,
        "gsaSchedule": 35,
        "eagleVehicles": 30,
        "directAwards": 13
      },
      "topVehicles": [
        {
          "name": "EAGLE II",
          "manager": "DHS",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        },
        {
          "name": "FirstSource III",
          "manager": "DHS",
          "naics": [
            "541611",
            "541612"
          ]
        }
      ],
      "tips": "EAGLE II is the primary IT vehicle. Getting on is competitive but worthwhile."
    }
  },
  {
    "slug": "department-of-health-and-human-services",
    "name": "Department of Health and Human Services",
    "abbreviation": "HHS",
    "cgac": "075",
    "group": "health",
    "fy26BudgetB": 93.8,
    "fy25BudgetB": 127.0,
    "budgetTrend": "cut",
    "budgetChangePct": 0.738583,
    "painPoints": [
      "Public health data systems and analytics",
      "Healthcare IT modernization",
      "Biomedical research infrastructure",
      "Emergency preparedness and response",
      "Cybersecurity for health data",
      "Pandemic preparedness stockpile - maintaining and modernizing Strategic National Stockpile inventory"
    ],
    "priorities": [
      "$20B allocated for BARDA and Strategic National Stockpile (SNS) medical countermeasure stockpiling, with contracts for biodefense vaccines and therapeutics open for bidding through FY2025-2027",
      "$10.7B in SAMHSA grants for opioid crisis response and substance abuse treatment programs, with funding opportunities for behavioral health service providers through annual RFPs",
      "$48B NIH research portfolio emphasizing AI, climate health, and health equity, with grant and contract opportunities for research institutions and tech firms through FY2025-2027",
      "$1.4B Medicare Program Integrity budget to reduce improper payments, with contracts for fraud detection analytics and auditing services expected in FY2025",
      "$500M allocated for ONC\u2019s TEFCA framework to mandate health data interoperability, with procurement opportunities for health IT vendors to support data exchange platforms through FY2026"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule",
        "nih_vehicles"
      ],
      "secondarySources": [
        {
          "name": "HHS Grants.gov",
          "url": "https://www.grants.gov/",
          "type": "grants",
          "notes": "Primary portal for HHS grants"
        }
      ],
      "spendingPatterns": {
        "samPosted": 25,
        "gsaSchedule": 30,
        "nihVehicles": 25,
        "grants": 15,
        "directAwards": 5
      },
      "topVehicles": [
        {
          "name": "CIO-SP3",
          "manager": "NIH",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        },
        {
          "name": "CIO-SP4",
          "manager": "NIH",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        }
      ],
      "tips": "NIH CIO-SP vehicles dominate HHS IT spending. Also watch NIH SBIR/STTR for R&D."
    }
  },
  {
    "slug": "department-of-education",
    "name": "Department of Education",
    "abbreviation": "ED",
    "cgac": "091",
    "group": "civilian",
    "fy26BudgetB": 66.7,
    "fy25BudgetB": 78.7,
    "budgetTrend": "declining",
    "budgetChangePct": 0.847522,
    "painPoints": [
      "Student loan servicing - managing $1.7T+ portfolio across multiple servicers with system integration challenges",
      "FAFSA modernization - simplifying federal student aid application after troubled 2024 rollout",
      "Data privacy and security - protecting 42M+ student borrower records under FERPA and cybersecurity mandates",
      "IT infrastructure modernization - legacy systems supporting financial aid processing and compliance",
      "Civil rights enforcement technology - case management and investigation systems for OCR",
      "K-12 technology grants - administering E-Rate, Title I, and IDEA technology funding to schools"
    ],
    "priorities": [
      "$1.2B allocated for the Federal Student Aid (FSA) Next Generation Financial Services Environment, with recompetes for IT and servicing contracts expected in FY2025",
      "$500M in FY2025 budget for Title I Grants to Local Educational Agencies, supporting contractors providing educational materials and services to disadvantaged schools",
      "$800M committed to the Pell Grant program expansion, with opportunities for administrative and IT support contracts through FY2026",
      "$300M for the Education Stabilization Fund under the American Rescue Plan, with active grants for edtech solutions and distance learning infrastructure in FY2025",
      "$250M allocated for the Institute of Education Sciences (IES) research initiatives, with RFPs for data analytics and evaluation services expected in FY2025-2026"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule",
        "grants"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 25,
        "gsaSchedule": 30,
        "grants": 35,
        "directAwards": 10
      },
      "topVehicles": [],
      "tips": "Heavy grants focus. Educational technology and assessment services."
    }
  },
  {
    "slug": "department-of-energy",
    "name": "Department of Energy",
    "abbreviation": "DOE",
    "cgac": "089",
    "group": "civilian",
    "fy26BudgetB": 45.1,
    "fy25BudgetB": 49.8,
    "budgetTrend": "declining",
    "budgetChangePct": 0.905622,
    "painPoints": [
      "Clean energy technology development",
      "Grid modernization and resilience",
      "Nuclear security and non-proliferation",
      "Cybersecurity for energy infrastructure",
      "Environmental cleanup and remediation",
      "FY2026 NDAA: BIOSECURE Act compliance - biotechnology research programs (if applicable)"
    ],
    "priorities": [
      "$8.4B allocated for DOE's Environmental Management program, with active contracts for nuclear waste cleanup at Hanford and Savannah River sites through FY2027",
      "$23B for National Nuclear Security Administration (NNSA) nuclear weapons modernization, including W93 warhead development and pit production at Los Alamos and Savannah River with ongoing contract opportunities",
      "$10.5B for Grid Deployment Office initiatives under the Bipartisan Infrastructure Law, focusing on transmission and storage projects with grants and contracts available through FY2026",
      "$7B for Regional Clean Hydrogen Hubs program, with awards and subcontracting opportunities for clean energy technology firms through FY2025",
      "$2.5B for Advanced Reactor Demonstration Program, supporting small modular reactor (SMR) projects and HALEU fuel supply chain with active solicitations in FY2025"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "lab_portals",
        "gsa_schedule"
      ],
      "secondarySources": [
        {
          "name": "DOE National Labs",
          "url": "https://www.energy.gov/national-laboratories",
          "type": "information",
          "notes": "Labs have independent procurement"
        }
      ],
      "spendingPatterns": {
        "samPosted": 20,
        "gsaSchedule": 25,
        "labContracts": 40,
        "directAwards": 15
      },
      "topVehicles": [],
      "tips": "National Labs (ORNL, LANL, Sandia) have their own procurement. Energy focus."
    }
  },
  {
    "slug": "department-of-housing-and-urban-development",
    "name": "Department of Housing and Urban Development",
    "abbreviation": "HUD",
    "cgac": "086",
    "group": "civilian",
    "fy26BudgetB": 33.2,
    "fy25BudgetB": 70.3,
    "budgetTrend": "cut",
    "budgetChangePct": 0.472262,
    "painPoints": [
      "Housing voucher system modernization - upgrading Section 8 platforms serving 2.3M+ families",
      "FHA loan processing - automating underwriting and claims for $1.3T+ insurance portfolio",
      "Homelessness data systems - HMIS modernization and Continuum of Care coordination technology",
      "Fair housing enforcement - complaint tracking, investigation management, and AI-assisted pattern detection",
      "Community development grants - CDBG and HOME program reporting and compliance systems",
      "Lead hazard reduction - tracking abatement progress and grant administration for lead-safe housing"
    ],
    "priorities": [
      "$1.5B allocated for the Community Development Block Grant (CDBG) program in FY2025, with funding opportunities for contractors supporting local housing and economic development projects",
      "$4.8B committed to the Public Housing Capital Fund for modernization and repairs, with contracts available for construction and facility management through local housing authorities",
      "$1.2B in FY2025 budget for HOME Investment Partnerships Program, offering opportunities for contractors in affordable housing development and rehabilitation",
      "$3.3B allocated for Homeless Assistance Grants under the Continuum of Care program, with service providers and technology firms able to bid on supportive housing and data management solutions",
      "$500M in Lead Hazard Control and Healthy Homes grants for FY2025-2026, creating opportunities for environmental remediation and construction contractors"
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "Alliant 3",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        },
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "department-of-justice",
    "name": "Department of Justice",
    "abbreviation": "DOJ",
    "cgac": "015",
    "group": "civilian",
    "fy26BudgetB": 33.2,
    "fy25BudgetB": 36.0,
    "budgetTrend": "declining",
    "budgetChangePct": 0.922222,
    "painPoints": [
      "Law enforcement technology - FBI, DEA, and ATF investigative tools, biometrics, and forensic systems",
      "Federal prison system modernization - BOP facility technology, communications monitoring, and healthcare IT",
      "Cybercrime investigation tools - digital forensics, cryptocurrency tracing, and dark web analysis capabilities",
      "Case management systems - unifying litigation tracking across 94 U.S. Attorney offices",
      "Forensic laboratory technology - DNA analysis, ballistics, and digital evidence processing at FBI labs",
      "Civil rights enforcement - investigation and compliance monitoring systems for voting, housing, and policing"
    ],
    "priorities": [
      "FBI allocated $800M for cyber investigative tools and ransomware response, with contracts for advanced threat detection software expected in FY2025.",
      "Bureau of Prisons (BOP) investing $3.8B in prison infrastructure rehabilitation and new facility construction, with solicitations for design-build contracts ongoing through FY2027.",
      "Office of Justice Programs (OJP) distributing $4.3B in grants for state/local law enforcement and victim services, with opportunities for training and technical assistance providers in FY2025-2026.",
      "DOJ committing $1.2B for IT modernization, including case management systems and biometric tools, with RFPs for system integration and software development anticipated in FY2025.",
      "Forensic science modernization funded at $500M for crime lab equipment and DNA backlog reduction, with procurement opportunities for lab technology vendors through FY2026."
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 30,
        "gsaSchedule": 45,
        "directAwards": 25
      },
      "topVehicles": [
        {
          "name": "ITSSS-3",
          "manager": "DOJ",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": "DOJ uses GSA Schedule heavily. More open competition than defense agencies."
    }
  },
  {
    "slug": "department-of-transportation",
    "name": "Department of Transportation",
    "abbreviation": "DOT",
    "cgac": "069",
    "group": "civilian",
    "fy26BudgetB": 26.7,
    "fy25BudgetB": 25.2,
    "budgetTrend": "growing",
    "budgetChangePct": 1.059524,
    "painPoints": [
      "Infrastructure modernization and repair",
      "Transportation safety systems",
      "Electric vehicle infrastructure",
      "Aviation safety and modernization",
      "Smart transportation technologies",
      "Supply chain bottleneck analysis - freight flow data systems and port congestion monitoring"
    ],
    "priorities": [
      "$2.8B allocated for FAA's NextGen air traffic control modernization, with contracts for satellite-based navigation systems expected in FY2025-2026.",
      "$110B from Bipartisan Infrastructure Law for FHWA and FTA highway, bridge, and transit projects, with ongoing grant opportunities for construction and engineering firms through state DOTs.",
      "$7.5B National Electric Vehicle Infrastructure (NEVI) Formula Program funding EV charging station deployment along interstates, with state-administered contracts open for bidding in FY2025.",
      "$66B for Amtrak and passenger rail modernization under the Bipartisan Infrastructure Law, with procurement for rolling stock and infrastructure upgrades ongoing through FY2027.",
      "$12.5B Bridge Investment Program targeting structurally deficient bridges, with FHWA grants available for design-build contracts via state partnerships in FY2025-2026."
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 35,
        "gsaSchedule": 35,
        "directAwards": 30
      },
      "topVehicles": [],
      "tips": "FAA and FHWA are major buyers. Infrastructure focus."
    }
  },
  {
    "slug": "department-of-agriculture",
    "name": "Department of Agriculture",
    "abbreviation": "USDA",
    "cgac": "012",
    "group": "civilian",
    "fy26BudgetB": 22.3,
    "fy25BudgetB": 27.3,
    "budgetTrend": "declining",
    "budgetChangePct": 0.81685,
    "painPoints": [
      "Food safety modernization - FSIS inspection technology and pathogen detection systems",
      "Rural broadband deployment - administering $65B+ for last-mile connectivity in underserved areas",
      "Crop insurance systems - modernizing risk management platforms serving 1.1M+ policies",
      "Forest management technology - wildfire prediction, fuels management, and reforestation tracking",
      "Conservation program delivery - digital platforms for CRP, EQIP, and other stewardship programs",
      "Supply chain resilience - agricultural supply chain monitoring and disruption early warning"
    ],
    "priorities": [
      "$1.2B allocated for USDA's Rural Utilities Service (RUS) ReConnect Program to expand broadband access in rural areas, with grant and loan opportunities for ISPs and infrastructure firms through FY2025.",
      "$500M in FY2025 budget for Food Safety and Inspection Service (FSIS) modernization, including contracts for IT systems and data analytics to enhance food safety inspections.",
      "$3.1B committed under the Bipartisan Infrastructure Law for USDA Forest Service wildfire risk reduction, with contracts for forest management and fuel reduction projects through FY2027.",
      "$800M allocated for Supplemental Nutrition Assistance Program (SNAP) integrity initiatives, with procurement opportunities for fraud detection software and payment processing systems in FY2025.",
      "$250M in FY2025 Congressional Justification for USDA IT modernization under FITARA compliance, with upcoming solicitations for cloud migration and legacy system replacement."
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [
        {
          "name": "USDA Grants Portal",
          "url": "https://www.nifa.usda.gov/grants",
          "type": "grants",
          "notes": "Agricultural research grants"
        }
      ],
      "spendingPatterns": {
        "samPosted": 30,
        "gsaSchedule": 35,
        "grants": 20,
        "directAwards": 15
      },
      "topVehicles": [],
      "tips": "USDA Forest Service is a major buyer. Rural development focus."
    }
  },
  {
    "slug": "agency-for-international-development",
    "name": "Agency for International Development",
    "abbreviation": "USAID",
    "cgac": "072",
    "group": "independent",
    "fy26BudgetB": 19.2,
    "fy25BudgetB": 36.3,
    "budgetTrend": "cut",
    "budgetChangePct": 0.528926,
    "painPoints": [
      "Foreign aid delivery systems - modernizing procurement and disbursement for $30B+ annual programs",
      "Cybersecurity for global operations - protecting systems across 80+ country missions",
      "Development finance modernization - DFC and USAID coordination for private sector investment",
      "Humanitarian response technology - rapid deployment logistics and disaster relief coordination",
      "Monitoring and evaluation platforms - real-time impact measurement for development programs",
      "Supply chain for global health - vaccine, pharmaceutical, and medical supply distribution networks"
    ],
    "priorities": [
      "USAID has allocated $1.2B for the Global Health Supply Chain Program to procure and distribute medical supplies and vaccines, with contracts open for logistics and pharmaceutical firms through FY2025.",
      "USAID is investing $650M in the Power Africa initiative to support renewable energy projects in sub-Saharan Africa, with upcoming solicitations for energy infrastructure contractors in FY2025-2026.",
      "USAID\u2019s Bureau for Resilience and Food Security has $800M budgeted for agricultural development programs, targeting contracts for agribusiness and technology solutions providers in FY2025.",
      "USAID is committing $500M to the Digital Connectivity and Cybersecurity Partnership, focusing on IT infrastructure and cybersecurity support contracts for developing countries through FY2027.",
      "USAID has $300M allocated for the Climate Adaptation and Resilience Fund under the Bipartisan Infrastructure Law, with grants and contracts for environmental consulting firms starting in FY2025."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "national-aeronautics-and-space-administration",
    "name": "National Aeronautics and Space Administration",
    "abbreviation": "NASA",
    "cgac": "080",
    "group": "independent",
    "fy26BudgetB": 18.8,
    "fy25BudgetB": 24.8,
    "budgetTrend": "cut",
    "budgetChangePct": 0.758065,
    "painPoints": [],
    "priorities": [
      "Total obligated: $43.3B. Congressional justification outlay: $13541.1B"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "nspires",
        "sewp"
      ],
      "secondarySources": [
        {
          "name": "NSPIRES",
          "url": "https://nspires.nasaprs.com/",
          "type": "research",
          "notes": "NASA research announcements and proposals"
        },
        {
          "name": "NASA SEWP",
          "url": "https://www.sewp.nasa.gov/",
          "type": "it_products",
          "notes": "IT hardware and solutions"
        }
      ],
      "spendingPatterns": {
        "samPosted": 25,
        "sewp": 30,
        "gsaSchedule": 20,
        "research": 15,
        "directAwards": 10
      },
      "topVehicles": [
        {
          "name": "SEWP V",
          "manager": "NASA",
          "naics": [
            "541512",
            "334XXX"
          ]
        },
        {
          "name": "ACES",
          "manager": "NASA",
          "naics": [
            "541715",
            "541714"
          ]
        }
      ],
      "tips": "SEWP V is huge for IT. SBIR/STTR program is excellent for R&D companies."
    }
  },
  {
    "slug": "social-security-administration",
    "name": "Social Security Administration",
    "abbreviation": "SSA",
    "cgac": "028",
    "group": "independent",
    "fy26BudgetB": 12.7,
    "fy25BudgetB": 12.7,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "Disability claims processing - reducing 1.1M+ case backlog with average 6-month wait times",
      "IT modernization - replacing 60M+ lines of COBOL running on decades-old mainframes",
      "Fraud prevention technology - identity verification and overpayment detection for $1.4T+ in annual benefits",
      "Phone and field office service - addressing 30M+ annual calls with 30+ minute average hold times",
      "Online services expansion - migrating in-person transactions to my Social Security digital platform",
      "Cybersecurity for beneficiary data - protecting PII of 70M+ Social Security recipients"
    ],
    "priorities": [
      "$1.5B allocated in FY2025 for Social Security Administration's IT Modernization Plan, with contracts for cloud migration and legacy system replacement expected through Q3 FY2026.",
      "$300M budgeted for Disability Case Processing System (DCPS) enhancements, with opportunities for software development and integration support in FY2025.",
      "$200M committed to cybersecurity upgrades under Zero Trust Architecture mandates, including endpoint security and identity management solutions for FY2025-2026.",
      "$150M in FY2025 funding for fraud prevention and improper payment reduction initiatives, with contracts for data analytics and AI-driven detection tools.",
      "$100M allocated for field office service delivery improvements, including digital kiosks and customer service platforms, with RFPs expected in FY2025."
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 30,
        "gsaSchedule": 45,
        "directAwards": 25
      },
      "topVehicles": [],
      "tips": "Large IT infrastructure needs. Disability determination services."
    }
  },
  {
    "slug": "department-of-the-interior",
    "name": "Department of the Interior",
    "abbreviation": "DOI",
    "cgac": "014",
    "group": "civilian",
    "fy26BudgetB": 11.7,
    "fy25BudgetB": 16.8,
    "budgetTrend": "cut",
    "budgetChangePct": 0.696429,
    "painPoints": [
      "Wildfire management technology - predictive modeling, detection systems, and suppression coordination",
      "Land management systems modernization - digitizing records for 245M+ acres of public lands",
      "Tribal programs and self-governance - IT systems for trust responsibilities and tribal consultation",
      "National park infrastructure - $22B+ deferred maintenance backlog across 400+ park units",
      "Water resource management - dam safety, irrigation systems, and drought response in western states",
      "Energy leasing modernization - streamlining oil, gas, and renewable energy permitting on federal lands"
    ],
    "priorities": [
      "$6.2B allocated for wildfire management, with contracts for suppression, prescribed burns, and forest thinning services expected through FY2025-2027",
      "$3.2B for Bureau of Reclamation water infrastructure projects, including dam safety and drought resilience, with procurement opportunities for engineering and construction firms in FY2025",
      "$1.9B from the Great American Outdoors Act for National Park Service deferred maintenance, with contracts for facility repairs and infrastructure upgrades ongoing through FY2027",
      "$4.8B for Bureau of Indian Affairs tribal programs, including trust responsibilities and infrastructure, with funding for construction and service delivery contracts in FY2025-2026",
      "$11.3B from the Bipartisan Infrastructure Law for abandoned mine land reclamation, with RFPs for environmental remediation and site cleanup expected through FY2027"
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "BPA IDIQ",
          "manager": "DOI",
          "naics": [
            "541620",
            "541330"
          ]
        },
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "department-of-the-treasury",
    "name": "Department of the Treasury",
    "abbreviation": "TREAS",
    "cgac": "020",
    "group": "civilian",
    "fy26BudgetB": 11.5,
    "fy25BudgetB": 14.2,
    "budgetTrend": "declining",
    "budgetChangePct": 0.809859,
    "painPoints": [
      "IRS modernization - $80B+ investment in taxpayer services, IT systems, and enforcement technology",
      "Financial systems consolidation - migrating legacy mainframe systems to cloud-based platforms",
      "Tax processing automation - reducing manual processing of 150M+ annual returns",
      "Fraud detection and prevention - AI-driven analytics for tax evasion and identity theft",
      "Sanctions enforcement technology - OFAC screening systems for global financial transactions",
      "Cybersecurity for financial infrastructure - protecting Treasury payment systems processing $5T+ annually"
    ],
    "priorities": [
      "$1.9B allocated for IRS modernization under the Inflation Reduction Act, with contracts for IT system upgrades and taxpayer service platforms expected through FY2025-2027",
      "$500M in funding for Treasury\u2019s Cybersecurity Enhancement Account to implement Zero Trust Architecture across financial systems, with RFPs for cybersecurity solutions anticipated in FY2025",
      "$300M committed to the Office of Foreign Assets Control (OFAC) for financial sanctions enforcement tools, including software and data analytics contracts open for bidding in FY2025",
      "$250M budgeted for IRS enforcement initiatives to reduce the tax gap, with procurement opportunities for data analytics and compliance technology through FY2026",
      "$150M allocated for Treasury\u2019s Financial Crimes Enforcement Network (FinCEN) to enhance anti-money laundering oversight, with contracts for regulatory technology solutions expected in FY2025"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 35,
        "gsaSchedule": 40,
        "directAwards": 25
      },
      "topVehicles": [],
      "tips": "IRS is the biggest buyer. Financial systems expertise valued."
    }
  },
  {
    "slug": "department-of-state",
    "name": "Department of State",
    "abbreviation": "DOS",
    "cgac": "019",
    "group": "civilian",
    "fy26BudgetB": 9.6,
    "fy25BudgetB": 58.7,
    "budgetTrend": "cut",
    "budgetChangePct": 0.163543,
    "painPoints": [
      "Diplomatic security technology - protecting 270+ embassies and consulates with surveillance and access systems",
      "IT modernization - consolidating legacy systems across global diplomatic network",
      "Visa processing systems - reducing appointment backlogs and modernizing consular workflow technology",
      "Cybersecurity for diplomatic communications - protecting classified networks from nation-state threats",
      "Overseas facility construction - $2B+ annual capital program for embassy security upgrades",
      "Consular services technology - passport processing, citizen services, and emergency notification systems"
    ],
    "priorities": [
      "$1.2B allocated for the Department of State\u2019s Diplomatic Security Service to enhance embassy protection and security upgrades, with contracts for physical security systems and guard services expected in FY2025.",
      "$500M budgeted for IT modernization under the Bureau of Information Resource Management, focusing on cloud migration and legacy system replacement with RFPs for IT services anticipated in FY2025-2026.",
      "$300M committed to cybersecurity enhancements, including Zero Trust Architecture implementation per OMB M-22-09, with opportunities for contractors in endpoint security and identity management solutions in FY2025.",
      "$800M for embassy construction and maintenance through the Bureau of Overseas Buildings Operations, with upcoming solicitations for design-build contracts and facility management services in FY2025-2027.",
      "$250M allocated for passport processing system upgrades under Consular Affairs, with procurement opportunities for biometric technology and IT support services expected in FY2025."
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 25,
        "gsaSchedule": 50,
        "directAwards": 25
      },
      "topVehicles": [],
      "tips": "State Department often requires security clearances. International work opportunities."
    }
  },
  {
    "slug": "department-of-labor",
    "name": "Department of Labor",
    "abbreviation": "DOL",
    "cgac": "016",
    "group": "civilian",
    "fy26BudgetB": 8.6,
    "fy25BudgetB": 13.3,
    "budgetTrend": "cut",
    "budgetChangePct": 0.646617,
    "painPoints": [
      "Unemployment insurance modernization - replacing decades-old COBOL-based state systems",
      "Workplace safety technology (OSHA) - inspection management, hazard tracking, and compliance systems",
      "Workforce development systems - job training program management under WIOA",
      "Pension and benefits administration - EBSA oversight of $12T+ in private retirement assets",
      "Wage enforcement technology - WHD investigation tools for minimum wage and overtime compliance",
      "Job training platforms - expanding apprenticeship.gov and career pathways digital tools"
    ],
    "priorities": [
      "$1.2B allocated for Unemployment Insurance modernization under the American Rescue Plan Act, with state-level IT system upgrades and fraud prevention tools open for contractor bids through FY2025",
      "$650M in FY2025 budget for OSHA\u2019s workplace safety enforcement, including contracts for inspection technology and data analytics support",
      "$800M committed to the Workforce Innovation and Opportunity Act (WIOA) programs for worker training, with grants and contracts for training providers and evaluation services in FY2025-2026",
      "$200M for IT modernization and cybersecurity enhancements at DOL, including Zero Trust Architecture implementation per OMB M-22-09, with RFPs expected in FY2025",
      "$150M in FY2025 funding for Wage and Hour Division compliance tools, offering opportunities for software development and data analysis contracts"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 40,
        "gsaSchedule": 35,
        "directAwards": 25
      },
      "topVehicles": [],
      "tips": "Workforce development and training opportunities. Good small business set-asides."
    }
  },
  {
    "slug": "department-of-commerce",
    "name": "Department of Commerce",
    "abbreviation": "DOC",
    "cgac": "013",
    "group": "civilian",
    "fy26BudgetB": 8.5,
    "fy25BudgetB": 10.2,
    "budgetTrend": "declining",
    "budgetChangePct": 0.833333,
    "painPoints": [
      "Weather forecasting and climate monitoring",
      "Cybersecurity and IT modernization",
      "Trade and economic data systems",
      "Broadband infrastructure deployment",
      "Intellectual property protection",
      "CHIPS Act semiconductor manufacturing support - administering $52B+ for domestic chip production"
    ],
    "priorities": [
      "$1.2B allocated for NOAA\u2019s National Weather Service modernization, with contracts for weather modeling software and data analytics expected in FY2025",
      "$500M in NTIA\u2019s Broadband Equity, Access, and Deployment (BEAD) program funding, with grant opportunities for telecom contractors through state broadband offices in FY2025-2026",
      "$400M budgeted for NIST\u2019s Cybersecurity Framework implementation support, including contracts for risk assessment tools and training services in FY2025",
      "$3B from the CHIPS and Science Act allocated for semiconductor manufacturing incentives, with grant and contract opportunities for tech firms through FY2027",
      "$250M for NOAA\u2019s Geostationary Operational Environmental Satellite (GOES-R) program sustainment, with upcoming recompetes for satellite ground systems support in FY2026"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 35,
        "gsaSchedule": 40,
        "directAwards": 25
      },
      "topVehicles": [],
      "tips": "NOAA and Census Bureau are key buyers. Weather and data analytics focus."
    }
  },
  {
    "slug": "corps-of-engineers-civil-works",
    "name": "Corps of Engineers - Civil Works",
    "abbreviation": "USACE-CW",
    "cgac": "096",
    "group": "defense",
    "fy26BudgetB": 5.0,
    "fy25BudgetB": 5.9,
    "budgetTrend": "declining",
    "budgetChangePct": 0.847458,
    "painPoints": [],
    "priorities": [
      "Total obligated: $78.0B. Congressional justification outlay: $13541.1B"
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [],
      "tips": ""
    }
  },
  {
    "slug": "environmental-protection-agency",
    "name": "Environmental Protection Agency",
    "abbreviation": "EPA",
    "cgac": "068",
    "group": "independent",
    "fy26BudgetB": 4.2,
    "fy25BudgetB": 9.1,
    "budgetTrend": "cut",
    "budgetChangePct": 0.461538,
    "painPoints": [
      "PFAS contamination cleanup - nationwide remediation of per- and polyfluoroalkyl substances in water and soil",
      "Air quality monitoring modernization - upgrading sensor networks and real-time emissions tracking",
      "Water infrastructure grants - administering $50B+ for lead pipe replacement and treatment upgrades",
      "Environmental data systems - consolidating 100+ databases into unified monitoring platforms",
      "Superfund remediation acceleration - addressing 1,300+ contaminated sites with growing cleanup backlog",
      "Climate change programs - greenhouse gas monitoring, reporting, and reduction technology"
    ],
    "priorities": [
      "$1.5B allocated for Superfund site cleanup under the Bipartisan Infrastructure Law, with contracts for remediation and engineering services ongoing through FY2027",
      "$2.7B in Water Infrastructure Finance and Innovation Act (WIFIA) loans and grants for modernizing drinking water systems, with opportunities for construction and engineering firms in FY2025-2026",
      "$500M committed to PFAS remediation and research under the Infrastructure Investment and Jobs Act, with RFPs for treatment technologies and monitoring expected in FY2025",
      "$350M budgeted for Toxic Substances Control Act (TSCA) implementation to accelerate chemical risk assessments, opening opportunities for scientific and consulting services through FY2026",
      "$200M allocated for environmental justice initiatives, including grants and contracts for community-based monitoring and enforcement support in FY2025"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 40,
        "gsaSchedule": 35,
        "directAwards": 25
      },
      "topVehicles": [],
      "tips": "Environmental consulting and remediation. Good small business opportunities."
    }
  },
  {
    "slug": "national-science-foundation",
    "name": "National Science Foundation",
    "abbreviation": "NSF",
    "cgac": "049",
    "group": "independent",
    "fy26BudgetB": 3.9,
    "fy25BudgetB": 8.8,
    "budgetTrend": "cut",
    "budgetChangePct": 0.443182,
    "painPoints": [
      "Research grant management - modernizing systems processing 40,000+ proposals and $9B+ annually",
      "Merit review modernization - improving peer review workflows for 250,000+ reviewer assignments",
      "Research infrastructure investment - Major Research Equipment and Facilities Construction portfolio",
      "Cybersecurity for research data - protecting intellectual property and sensitive research outputs",
      "Cloud computing for research - enabling large-scale scientific computing and AI workloads",
      "Data management and sharing - implementing OSTP public access policies for federally funded research"
    ],
    "priorities": [
      "$9.5B allocated for NSF's FY2025 budget, with $1.2B specifically for the Directorate for Technology, Innovation, and Partnerships (TIP) to fund AI and quantum computing research grants for industry-academia collaborations.",
      "$500M committed to the NSF Regional Innovation Engines program, with awards up to $160M per engine over 10 years for tech hubs\u2014proposals open to contractors supporting innovation ecosystems through FY2026.",
      "$1.6B budgeted for NSF's STEM Education programs in FY2025, including contracts for curriculum development and training solutions to support underrepresented groups in STEM fields.",
      "$300M allocated for the NSF Cyberinfrastructure for Sustained Scientific Innovation (CSSI) program, funding software and data tools development with solicitations expected in FY2025 for IT contractors.",
      "$200M for the NSF Secure and Trustworthy Cyberspace (SaTC) program in FY2025, supporting cybersecurity research and prototype development with grant opportunities for tech firms."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "CIO-SP4",
          "manager": "NIH",
          "naics": [
            "541512",
            "541714",
            "541715"
          ]
        },
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "SEWP V",
          "manager": "NASA",
          "naics": [
            "541512",
            "334111"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "federal-deposit-insurance-corporation",
    "name": "Federal Deposit Insurance Corporation",
    "abbreviation": "FDIC",
    "cgac": "051",
    "group": "small",
    "fy26BudgetB": 2.5,
    "fy25BudgetB": 2.5,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "The FDIC struggles with cybersecurity workforce gaps, as noted in GAO reports on Ensuring the Cybersecurity of the Nation, creating a need for specialized training and staffing solutions to bolster incident response capabilities.",
      "Per GAO findings on IT Acquisitions and Operations, the FDIC faces challenges in managing legacy IT systems, requiring contractor support for system migration and modernization to reduce operational risks.",
      "GAO's High Risk List highlights FDIC's fragmented oversight within the U.S. Financial Regulatory System, necessitating data analytics tools to enhance monitoring of non-bank financial institutions.",
      "Under OMB M-22-09, the FDIC must implement Zero Trust Architecture, creating a demand for contractors to design and deploy identity verification and network segmentation solutions by mandated deadlines.",
      "The FDIC's compliance with FITARA scorecard requirements is lagging, as per GAO oversight, requiring IT portfolio management expertise to improve spending transparency and CIO authority.",
      "GAO's Strategic Human Capital Management findings indicate FDIC struggles to recruit skilled financial examiners, opening opportunities for contractors to provide talent acquisition and retention strategies."
    ],
    "priorities": [
      "FDIC allocated $2.5B for IT modernization in FY2025, with contracts expected for cloud migration and legacy system upgrades under the IT Strategic Plan.",
      "FDIC budgeting $150M for cybersecurity enhancements in FY2025-2026, focusing on Zero Trust Architecture implementation per OMB M-22-09, with RFPs for endpoint security solutions.",
      "FDIC awarded $50M in contracts for data analytics platforms in FY2024, with ongoing needs for AI-driven risk assessment tools through FY2027.",
      "FDIC committing $100M annually for workforce development and human capital management, with training and recruitment support contracts open for bid in FY2025.",
      "FDIC allocating $75M for financial regulatory system modernization per FY2025 Congressional Justification, targeting software solutions for oversight and compliance monitoring."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "securities-and-exchange-commission",
    "name": "Securities and Exchange Commission",
    "abbreviation": "SEC",
    "cgac": "050",
    "group": "small",
    "fy26BudgetB": 2.1,
    "fy25BudgetB": 2.1,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "The SEC struggles with cybersecurity incident response, as highlighted by GAO reports on federal system vulnerabilities, creating a need for contractors to provide real-time threat detection and response solutions tailored to financial regulatory data.",
      "Per GAO's High Risk List on Strategic Human Capital Management, the SEC faces challenges in recruiting skilled IT and financial oversight staff, opening opportunities for contractors to offer specialized training programs or workforce augmentation services.",
      "GAO's IT Acquisitions and Operations findings note SEC's reliance on legacy systems for market surveillance, requiring contractors to deliver modernization solutions for platforms like the Consolidated Audit Trail (CAT) to improve data processing efficiency.",
      "The SEC's fragmented oversight of fintech and cryptocurrency markets, as cited in GAO's Financial Regulatory System modernization concerns, necessitates contractor support in developing unified regulatory frameworks or advanced analytics tools for emerging financial technologies.",
      "Under OMB M-22-09, the SEC must implement Zero Trust Architecture by 2024, creating a demand for contractors to provide identity verification, network segmentation, and continuous monitoring solutions specific to financial data environments.",
      "GAO's climate change risk findings highlight the SEC's need for better integration of climate-related financial disclosures, offering contractors a chance to build ESG (Environmental, Social, Governance) data analytics platforms for regulatory compliance."
    ],
    "priorities": [
      "SEC allocated $2.4B in FY2025 budget for enforcement and compliance programs, with contracts for data analytics and forensic accounting services expected in Q1 FY2025.",
      "SEC investing $150M in IT modernization under FITARA compliance, focusing on cloud migration and legacy system replacement with RFPs for system integrators in FY2025.",
      "SEC budgeting $75M for cybersecurity enhancements per OMB M-22-09 Zero Trust Architecture mandate, seeking contractors for identity management and endpoint security solutions in FY2025.",
      "SEC allocating $50M for AI governance and risk assessment tools under Executive Order on AI, with procurement for AI monitoring software expected by Q3 FY2025.",
      "SEC funding $30M for supply chain risk management (SCRM) compliance under Section 889, with contracts for risk assessment and vendor vetting services in FY2025-2026."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "nuclear-regulatory-commission",
    "name": "Nuclear Regulatory Commission",
    "abbreviation": "NRC",
    "cgac": "031",
    "group": "independent",
    "fy26BudgetB": 1.0,
    "fy25BudgetB": 0.9,
    "budgetTrend": "stable",
    "budgetChangePct": 1.028602,
    "painPoints": [
      "Reactor licensing modernization - updating regulatory framework for 93 operating commercial reactors",
      "Cybersecurity for nuclear facilities - implementing 10 CFR 73.54 digital asset protection requirements",
      "Advanced reactor review framework - developing licensing pathways for Gen IV and fusion designs",
      "Spent fuel oversight - monitoring interim storage and transportation safety across 70+ sites",
      "Emergency preparedness systems - modernizing radiological response coordination technology",
      "Inspection technology - remote monitoring, data analytics, and risk-informed inspection tools"
    ],
    "priorities": [
      "$23M allocated by the Nuclear Regulatory Commission for the Advanced Reactor Licensing Program to develop regulatory frameworks for next-gen nuclear technologies, with opportunities for technical consulting contracts in FY2025.",
      "$15M budgeted for cybersecurity enhancements at nuclear facilities under the NRC\u2019s Cyber Security Roadmap, with contracts for vulnerability assessments and incident response tools expected in FY2025.",
      "$10M committed for spent nuclear fuel management research, supporting contracts for engineering and storage solution providers through FY2026.",
      "$8M in funding for emergency preparedness exercises and training programs, with opportunities for simulation and logistics support contractors in FY2025.",
      "$5M allocated for IT modernization under FITARA compliance, with upcoming procurements for legacy system upgrades and cloud migration services in FY2025-2026."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "EECM III",
          "manager": "DOE",
          "naics": [
            "541330",
            "541620"
          ]
        },
        {
          "name": "EMCBC MATOC",
          "manager": "DOE",
          "naics": [
            "562910",
            "541620"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "consumer-financial-protection-bureau",
    "name": "Consumer Financial Protection Bureau",
    "abbreviation": "CFPB",
    "cgac": "581",
    "group": "small",
    "fy26BudgetB": 0.8,
    "fy25BudgetB": 0.8,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "The Consumer Financial Protection Bureau (CFPB) struggles with cybersecurity vulnerabilities in its consumer complaint database, as highlighted in a 2022 GAO report, creating a need for contractors to implement advanced encryption and incident response solutions compliant with OMB M-22-09 Zero Trust mandates.",
      "CFPB faces challenges in recruiting and retaining skilled IT professionals to manage financial data systems, per GAO\u2019s Strategic Human Capital Management high-risk area, opening opportunities for contractors to provide specialized staffing and training solutions.",
      "A 2021 IG report noted CFPB\u2019s delays in modernizing legacy IT systems for consumer protection data analysis, presenting a need for contractors to deliver FITARA-compliant IT modernization and cloud migration services.",
      "CFPB\u2019s exposure to climate change-related financial risks, as flagged in GAO\u2019s high-risk area on fiscal exposure, requires contractors to develop climate risk assessment tools and adaptation strategies for regulated financial institutions.",
      "With increasing improper payments in federal programs (GAO estimates $175B annually), CFPB needs contractors to design fraud detection algorithms and payment verification systems to monitor financial consumer protection programs.",
      "CFPB must comply with the Executive Order on AI by 2025, necessitating contractors to build AI governance frameworks and ethical AI tools for automated consumer complaint processing."
    ],
    "priorities": [
      "CFPB allocated $215M in FY2025 for the Consumer Complaint Database modernization, with contracts expected for IT services and data analytics support by Q3 FY2025.",
      "CFPB investing $30M in FY2025-2026 for AI-driven fraud detection tools under the Office of Enforcement, with solicitations for AI/ML development anticipated in Q1 FY2025.",
      "CFPB budgeting $18M for cybersecurity enhancements in FY2025 to comply with Zero Trust Architecture mandates (OMB M-22-09), seeking contractors for endpoint security and identity management solutions.",
      "CFPB allocating $25M through FY2027 for cloud migration and IT infrastructure upgrades under FITARA compliance, with RFPs for managed services expected in mid-FY2025.",
      "CFPB funding $12M in FY2025 for supply chain risk management (SCRM) initiatives per Section 889 requirements, with opportunities for risk assessment and compliance support contractors."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "government-accountability-office",
    "name": "Government Accountability Office",
    "abbreviation": "GAO",
    "cgac": "004",
    "group": "small",
    "fy26BudgetB": 0.8,
    "fy25BudgetB": 0.8,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "GAO has identified that federal agencies struggle with implementing consistent cybersecurity incident response plans, with over 30% of agencies failing to meet NIST framework standards, creating a need for tailored incident response training and tools.",
      "Under GAO\u2019s Strategic Human Capital Management high-risk area, federal agencies face a 20% vacancy rate in critical IT roles, requiring contractors to provide specialized recruitment and retention strategies for tech talent.",
      "GAO reports highlight $1.2 trillion in duplicative IT investments across federal agencies, presenting an opportunity for contractors to offer data analytics solutions to identify and eliminate redundant systems.",
      "GAO\u2019s climate change risk exposure findings note that federal infrastructure lacks resilience planning, with $100B in annual disaster costs, necessitating contractor support for climate adaptation assessments and mitigation strategies.",
      "GAO estimates $175B in annual improper payments across federal programs, creating a demand for AI-driven fraud detection and payment verification systems that contractors can develop.",
      "Inspector General reports cite delays in border security technology deployment, with $500M in CBP projects behind schedule, opening opportunities for contractors to provide project management and tech integration services."
    ],
    "priorities": [
      "GAO allocating $5M in FY2025 for cybersecurity audit support contracts to assess federal agency compliance with NIST frameworks",
      "GAO committing $3.2M for IT acquisition oversight consulting services to evaluate major system modernization failures, with solicitations in Q1 FY2025",
      "GAO budgeting $4.8M for strategic human capital management studies, seeking contractors for workforce analytics and retention strategy development in FY2025-2026",
      "GAO investing $2.5M in climate risk assessment contracts to support audits of federal infrastructure resilience programs, with task orders expected in FY2025",
      "GAO dedicating $3M for improper payment analysis support, issuing RFPs for data analytics firms to identify fraud in federal programs during FY2025"
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "FirstSource III",
          "manager": "DHS",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "EAGLE II",
          "manager": "DHS",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "smithsonian-institution",
    "name": "Smithsonian Institution",
    "abbreviation": "SI",
    "cgac": "033",
    "group": "independent",
    "fy26BudgetB": 0.8,
    "fy25BudgetB": 1.1,
    "budgetTrend": "cut",
    "budgetChangePct": 0.727273,
    "painPoints": [
      "The Smithsonian Institution faces challenges in securing its digital collections and IT systems, as identified in GAO reports on federal cybersecurity, requiring enhanced incident response capabilities and compliance with OMB M-22-09 Zero Trust Architecture mandates.",
      "With over 155 million artifacts and specimens, the Smithsonian struggles with IT infrastructure modernization, as noted in GAO's IT acquisition and operations findings, needing contractor support for scalable cloud solutions.",
      "The Smithsonian's workforce lacks sufficient cybersecurity talent, per GAO's strategic human capital management concerns, creating a need for contractors to provide specialized training and staffing augmentation.",
      "Climate change risks threaten Smithsonian facilities and collections, as highlighted in GAO's high-risk area on climate resilience, requiring contractors to develop tailored disaster response and infrastructure adaptation plans.",
      "The Smithsonian's IT spending transparency falls short of FITARA scorecard requirements, necessitating contractor expertise in financial systems integration and CIO authority alignment.",
      "GAO oversight has identified government-wide improper payments as a $175B+ issue annually, and the Smithsonian needs contractor support to implement fraud detection tools for its grant and vendor payment processes."
    ],
    "priorities": [
      "Smithsonian Institution allocated $253M in FY2025 for the National Air and Space Museum revitalization, with contracts for construction and exhibit design open for bidding through FY2026.",
      "Smithsonian committed $50M for digitization of collections under the Strategic Plan 2022-2026, seeking IT contractors for data management and imaging systems in FY2025.",
      "Facilities Capital Program funded at $150M in FY2025 for deferred maintenance across Smithsonian campuses, with opportunities for facilities management and construction firms.",
      "Smithsonian Astrophysical Observatory received $30M for Chandra X-ray Observatory operations, with potential subcontracts for scientific data analysis and software support in FY2025-2026.",
      "National Zoo allocated $25M for infrastructure upgrades under the Bipartisan Infrastructure Law, with RFPs for engineering and construction expected in late FY2025."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "small-business-administration",
    "name": "Small Business Administration",
    "abbreviation": "SBA",
    "cgac": "073",
    "group": "independent",
    "fy26BudgetB": 0.6,
    "fy25BudgetB": 0.9,
    "budgetTrend": "cut",
    "budgetChangePct": 0.666667,
    "painPoints": [
      "Disaster loan processing - reducing application-to-disbursement times after surge events",
      "8(a) program management - certification, annual review, and business development tracking systems",
      "SBIR/STTR grant systems - managing $4B+ in annual small business innovation research awards",
      "Lender portal modernization - upgrading systems for 7(a) and 504 loan program partners",
      "Size standards verification - automated determination of small business eligibility",
      "Contracting assistance platforms - modernizing subcontracting.net and procurement scorecards"
    ],
    "priorities": [
      "$200M allocated for SBA IT modernization, focusing on loan processing systems and online portal upgrades with contracts expected in FY2025 for system integrators and software developers.",
      "$50M committed to disaster loan program modernization, targeting automated processing and fraud detection tools with procurement opportunities in FY2025 for data analytics and AI solution providers.",
      "$4B+ annual set-aside for SBIR/STTR programs, funding small business R&D innovation with ongoing solicitations across federal agencies for FY2025-2027.",
      "$10M budgeted for 8(a), HUBZone, and WOSB certification process streamlining, with IT and business process outsourcing contracts anticipated in FY2025.",
      "$5M allocated for cybersecurity enhancements under Zero Trust Architecture per OMB M-22-09, with RFPs for cybersecurity vendors expected in FY2025."
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_schedule"
      ],
      "secondarySources": [],
      "spendingPatterns": {
        "samPosted": 50,
        "gsaSchedule": 30,
        "directAwards": 20
      },
      "topVehicles": [],
      "tips": "Small agency but sets small business policy. 8(a) and HUBZone programs."
    }
  },
  {
    "slug": "general-services-administration",
    "name": "General Services Administration",
    "abbreviation": "GSA",
    "cgac": "047",
    "group": "independent",
    "fy26BudgetB": 0.5,
    "fy25BudgetB": 0.5,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "Federal building modernization and sustainability",
      "IT acquisition and cloud services",
      "Fleet vehicle electrification",
      "Workplace modernization and hybrid work support",
      "Supply chain and procurement optimization",
      "Cybersecurity for government-wide shared systems - protecting Login.gov, SAM.gov, and other platforms"
    ],
    "priorities": [
      "$3.4B allocated for federal building electrification and HVAC modernization under the Bipartisan Infrastructure Law, with contracts for energy-efficient systems and net-zero retrofits open for bidding through FY2025-2027",
      "$2.1B invested in the Technology Modernization Fund and shared IT services, with GSA issuing task orders for cloud migration and legacy system replacement via existing contract vehicles like Alliant 2 through FY2026",
      "$500M committed to federal fleet electrification, targeting conversion of 680K vehicles by 2035, with procurement opportunities for electric vehicle supply and charging infrastructure in FY2025",
      "$300M budgeted for cybersecurity enhancements under Zero Trust Architecture mandates (OMB M-22-09), with GSA seeking contractors for identity management and endpoint security solutions in FY2025",
      "$150M allocated for federal real property disposal and excess property management, with opportunities for real estate services and auction platforms through FY2026"
    ],
    "procurement": {
      "primarySources": [
        "sam.gov",
        "gsa_advantage",
        "ebuy"
      ],
      "secondarySources": [
        {
          "name": "GSA Advantage",
          "url": "https://www.gsaadvantage.gov/",
          "type": "catalog",
          "notes": "Online shopping for GSA Schedule holders"
        },
        {
          "name": "GSA eBuy",
          "url": "https://www.ebuy.gsa.gov/",
          "type": "rfq",
          "notes": "RFQ portal for Schedule holders"
        }
      ],
      "spendingPatterns": {
        "samPosted": 25,
        "gsaSchedule": 60,
        "directAwards": 15
      },
      "topVehicles": [
        {
          "name": "MAS (Multiple Award Schedule)",
          "manager": "GSA",
          "naics": [
            "all"
          ]
        },
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "Alliant 3",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": "GSA Schedule is the gateway. 60% of GSA's own spending and billions in assisted acquisitions go through Schedule."
    }
  },
  {
    "slug": "tennessee-valley-authority",
    "name": "Tennessee Valley Authority",
    "abbreviation": "TVA",
    "cgac": "064",
    "group": "independent",
    "fy26BudgetB": 0.5,
    "fy25BudgetB": 0.5,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "The Tennessee Valley Authority (TVA) faces cybersecurity vulnerabilities in its critical infrastructure systems, as highlighted by GAO reports on energy sector threats, requiring contractors to provide specialized incident response and threat detection solutions tailored to operational technology (OT) environments.",
      "TVA struggles with an aging IT workforce, per GAO\u2019s Strategic Human Capital Management findings, creating a need for contractors to offer training programs or managed services to bridge skill gaps in maintaining legacy power grid systems.",
      "GAO\u2019s IT Acquisitions and Operations reports note inefficiencies in TVA\u2019s legacy system upgrades, necessitating contractors to deliver cost-effective modernization solutions for specific systems like outage management software with clear ROI metrics.",
      "TVA\u2019s exposure to climate change risks, as per GAO\u2019s High Risk List, demands contractors to support infrastructure resilience projects, such as flood-resistant designs for hydroelectric dams, with detailed engineering and risk assessment capabilities.",
      "With OMB M-22-09 mandating Zero Trust Architecture, TVA requires contractors to implement identity verification and network segmentation solutions for its distributed energy grid operations by the 2024 deadline.",
      "TVA\u2019s compliance with FITARA scorecards shows gaps in IT spending transparency, creating an opportunity for contractors to provide data analytics and reporting tools to streamline CIO oversight of multi-million-dollar tech investments."
    ],
    "priorities": [
      "Tennessee Valley Authority (TVA) allocating $1.5B for grid modernization through FY2025-2027, with contracts for smart grid technologies and infrastructure upgrades open for bidding.",
      "TVA committing $500M to renewable energy expansion, specifically solar projects, with RFPs for solar panel installation and maintenance expected in FY2025.",
      "TVA investing $800M in cybersecurity enhancements for critical infrastructure, including contracts for Zero Trust Architecture implementation per OMB M-22-09 by FY2026.",
      "TVA budgeting $300M for nuclear plant maintenance and upgrades at Watts Bar and Sequoyah facilities, with procurement opportunities for engineering and technical services in FY2025.",
      "TVA allocating $250M for climate resilience projects under the Bipartisan Infrastructure Law, focusing on flood control and dam safety with contracts available for construction firms through FY2026."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "commodity-futures-trading-commission",
    "name": "Commodity Futures Trading Commission",
    "abbreviation": "CFTC",
    "cgac": "339",
    "group": "small",
    "fy26BudgetB": 0.4,
    "fy25BudgetB": 0.4,
    "budgetTrend": "growing",
    "budgetChangePct": 1.123288,
    "painPoints": [
      "Legacy market surveillance system dating back to the 1990s required complete replacement \u2014 CFTC adopting Nasdaq Market Surveillance for first-ever automated alerts and cross-market analytics",
      "FISMA audit findings: OIG completed FY2023 and FY2024 audits identifying cybersecurity compliance gaps in information security programs",
      "Budget constraints: $410M and 650 FTE requested for FY2026 (12.3% increase) still insufficient for expanding jurisdiction into digital assets and crypto spot markets",
      "Cryptocurrency regulatory gap: CFTC and SEC launched Joint 'Project Crypto' initiative (January 2026) but lack statutory authority for comprehensive digital asset oversight",
      "Market data surveillance technology lagging innovation \u2014 swap data reporting unable to keep pace with DeFi, tokenized assets, and algorithmic trading",
      "Workforce expertise gap in blockchain, AI/ML, and digital asset technology needed for rapidly evolving crypto and fintech derivatives markets"
    ],
    "priorities": [
      "$410M total budget requested for FY2026 with 650 FTE for oversight of futures, swaps, options, and emerging digital asset markets",
      "Nasdaq Market Surveillance technology deployment providing automated alerts and cross-market analytics across all CFTC operating divisions",
      "Project Crypto joint SEC-CFTC initiative \u2014 technology infrastructure, rulemaking support, and market analysis contracts for digital asset regulation",
      "Enterprise analytics and AI/ML capabilities development \u2014 technology development and data science contractor support",
      "Tokenized collateral framework rulemaking \u2014 blockchain-based collateral and novel derivatives products including perpetual contracts"
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "equal-employment-opportunity-commission",
    "name": "Equal Employment Opportunity Commission",
    "abbreviation": "EEOC",
    "cgac": "045",
    "group": "small",
    "fy26BudgetB": 0.4,
    "fy25BudgetB": 0.5,
    "budgetTrend": "stable",
    "budgetChangePct": 0.956044,
    "painPoints": [
      "The Equal Employment Opportunity Commission (EEOC) struggles with outdated IT systems for case management, as noted in GAO reports on federal IT acquisition challenges, creating a need for modernized platforms to streamline discrimination complaint processing.",
      "EEOC faces workforce gaps in data analysts and investigators, per Strategic Human Capital Management high-risk findings, requiring contractor support for recruitment strategies and training programs.",
      "With increasing cyber threats to federal systems (GAO High Risk: Cybersecurity), EEOC needs enhanced incident response capabilities and security framework implementation for protecting sensitive employee data.",
      "EEOC's compliance with OMB M-22-09 Zero Trust Architecture mandates is incomplete, presenting an opportunity for contractors to design and deploy zero trust solutions by the required deadlines.",
      "Under the Executive Order on AI, EEOC must establish AI governance frameworks by 2025 to support unbiased decision-making in case reviews, creating a demand for AI policy and tool development services.",
      "EEOC's IT spending transparency lags behind FITARA scorecard requirements, necessitating contractor expertise in financial reporting tools and CIO authority alignment."
    ],
    "priorities": [
      "EEOC allocated $455M in FY2025 budget for enforcement of anti-discrimination laws, with contracts for legal support and case management software expected in Q1 FY2025.",
      "EEOC investing $15M in modernizing its Charge Handling System, with IT vendors able to bid on system integration and cloud migration services through Q3 FY2025.",
      "EEOC budgeted $10M for outreach and education programs under its Strategic Enforcement Plan, with opportunities for training and public relations firms to secure contracts in FY2025.",
      "EEOC awarded a $5M contract in FY2024 for data analytics to support litigation efforts, with potential follow-on task orders for data vendors in FY2025.",
      "EEOC allocating $8M for IT infrastructure upgrades to comply with FITARA scorecards, with RFPs for cybersecurity and network support expected in mid-FY2025."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "Alliant 3",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        },
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "federal-communications-commission",
    "name": "Federal Communications Commission",
    "abbreviation": "FCC",
    "cgac": "027",
    "group": "small",
    "fy26BudgetB": 0.4,
    "fy25BudgetB": 0.4,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "Broadband mapping accuracy - updating National Broadband Map with location-level deployment data",
      "Spectrum management modernization - rebalancing allocations for 5G, satellite, and federal users",
      "5G and 6G policy development - spectrum auctions, infrastructure rules, and security standards",
      "Universal Service Fund modernization - reforming $8B+ annual fund for broadband, schools, and healthcare",
      "Robocall enforcement - implementing STIR/SHAKEN and tracing illegal call campaigns",
      "Cybersecurity regulation - network security requirements for telecommunications carriers"
    ],
    "priorities": [
      "FCC allocating $14.2B for the Affordable Connectivity Program (ACP) to subsidize broadband for low-income households, with ongoing vendor contracts for outreach and administration through FY2025.",
      "FCC committing $1.5B to the Rip and Replace Program to remove unsecure equipment from telecom networks, with reimbursements available for contractors supporting equipment swaps through FY2026.",
      "FCC budgeting $544M for the 5G Fund for Rural America to deploy 5G in underserved areas, with auctions and contracts for telecom providers expected in FY2025.",
      "FCC investing $9B in the Universal Service Fund (USF) for broadband expansion, with active solicitations for network infrastructure contractors through FY2027.",
      "FCC allocating $100M for the Telehealth Program under the COVID-19 Telehealth Fund, with opportunities for IT and telecom vendors to support healthcare connectivity in FY2025."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "federal-trade-commission",
    "name": "Federal Trade Commission",
    "abbreviation": "FTC",
    "cgac": "029",
    "group": "small",
    "fy26BudgetB": 0.4,
    "fy25BudgetB": 0.4,
    "budgetTrend": "declining",
    "budgetChangePct": 0.899533,
    "painPoints": [
      "The Federal Trade Commission (FTC) struggles to protect consumer data due to identified gaps in cybersecurity incident response capabilities, as noted in GAO reports on federal cybersecurity, creating a need for contractors to provide tailored incident detection and mitigation tools.",
      "FTC faces challenges in recruiting and retaining cybersecurity talent amid private sector competition, per GAO\u2019s Strategic Human Capital Management findings, opening opportunities for contractors to offer specialized workforce training and staffing solutions.",
      "With increasing cyber threats to FTC systems, as highlighted in GAO\u2019s High Risk Area on Cybersecurity, contractors can address the need for implementing Zero Trust Architecture per OMB M-22-09 mandates by providing integration and monitoring services.",
      "FTC\u2019s IT acquisition processes lack efficiency, as per GAO\u2019s IT Acquisitions and Operations findings, creating a demand for contractors to deliver FITARA-compliant IT portfolio management solutions to enhance transparency and CIO oversight.",
      "The FTC requires support to meet the 2025 deadline for AI governance frameworks under the Executive Order on AI, presenting an opportunity for contractors to develop compliant AI policy frameworks and risk assessment tools.",
      "FTC\u2019s consumer protection mission is hampered by outdated IT systems, as flagged in GAO IT management reports, offering contractors a chance to provide legacy system modernization and cloud migration services."
    ],
    "priorities": [
      "FTC allocated $430M in FY2025 budget for antitrust enforcement, with increased funding for litigation support and economic analysis contracts.",
      "FTC investing $25M in consumer protection technology upgrades, focusing on data analytics tools for fraud detection with RFPs expected in Q1 FY2026.",
      "FTC committing $15M for cybersecurity enhancements under Zero Trust Architecture per OMB M-22-09, seeking IT security solutions for implementation by FY2027.",
      "FTC budgeting $10M for AI governance framework development under Executive Order on AI, with contracts for AI risk assessment tools anticipated in FY2026.",
      "FTC allocating $8M for IT modernization to improve case management systems, with procurement opportunities for software development in FY2025."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "Alliant 3",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        },
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "national-archives-and-records-administration",
    "name": "National Archives and Records Administration",
    "abbreviation": "NARA",
    "cgac": "088",
    "group": "small",
    "fy26BudgetB": 0.4,
    "fy25BudgetB": 0.4,
    "budgetTrend": "stable",
    "budgetChangePct": 0.965116,
    "painPoints": [
      "FY2026 budget cut to $414.7M \u2014 nearly $60M less than FY2025 projected spending and $93M less than FY2024, with 136 FTE positions eliminated",
      "Electronic Records Initiative (ERI) budget cut by 33% in FY2026, receiving 56% less than 2007 funding levels despite exponential growth in federal electronic records",
      "FOIA declassification backlog: 183M pages at Bush Library and 128M at Obama Library \u2014 capacity to declassify only 500,000 pages/year means 622 years to clear backlog",
      "National Declassification Center has only 58 employees with just 8 FOIA/MDR staff \u2014 more presidential libraries than declassifiers",
      "ERA 2.0 (Electronic Records Archives) deployment plagued by bugs \u2014 roughly 2,000 of 104,000 migrated forms affected, with deployment delayed per OIG audit",
      "Digitization goal of 500M pages by September 2026 only 40% complete (200M pages as of August 2025), requiring massive acceleration"
    ],
    "priorities": [
      "$20M Digitization Center at Archives II with text-scanning equipment and sensitive cameras, targeting 500M pages by September 2026",
      "ERA 2.0 cloud-based electronic records system handling 900+ terabytes \u2014 development and migration contracts for records from White House, Congress, and agencies",
      "Enterprise IAM solution, Cloud Access Security Broker, and Login.gov phishing-resistant MFA implementation for NARA applications",
      "2026 Annual Move transferring 9,000+ Transfer Requests from Federal Records Centers to archival custodial units \u2014 logistics and processing contracts",
      "Federal Records Centers Program managing 30M cubic feet across 18 facilities \u2014 storage, retrieval, and disposition services"
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "Alliant 3",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        },
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "office-of-personnel-management",
    "name": "Office of Personnel Management",
    "abbreviation": "OPM",
    "cgac": "024",
    "group": "independent",
    "fy26BudgetB": 0.4,
    "fy25BudgetB": 0.4,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "USAJOBS modernization - improving federal hiring platform serving 500K+ job postings annually",
      "Retirement services backlog - processing claims for 2.7M+ federal annuitants with 6-month average wait",
      "Background investigation systems - post-NBIB transition to DCSA coordination and data sharing",
      "Federal employee health benefits administration - managing FEHB marketplace for 8M+ enrollees",
      "HR shared services modernization - USA Staffing and other platforms for agency hiring support",
      "Cybersecurity for personnel data - protecting SF-86 records after 2015 breach impacting 22M+ records"
    ],
    "priorities": [
      "OPM allocated $150M for IT modernization under the Technology Modernization Fund to upgrade legacy HR systems, with contracts for cloud migration and software development expected in FY2025.",
      "OPM investing $80M in the USAJOBS platform enhancements, seeking contractors for user experience design and data analytics support through FY2026.",
      "OPM budgeted $25M for cybersecurity improvements post-2015 breach, focusing on endpoint detection and response tools with procurements planned for FY2025.",
      "OPM allocating $50M for the Federal Employee Retirement System (FERS) processing automation, with RFPs for case management software solutions expected in early FY2025.",
      "OPM committing $30M to security clearance process reforms under the Trusted Workforce 2.0 initiative, offering opportunities for background investigation support services through FY2026."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "FirstSource III",
          "manager": "DHS",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "EAGLE II",
          "manager": "DHS",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "peace-corps",
    "name": "Peace Corps",
    "abbreviation": "PC",
    "cgac": "011",
    "group": "small",
    "fy26BudgetB": 0.4,
    "fy25BudgetB": 0.4,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "The Peace Corps faces challenges in implementing Zero Trust Architecture as mandated by OMB M-22-09, requiring enhanced identity verification and network segmentation for its global volunteer management systems.",
      "Per GAO findings on cybersecurity, the Peace Corps struggles with incident response capabilities, needing robust tools and training to protect sensitive volunteer data across distributed international networks.",
      "The Peace Corps requires support to comply with the Executive Order on AI by 2025, specifically in developing governance frameworks for potential AI-driven volunteer placement and risk assessment tools.",
      "GAO\u2019s Strategic Human Capital Management high-risk area highlights Peace Corps\u2019 difficulty in recruiting and retaining IT staff, creating a need for contractor-provided workforce planning and training solutions.",
      "Under FITARA scorecard compliance, the Peace Corps needs assistance in improving IT spending transparency, particularly for its overseas operations, to ensure accountability of its $410M annual budget.",
      "The Peace Corps\u2019 legacy IT systems, as noted in GAO\u2019s IT Acquisitions high-risk area, require modernization to support volunteer tracking, with a need for contractor expertise in cloud migration and system integration."
    ],
    "priorities": [
      "Peace Corps allocated $410.5M in FY2025 budget for Volunteer Operations Support, with contracts for training, logistics, and medical support services open for bidding.",
      "Peace Corps investing $30M in IT modernization through FY2026, with RFPs expected for cloud migration and cybersecurity solutions under FITARA compliance.",
      "Peace Corps budgeting $15M for overseas facility upgrades in FY2025, with opportunities for construction and infrastructure contractors in host countries.",
      "Peace Corps committing $8M to implement Zero Trust Architecture per OMB M-22-09, with contracts for network security and identity management solutions in FY2025.",
      "Peace Corps allocating $5M for climate resilience initiatives at overseas posts through FY2027, supporting contractors for energy efficiency and disaster preparedness projects."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "court-services-and-offender-supervision-agency",
    "name": "Court Services and Offender Supervision Agency",
    "abbreviation": "CSOSA",
    "cgac": "511",
    "group": "small",
    "fy26BudgetB": 0.3,
    "fy25BudgetB": 0.3,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "Offender Case Management System (OCMS) aging \u2014 requires modernization for predictive analytics, AI/ML risk modeling, and real-time supervision compliance tracking",
      "FY2024 caseload: Pretrial Services Agency served 27,188 arrestees and supervised 15,676 defendants on pretrial release with limited technology automation",
      "GPS monitoring infrastructure requires continuous technology refresh as tracking hardware evolves faster than procurement cycles",
      "AI compliance requirements under OMB M-25-21 mandate CSOSA develop AI governance plans despite being a small independent agency with limited IT staff",
      "Community supervision officer recruitment and retention challenges competing with higher-paying federal law enforcement in DC metro area",
      "Drug testing laboratory operations requiring continuous accreditation maintenance and technology updates for evolving substance detection protocols"
    ],
    "priorities": [
      "Community Supervision Program and Pretrial Services Agency combined budget supporting supervision of DC offender and defendant populations",
      "GPS and electronic monitoring technology \u2014 ankle bracelet hardware, cellular-based tracking, and real-time alert systems for high-risk supervisees",
      "OCMS modernization with AI, machine learning, and predictive analytics for evidence-based supervision strategies",
      "Drug testing and substance abuse monitoring \u2014 laboratory operations, rapid testing supplies, and chain-of-custody management technology",
      "Reentry and Sanctions Center (Karrick Hall) operations \u2014 residential treatment, cognitive behavioral programs, and transitional services"
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "FirstSource III",
          "manager": "DHS",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "EAGLE II",
          "manager": "DHS",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "federal-housing-finance-agency",
    "name": "Federal Housing Finance Agency",
    "abbreviation": "FHFA",
    "cgac": "537",
    "group": "small",
    "fy26BudgetB": 0.3,
    "fy25BudgetB": 0.3,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [],
    "priorities": [],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [],
      "tips": ""
    }
  },
  {
    "slug": "national-labor-relations-board",
    "name": "National Labor Relations Board",
    "abbreviation": "NLRB",
    "cgac": "025",
    "group": "small",
    "fy26BudgetB": 0.3,
    "fy25BudgetB": 0.3,
    "budgetTrend": "stable",
    "budgetChangePct": 0.953177,
    "painPoints": [
      "The National Labor Relations Board (NLRB) struggles with outdated IT systems for case management, as noted in GAO reports on federal IT modernization, creating a need for contractors to develop secure, cloud-based platforms to streamline case processing.",
      "NLRB faces challenges in meeting OMB M-22-09 Zero Trust Architecture requirements by 2024, requiring contractors to provide cybersecurity solutions for identity verification and network segmentation.",
      "Per GAO's Strategic Human Capital Management findings, NLRB has difficulty recruiting skilled IT staff to manage digital tools, opening opportunities for contractors to offer managed IT services or training programs.",
      "NLRB's vulnerability to cyber threats, as highlighted in GAO's Cybersecurity High Risk Area, necessitates contractors to implement advanced incident response and threat detection systems tailored to federal compliance.",
      "Under FITARA scorecard compliance, NLRB must improve IT spending transparency, creating a demand for contractors to develop dashboards or analytics tools for real-time budget tracking.",
      "NLRB's case backlog, exacerbated by manual processes as per agency budget justifications, calls for contractors to design AI-driven workflow automation tools to enhance efficiency."
    ],
    "priorities": [
      "NLRB allocated $299.2M in FY2025 budget for case management system modernization, with RFPs expected for IT services and software development in Q1 FY2025.",
      "NLRB investing $15M in FY2025-2026 for cybersecurity enhancements under Zero Trust Architecture per OMB M-22-09, seeking contractors for endpoint security and identity management solutions.",
      "NLRB awarded a $10M contract in FY2024 for cloud migration support, with potential follow-on task orders for managed services through FY2026.",
      "NLRB budgeting $8.5M in FY2025 for AI-driven case analysis tools under EO on AI, with procurement for AI software and integration services planned for mid-FY2025.",
      "NLRB allocating $12M over FY2025-2027 for workforce training and human capital management solutions, with opportunities for training providers and HR consultants."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "Alliant 3",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513",
            "541519"
          ]
        },
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "millennium-challenge-corporation",
    "name": "Millennium Challenge Corporation",
    "abbreviation": "MCC",
    "cgac": "184",
    "group": "small",
    "fy26BudgetB": 0.2,
    "fy25BudgetB": 0.9,
    "budgetTrend": "cut",
    "budgetChangePct": 0.24086,
    "painPoints": [
      "The Millennium Challenge Corporation (MCC) struggles with IT system vulnerabilities, as identified in GAO reports on federal cybersecurity, requiring enhanced incident response capabilities and security framework implementation to protect sensitive grant data.",
      "MCC faces challenges in recruiting and retaining a skilled IT workforce, per GAO\u2019s Strategic Human Capital Management findings, creating a need for contractor support in talent acquisition and training programs tailored to federal needs.",
      "GAO\u2019s IT Acquisition and Operations reports highlight MCC\u2019s reliance on legacy systems for grant management, necessitating contractor expertise in system modernization and migration to cloud-based platforms.",
      "MCC\u2019s international development projects are at risk from climate change impacts, as noted in GAO\u2019s High Risk Area on Climate Change Risks, requiring contractors to provide climate adaptation planning and infrastructure resilience solutions.",
      "Improper payments in MCC\u2019s grant programs contribute to the government-wide $175B+ issue flagged by GAO, creating an opportunity for contractors to develop fraud detection tools and payment verification processes.",
      "MCC must comply with the Executive Order on AI by 2025, needing contractor support to design and implement AI governance frameworks for evaluating development project outcomes."
    ],
    "priorities": [
      "Millennium Challenge Corporation (MCC) allocated $912M for FY2025 compact development with countries like Kosovo and Belize, focusing on infrastructure and energy projects open to construction and engineering contractors.",
      "MCC awarded a $537M compact to Mongolia for water supply infrastructure, with procurement opportunities for water treatment and pipeline construction through FY2026.",
      "MCC's $650M Threshold Program includes active funding for governance and economic reforms in countries like Sierra Leone, with consulting and advisory service contracts available for bid.",
      "MCC committed $500M to the C\u00f4te d\u2019Ivoire compact for transportation and education infrastructure, with RFPs for road construction and vocational training facilities expected in FY2025.",
      "MCC\u2019s $480M compact with Burkina Faso targets power sector reforms, offering opportunities for energy contractors to bid on grid modernization projects through FY2027."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "export-import-bank-of-the-united-states",
    "name": "Export-Import Bank of the United States",
    "abbreviation": "EXIM",
    "cgac": "083",
    "group": "small",
    "fy26BudgetB": 0.1,
    "fy25BudgetB": 0.1,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "The Export-Import Bank of the United States (EXIM) struggles with outdated IT systems for transaction processing, risking inefficiencies in managing over $8.5 billion in annual export financing, creating a need for modernized financial management software solutions.",
      "EXIM faces challenges in implementing Zero Trust Architecture per OMB M-22-09, particularly in securing remote access to sensitive trade data, requiring contractor support for cybersecurity architecture design and deployment.",
      "A 2022 GAO report highlighted EXIM\u2019s delays in processing small business export loans due to manual workflows, necessitating automation tools to streamline application reviews and improve turnaround times.",
      "EXIM\u2019s cybersecurity workforce lacks specialized skills to address increasing threats to financial systems, as noted in GAO\u2019s High Risk Area on Cybersecurity, creating a demand for training programs or managed security services.",
      "Per the Executive Order on AI, EXIM must establish AI governance frameworks by 2025 to enhance risk assessment of export deals, opening opportunities for contractors to develop AI policy and implementation strategies.",
      "EXIM\u2019s FITARA scorecard shows gaps in IT spending transparency, requiring contractor expertise in data analytics and reporting tools to improve compliance with federal mandates."
    ],
    "priorities": [
      "Export-Import Bank of the United States allocated $110M in FY2025 for the China and Transformational Exports Program (CTEP) to counter Chinese influence, with financing opportunities for U.S. exporters in critical sectors like renewable energy and semiconductors.",
      "EXIM Bank committed $500M for the Make More in America Initiative, providing loan guarantees and insurance for domestic manufacturing projects, with applications open through FY2027 for contractors in supply chain and infrastructure sectors.",
      "EXIM Bank awarded a $1B financing package in FY2024 for renewable energy exports under the Energy Transition Accelerator, with ongoing opportunities for clean tech firms to secure export contracts through FY2026.",
      "EXIM Bank budgeted $20M for IT modernization in FY2025 to enhance digital application platforms, with RFPs expected for software development and cybersecurity services in Q1 FY2025.",
      "EXIM Bank is implementing Zero Trust Architecture per OMB M-22-09, with $15M allocated in FY2025 for cybersecurity upgrades, creating opportunities for IT security contractors to bid on implementation contracts."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "8(a) STARS III",
          "manager": "GSA",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "merit-systems-protection-board",
    "name": "Merit Systems Protection Board",
    "abbreviation": "MSPB",
    "cgac": "541",
    "group": "small",
    "fy26BudgetB": 0.1,
    "fy25BudgetB": 0.1,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [],
    "priorities": [
      "Total obligated: $0.1B. Congressional justification outlay: $13541.1B"
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [],
      "tips": ""
    }
  },
  {
    "slug": "railroad-retirement-board",
    "name": "Railroad Retirement Board",
    "abbreviation": "RRB",
    "cgac": "060",
    "group": "small",
    "fy26BudgetB": 0.1,
    "fy25BudgetB": 0.1,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "The Railroad Retirement Board (RRB) struggles with legacy IT systems that hinder efficient processing of retirement and survivor benefits, with GAO reports highlighting delays in modernization efforts costing over $10M in inefficiencies annually; contractors can provide system integration and migration solutions.",
      "RRB's cybersecurity posture is weakened by outdated incident response protocols, as noted in IG reports, leaving critical beneficiary data vulnerable; contractors can implement NIST-compliant frameworks and real-time threat monitoring tools.",
      "Per GAO findings, RRB faces workforce shortages in IT and actuarial roles, impacting accurate benefit calculations; contractors can offer specialized staffing augmentation and training programs to bridge human capital gaps.",
      "RRB's improper payment rate for disability benefits, estimated at $50M annually per agency data, requires enhanced fraud detection; contractors can deploy AI-driven analytics to identify and prevent overpayments.",
      "Under OMB M-22-09, RRB must adopt Zero Trust Architecture by 2024 but lacks implementation plans, risking non-compliance; contractors can design and deploy Zero Trust solutions tailored to RRB\u2019s infrastructure.",
      "RRB's IT acquisition management scored poorly on FITARA scorecards due to lack of CIO oversight on $15M annual IT spending; contractors can provide advisory services to streamline procurement and enhance transparency."
    ],
    "priorities": [
      "Railroad Retirement Board (RRB) allocated $108M in FY2025 for IT modernization under the Information Technology Investment Plan, with contracts for cloud migration and legacy system upgrades expected in Q1 FY2025.",
      "RRB budgeting $15M annually through FY2027 for cybersecurity enhancements to comply with Zero Trust Architecture mandates per OMB M-22-09, with opportunities for endpoint security and identity management solutions.",
      "RRB awarded a $5M contract in FY2024 for customer service platform upgrades, with potential follow-on task orders for CRM integration and support services in FY2025.",
      "RRB requesting $12M in FY2025 Congressional Justification for data analytics tools to improve benefit processing accuracy, opening bids for software development and AI-driven automation.",
      "RRB allocating $8M through FY2026 for workforce training and human capital management systems to address Strategic Human Capital Management gaps, with contracts for HR software and consulting services."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "TAPS",
          "manager": "DOT",
          "naics": [
            "541330",
            "541611"
          ]
        },
        {
          "name": "GSA MAS",
          "manager": "GSA",
          "naics": [
            "541512",
            "541611"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "broadcasting-board-of-governors",
    "name": "Broadcasting Board of Governors",
    "abbreviation": "BBG",
    "cgac": "095",
    "group": "small",
    "fy26BudgetB": null,
    "fy25BudgetB": null,
    "budgetTrend": null,
    "budgetChangePct": null,
    "painPoints": [],
    "priorities": [],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [],
      "tips": ""
    }
  },
  {
    "slug": "executive-office-of-the-president",
    "name": "Executive Office of the President",
    "abbreviation": "EOP",
    "cgac": "011",
    "group": "small",
    "fy26BudgetB": null,
    "fy25BudgetB": null,
    "budgetTrend": null,
    "budgetChangePct": null,
    "painPoints": [],
    "priorities": [
      "Total obligated: $2.2B. Congressional justification outlay: $13541.1B"
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [],
      "tips": ""
    }
  },
  {
    "slug": "international-boundary-and-water-commission",
    "name": "International Boundary and Water Commission",
    "abbreviation": "IBWC",
    "cgac": "519",
    "group": "small",
    "fy26BudgetB": null,
    "fy25BudgetB": null,
    "budgetTrend": null,
    "budgetChangePct": null,
    "painPoints": [],
    "priorities": [],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [],
      "tips": ""
    }
  },
  {
    "slug": "selective-service-system",
    "name": "Selective Service System",
    "abbreviation": "SSS",
    "cgac": "090",
    "group": "small",
    "fy26BudgetB": 0.0,
    "fy25BudgetB": 0.0,
    "budgetTrend": "stable",
    "budgetChangePct": 1.0,
    "painPoints": [
      "The Selective Service System struggles with outdated IT infrastructure, risking failure to meet registration processing demands during a national emergency, as highlighted in GAO reports on IT acquisition management, creating a need for modernized systems integration and support.",
      "Cybersecurity vulnerabilities in Selective Service System databases expose sensitive registrant data to increasing threats, per GAO\u2019s High Risk Area on cybersecurity, requiring contractors to implement Zero Trust Architecture per OMB M-22-09 mandates.",
      "The Selective Service System faces workforce gaps in IT and cybersecurity expertise, as noted in GAO\u2019s Strategic Human Capital Management challenges, necessitating contractor support for training and staffing solutions.",
      "Compliance with the Executive Order on AI by 2025 poses a challenge for the Selective Service System, which lacks frameworks for AI-driven registration or data analysis, opening opportunities for AI governance and implementation services.",
      "The Selective Service System\u2019s legacy systems hinder FITARA scorecard compliance for IT spending transparency, creating a need for contractors to provide data analytics and reporting tools to enhance CIO oversight.",
      "Supply chain risks in IT hardware and software procurement for the Selective Service System, under Section 889 requirements, demand contractor expertise in supply chain risk management (SCRM) assessments and mitigation strategies."
    ],
    "priorities": [
      "Selective Service System allocated $31.5M in FY2025 for IT modernization, including cloud migration and registration system upgrades, with solicitations expected in Q1 FY2025.",
      "SSS budgeting $5.2M for cybersecurity enhancements to protect registrant data, aligning with Zero Trust Architecture mandates, with contracts for endpoint security solutions anticipated in FY2025.",
      "SSS investing $3.8M in FY2025-2026 for public awareness campaigns to increase registration compliance, with opportunities for marketing and media firms to bid on outreach contracts.",
      "SSS allocating $2.1M for workforce training and human capital management in FY2025, with contracts for learning management systems and training providers expected by mid-FY2025.",
      "SSS committing $1.5M for data analytics and reporting tools to improve operational efficiency, with RFPs for software solutions projected for Q3 FY2025."
    ],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [
        {
          "name": "OASIS+",
          "manager": "GSA",
          "naics": [
            "541XXX"
          ]
        },
        {
          "name": "FirstSource III",
          "manager": "DHS",
          "naics": [
            "541512",
            "541611"
          ]
        },
        {
          "name": "EAGLE II",
          "manager": "DHS",
          "naics": [
            "541512",
            "541513"
          ]
        }
      ],
      "tips": ""
    }
  },
  {
    "slug": "us-international-trade-commission",
    "name": "U.S. International Trade Commission",
    "abbreviation": "USITC",
    "cgac": "061",
    "group": "small",
    "fy26BudgetB": null,
    "fy25BudgetB": null,
    "budgetTrend": null,
    "budgetChangePct": null,
    "painPoints": [],
    "priorities": [],
    "procurement": {
      "primarySources": [],
      "secondarySources": [],
      "spendingPatterns": {},
      "topVehicles": [],
      "tips": ""
    }
  }
];

export const AGENCIES_BY_SLUG: Record<string, AgencySeo> = Object.fromEntries(
  AGENCIES_SEO.map((a) => [a.slug, a]),
);

export function getAgencyBySlug(slug: string): AgencySeo | undefined {
  return AGENCIES_BY_SLUG[slug];
}

export function getAgenciesByGroup(group: AgencySeo['group']): AgencySeo[] {
  return AGENCIES_SEO.filter((a) => a.group === group);
}

/**
 * Related agencies = same group, excluding the focal agency, top 4 by
 * budget. Falls back to top-budget overall when the group is sparse.
 */
export function getRelatedAgencies(agency: AgencySeo, limit = 4): AgencySeo[] {
  const sameGroup = AGENCIES_SEO.filter(
    (a) => a.group === agency.group && a.slug !== agency.slug,
  );
  if (sameGroup.length >= limit) return sameGroup.slice(0, limit);
  const filler = AGENCIES_SEO.filter(
    (a) => a.slug !== agency.slug && !sameGroup.includes(a),
  ).slice(0, limit - sameGroup.length);
  return [...sameGroup, ...filler];
}
