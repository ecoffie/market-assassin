/**
 * A FULL stored market report: every section populated, at the sizes a real keyword report returns
 * (10 NAICS, 8 PSC, 10 agencies, 6 contacts, 15 contractors, 2 of 3,899 recompetes, 15 of 48 forecasts).
 * Shape and amounts come from a real generate_market_report run (2026-11-22, "janitorial services");
 * every person, company, UEI and contract number is SYNTHETIC. Data dates and source URLs are the real run's
 * metadata (public, not about any person). Used by the screenshot and PDF regression
 * tests (tests/unit/visual, tests/visual) — not a source of market facts.
 */
export const FULL_REPORT = {
  "id": "fullreportfixture000001",
  "owner_email": "fixture@example.com",
  "subject": "janitorial services",
  "client_name": "Design QA sample",
  "params": {},
  "created_at": "2026-11-22T18:59:00Z",
  "payload": {
    "subject": "janitorial services",
    "generated_at": "2026-11-22T18:59:00.000Z",
    "generated_for": null,
    "basis": { "scope": "keyword", "label": "keyword \"janitorial services\"", "ranked_by_dominant_naics": false, "naics_sections_code": null },
    "reconciliation": { "single_naics": "561720", "single_naics_name": "JANITORIAL SERVICES", "single_naics_amount": 343277543.9399999, "single_naics_pct": 0.8053119477831756, "total_market": 426266547.8699999, "naics_count": 30, "missed_pct": 0.1946880522168244 },
    "summary": {
      "subject": "janitorial services",
      "axis": "keyword",
      "size_tiers": [
        {
          "basis": "named",
          "label": "Awards that say \"janitorial services\"",
          "amount": 5397300310.75,
          "method": "USASpending award text contains \"janitorial services\" (FY23-25, contract awards). A FLOOR — classified, component-level and indirectly-titled work never says the name.",
          "inputs": ["janitorial services"],
          "role": "sections_basis",
          "note": "This literal-phrase reading is what the agency and contractor tables below are ranked on (FY23-25). The headline total is a different measurement (see its label)."
        }
      ],
      "undercount_note": null,
      "total_market": 426266547.8699999,
      "naics_count": 30,
      "top_psc": { "code": "S201", "name": "HOUSEKEEPING- CUSTODIAL JANITORIAL" },
      "buying_agencies": 10,
      "top_contractors": 15,
      "recompetes": 2,
      "forecasts": 15,
      "contacts": 6,
      "recompetes_total": 3899,
      "forecasts_total": 48,
      "forecasts_duplicates_removed": 0,
      "total_market_basis": { "source": "keyword_description_match", "window": "FY2026 (1 complete fiscal year · description match)", "state_scoped": false, "requested_state": null, "agency_scoped": false, "requested_agency": null, "identity_resolved_via": null }
    },
    "sections": {
      "market_size": { "source": "bigquery_usaspending_awards", "windowLabel": "FY2026 (1 complete fiscal year \u00b7 description match)", "sourceMaxActionDate": "2026-09-30",
        "allNaics": [
          { "code": "561720", "name": "JANITORIAL SERVICES", "amount": 343277543.9399999, "pct": 0.8053119477831756 },
          { "code": "561210", "name": "FACILITIES SUPPORT SERVICES", "amount": 58402844.89000001, "pct": 0.13701015287695376 },
          { "code": "531210", "name": "OFFICES OF REAL ESTATE AGENTS AND BROKERS", "amount": 5962205.400000001, "pct": 0.013987035646574634 },
          { "code": "541519", "name": "OTHER COMPUTER RELATED SERVICES", "amount": 4903501.24, "pct": 0.011503368642231431 },
          { "code": "722310", "name": "FOOD SERVICE CONTRACTORS", "amount": 2412306.99, "pct": 0.005659151538055223 },
          { "code": "561730", "name": "LANDSCAPING SERVICES", "amount": 2217633.56, "pct": 0.005202457408589144 },
          { "code": "541990", "name": "ALL OTHER PROFESSIONAL, SCIENTIFIC, AND TECHNICAL SERVICES", "amount": 1497938.25, "pct": 0.003514088209560446 },
          { "code": "541611", "name": "ADMINISTRATIVE MANAGEMENT AND GENERAL MANAGEMENT CONSULTING SERVICES", "amount": 1495793.79, "pct": 0.00350905741366357 },
          { "code": "541690", "name": "OTHER SCIENTIFIC AND TECHNICAL CONSULTING SERVICES", "amount": 1270277.76, "pct": 0.0029800080873045695 },
          { "code": "561320", "name": "TEMPORARY HELP SERVICES", "amount": 874000.29, "pct": 0.0020503609639725873 }
        ],
        "topPscList": [
          { "code": "S201", "name": "HOUSEKEEPING- CUSTODIAL JANITORIAL", "amount": 385446037.40000004, "pct": 0.9042371242266728 },
          { "code": "Z1AA", "name": "MAINTENANCE OF OFFICE BUILDINGS", "amount": 14455488.99, "pct": 0.033911854125622226 },
          { "code": "S211", "name": "HOUSEKEEPING- SURVEILLANCE", "amount": 6033582.760000002, "pct": 0.014154483362931135 },
          { "code": "S216", "name": "HOUSEKEEPING- FACILITIES OPERATIONS SUPPORT", "amount": 5033761.01, "pct": 0.011808951547225716 },
          { "code": "S299", "name": "HOUSEKEEPING- OTHER", "amount": 2609477.11, "pct": 0.006121702777380086 },
          { "code": "S203", "name": "HOUSEKEEPING- FOOD", "amount": 2412306.99, "pct": 0.005659151538055223 },
          { "code": "L079", "name": "TECHNICAL REPRESENTATIVE- CLEANING EQUIPMENT AND SUPPLIES", "amount": 1850000, "pct": 0.004340007465385723 },
          { "code": "Z1HB", "name": "MAINTENANCE OF GOVERNMENT-OWNED GOVERNMENT-OPERATED (GOGO) R&D FACILITIES", "amount": 1498812, "pct": 0.003516137983356598 }
        ],
        "topCodePct": 0.8053119477831756
      },
      "top_agencies": [
        { "name": "Department of the Army", "amount": 1584933042 },
        { "name": "Department of the Navy", "amount": 809497417 },
        { "name": "Department of the Air Force", "amount": 656527760 },
        { "name": "Department of Veterans Affairs", "amount": 424597506 },
        { "name": "Defense Health Agency", "amount": 237160529 },
        { "name": "Public Buildings Service", "amount": 185098048 },
        { "name": "Federal Aviation Administration", "amount": 153554197 },
        { "name": "U.S. Customs and Border Protection", "amount": 135748380 },
        { "name": "Federal Law Enforcement Training Center", "amount": 116768087 },
        { "name": "Federal Bureau of Investigation", "amount": 88614728 }
      ],
      "top_agencies_total": 10,
      "contacts": {
        "agency": "Department of the Army",
        "office": null,
        "total": 1850,
        "basis": "market_awarding_offices",
        "office_codes": ["1111AA", "2222BB"],
        "people": [
          { "name": "Contact Person 1", "role": "Contracting", "email": "contact1@example.gov", "office": null , "source": {"kind": "sam_notice_poc", "solicitation_number": "SYN-SOL-001", "notice_posted": "2026-11-18"} },
          { "name": "Contact Person 2", "role": "Contracting", "email": "contact2@example.gov", "office": null , "source": {"kind": "sam_notice_poc", "solicitation_number": "SYN-SOL-002", "notice_posted": "2026-11-18"} },
          { "name": "Contact Person 3", "role": "Contracting", "email": "contact3@example.gov", "office": null , "source": {"kind": "sam_notice_poc", "solicitation_number": "SYN-SOL-003", "notice_posted": "2026-11-18"} },
          { "name": "Contact Person 4", "role": "Contracting", "email": "contact4@example.gov", "office": null , "source": {"kind": "sam_notice_poc", "solicitation_number": "SYN-SOL-004", "notice_posted": "2026-10-02"} },
          { "name": "Contact Person 5", "role": "Contracting", "email": "contact5@example.gov", "office": null , "source": {"kind": "sam_notice_poc", "solicitation_number": "SYN-SOL-005", "notice_posted": "2026-10-02"} },
          { "name": "Contact Person 6", "role": "Contracting", "email": "contact6@example.gov", "office": null , "source": {"kind": "sam_notice_poc", "solicitation_number": "SYN-SOL-006", "notice_posted": null} }
        ]
      },
      "competition": {
        "contractors": [
          { "recipient_name": "Synthetic Facility Services 1 Inc", "recipient_uei": "SYNTH0000001", "total_obligated": 176555708 },
          { "recipient_name": "Synthetic Facility Services 2 Inc", "recipient_uei": "SYNTH0000002", "total_obligated": 166118723 },
          { "recipient_name": "Synthetic Facility Services 3 Inc", "recipient_uei": "SYNTH0000003", "total_obligated": 154680751 },
          { "recipient_name": "Synthetic Facility Services 4 Inc", "recipient_uei": "SYNTH0000004", "total_obligated": 147225574 },
          { "recipient_name": "Synthetic Facility Services 5 Inc", "recipient_uei": "SYNTH0000005", "total_obligated": 142346842 },
          { "recipient_name": "Synthetic Facility Services 6 Inc", "recipient_uei": "SYNTH0000006", "total_obligated": 141015467 },
          { "recipient_name": "Synthetic Facility Services 7 Inc", "recipient_uei": "SYNTH0000007", "total_obligated": 133248245 },
          { "recipient_name": "Synthetic Facility Services 8 Inc", "recipient_uei": "SYNTH0000008", "total_obligated": 126054159 },
          { "recipient_name": "Synthetic Facility Services 9 Inc", "recipient_uei": "SYNTH0000009", "total_obligated": 109444992 },
          { "recipient_name": "Synthetic Facility Services 10 Inc", "recipient_uei": "SYNTH0000010", "total_obligated": 82423898 },
          { "recipient_name": "Synthetic Facility Services 11 Inc", "recipient_uei": "SYNTH0000011", "total_obligated": 79360557 },
          { "recipient_name": "Synthetic Facility Services 12 Inc", "recipient_uei": "SYNTH0000012", "total_obligated": 75154613 },
          { "recipient_name": "Synthetic Facility Services 13 Inc", "recipient_uei": "SYNTH0000013", "total_obligated": 73555649 },
          { "recipient_name": "Synthetic Facility Services 14 Inc", "recipient_uei": "SYNTH0000014", "total_obligated": 73242567 },
          { "recipient_name": "Synthetic Facility Services 15 Inc", "recipient_uei": "SYNTH0000015", "total_obligated": 71954548 }
        ],
        "count": 15
      },
      "recompetes": {
        "contracts": [
          { "piid": "SYN1C00000", "incumbent_name": "Synthetic Incumbent 1 LLC", "awarding_agency": "Department of the Treasury", "awarding_sub_agency": "Bureau of Engraving and Printing", "naics_code": "561210", "description": "WCF SECURITY SUPPORT ADMINISTRATIVE SERVICES", "total_obligation": 2348726, "potential_total_value": null, "period_of_performance_current_end": "2026-11-23", "recompete_likelihood": "high", "last_synced_at": "2026-11-22T16:25:30.611+00:00", "provenance": { "source_label": "USASpending award record", "source_url": null, "as_of": "2026-11-22T16:25:30.611+00:00", "as_of_label": "last synced" } },
          { "piid": "SYN2C00001", "incumbent_name": "Synthetic Incumbent 2 LLC", "awarding_agency": "Department of Agriculture", "awarding_sub_agency": "Agricultural Research Service", "naics_code": "561210", "description": "WATER AND WASTEWATER SUPERINTENDENT SERVICES", "total_obligation": 120000, "potential_total_value": null, "period_of_performance_current_end": "2026-11-24", "recompete_likelihood": "medium", "last_synced_at": "2026-11-22T16:25:30.611+00:00", "provenance": { "source_label": "USASpending award record", "source_url": null, "as_of": "2026-11-22T16:25:30.611+00:00", "as_of_label": "last synced" } }
        ],
        "count": 2
      },
      "forecasts": {
        "forecasts": [
          { "title": "BDO Recreation Maintenance", "agency": "DOI", "department": null, "naics_code": "561720", "value_min": 1000000, "value_max": 1900000, "value_range": "$1M - $1.9M", "fiscal_year": null, "quarter": null, "set_aside_type": null, "incumbent_name": null , "as_of": "2026-08-01T20:06:17.078+00:00", "source_url": "https://www.acquisitiongateway.gov/forecast" },
          { "title": "Janitorial services for Pecos District Campgrounds", "agency": "DOI", "department": null, "naics_code": "561720", "value_min": 250000, "value_max": 499000, "value_range": "$250K - $499K", "fiscal_year": null, "quarter": null, "set_aside_type": "Small Business", "incumbent_name": null , "as_of": "2026-08-01T20:06:17.078+00:00", "source_url": "https://www.acquisitiongateway.gov/forecast" },
          { "title": "Lake Tahoe Basin Management Unit Janitorial Services", "agency": "USDA", "department": null, "naics_code": "561720", "value_min": 250000, "value_max": 499000, "value_range": "$250K - $499K", "fiscal_year": "FY2027", "quarter": null, "set_aside_type": null, "incumbent_name": null , "as_of": "2026-08-01T20:06:17.078+00:00", "source_url": "https://www.acquisitiongateway.gov/forecast" },
          { "title": "FACILITY OPERATIONS AND MAINTENANCE AIR & MARINE OPERATIONS CENTER (AMOC) RIVERSIDE, CA", "agency": "DHS", "department": null, "naics_code": "561210", "value_min": 5000000, "value_max": 10000000, "value_range": "$5M to $10M", "fiscal_year": "FY2027", "quarter": "Q1", "set_aside_type": "Small Business", "incumbent_name": "Synthetic Forecast Incumbent" , "as_of": "2026-10-19T13:00:30.018+00:00", "source_url": "https://apfs-cloud.dhs.gov/forecast/" },
          { "title": "Grounds Maintenance and Janitorial Novato/ Point Reyes CA (Marin County)", "agency": "DHS", "department": null, "naics_code": "561720", "value_min": 1000000, "value_max": 2000000, "value_range": "$1M to $2M", "fiscal_year": "FY2027", "quarter": "Q1", "set_aside_type": null, "incumbent_name": null , "as_of": "2026-10-29T13:00:30.858+00:00", "source_url": "https://apfs-cloud.dhs.gov/forecast/" },
          { "title": "ANC Janitorial Services (5 year)", "agency": "DOT", "department": null, "naics_code": "561720", "value_min": 250000, "value_max": 499000, "value_range": "$250K - $499K", "fiscal_year": null, "quarter": null, "set_aside_type": null, "incumbent_name": null , "as_of": "2026-08-01T20:06:17.078+00:00", "source_url": "https://www.acquisitiongateway.gov/forecast" },
          { "title": "Ft Gibson - Janitorial", "agency": "VA", "department": null, "naics_code": "561720", "value_min": 150000, "value_max": 249000, "value_range": "$150K - $249K", "fiscal_year": "FY2027", "quarter": null, "set_aside_type": "SDVOSB", "incumbent_name": null , "as_of": "2026-08-01T20:06:17.078+00:00", "source_url": "https://www.acquisitiongateway.gov/forecast" },
          { "title": "Base Borinquen Janitorial Services", "agency": "DHS", "department": null, "naics_code": "561720", "value_min": 2000000, "value_max": 4900000, "value_range": "$2M - $4.9M", "fiscal_year": "FY2027", "quarter": null, "set_aside_type": null, "incumbent_name": null , "as_of": "2026-11-22T13:00:30.928+00:00", "source_url": "https://apfs-cloud.dhs.gov/forecast/" },
          { "title": "Ft Sill NC - Janitorial", "agency": "VA", "department": null, "naics_code": "561720", "value_min": 150000, "value_max": 249000, "value_range": "$150K - $249K", "fiscal_year": "FY2027", "quarter": null, "set_aside_type": "SDVOSB", "incumbent_name": null , "as_of": "2026-08-01T20:06:17.078+00:00", "source_url": "https://www.acquisitiongateway.gov/forecast" },
          { "title": "OBS- Galley and Barracks Keepers", "agency": "DHS", "department": null, "naics_code": "561210", "value_min": 2000000, "value_max": 4900000, "value_range": "$2M - $4.9M", "fiscal_year": "FY2027", "quarter": null, "set_aside_type": null, "incumbent_name": null , "as_of": "2026-11-22T13:00:30.928+00:00", "source_url": "https://apfs-cloud.dhs.gov/forecast/" },
          { "title": "Janitorial Services for Forest Products Laboratory", "agency": "USDA", "department": null, "naics_code": "561720", "value_min": 2000000, "value_max": 4900000, "value_range": "$2M - $4.9M", "fiscal_year": "FY2027", "quarter": null, "set_aside_type": null, "incumbent_name": null , "as_of": "2026-08-01T20:06:17.078+00:00", "source_url": "https://www.acquisitiongateway.gov/forecast" },
          { "title": "Janitorial Services", "agency": "HHS", "department": null, "naics_code": "561720", "value_min": 25000, "value_max": 250000, "value_range": "> $25K and < $250K", "fiscal_year": "FY2027", "quarter": "Q3", "set_aside_type": null, "incumbent_name": null , "as_of": "2026-09-13T21:06:02.677+00:00", "source_url": "https://osdbu.hhs.gov/industry/opportunity-forecast" },
          { "title": "FPSU JANITORIAL SERVICES", "agency": "HHS", "department": null, "naics_code": "561320", "value_min": 25000, "value_max": 250000, "value_range": "> $25K and < $250K", "fiscal_year": "FY2027", "quarter": "Q4", "set_aside_type": null, "incumbent_name": "Synthetic Forecast Incumbent" , "as_of": "2026-09-13T21:06:01.973+00:00", "source_url": "https://osdbu.hhs.gov/industry/opportunity-forecast" },
          { "title": "BROWN POINT FACILITY MANAGEMENT SOLUTIONS LLC", "agency": "HHS", "department": null, "naics_code": "561210", "value_min": 25000, "value_max": 250000, "value_range": "> $25K and < $250K", "fiscal_year": "FY2027", "quarter": "Q4", "set_aside_type": null, "incumbent_name": "Synthetic Forecast Incumbent" , "as_of": "2026-09-13T21:06:02.677+00:00", "source_url": "https://osdbu.hhs.gov/industry/opportunity-forecast" },
          { "title": "Lockport Janitorial Services - Option Year 1", "agency": "HHS", "department": null, "naics_code": "561720", "value_min": 25000, "value_max": 250000, "value_range": "> $25K and < $250K", "fiscal_year": "FY2027", "quarter": "Q4", "set_aside_type": null, "incumbent_name": null , "as_of": "2026-09-13T21:06:02.677+00:00", "source_url": "https://osdbu.hhs.gov/industry/opportunity-forecast" }
        ],
        "count": 15
      },
      "agency_detail": null,
      "set_aside_gap": null
    },
    "_meta": {
      "grounded": true,
      "degraded": false,
      "sections_grounded": 5,
      "sections_total": 7,
      "section_status": [
        { "name": "market_measurement", "status": "ok", "required": true },
        { "name": "top_agencies", "status": "ok", "required": false },
        { "name": "competition", "status": "ok", "required": false },
        { "name": "recompetes", "status": "ok", "required": false },
        { "name": "forecasts", "status": "ok", "required": false },
        { "name": "agency_detail", "status": "empty", "required": false },
        { "name": "sba_goaling", "status": "empty", "required": false }
      ]
    }
  }
} as const;

/**
 * The same report as Ask Mindy's intelligence gate publishes it: led by a checked decision ("What to pursue").
 * Synthetic wording at real lengths (two pursuits, one with a barrier, one without; also-consider; ruled out;
 * gaps), so the print checks cover the brief the customer reads first.
 */
export const FULL_REPORT_WITH_DECISION = {
  ...FULL_REPORT,
  payload: {
    ...FULL_REPORT.payload,
    decision: {
      headline: 'Two Florida janitorial recompetes are worth pursuing in the next 12 months; the strongest is the FAA West Palm Beach custodial contract, a small-business set-aside expiring in September 2027.',
      pursuits: [
        {
          contract_id: 'fixture-pursuit-1',
          title: 'FAA West Palm Beach ATCT custodial services',
          why: [
            'Work is in West Palm Beach, FL (place of performance on the award record).',
            'Janitorial PSC S201 matches the work you described.',
            'Previously awarded as a total small-business set-aside; expires 2027-09-30, inside your capture window.',
          ],
          barrier: 'Your small-business status for NAICS 561720 is not on file in your Vault profile.',
          next_move: 'Confirm your size status in SAM.gov, then request the current performance work statement from the FAA contracting office listed under Who to call.',
        },
        {
          contract_id: 'fixture-pursuit-2',
          title: 'VA Bay Pines Healthcare System environmental services',
          why: ['Work is in Bay Pines, FL.', 'PSC S201; full and open competition on the last award.'],
          barrier: null,
          next_move: 'Ask the VA small-business liaison whether the recompete will be set aside, and register for the industry day if one is announced.',
        },
      ],
      also_consider: ['NASA Kennedy Space Center facilities support (janitorial is one task area of a larger base-operations contract).'],
      ruled_out: '5 of 7 recompetes: 2 are performed in Gulfport, MS and Washington, DC despite a Florida state field; 2 are AbilityOne mandatory-source awards that are not competed; 1 is grounds maintenance, not janitorial.',
      gaps: ['Your set-aside eligibility (size and socioeconomic status) is not on file.', 'Incumbent pricing is not available from the award records.'],
    },
  },
} as const;
