# Human review package — Data Core hidden-opportunity benchmark v1

**Every label below is an AI judgment (two Claude reviewers + Claude adjudication). None has been checked by a person.** Your job: accept or reject each proposed label. Fill the last three columns of `review_sheet.csv`, then run `python3 -I scripts/score.py --labels human` after copying your labels into `labels.jsonl` → `human_label` (or hand the CSV back and Agent 4 will do it).

## What is in it
- **R01–R11**: the 11 opportunities the audit says traditional search missed and the Data Core recovered.
- **G01–G06**: lane items the evidence gate KEPT whose quoted sentence lies outside the excerpt the AI reviewers saw. Their AI label may reflect missing evidence, not wrong evidence. These decide whether the gate's false positives are real.
- **S01–S30**: 30 labeled notices chosen at random: all 325 labeled items, minus those 11 solicitations, sorted by `sha256("agent4-review-v1|"+item_id)`, first 30 taken. Anyone can re-derive the same 30.

## Labels
- **FIT**: the main work bought is this business's service.
- **PARTIAL**: the service is a real, explicitly stated component of a bigger job (they could prime or sub that part).
- **NO**: something else, or no evidence of the service. Do not credit topic similarity or codes alone.

Open the SAM link when the excerpt is not enough. The excerpt is the gate's quoted sentence when one exists, otherwise the start of the text the AI reviewers saw.

### R01 · steelbldg · proposed **FIT**
**Minor Construction / Sustainability, Repair and Maintenance** (W519TC-26-Q-JOC1, 236220/Y1QA) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/a08792cfdd044de39d37cee81b3849b8/view)
- Traditional: Title "Minor Construction / Sustainability, Repair and Maintenance" names no work; filed 236220 general building
- Semantic: Meaning rank #12 of 9,929 (cosine 0.387) for the customer's own description
- Evidence: "SCOPE OF WORK 50'x100'x18' Red Iron Storage Facility" — “Excavate precise footprints for all concrete slabs and footings, including:”
- Reviewer 1: FIT (install 50x100 red iron storage facility) · Reviewer 2: FIT (install 50x100x18 red iron steel storage facility)
- [ ] Accept  [ ] Reject → correct label: ____

### R02 · steelbldg · proposed **FIT**
**F-15 Aerospace Ground Equipment (AGE) Facility, Vandenberg SFB** (W912PL27S0005, 236220/Y1JZ) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/ab6b9a4a51a94fc2be0fee597c174c6e/view)
- Traditional: Title names the aircraft program (F-15 AGE facility), not the building; filed 236220
- Semantic: Meaning rank #4 of 9,929 (cosine 0.422) for the customer's own description
- Evidence: "pre-engineered metal warehouse storage building ... Pre-Engineered Metal Buildings (PEMB)" — “Structural Foundations & Slabs: Placement of heavy structural footings and thick concrete slabs-on-grade designed to withstand high concentrated floor loads from heavy wheeled equipment.”
- Reviewer 1: FIT (construct pre-engineered metal warehouse storage building) · Reviewer 2: FIT (construct pre-engineered metal warehouse storage building)
- [ ] Accept  [ ] Reject → correct label: ____

### R03 · steelbldg · proposed **PARTIAL**
**Outdoor Fitness Facility, Building 389— Supply, Delivery, and Limited Installation Support** (HARBSS-2027-01, 236220/5670) · DEPT OF DEFENSE / DEPT OF THE AIR FORCE · [SAM](https://sam.gov/opp/c4094dc11366430dbdaa397ffc28e96c/view)
- Traditional: Title says Outdoor Fitness Facility; filed 236220 / PSC 5670
- Semantic: Meaning rank #15 of 9,929 (cosine 0.384) for the customer's own description
- Evidence: "PRE-ENGINEERED BUILDING (PEB): The Contractor shall ... provide ... pre-engineered shop drawings and all materials" — “e) Standing Seam Metal Roof (SSMR).”
- Reviewer 1: PARTIAL (supply pre-engineered steel building and install fence) · Reviewer 2: PARTIAL (supply pre-engineered building structure; RED HORSE erects)
- [ ] Accept  [ ] Reject → correct label: ____

### R04 · steelbldg · proposed **PARTIAL**
**88th RD US ARMY RESERVE CENTER MONCLOVA, OH CONSTRUCT STORAGE BUILDING AND REPAIR MEP LOTS** (W912EK27BA011, 236220/Z2QA) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/1ba6bd54228444fe91bd10ab7d007971/view)
- Traditional: "Storage building" with no material named; MEP-led title; filed 236220
- Semantic: Meaning rank #30 of 9,929 (cosine 0.365) for the customer's own description
- Evidence: "installation of pre-fabricated metal storage building" — “placement of asphalt and concrete;”
- Reviewer 1: PARTIAL (installation of pre-fabricated metal storage building) · Reviewer 2: PARTIAL (installation of pre-fabricated metal storage building within larger project)
- [ ] Accept  [ ] Reject → correct label: ____

### R05 · steelbldg · proposed **PARTIAL**
**P758 Machinery Control Development Center, Philadelphia Navy Yard, PA** (N4008527R0047, 236220/Y1JB) · DEPT OF DEFENSE / DEPT OF THE NAVY · [SAM](https://sam.gov/opp/210d9a8ca71f45e3ba10457201d1f3d9/view)
- Traditional: Large lab project; title is a facility name; filed 236220
- Semantic: Meaning rank #3 of 9,929 (cosine 0.433) for the customer's own description
- Evidence: "structural steel framing ... insulated metal panel exterior skin" — “Primary facilities include structural steel framing, concrete foundations and structural slab, elevated floor slabs, masonry and insulated metal panel exterior skin, built-up roofing system, HVAC, plumbing, and fire protection systems.”
- Reviewer 1: NO (multi-story lab construction) · Reviewer 2: PARTIAL (multi-story facility with structural steel and metal panel skin) · adjudicated PARTIAL
- [ ] Accept  [ ] Reject → correct label: ____

### R06 · hvac · proposed **PARTIAL**
**FCI MCKEAN CAMP ADMIN AIR HANDLING UNIT & INSTALLATION** (15B20927Q00000002, 333415/4120) · JUSTICE, DEPARTMENT OF / FEDERAL PRISON SYSTEM / BUREAU OF PRISONS · [SAM](https://sam.gov/opp/2cf886b2e3c7436a8592de42be610924/view)
- Traditional: Filed 333415 / PSC 4120 (equipment), not an HVAC service code
- Semantic: Meaning rank #30 of 9,929 (cosine 0.433) for the customer's own description
- Evidence: AHU supply and installation — “FCI McKean Camp Admin Air Handler Supply & Installation Project # 26Z2BF5 Solicitation # 15B20927Q00000002 The Federal Bureau of Prisons, Federal Correction Institution (FCI) McKean, Lewis Run, Pennsylvania, herein issues solicitation 15B20927Q00000002 for the requirements of: FCI MCKEAN CAMP ADMIN AIR HANDING UNIT & INSTALLATION FY”
- Reviewer 1: PARTIAL (air handling unit supply and installation, no maintenance) · Reviewer 2: PARTIAL (air handling unit supply and installation; equipment install, not maintenance)
- [ ] Accept  [ ] Reject → correct label: ____

### R07 · hvac · proposed **PARTIAL**
**CRAC Units Replacement for MCE 1211 at GFAFB, ND** (FA465927QM001, 236220/N099) · DEPT OF DEFENSE / DEPT OF THE AIR FORCE · [SAM](https://sam.gov/opp/28d5fb2c970b45f6a2ace9384f20f600/view)
- Traditional: Filed 236220 / N099; title says CRAC units, no HVAC keyword in the trade list used
- Semantic: Meaning rank #13 of 9,929 (cosine 0.474) for the customer's own description
- Evidence: computer room air conditioner replacement — “PREVENTATIVE MAINTENANCE (PM): The contractor shall perform all scheduled PM services within industry standards of the American Society of Heating, Refrigerating and Air-Conditioning Engineers (ASHRAE) guidelines and OEM specifications.”
- Reviewer 1: PARTIAL (CRAC unit replacement) · Reviewer 2: PARTIAL (computer room air conditioner replacement)
- [ ] Accept  [ ] Reject → correct label: ____

### R08 · hvac · proposed **PARTIAL**
**Building SH50 Replace Water Source Heat Pump** (N4008527R9004, 236220/Z2JZ) · DEPT OF DEFENSE / DEPT OF THE NAVY · [SAM](https://sam.gov/opp/0f2a3d5c74ec43b7a90753a7ebb43676/view)
- Traditional: Filed 236220 / Z2JZ; title "Replace Water Source Heat Pump"
- Semantic: Meaning rank #2 of 9,929 (cosine 0.533) for the customer's own description
- Evidence: "COMPLETE MECHANICAL REPLACEMENT OF THE HVAC SYSTEMS SERVING BUILDING HP259" — “ REQUIRED TO ACCOMPLISH THE FOLLOWING: COMPLETE MECHANICAL REPLACEMENT OF THE HVAC SYSTEMS SERVING BUILDING HP259, INCLUDING THE INSTALLATION OF A NEW 20-TON SPLIT SYSTEM AIR HANDLING UNIT (AHU-1) AND MATCHING OUTDOOR AIR-COOLED CONDENSING UNIT (CU-1), DUCTWORK CONNECTIONS, CONDENSATE DRAIN LINES, REFRIGERANT PIPING, AND ASSOCIATED ELECTRICAL AND CONTROL SYSTEMS.”
- Reviewer 1: PARTIAL (HVAC split system replacement, install only) · Reviewer 2: PARTIAL (HVAC mechanical replacement, new AHU and condensing unit)
- [ ] Accept  [ ] Reject → correct label: ____

### R09 · hvac · proposed **PARTIAL**
**Cooling Tower, Roofing, and Structural Construction** (2031ZA26R00027, 236220/Z2EC) · TREASURY, DEPARTMENT OF THE / BUREAU OF ENGRAVING AND PRINTING · [SAM](https://sam.gov/opp/1511422418e848f896a0010668d90da1/view)
- Traditional: Filed 236220 / Z2EC; title leads with cooling tower and roofing
- Semantic: Meaning rank #9 of 9,929 (cosine 0.485) for the customer's own description
- Evidence: cooling tower replacement within roofing/structural construction — “Contractor shall ensure that the project adheres to all guidelines and code, including but not limited to the International Plumbing Code (IPC), the American Society of Heating, Refrigeration, and Air Conditioning Engineers (ASHRAE) standard and guideline, the American Society of Mechanical Engineers (ASME) codes and standards, and the National Electrical Code, etc.”
- Reviewer 1: PARTIAL (cooling tower replacement construction, HVAC-adjacent) · Reviewer 2: PARTIAL (cooling tower replacement within roofing/structural construction)
- [ ] Accept  [ ] Reject → correct label: ____

### R10 · hvac · proposed **PARTIAL**
**Design/Build Maintenance and Repair Army Reserve (MRAR), Area Maintenance Support Activity (AMSA) 21, JBMDL, NJ** (W912QR26RA062, 236220/Z2JZ) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/ada6d118165a47d4aa4dd1981aef8b74/view)
- Traditional: Filed 236220 / Z2JZ; title "Design/Build Maintenance and Repair Army Reserve (MRAR)"
- Semantic: Not in the top 400 by meaning; recovered by body-text keywords (keyword layer matched)
- Evidence: "repair of the failing HVAC and electrical systems" — “The project scope includes the repair of the failing HVAC and electrical systems, the removal of non-structural interior walls to right-size rooms and create open flexible workspaces as required, the repair/replacement/upgrade of light fixtures with code compliant units, the installation of a code compliant fire alarm and suppression system, and the repair of electrical conduit distribution throug”
- Reviewer 1: PARTIAL (repair of failing HVAC and electrical systems in design-build) · Reviewer 2: PARTIAL (repair failing HVAC systems within facility repair project)
- [ ] Accept  [ ] Reject → correct label: ____

### R11 · hvac · proposed **PARTIAL**
**Cleaning C and D Towers Phoenix Main Hospital** (36C26227Q0092, 562910/F108) · VETERANS AFFAIRS, DEPARTMENT OF / VETERANS AFFAIRS, DEPARTMENT OF · [SAM](https://sam.gov/opp/32611396cf6b45a39be97c2b102093c9/view)
- Traditional: Filed 562910 / F108 (remediation)
- Semantic: Meaning rank #7 of 9,929 (cosine 0.499) for the customer's own description
- Evidence: cleaning plenums, air-handling components and ductwork — “The Contractor shall provide complete, coordinated, and documented cleaning and mold-prevention services for seven 8th-floor plenum chambers and associated air-handling components serving inpatient areas. The work shall prevent cross-contamination into patient-care spaces, support acceptable indoor air quality, and leave treated areas ready for VA inspection and acceptance. The 8th-floor plenum chambers and associated air-handling components in t”
- Reviewer 1: PARTIAL (cleaning of air-handling plenum chambers, HVAC component cleaning) · Reviewer 2: PARTIAL (cleaning plenums and air-handling components and ductwork)
- [ ] Accept  [ ] Reject → correct label: ____

### S01 · janitorial · proposed **PARTIAL**
**Window Cleaning and Maintenance** (15F06727Q0000010, 561720/S201) · JUSTICE, DEPARTMENT OF / FEDERAL BUREAU OF INVESTIGATION · [SAM](https://sam.gov/opp/e11dc80cc2494d43813ebb13c58e50b6/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #27 of 9,929 (cosine 0.369) for the customer's own description
- Evidence: “The Federal Bureau of Investigation (FBI), Criminal Justice Information Services (CJIS) Division, located in Clarksburg, West Virginia, is issuing this Request for Quotations (RFQ) for commercial Window Maintenance and Cleaning Services.”
- Reviewer 1: PARTIAL (window cleaning and maintenance only) · Reviewer 2: FIT (interior and exterior window cleaning services) · adjudicated PARTIAL
- [ ] Accept  [ ] Reject → correct label: ____

### S02 · hvac · proposed **NO**
**Repair Sanitary Waste Piping at the Mann-Grandstaff VA Medical Center** (36C26027R0021, 238220/Z1DA) · VETERANS AFFAIRS, DEPARTMENT OF / VETERANS AFFAIRS, DEPARTMENT OF · [SAM](https://sam.gov/opp/448422d8b2aa4a7fb33273befc7d52ef/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Not in the top 400 by meaning; recovered by body-text keywords
- Evidence: “The Mann-Grandstaff VA Medical Center, Spokane, WA requires labor, materials, and equipment for the repair of sanitary waste piping in Building 1 (Main Hospital) for Project 668-24-108. Please review attached Solication # 36C26027R0021 for full details and proposal submission requirements. Amendment 0001 - Posting of revised Site Vist Map Amendment 0002 - Posting of revised Attachment 6 - Limitations on Subcontracting.”
- Reviewer 1: NO (sanitary piping repair) · Reviewer 2: NO (sanitary waste piping repair)
- [ ] Accept  [ ] Reject → correct label: ____

### S03 · guards · proposed **NO**
**Food Services for the Marine Security Guard (MSG) Detachment** (19CT2027Q0001, 445/7310) · STATE, DEPARTMENT OF / STATE, DEPARTMENT OF · [SAM](https://sam.gov/opp/27a5d9ebe68640fd9cd52e889f70d147/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Not in the top 400 by meaning; recovered by body-text keywords (keyword layer matched)
- Evidence: “After contract award, the Contracting Officer shall issue a Notice to Proceed.”
- Reviewer 1: NO (food services) · Reviewer 2: NO (food services for Marine Security Guard detachment)
- [ ] Accept  [ ] Reject → correct label: ____

### S04 · guards · proposed **NO**
**Houston Privacy Screens** (192127FHOFPS0001, 238990/5660) · HOMELAND SECURITY, DEPARTMENT OF / US IMMIGRATION AND CUSTOMS ENFORCEMENT · [SAM](https://sam.gov/opp/1c02491a7ff14aab8794ca93926f414a/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #13 of 9,929 (cosine 0.385) for the customer's own description
- Evidence: “No removal, replacement, or modification of existing fence fabric, fence panels, posts, rails, gates, access-control equipment, or other site features is authorized unless specifically approved in writing by the Contracting Officer.”
- Reviewer 1: NO (privacy screen installation) · Reviewer 2: NO (install privacy screening on fencing)
- [ ] Accept  [ ] Reject → correct label: ____

### S05 · guards · proposed **NO**
**Barriers and Bunkers** (FA568227Q9001, 237990/Y1PZ) · DEPT OF DEFENSE / DEPT OF THE AIR FORCE · [SAM](https://sam.gov/opp/3ff50a179d534ec39759a1cac636fcee/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #81 of 9,929 (cosine 0.330) for the customer's own description
- Evidence: “As such we are asking interested vendors to send the contracting officer associated with this posting a capability statement/document with a breakdown of your capabilities in terms of ability to produce/procure passive defense systems, examples of said systems include but is not limited to, Bremer walls (T-Walls), Hesco barriers, jersey barriers, and fortified/hardened facilities.”
- Reviewer 1: NO (work is different from stated business; no evidence of this service) · Reviewer 2: NO (Passive defense barriers (T-walls, Hesco) supply)
- [ ] Accept  [ ] Reject → correct label: ____

### S06 · steelbldg · proposed **NO**
**Atchison Storm Sewer Separation Improvements, Atchison, Kansas** (W912DQ27BA002, 237110/Y1PZ) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/9b59625157a24de68bfea48d41dfe72c/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #79 of 9,929 (cosine 0.334) for the customer's own description
- Evidence: “The purpose of this amendment is to amend the Specifications SECTION 33 40 00 Paragraph 1.2 and Paragraph 3.1, and Section 03 42 13.00 10 Paragraph 3.3.3 (attached).The U.S. Army Corps of Engineers, Kansas City District, Intends to issue an invitation for bid (IFB) solicitation for construction activities for storm sewer separation and improvements. The work covered by this contract consists of furnishing all equipment, labor, operators, supervis”
- Reviewer 1: NO (work is different from stated business; no evidence of this service) · Reviewer 2: NO (Storm sewer separation and pavement restoration)
- [ ] Accept  [ ] Reject → correct label: ____

### S07 · steelbldg · proposed **NO**
**FCC Terre Haute Bus Center Roof and Paint Materials NOV FY27** (15B41827Q00000001, 238320/5650) · JUSTICE, DEPARTMENT OF / FEDERAL PRISON SYSTEM / BUREAU OF PRISONS · [SAM](https://sam.gov/opp/431e7a97fd194b68930b85b5afdb9386/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Not in the top 400 by meaning; recovered by body-text keywords (keyword layer matched)
- Evidence: “***CLARIFICATIONS DOCUMENT ATTACHED*** ****STATEMENT OF WORK ATTACHED (TAKES PRECEDENCE- REFER TO FOR SPECIFICATIONS*** ***CLARIFICATION AND RESPONSES WILL END ON TUESDAY, NOVEMBER 17, 2026*** Federal Correctional Complex at Terre Haute, Indiana: FCC TERRE HAUTE BUS CENTER PAINT AND ROOFING MATERIALS The Federal Correctional Complex (FCC) Terre Haute, Indiana, herein issues combined synopsis / sol”
- Reviewer 1: NO (supply of roof coating materials only) · Reviewer 2: NO (supply of roof coating materials; BOP staff perform work)
- [ ] Accept  [ ] Reject → correct label: ____

### S08 · janitorial · proposed **FIT**
**Custodial Services - Staten Island, NY (NY024)** (W15QKN26RA081, None/S201) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/59ddeff36a7f4d7e84e21ed9152c2b0a/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #19 of 9,929 (cosine 0.377) for the customer's own description
- Evidence: “The Army Contracting Command New Jersey in support of the 99th Readiness Division has a requirement for Custodial Services.”
- Reviewer 1: FIT (custodial services NAICS 561720) · Reviewer 2: FIT (custodial services, Staten Island reserve facility)
- [ ] Accept  [ ] Reject → correct label: ____

### S09 · steelbldg · proposed **NO**
**Robins RAPID Construction OTA Progressive Design Build Fiber Replacement** (FA8501-27-RAPID-CIRCUIT-F1-170129-OTA, 236220/Z2JZ) · DEPT OF DEFENSE / DEPT OF THE AIR FORCE · [SAM](https://sam.gov/opp/cf8e1d878f2245f5ab25f69e4cfc5067/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Not in the top 400 by meaning; recovered by body-text keywords
- Evidence: “The selected approach must provide a practical path to execute the work while minimizing disruption to aircraft operations and controlling construction, safety, environmental, and schedule risks.”
- Reviewer 1: NO (electrical cable replacement) · Reviewer 2: NO (electrical circuit cable replacement)
- [ ] Accept  [ ] Reject → correct label: ____

### S10 · nursing · proposed **FIT**
**ISBEE Solicitation: Emergency Department Registered Nurse Services (Up to 8 RNs) – Standing Rock Service Unit, Fort Yates IHS Hospital, Fort Yates, ND.** (75H70627R00002, 561320/Q401) · HEALTH AND HUMAN SERVICES, DEPARTMENT OF / INDIAN HEALTH SERVICE · [SAM](https://sam.gov/opp/fe4d9468ae4e40dcb5651aa503ea997a/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #3 of 9,929 (cosine 0.377) for the customer's own description
- Evidence: “The Indian Health Service (IHS), Great Plains Area, is soliciting proposals for non-personal Emergency Department Registered Nurse services in support of the Standing Rock Service Unit, Fort Yates Hospital, Fort Yates, North Dakota, under Solicitation No.”
- Reviewer 1: FIT (emergency department RN services up to 8 RNs) · Reviewer 2: FIT (emergency department registered nurse services, up to 8 RNs)
- [ ] Accept  [ ] Reject → correct label: ____

### S11 · janitorial · proposed **NO**
**Vent Hood Services** (FA483027Q0004, 561790/J073) · DEPT OF DEFENSE / DEPT OF THE AIR FORCE · [SAM](https://sam.gov/opp/4eabd9cf67a9464d9b39e7155bd67625/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #29 of 9,929 (cosine 0.365) for the customer's own description
- Evidence: “This requirement is for Moody AFB GA and Grassy Po Page 1 of 8 RFQ No.: FA483027Q0004 Contract No.: FA4830- Contract Title: Clean Kitchen Hoods and Ducts CUI CUI 23RD CIVIL ENGINEER SQUADRON STATEMENT OF WORK CLEAN KITCHEN HOODS AND DUCTS Dated 1 April 2026 23rd Contracting Squadron Moody AFB GA -- 1 of 8 -- Page 2 of 8 RFQ No.: FA483027Q0004 Contract No.: FA4830- Contract Title: Clean Kitchen Hoo”
- Reviewer 1: NO (kitchen hood and duct cleaning) · Reviewer 2: PARTIAL (kitchen hood and duct cleaning, specialized cleaning) · adjudicated NO
- [ ] Accept  [ ] Reject → correct label: ____

### S12 · steelbldg · proposed **NO**
**Demolition of an existing building, Site Improvements and construction of a Modular Office Building at the US Merchant Marine Academy Campus, Kings Point, NY** (W912DS27BA004, 236220/Y1AA) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/6a6249a47b71404eb8a2a7d838a5ed8a/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #24 of 9,929 (cosine 0.367) for the customer's own description
- Evidence: “The U.S. Army Corps of Engineers, New York District is issuing an invitation for bid to award a Firm Fixed Price construction contract for the demolition of existing building, site Improvements and provide a turnkey modular office facility. The scope includes the demolition of an existing 10,000 SF building (with basement, in-ground pool, and pool shed), Hazardous Materials Abatement and Disposal, Site Improvements (SWPPP Controls, Sidewalks, Par”
- Reviewer 1: NO (demolition and modular office construction) · Reviewer 2: NO (demolition and modular office construction)
- [ ] Accept  [ ] Reject → correct label: ____

### S13 · janitorial · proposed **FIT**
**SOURCES SOUGHT: N40080-27-R-XXXX 8(a) BASEWIDE JANITORIAL SERVICES FOR MARINE CORPS BASE (MCB) QUANTICO, VIRGINIA** (N4008027RXXXX, 561720/S201) · DEPT OF DEFENSE / DEPT OF THE NAVY · [SAM](https://sam.gov/opp/a2badf39d2574984a80c99ec15091ffc/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #24 of 9,929 (cosine 0.374) for the customer's own description
- Evidence: “SOURCES SOUGHT: N40080-27-R-XXXX 8(a) BASEWIDE JANITORIAL SERVICES FOR MARINE CORPS BASE (MCB) QUANTICO, VIRGINIA DATE: 10/27/2026 RESPONSE DATE: 11/16/2026 PRODUCT SERVICE CODE: S201 - Housekeeping- Custodial Janitorial NAICS CODE(S): 561720 - Janitorial Services TITLE: 8(a) BASEWIDE JANITORIAL SERVICES FOR MARINE CORPS BASE (MCB) QUANTICO, VIRGINIA This is a Sources Sought Notice issued solely f”
- Reviewer 1: FIT (basewide janitorial services) · Reviewer 2: FIT (basewide janitorial services, MCB Quantico)
- [ ] Accept  [ ] Reject → correct label: ____

### S14 · steelbldg · proposed **PARTIAL**
**RF Roof Replacement Project** (RFP27-005JR, 238160/Y1EZ) · ENERGY, DEPARTMENT OF / ENERGY, DEPARTMENT OF · [SAM](https://sam.gov/opp/91e1a83848304f2d84cfe6e95588d9e6/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #6 of 9,929 (cosine 0.420) for the customer's own description
- Evidence: “d For Bid DIVISION 4 - MASONRY SECTION 040120 MAINTENANCE OF UNIT MASONRY 042000 UNIT MASONRY DIVISION 5 - METALS SECTION 051200 STRUCTURAL STEEL 055000 MISCELLANEOUS METALS 055100 METAL STAIRS 055300 METAL GRATINGS DIVISION 6 - WOOD, PLASTICS AND COMPOSITES DIVISION 7 - THERMAL AND MOISTURE PROTECTION SECTION 070150 MAINTENANCE OF MEMBRANE ROOFING 072216 ROOF BOARD INSULATION”
- Reviewer 1: NO (roof replacement, no metal roofing evidence) · Reviewer 2: PARTIAL (roof replacement project; metal roofing not specified) · adjudicated PARTIAL
- [ ] Accept  [ ] Reject → correct label: ____

### S15 · steelbldg · proposed **NO**
**DFC Bldg. 56 Clean Room - Design/Build** (47PD5127Q9995, 236220/Z2AA) · GENERAL SERVICES ADMINISTRATION / PUBLIC BUILDINGS SERVICE · [SAM](https://sam.gov/opp/6feb428ac9604194911858c83efaebef/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #11 of 9,929 (cosine 0.389) for the customer's own description
- Evidence: “This project is open to contractholders on the National IDIQ for Consatruction in Zone D only. They are: Akima Intra-Data, LLC Thomson, James dba American Southwest Electric Anderson Burton Construction Inc B.C. Schmidt Construction, Inc .Bilbro Construction Company, IncD7, LLC dba Dawson D7DCR Services & Construction, Inc .Defender Contracting & Construction LLC Glen/Mar Construction, Inc GMH-C JV, LLCGoshawk, LLC Ironwood Commercial Builders In”
- Reviewer 1: NO (clean room design-build) · Reviewer 2: NO (clean room design-build, restricted IDIQ)
- [ ] Accept  [ ] Reject → correct label: ____

### S16 · guards · proposed **FIT**
**INSCOM G-2 Access Control and Security Escorts (ACES)** (W50NH9-26-R-A028, 561612/R430) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/50d048f7979e4f2d87c4489f0bb201db/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #6 of 9,929 (cosine 0.406) for the customer's own description
- Evidence: “1 PERFORMANCE WORK STATEMENT US Army Intelligence and Security Command (INSCOM) Access Control Officer and Escort Support Services Part 1 General Information”
- Reviewer 1: FIT (unarmed access control officers and escorts) · Reviewer 2: FIT (unarmed access control officers and escort personnel)
- [ ] Accept  [ ] Reject → correct label: ____

### S17 · steelbldg · proposed **NO**
**GAOA  Facilities, Barracks Inyo NF** (1240BH26Q0078, 236220/Z1FB) · AGRICULTURE, DEPARTMENT OF / FOREST SERVICE · [SAM](https://sam.gov/opp/48887f9b30af42fbb8f960f29b9aa766/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Not in the top 400 by meaning; recovered by body-text keywords
- Evidence: “This is a combined synopsis/solicitation for commercial items prepared in accordance with the format in FAR Part 12. This announcement constitutes the only solicitation. Quotations are being requested and a separate written solicitation will not be issued. Solicitation number 1240BH26Q0078 is issued as a Request for Quotation (RFQ) for GAOA Facilities, Barracks Inyo NF. This acquisition is set-aside for small business concerns. The applicable Nor”
- Reviewer 1: NO (barracks construction) · Reviewer 2: NO (barracks facilities RFQ with no scope detail)
- [ ] Accept  [ ] Reject → correct label: ____

### S18 · parts · proposed **FIT**
**53--KNOB - AND OTHER REPLACEMENT PARTS** (N0038327QPA02, None/5355) · DEPT OF DEFENSE / DEPT OF THE NAVY · [SAM](https://sam.gov/opp/8fb401257dbe449eba93343847b53aec/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #9 of 9,929 (cosine 0.602) for the customer's own description
- Evidence: “NSN 0Q-5355-017396916-SX, REF NR 4322AS0217-1, QTY 50 EA, DELIVERY FOB ORIGIN.”
- Reviewer 1: FIT (NSN knob replacement part qty 50) · Reviewer 2: FIT (NSN knob replacement part, qty 50)
- [ ] Accept  [ ] Reject → correct label: ____

### S19 · nursing · proposed **FIT**
**Pre-solicitation Notice: Federal Correctional Complex (FCC) Pollock - Optometrist Services** (15BGCS26Q51900008, 621320/Q999) · JUSTICE, DEPARTMENT OF / FEDERAL PRISON SYSTEM / BUREAU OF PRISONS · [SAM](https://sam.gov/opp/7292f1b6295e4c8999ecc691930029c6/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #125 of 9,929 (cosine 0.278) for the customer's own description
- Evidence: “Evaluation of patients as referred by the medical staff.”
- Reviewer 1: FIT (one optometrist provider BPA) · Reviewer 2: FIT (provision of one contract optometrist at FCC Pollock)
- [ ] Accept  [ ] Reject → correct label: ____

### S20 · parts · proposed **FIT**
**48--VALVE,THROTTLE** (SPE7MC27T1947, 332911/48) · DEPT OF DEFENSE / DEFENSE LOGISTICS AGENCY · [SAM](https://sam.gov/opp/f8b0121694cc47a7824b9b7a0dc53942/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Not in the top 400 by meaning; recovered by body-text keywords (keyword layer matched)
- Evidence: “Proposed procurement for NSN 4820014186456 VALVE,THROTTLE: Line 0001 Qty 5 UI EA Deliver To: DLA DISTRIBUTION PUGET SOUND By: 0122 DAYS ADO Approved sources are 0BR59 134B811AAG-3;”
- Reviewer 1: FIT (NSN throttle valve supply) · Reviewer 2: FIT (NSN throttle valve, qty 5)
- [ ] Accept  [ ] Reject → correct label: ____

### S21 · steelbldg · proposed **NO**
**USACE SPK DBB Construction - LAR C3B South - Sacramento, CA** (W9123827BA002, 237990/Y1LC) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/2babd0128b9c47d2be8ba163fcb95f23/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #82 of 9,929 (cosine 0.333) for the customer's own description
- Evidence: “USACE SPK requires Design-Bid-Build construction services along the Lower American River (LAR), known as Contract 3B (C3B) South, to include excavating, placement, and regrading of material on the riverbank slope and levee embankment, installation of soil-filled rock slope protection on the waterside levee face and riverbank, soil and rock placement to construct river toe protection and planting bench features, instream wood structure placement o”
- Reviewer 1: NO (work is different from stated business; no evidence of this service) · Reviewer 2: NO (Levee and riverbank erosion protection civil works)
- [ ] Accept  [ ] Reject → correct label: ____

### S22 · hvac · proposed **PARTIAL**
**Replace B28 AHU 1, 4, 18, 9A, 9B, OR Chiller** (36C25727R0029, 238220/Z1DA) · VETERANS AFFAIRS, DEPARTMENT OF / VETERANS AFFAIRS, DEPARTMENT OF · [SAM](https://sam.gov/opp/18ec73f48d0b4246a2224ef8d3d09c99/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #12 of 9,929 (cosine 0.477) for the customer's own description
- Evidence: “Chiller throughout several floors of Main Hospital Bldg.”
- Reviewer 1: PARTIAL (replace air handling units and OR chiller) · Reviewer 2: PARTIAL (replacing air handling units and OR chiller)
- [ ] Accept  [ ] Reject → correct label: ____

### S23 · janitorial · proposed **PARTIAL**
**637TRSS Carpet Cleaning** (FA301626Q0012, 561740/S214) · DEPT OF DEFENSE / DEPT OF THE AIR FORCE · [SAM](https://sam.gov/opp/38756e20f6224908b4ba111b4b5a79bb/view)
- Traditional: Traditional title+code search DID return this (title or code matched the trade)
- Semantic: Meaning rank #25 of 9,929 (cosine 0.373) for the customer's own description
- Evidence: “Please use FA301627Q00120001 - 673 TRSS Carpet Cleaning Services.”
- Reviewer 1: PARTIAL (carpet cleaning services only) · Reviewer 2: FIT (carpet cleaning services for four buildings) · adjudicated PARTIAL
- [ ] Accept  [ ] Reject → correct label: ____

### S24 · parts · proposed **FIT**
**31--BEARING,BALL,ANNULA** (N0010426QYAH7, None/3110) · DEPT OF DEFENSE / DEPT OF THE NAVY · [SAM](https://sam.gov/opp/c29f795658414ef49624fb7d3557091f/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #29 of 9,929 (cosine 0.582) for the customer's own description
- Evidence: “NSN 3H-3110-009873734-NT, TDP VER 019, QTY 265 EA, DELIVERY FOB ORIGIN.”
- Reviewer 1: FIT (NSN ball bearing supply qty 265) · Reviewer 2: FIT (NSN ball bearing, qty 265)
- [ ] Accept  [ ] Reject → correct label: ____

### S25 · steelbldg · proposed **NO**
**Y--Construction Contract Sources Sought** (89233126NNA000150, 236210/Y1JZ) · ENERGY, DEPARTMENT OF / ENERGY, DEPARTMENT OF · [SAM](https://sam.gov/opp/4d1a5ef5e419420dab03e085f08186d7/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #75 of 9,929 (cosine 0.335) for the customer's own description
- Evidence: “This is a Sources Sought notice. This is NOT a solicitation for proposals, proposal abstracts, or quotations. The purpose of this notice is to obtain information regarding the availability and capability of qualified small business sources; other than small businesses should not respond to this notice. Your responses to the information requested will assist the Government in determining the appropriate acquisition method, including whether a set-”
- Reviewer 1: NO (work is different from stated business; no evidence of this service) · Reviewer 2: NO (Industrial construction sources sought; no scope detail)
- [ ] Accept  [ ] Reject → correct label: ____

### S26 · guards · proposed **NO**
**Corrective and Preventative Maintenance of Electronic Security Systems at the Ronald Reagan Building** (70RFP226QEC000005, 561621/J063) · HOMELAND SECURITY, DEPARTMENT OF / OFFICE OF PROCUREMENT OPERATIONS · [SAM](https://sam.gov/opp/9258c1810984437c9b3300dd20d13b95/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #27 of 9,929 (cosine 0.352) for the customer's own description
- Evidence: “The US Department of Homeland Security (DHS), Federal Protective Service (FPS) has a requirement for corrective and preventative maintenance of electronic security systems and the replacement and removal of outdated electronic security systems at the Ronald Reagan Building (DC0459).”
- Reviewer 1: NO (electronic security systems maintenance) · Reviewer 2: NO (electronic security systems maintenance)
- [ ] Accept  [ ] Reject → correct label: ____

### S27 · guards · proposed **NO**
**Enterprise Electronic Security Systems (ESS) — Nationwide Operations, Maintenance, Integration, and Lifecycle Support** (7571MN27R00005, 561621/R408) · HEALTH AND HUMAN SERVICES, DEPARTMENT OF / OFFICE OF INTERGOVERNMENTAL AND EXTERNAL AFFAIRS · [SAM](https://sam.gov/opp/4af492bc290b4729b9f3331f0c01a3b0/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #8 of 9,929 (cosine 0.405) for the customer's own description
- Evidence: “Covered systems include Physical Access Control Systems (PACS), Video Surveillance/Video Management Systems (VSS/VMS), Intrusion Detection Systems (IDS), duress alarms, intercoms, turnstiles, gate arms, elevator-control interfaces, and the associated network infrastructure supporting these systems primarily built on the Lenel OnGuard and Milestone XProtect platforms.”
- Reviewer 1: NO (electronic security systems) · Reviewer 2: NO (electronic security systems lifecycle support)
- [ ] Accept  [ ] Reject → correct label: ____

### S28 · guards · proposed **NO**
**Munitions Maintenance and Inspection Facility and Conventional Munitions Cube Storage Addition, HIANG, JBPHH, HI** (W50SLF26RA005, 236220/Y1GA) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/3003948ae80248a0b83d74a8d4bdde2c/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #67 of 9,929 (cosine 0.334) for the customer's own description
- Evidence: “The Hawaii National Guard intends to issue a Request for Proposals (RFP) to award a single firm fixed-price contract for services, non-personal, to provide all plant, labor, transportation, materials, tools, equipment, appliances and supervision necessary for the Construction of KNMD209085 Munitions Maintenance and Inspection Facility and KNMD209086 Conventional Munitions Cube Storage Addition loc”
- Reviewer 1: NO (work is different from stated business; no evidence of this service) · Reviewer 2: NO (Munitions facility construction RFP; no guard services)
- [ ] Accept  [ ] Reject → correct label: ____

### S29 · steelbldg · proposed **NO**
**W912EK27BA003 - Detroit Project Office Detroit, MI Wayne County Roads, Parking, and Grounds Renovation** (W912EK27BA003, 237310/Y1QA) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/c45fd3f122574310b55bca1fb46014ff/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #20 of 9,929 (cosine 0.373) for the customer's own description
- Evidence: “demolition to include removal of asphalt and concrete pavements, curbs and gutters, sidewalks and slabs, water main, valve and hydrant, storm sewer inlets, manholes and pipe, chain-link and ornamental fencing and gates, and flagpole;”
- Reviewer 1: NO (roads and grounds renovation) · Reviewer 2: NO (roads, parking and grounds renovation)
- [ ] Accept  [ ] Reject → correct label: ____

### S30 · parts · proposed **PARTIAL**
**61--DISTRIBUTING SYSTEM, IN REPAIR/MODIFICATION OF** (N0038327QNA16, None/6150) · DEPT OF DEFENSE / DEPT OF THE NAVY · [SAM](https://sam.gov/opp/4c7574e2e37d4b7e8b3c4987de42e44f/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #13 of 9,929 (cosine 0.597) for the customer's own description
- Evidence: “NSN 7R-6150-015240925-H1, TDP VER 002, QTY 4 EA, DELIVERY FOB ORIGIN.”
- Reviewer 1: PARTIAL (NSN distributing system in repair/modification) · Reviewer 2: PARTIAL (distributing system repair/modification, not supply)
- [ ] Accept  [ ] Reject → correct label: ____

### G01 · hvac · proposed **NO**
**Chesapeake and Delaware (C and D) Canal Building Replacement Project. ** (W912BU27RA009, 236220/Y1EB) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/b75232e01627477ba024adc55fa2e5e9/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #48 of 9,929 (cosine 0.420) for the customer's own description
- Evidence: GATE SENTENCE (AI reviewers did NOT see it) — “B.) The maintenance building must be provided with Heating, Ventilation, and Air Conditioning (HVAC), electrical, communications, fire protection, life safety, plumbing systems, waste oil storage, and compressed air systems.”
- Reviewer 1: NO (building replacement construction) · Reviewer 2: NO (building demolition and replacement construction; no HVAC scope shown)
- [ ] Accept  [ ] Reject → correct label: ____

### G02 · steelbldg · proposed **NO**
**Z2DZ--Project Number 653-105, Seismic Retrofit of Building 16,    Roseburg VAMC, Oregon** (36C10F26R0084 , 236220/Z2DZ) · VETERANS AFFAIRS, DEPARTMENT OF / VETERANS AFFAIRS, DEPARTMENT OF · [SAM](https://sam.gov/opp/7cea9a6c360a47a2b7cdf8d584239c86/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #25 of 9,929 (cosine 0.366) for the customer's own description
- Evidence: GATE SENTENCE (AI reviewers did NOT see it) — “33.13 Lead-Based Paint Removal and Disposal 01-21 DIVISION 03 – CONCRETE 03 30 53 (Short-Form) Cast-in-Place Concrete 01-21 03 37 13 Shotcrete 01-21 DIVISION 04 – MASONRY 04 05 13 Masonry Mortaring 10-17 04 20 00 Unit Masonry 08-17 DIVISION 05 – METALS 05 12 00 Structural Steel Framing 11-18 05 40 00 Cold-Formed Metal Framing 01-21 05 50 00 Metal Fabrications 08-18 05 51 00 Metal Stairs 01-21 DIVI”
- Reviewer 1: NO (seismic retrofit) · Reviewer 2: NO (seismic retrofit and renovation)
- [ ] Accept  [ ] Reject → correct label: ____

### G03 · hvac · proposed **NO**
**Construction of Chilled Water Plant and Site Utility Upgrades at VA Medical Center in West Haven, CT** (W912WJ26RA008, 236220/Y1NB) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/6370f6ed68ac469ea853c27dc60d8a41/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #16 of 9,929 (cosine 0.465) for the customer's own description
- Evidence: GATE SENTENCE (AI reviewers did NOT see it) — “The scope of the chilled water plant replacement consists of the demolition of the existing chilled water plant (building 16a) and construction of a new multi-story chilled water plant to include chillers, cooling towers, pumps, and all associated mechanical and electrical equipment.”
- Reviewer 1: NO (chilled water plant construction) · Reviewer 2: PARTIAL (chilled water plant replacement construction) · adjudicated NO
- [ ] Accept  [ ] Reject → correct label: ____

### G04 · hvac · proposed **NO**
**Z2DA--666-27-102 Lightning Protection Update B71N** (36C25926Q0880_1, 236220/Z2DA) · VETERANS AFFAIRS, DEPARTMENT OF / VETERANS AFFAIRS, DEPARTMENT OF · [SAM](https://sam.gov/opp/a1b1f2db2fcf4f1f9d108530ea86d6e8/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #29 of 9,929 (cosine 0.434) for the customer's own description
- Evidence: GATE SENTENCE (AI reviewers did NOT see it) — “Install new air terminals at both ends of each screen wall, with additional terminals spaced at 20-foot intervals along the top of each wall, and at the highest point of the HVAC ductwork.”
- Reviewer 1: NO (lightning protection upgrade) · Reviewer 2: NO (lightning protection system upgrades)
- [ ] Accept  [ ] Reject → correct label: ____

### G05 · hvac · proposed **NO**
**Construction of Chilled Water Plant and Site Utility Upgrades at VA Medical Center in West Haven, CT** (W912WJ26RA008, 236220/Y1NB) · DEPT OF DEFENSE / DEPT OF THE ARMY · [SAM](https://sam.gov/opp/b3184af4cd104d9280c1de6e24e4846f/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #11 of 9,929 (cosine 0.482) for the customer's own description
- Evidence: GATE SENTENCE (AI reviewers did NOT see it) — “The scope of the chilled water plant replacement consists of the demolition of the existing chilled water plant (building 16a) and construction of a new multi-story chilled water plant to include chillers, cooling towers, pumps, and all associated mechanical and electrical equipment.”
- Reviewer 1: NO (chilled water plant construction) · Reviewer 2: PARTIAL (chilled water plant replacement construction) · adjudicated NO
- [ ] Accept  [ ] Reject → correct label: ____

### G06 · steelbldg · proposed **NO**
**RM16-1405 BUILDING 592 RENOVATIONS** (N4008527R0017, 236220/Y1JZ) · DEPT OF DEFENSE / DEPT OF THE NAVY · [SAM](https://sam.gov/opp/909e581682c44c4dbf22ef2ec4f5de82/view)
- Traditional: Title and codes do not carry the trade words/codes searched
- Semantic: Meaning rank #48 of 9,929 (cosine 0.345) for the customer's own description
- Evidence: GATE SENTENCE (AI reviewers did NOT see it) — “ESTOS REMEDIATION 02 83 00 11/18 LEAD REMEDIATION 02 84 16 11/22 HANDLING OF LIGHTING BALLASTS AND LAMPS CONTAINING PCBs AND MERCURY DIVISION 03 - CONCRETE 03 30 00 02/19, CHG 9: 08/24 CAST-IN-PLACE CONCRETE DIVISION 05 - METALS 05 05 20 05/22, CHG 1: 08/24 POST-INSTALLED CONCRETE AND MASONRY ANCHORS 05 05 23.16 08/18 STRUCTURAL WELDING 05 12 00 08/18, CHG 2: 05/21 STRUCTURAL STEEL 05 40 00 05/15,”
- Reviewer 1: NO (work is different from stated business; no evidence of this service) · Reviewer 2: NO (Building 592 interior renovations, electrical, HVAC; no steel building/roof)
- [ ] Accept  [ ] Reject → correct label: ____
