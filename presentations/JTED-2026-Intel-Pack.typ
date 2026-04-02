// JTED 2026 A/E/C Federal Contracting Intel Pack
// Built with Typst for proper page control

#set page(
  paper: "us-letter",
  margin: (x: 0.75in, y: 0.75in),
  footer: context [
    #line(length: 100%, stroke: 0.5pt + rgb("#e5e7eb"))
    #v(4pt)
    #grid(
      columns: (1fr, auto, 1fr),
      align(left)[#text(size: 8pt, fill: rgb("#6b7280"))[GovCon Giants]],
      align(center)[#text(size: 8pt, fill: rgb("#6b7280"))[#counter(page).display()]],
      align(right)[#text(size: 8pt, fill: rgb("#7c3aed"), weight: "bold")[Get more intel at shop.govcongiants.org]]
    )
  ]
)

#set text(font: "Helvetica Neue", size: 10pt)
#set par(justify: true, leading: 0.65em)

// Figure styling - caption below, proper spacing
#set figure(gap: 1em)
#show figure.caption: it => {
  set text(size: 9pt, fill: rgb("#374151"))
  set par(justify: true)
  v(0.5em)
  it.body
}

// Colors
#let navy = rgb("#1e3a8a")
#let purple = rgb("#7c3aed")
#let green = rgb("#059669")
#let amber = rgb("#f59e0b")
#let red = rgb("#dc2626")

// ============================================
// COVER PAGE
// ============================================

#align(center)[
  #v(0.5in)

  #grid(
    columns: 2,
    gutter: 0.5in,
    align(center + horizon)[#image("GovconGiants-logo.png", width: 1.2in)],
    align(center + horizon)[#image("SAME-Tampa-Logo.png", width: 1.5in)]
  )

  #v(0.4in)

  #rect(fill: purple.lighten(80%), radius: 8pt, inset: 12pt)[
    #text(size: 11pt, weight: "bold", fill: purple)[APRIL 2026 INTELLIGENCE BRIEFING]
  ]

  #v(0.5in)

  #text(size: 32pt, weight: "black", fill: navy)[
    A/E/C Federal Contracting\ Intel Pack
  ]

  #v(0.3in)

  #text(size: 14pt, fill: gray)[
    Actionable Data for NAICS 236220, 237xxx, 541330
  ]

  #v(0.5in)

  #rect(fill: navy, radius: 8pt, inset: 16pt)[
    #text(fill: white, size: 11pt)[
      Prepared for *JTED 2026 AEC Industry Day*\
      MacDill AFB | April 1, 2026
    ]
  ]

  #v(0.8in)

  #grid(
    columns: 4,
    gutter: 0.5in,
    align(center)[
      #text(size: 24pt, weight: "black", fill: green)[\$18.7B+]
      #text(size: 9pt, fill: gray)[\ A/E/C Contract Volume]
    ],
    align(center)[
      #text(size: 24pt, weight: "black", fill: purple)[15]
      #text(size: 9pt, fill: gray)[\ Expiring Contracts]
    ],
    align(center)[
      #text(size: 24pt, weight: "black", fill: navy)[5]
      #text(size: 9pt, fill: gray)[\ Teaming Plays]
    ],
    align(center)[
      #text(size: 24pt, weight: "black", fill: amber)[4]
      #text(size: 9pt, fill: gray)[\ AI Prompts]
    ],
  )

  #v(1in)

  #text(size: 9pt, fill: gray)[govcongiants.org]
]

// ============================================
// SECTION 1: EXPIRING CONTRACTS
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[1]]
  #h(0.2in)15 Expiring A/E/C Contracts Worth Pursuing
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.2in)

#text(fill: gray)[5 per category: Architecture (541330), Engineering (237xxx), Construction (236220). All CONUS, \$8M-\$67M range.]

#v(0.3in)

// Contract helper function
#let contract(title, number, agency, incumbent, value, naics, location, why) = {
  rect(fill: rgb("#f8fafc"), radius: 8pt, inset: 14pt, width: 100%, stroke: (left: 4pt + purple))[
    #text(size: 12pt, weight: "bold", fill: navy)[#title]

    #v(0.1in)

    #grid(
      columns: 2,
      gutter: 8pt,
      [*Contract \#:* #number], [*Agency:* #agency],
      [*Incumbent:* #incumbent], [*Value:* #text(fill: green, weight: "bold")[#value]],
      [*NAICS:* #naics], [*Location:* #location],
    )

    #v(0.1in)

    #rect(fill: amber.lighten(80%), radius: 6pt, inset: 10pt, width: 100%)[
      #text(weight: "bold", fill: rgb("#92400e"))[Why Pursue:]
      #text(fill: rgb("#78350f"), size: 9.5pt)[\ #why]
    ]
  ]
  v(0.2in)
}

// ---- ARCHITECTURE (541330) - 5 Contracts ----

#contract(
  "GSA PBS Region 4 A/E Services",
  "47PF0025R0001",
  "General Services Administration",
  "AECOM Technical Services",
  "$24.5 Million",
  "541330",
  "Atlanta, GA",
  "GSA PBS Southeast regional A/E IDIQ. Multiple task orders for courthouse and federal building design. Small business teaming opportunities on each task order."
)

#contract(
  "VA VISN 8 A/E Design Services",
  "36C24825R0012",
  "Dept of Veterans Affairs",
  "HDR Architecture Inc",
  "$18.7 Million",
  "541330",
  "Tampa, FL",
  "VA healthcare facility design across Florida. PACT Act funding driving demand. SDVOSB/VOSB teaming preferred."
)

#contract(
  "USACE Jacksonville A/E MATOC",
  "W912EP24R0008",
  "Dept of Defense (USACE)",
  "Jacobs Engineering",
  "$45 Million",
  "541330",
  "Jacksonville, FL",
  "Civil works and military construction design. Multiple task orders annually. Strong small business subcontracting goals."
)

#pagebreak()

#contract(
  "FAA Southeast Facilities Design",
  "692M15-25-R-00034",
  "Federal Aviation Administration",
  "Burns & McDonnell",
  "$12.8 Million",
  "541330",
  "College Park, GA",
  "Air traffic control and navigation facility design. Specialized MEP and security design opportunities."
)

#contract(
  "IHS Phoenix Area A/E Services",
  "75H70425R00015",
  "Indian Health Service",
  "Tetra Tech Inc",
  "$8.5 Million",
  "541330",
  "Phoenix, AZ",
  "Healthcare facility design for tribal communities. 8(a) and Native-owned business teaming strongly preferred."
)

// ---- ENGINEERING/HEAVY CIVIL (237xxx) - 5 Contracts ----

#contract(
  "USACE Mobile District Dredging",
  "W91278-25-R-0014",
  "Dept of Defense (USACE)",
  "Great Lakes Dredge & Dock",
  "$38 Million",
  "237990",
  "Mobile, AL",
  "Navigation channel maintenance. Heavy civil contractors with marine equipment in demand. Ongoing annual requirement."
)

#contract(
  "FDOT I-4 Interchange Improvements",
  "FPN 43850715201",
  "Florida DOT (Federal-Aid)",
  "Archer Western Construction",
  "$67 Million",
  "237310",
  "Orlando, FL",
  "BIL-funded highway work. DBE subcontracting requirements. Concrete, paving, and signage opportunities."
)

#pagebreak()

#contract(
  "USACE Savannah Harbor Deepening",
  "W912HP24C0018",
  "Dept of Defense (USACE)",
  "Weeks Marine Inc",
  "$52 Million",
  "237990",
  "Savannah, GA",
  "Port infrastructure expansion. Marine construction and environmental mitigation subs needed."
)

#contract(
  "GSA PBS Courthouse Site Work",
  "47PF0024C0089",
  "General Services Administration",
  "Brasfield & Gorrie",
  "$28 Million",
  "237110",
  "Nashville, TN",
  "Federal courthouse site preparation and utilities. Excavation, grading, and underground utilities work."
)

#contract(
  "NPS Everglades Trail Restoration",
  "P25PS00412",
  "National Park Service",
  "Environmental Chemical Corp",
  "$15.5 Million",
  "237310",
  "Homestead, FL",
  "Trail and boardwalk construction in sensitive environment. 8(a) and small business set-aside likely for recompete."
)

// ---- CONSTRUCTION (236220) - 5 Contracts ----

#contract(
  "VA Bay Pines Clinic Expansion",
  "36C24825C0034",
  "Dept of Veterans Affairs",
  "Robins & Morton",
  "$42 Million",
  "236220",
  "Bay Pines, FL",
  "Outpatient clinic expansion. Medical construction specialty required. SDVOSB teaming requirements on all VA work."
)

#pagebreak()

#contract(
  "GSA Orlando Federal Building HVAC",
  "47PF0025C0067",
  "General Services Administration",
  "Hensel Phelps Construction",
  "$31 Million",
  "236220",
  "Orlando, FL",
  "Major HVAC modernization. MEP subcontractors needed. Energy efficiency upgrades create specialty trade opportunities."
)

#contract(
  "USACE MacDill Hangar Renovation",
  "W912EP25C0045",
  "Dept of Defense (USACE)",
  "Harper Construction Co",
  "$27 Million",
  "236220",
  "Tampa, FL",
  "Aircraft maintenance facility work. Local to JTED attendees. Security clearance may be required."
)

#contract(
  "BOP Coleman Complex Maintenance",
  "15B30125C0008",
  "Bureau of Prisons",
  "Conti Federal Services",
  "$19.5 Million",
  "236220",
  "Coleman, FL",
  "Federal prison facility maintenance and repair. Ongoing IDIQ with multiple task orders annually."
)

#contract(
  "USCG Sector St. Petersburg Facilities",
  "70Z08025C0012",
  "U.S. Coast Guard",
  "RQ Construction LLC",
  "$22 Million",
  "236220",
  "St. Petersburg, FL",
  "Coast Guard station renovation. Waterfront construction experience valuable. Small business participation goals."
)

#pagebreak()

// ============================================
// SECTION 2: TEAMING PLAYS
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[2]]
  #h(0.2in)5 Teaming Plays with Word-for-Word Scripts
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.3in)

#let teaming-play(letter, title, primes, script) = {
  rect(fill: rgb("#f0fdf4"), radius: 8pt, inset: 14pt, width: 100%, stroke: 2pt + rgb("#86efac"))[
    #grid(
      columns: (auto, 1fr),
      gutter: 10pt,
      box(fill: green, radius: 50%, inset: 8pt)[#text(fill: white, weight: "bold")[#letter]],
      text(size: 13pt, weight: "bold", fill: rgb("#166534"))[#title]
    )

    #v(0.15in)

    #rect(fill: white, radius: 6pt, inset: 10pt, width: 100%)[
      #text(weight: "bold", fill: green)[Primes to Approach:]
      #text(size: 10pt)[\ #primes]
    ]

    #v(0.1in)

    #rect(fill: navy, radius: 6pt, inset: 12pt, width: 100%)[
      #text(fill: white, style: "italic", size: 10pt)["#script"]
    ]
  ]
  v(0.25in)
}

#teaming-play(
  "A",
  "VA Healthcare Construction",
  "Clark Construction (SBLO: Novelette Josephs - novelette.josephs\@clarkconstruction.com), Walsh-Turner JV, McCarthy Building Companies",
  "Hi, I'm [Name] from [Company]. We specialize in [MEP/fire protection/medical gas systems] and we've seen you're doing significant VA medical work. We're SDVOSB certified and looking to support your small business subcontracting goals. Who handles your teaming arrangements?"
)

#teaming-play(
  "B",
  "DHS Border Infrastructure",
  "Fisher Sand & Gravel, Spencer Construction, Southwest Valley Constructors",
  "We noticed your team is executing major DHS border infrastructure. We provide [concrete/electrical/security systems] and have capacity to support your timeline. Can we discuss how we might fit into your subcontracting plan?"
)

#teaming-play(
  "C",
  "USACE Heavy Civil / Data Centers",
  "Hensel Phelps (\$1.2B fed contracts), Balfour Beatty, Kiewit, DPR Construction",
  "Your data center and mission-critical facility work aligns with our [electrical/HVAC/low-voltage] capabilities. We're interested in supporting USACE projects. What's the best way to get on your approved subcontractor list?"
)

#pagebreak()

#teaming-play(
  "D",
  "NAVFAC Pacific Construction",
  "SLSCO Ltd, Nan Inc, Black & Veatch, Granite Construction",
  "We've been tracking the Indo-Pacific construction buildup and noticed your Pacific theater presence. We have [airfield paving/utilities/structural] experience and can mobilize for overseas work. Are you looking for specialty subs on upcoming NAVFAC work?"
)

#teaming-play(
  "E",
  "A/E Services to Primes",
  "AECOM (Supplier Portal: aecom.ayrus.com), Jacobs Engineering (SAP Ariba), HDR, Burns & McDonnell",
  "Hi, we're an 8(a)/SDVOSB/HUBZone A/E firm specializing in [civil/structural/MEP design]. We're looking to team on MATOC task orders where our set-aside status can help your proposal. Do you have any upcoming task orders where small business participation would strengthen your bid?"
)

#v(0.3in)

#rect(fill: amber.lighten(80%), radius: 8pt, inset: 16pt, width: 100%)[
  #text(weight: "bold", fill: rgb("#92400e"))[Pro Tips for Industry Day Conversations]

  #v(0.1in)

  - *Bring capability statements* — One page, not a brochure
  - *Know their current contracts* — Reference specific project names
  - *Ask about pain points* — "What trades are you having trouble finding?"
  - *Follow up within 48 hours* — Connect on LinkedIn same day, email Monday
  - *Don't pitch at the booth* — Schedule a follow-up call instead
]

#pagebreak()

// ============================================
// SECTION 3: SAM.GOV ALERTS
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[3]]
  #h(0.2in)How to Set Up SAM.gov Alerts
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.3in)

#let step(num, title, content) = {
  rect(fill: rgb("#f8fafc"), radius: 8pt, inset: 12pt, width: 100%)[
    #grid(
      columns: (auto, 1fr),
      gutter: 12pt,
      box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, weight: "bold")[#num]],
      [
        #text(size: 11pt, weight: "bold", fill: navy)[#title]
        #v(0.08in)
        #text(fill: gray, size: 10pt)[#content]
      ]
    )
  ]
  v(0.15in)
}

#step("1", "Log in to SAM.gov", [Go to sam.gov and sign in with your Login.gov account. If you don't have one, create it first.])

#step("2", "Navigate to Contract Opportunities", [Click "Contract Opportunities" in the main navigation, then "Search Contract Opportunities."])

#step("3", "Configure Your Filters", [
  - *NAICS Code:* Enter 236220, 237310, or 541330
  - *Set-Aside:* Select your eligibility (SBA, 8(a), SDVOSB, etc.)
  - *Posted Date:* Last 30 days
  - *Status:* Active opportunities only
])

#step("4", "Save Your Search", [Click "Save Search" button. Name it descriptively (e.g., "Construction SB Set-Asides").])

#step("5", "Enable Email Alerts", [In your saved search settings, toggle on "Email me when new results match this search."])

#pagebreak()

*Recommended Saved Searches for A/E/C:*

#v(0.2in)

#table(
  columns: (1fr, 2fr),
  stroke: 0.5pt + gray,
  inset: 8pt,
  [*Search Name*], [*Filters*],
  [USACE Construction SB], [NAICS 236220 + Agency: USACE + Set-Aside: SB],
  [NAVFAC Southeast], [NAICS 236220, 237310 + Agency contains "NAVFAC"],
  [VA Healthcare Construction], [VA + NAICS 236220],
  [Sources Sought AEC], [Notice Type: Sources Sought only],
  [Competitor Watch], [Your competitors' names as keywords],
)

#v(0.3in)

#rect(fill: amber.lighten(80%), radius: 8pt, inset: 16pt, width: 100%)[
  #text(weight: "bold", fill: rgb("#92400e"))[Pro Tips]

  #v(0.1in)

  - *Separate Sources Sought from Solicitations* — Sources Sought require different responses and timing
  - *Set up competitor alerts* — Use competitor names as keywords to see what they're bidding
  - *Include "Design-Build" and "DB"* — These won't always have NAICS 236220
  - *Check daily* — Email alerts can be delayed; check SAM.gov directly each morning
]

#pagebreak()

// ============================================
// SECTION 4: USASPENDING RECOMPETE TRACKING
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[4]]
  #h(0.2in)How to Track Recompetes on USASpending
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.3in)

#step("1", "Go to USASpending.gov", [Navigate to usaspending.gov and click "Award Search" in the top menu.])

#step("2", "Filter by NAICS", [In the left sidebar, expand "NAICS Code" and enter your codes (236220, 237xxx, 541330).])

#step("3", "Filter by Award Type", [Select "Contracts" and optionally filter by "IDV" for IDIQ vehicles.])

#step("4", "Sort by End Date", [Click the "Current End Date" column header to sort contracts by expiration date.])

#step("5", "Export to CSV", [Click "Download" to export results. Open in Excel for analysis.])

#v(0.2in)

*What to Look For:*

- Contracts ending in 12-18 months (prime recompete window)
- High-value contracts with single incumbent (vulnerable to competition)
- Contracts with options remaining (may extend, but still worth tracking)
- Multiple task orders to same contractor (relationship opportunity)

#v(0.2in)

#rect(fill: purple.lighten(90%), radius: 8pt, inset: 16pt, width: 100%)[
  #text(weight: "bold", fill: purple)[Shortcut: Use Our Recompete Tracker]

  #v(0.1in)

  #text(size: 10pt)[
    We've built a tool that does this automatically. Get expiring contracts filtered by NAICS, agency, and location at *shop.govcongiants.org/recompete*
  ]
]

#pagebreak()

// ============================================
// VISUAL REFERENCE: SAM.GOV & USASPENDING SCREENSHOTS
// ============================================

#text(size: 16pt, weight: "bold", fill: navy)[Visual Reference: SAM.gov & USASpending Interfaces]

#line(length: 100%, stroke: 2pt + purple)

#v(0.15in)

#block(breakable: false)[
  #image("intel-pack-images/page-21.png", width: 100%, height: 7.5in)

  #v(0.1in)

  #text(size: 9pt, fill: rgb("#374151"))[*SAM.gov Sources Sought Search.* Filter by "Sources Sought" notice type to find early-stage opportunities.]
]

#pagebreak()

#block(breakable: false)[
  #image("intel-pack-images/page-15.png", width: 100%)

  #v(0.1in)

  #text(size: 9pt, fill: rgb("#374151"))[*Early-Stage Notice Types.* Sources Sought asks "who can do this?" — respond with capability. Special Notice announces events or drafts. RFI requests pricing or approach input.]
]

#pagebreak()

#block(breakable: false)[
  #image("intel-pack-images/page-16.png", width: 100%)

  #v(0.1in)

  #text(size: 9pt, fill: rgb("#374151"))[*Bid-Stage Notice Types.* Presolicitation means a solicitation is coming — prep your team. Combined Synopsis/Solicitation is live with instructions. Solicitation is the formal RFP/RFQ.]
]

#pagebreak()

// ============================================
// SECTION 5: TOP 10 SAT AGENCIES
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[5]]
  #h(0.2in)Top 10 SAT Offices for Construction
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.15in)

#rect(fill: purple.lighten(90%), radius: 6pt, inset: 10pt, width: 100%)[
  #text(weight: "bold", fill: purple)[What is SAT?]
  #text(size: 9.5pt, fill: gray)[ — *Simplified Acquisition Threshold* is the \$250K limit (or \$350K for construction) below which agencies can use streamlined procurement. Fewer requirements, faster awards, less competition. Perfect entry point for new contractors.]
]

#v(0.15in)

#text(fill: gray, size: 9.5pt)[Civilian agencies often do MORE SAT construction than Defense. Target these offices:]

#v(0.2in)

#table(
  columns: (auto, 1.5fr, auto, 1.2fr),
  stroke: 0.5pt + gray,
  inset: 8pt,
  fill: (col, row) => if row == 0 { purple } else if calc.odd(row) { rgb("#f8fafc") } else { white },
  text(fill: white, weight: "bold", size: 9pt)[Rank], text(fill: white, weight: "bold", size: 9pt)[Agency], text(fill: white, weight: "bold", size: 9pt)[SAT Vol], text(fill: white, weight: "bold", size: 9pt)[Best Offices],
  [1], [GSA PBS (Civilian)], [\$210M+], [Region 4, Region 9],
  [2], [VA CFM (Civilian)], [\$185M+], [VISN 8, VISN 16, VISN 22],
  [3], [Dept of Interior], [\$125M+], [BLM, NPS, BIA],
  [4], [Dept of Agriculture], [\$95M+], [Forest Service, ARS],
  [5], [USACE (Defense)], [\$180M+], [Jacksonville, Savannah],
  [6], [HHS/IHS (Civilian)], [\$75M+], [Phoenix, Albuquerque],
  [7], [FAA (Civilian)], [\$65M+], [Southwest, Southern],
  [8], [Dept of Justice], [\$55M+], [BOP Regions],
  [9], [NAVFAC (Defense)], [\$95M+], [Southeast, Mid-Atlantic],
  [10], [Dept of State], [\$45M+], [OBO domestic],
)

#v(0.2in)

*SAM.gov Search Prefixes:*

#grid(
  columns: 2,
  gutter: 8pt,
  [- `"GS-" construction` — GSA PBS],
  [- `"VA2" construction` — VA CFM],
  [- `Interior construction` — DOI],
  [- `"AG-" construction` — USDA],
  [- `"W912" construction` — USACE],
  [- `IHS construction` — HHS/IHS],
)

#v(0.15in)

#rect(fill: green.lighten(90%), radius: 8pt, inset: 14pt, width: 100%)[
  #text(weight: "bold", fill: green)[Why SAT Matters]

  #v(0.08in)

  #text(size: 9.5pt)[
  - *5-10 day* typical award timeline (vs 60-90 for full competition)
  - *No* cost accounting system required
  - *Great* past performance builder for larger contracts
  ]
]

#pagebreak()

// ============================================
// SECTION 6: SOURCES SOUGHT TEMPLATE
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[6]]
  #h(0.2in)Sources Sought Response Template
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.2in)

#text(fill: gray)[Copy, paste, fill in brackets, submit in under 30 minutes.]

#v(0.2in)

#rect(fill: rgb("#1e293b"), radius: 8pt, inset: 16pt, width: 100%)[
  #text(fill: rgb("#e2e8f0"), size: 9.5pt, font: "Monaco")[
*Subject: Sources Sought Response - [Solicitation Number]*

[Company Name] is a [size status] [type of business] specializing in [core services] for federal, state, and commercial clients. Founded in [year], we are headquartered in [City, State] and hold certifications including [8(a)/SDVOSB/HUBZone/WOSB as applicable]. We are responding to this Sources Sought notice to express our interest and demonstrate our capability to perform this requirement.

*1. Company Information*
- Company Name: [Your Company]
- CAGE Code: [XXXXX]
- UEI: [XXXXXXXXXXXX]
- Business Size: [Small Business under NAICS XXX]
- Socioeconomic Status: [8(a), SDVOSB, HUBZone, WOSB, etc.]
- Point of Contact: [Name, Title, Email, Phone]

*2. Capability Statement*
[Company Name] has [X years] of experience providing [relevant services] to [federal/commercial clients]. Our relevant experience includes:

- [Project 1]: [Brief description, value, client]
- [Project 2]: [Brief description, value, client]
- [Project 3]: [Brief description, value, client]

*3. Relevant Experience*
We have successfully completed similar requirements for:
- [Agency/Client]: [Contract description]
- [Agency/Client]: [Contract description]

*4. Interest & Availability*
[Company Name] is interested in this requirement as a [prime/subcontractor]. We have the capacity and resources to perform this work within the anticipated timeframe.

*5. Questions/Recommendations*
[Optional: Include 1-2 thoughtful questions about scope or approach]

Attached: Capability Statement (1 page)
  ]
]

#pagebreak()

// ============================================
// SECTION 7: IDIQ/MACC VEHICLES
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[7]]
  #h(0.2in)IDIQ/MACC Vehicles Open for Bid
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.3in)

#table(
  columns: (2fr, 1fr, 1fr, 1fr),
  stroke: 0.5pt + gray,
  inset: 8pt,
  fill: (col, row) => if row == 0 { purple } else if calc.odd(row) { rgb("#f8fafc") } else { white },
  text(fill: white, weight: "bold")[Vehicle], text(fill: white, weight: "bold")[Agency], text(fill: white, weight: "bold")[Ceiling], text(fill: white, weight: "bold")[Set-Aside],
  [USACE Savannah District MATOC], [USACE], [\$400M], [Small Bus],
  [NAVFAC Washington Regional MACC], [NAVFAC], [\$249M], [Small Bus],
  [USACE Jacksonville SATOC], [USACE], [\$95M], [SB/8(a)],
  [NAVFAC SE Construction MACC], [NAVFAC], [\$500M], [Small Bus],
  [VA CFM Regional Construction], [VA], [\$200M], [SDVOSB],
  [GSA PBS Region 4 IDIQ], [GSA], [\$150M], [Small Bus],
)

#v(0.3in)

*How to Find More:*

1. Search SAM.gov for "MATOC" OR "MACC" OR "IDIQ" + your NAICS
2. Filter by "Presolicitation" and "Sources Sought" notice types
3. Check agency forecast sites (USACE, NAVFAC publish annual forecasts)
4. Review incumbents on current vehicles at USASpending.gov

#v(0.2in)

#rect(fill: amber.lighten(80%), radius: 8pt, inset: 16pt, width: 100%)[
  #text(weight: "bold", fill: rgb("#92400e"))[Vehicle Strategy]

  Getting on an IDIQ/MACC is only step one. You must then:
  - Build relationships with task order managers
  - Respond to every RFQ (even small ones) to build past performance
  - Track competitor wins to understand evaluation criteria
]

#pagebreak()

// ============================================
// SECTION 8: AI PROMPTS
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[8]]
  #h(0.2in)4 AI Prompts for GovCon
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.3in)

#let ai-prompt(num, title, prompt) = {
  rect(fill: rgb("#0f172a"), radius: 8pt, inset: 14pt, width: 100%, stroke: 2pt + purple)[
    #text(size: 11pt, weight: "bold", fill: rgb("#a78bfa"))[Prompt #num: #title]

    #v(0.1in)

    #rect(fill: rgb("#1e293b"), radius: 6pt, inset: 12pt, width: 100%)[
      #text(fill: rgb("#e2e8f0"), size: 9pt, font: "Monaco")[#prompt]
    ]
  ]
  v(0.2in)
}

#ai-prompt("1", "Analyze an RFP", [
I'm a small business contractor specializing in [YOUR SPECIALTY]. Analyze this RFP and tell me:
1. What are the key evaluation factors?
2. What past performance is required?
3. What certifications/clearances are needed?
4. Is this a good fit for a company my size?
5. What are the red flags or risks?

[PASTE RFP TEXT]
])

#ai-prompt("2", "Research a Competitor", [
Research [COMPETITOR NAME] as a federal contractor. Find:
1. Their CAGE code and business size
2. Recent federal contract awards (last 3 years)
3. Key personnel and leadership
4. Agencies they work with most
5. Strengths and potential vulnerabilities
])

#ai-prompt("3", "Draft a Capability Statement", [
Help me write a 1-page capability statement for [COMPANY NAME]. We are a [SIZE] [CERTIFICATIONS] company specializing in [SERVICES]. Our key differentiators are [DIFFERENTIATORS]. Include sections for: Company Overview, Core Capabilities, Past Performance, Certifications, and Contact Info.
])

#ai-prompt("4", "Prepare for Industry Day", [
I'm attending an industry day for [AGENCY] focused on [TOPIC]. Help me prepare:
1. 5 smart questions to ask the CO
2. Key talking points about my company
3. Research on the agency's current pain points
4. Names of potential teaming partners to look for
])

#pagebreak()

// ============================================
// SECTION 9: GLOSSARY
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[9]]
  #h(0.2in)Glossary of A/E/C Terms
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.3in)

#let glossary(term, def) = {
  grid(
    columns: (1.2in, 1fr),
    gutter: 12pt,
    text(weight: "bold", fill: purple)[#term],
    text(fill: gray, size: 9.5pt)[#def]
  )
  v(0.1in)
  line(length: 100%, stroke: 0.5pt + rgb("#e2e8f0"))
  v(0.1in)
}

#glossary("MATOC", "Multiple Award Task Order Contract - umbrella contract for construction task orders")
#glossary("MACC", "Multiple Award Construction Contract - NAVFAC's version of MATOC")
#glossary("SATOC", "Single Award Task Order Contract - one contractor per region/scope")
#glossary("IDIQ", "Indefinite Delivery/Indefinite Quantity - ceiling contract with task orders")
#glossary("SAT", "Simplified Acquisition Threshold - $350K, faster procurement rules")
#glossary("MILCON", "Military Construction - new construction on DoD installations")
#glossary("FSRM", "Facilities Sustainment, Restoration & Modernization")
#glossary("DB", "Design-Build - single contract for design and construction")
#glossary("DBB", "Design-Bid-Build - traditional separate design then construction")
#glossary("JOC", "Job Order Contract - pre-priced unit cost contracting")
#glossary("CPARS", "Contractor Performance Assessment Reporting System")
#glossary("NAICS 236220", "Commercial and Institutional Building Construction")
#glossary("NAICS 237310", "Highway, Street, and Bridge Construction")
#glossary("NAICS 541330", "Engineering Services")
#glossary("PSC", "Product Service Code - what you're providing")
#glossary("CO", "Contracting Officer - has signature authority")
#glossary("COR", "Contracting Officer's Representative - technical oversight")
#glossary("SBLO", "Small Business Liaison Officer - helps small business participation")

#pagebreak()

// ============================================
// SECTION 10: RESOURCES
// ============================================

#text(size: 18pt, weight: "bold", fill: navy)[
  #box(fill: purple, radius: 50%, inset: 8pt)[#text(fill: white, size: 12pt)[10]]
  #h(0.2in)Key Resources & Links
]

#line(length: 100%, stroke: 2pt + purple)

#v(0.3in)

#grid(
  columns: 2,
  gutter: 12pt,
  rect(fill: rgb("#f8fafc"), radius: 8pt, inset: 12pt)[
    #text(weight: "bold", fill: navy)[Contract Opportunities]
    #v(0.05in)
    #text(size: 9pt, fill: purple)[sam.gov/search]
  ],
  rect(fill: rgb("#f8fafc"), radius: 8pt, inset: 12pt)[
    #text(weight: "bold", fill: navy)[Award Data]
    #v(0.05in)
    #text(size: 9pt, fill: purple)[usaspending.gov]
  ],
  rect(fill: rgb("#f8fafc"), radius: 8pt, inset: 12pt)[
    #text(weight: "bold", fill: navy)[USACE Forecast]
    #v(0.05in)
    #text(size: 9pt, fill: purple)[usace.army.mil/Business-With-Us]
  ],
  rect(fill: rgb("#f8fafc"), radius: 8pt, inset: 12pt)[
    #text(weight: "bold", fill: navy)[NAVFAC Contracts]
    #v(0.05in)
    #text(size: 9pt, fill: purple)[navfac.navy.mil/Business]
  ],
  rect(fill: rgb("#f8fafc"), radius: 8pt, inset: 12pt)[
    #text(weight: "bold", fill: navy)[VA Construction]
    #v(0.05in)
    #text(size: 9pt, fill: purple)[cfm.va.gov/til/contracting]
  ],
  rect(fill: rgb("#f8fafc"), radius: 8pt, inset: 12pt)[
    #text(weight: "bold", fill: navy)[GSA PBS]
    #v(0.05in)
    #text(size: 9pt, fill: purple)[gsa.gov/real-estate]
  ],
)

#v(0.4in)

#rect(fill: purple, radius: 12pt, inset: 20pt, width: 100%)[
  #align(center)[
    #text(fill: white, size: 16pt, weight: "bold")[Need More Help?]

    #v(0.15in)

    #text(fill: white, size: 11pt)[
      *Free Training Videos:* youtube.com/\@govcongiants \
      *Market Intelligence Tools:* shop.govcongiants.org \
      *Free Beginner Course:* govcongiants.org/free-course
    ]

    #v(0.2in)

    #text(fill: white.darken(20%), size: 10pt)[
      Questions? Email hello\@govconedu.com or call 786-477-0477
    ]
  ]
]

#v(0.5in)

#align(center)[
  #text(size: 9pt, fill: gray)[
    © 2026 GovCon Giants. Data sourced from USASpending.gov and SAM.gov. \
    This guide is for informational purposes. Always verify data before bidding.
  ]
]
