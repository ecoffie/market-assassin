/**
 * Non-federal facts for Transaction Study 001 (Halvik / Tetra Tech), each traced in
 * tasks/halvik-transaction-study-publication-gate-2026-10-07.md (the claim ledger).
 *
 * Federal figures do NOT live here — they come from halvik-tetra-tech.data.json so prose cannot drift
 * from the frozen register. Everything in TRANSACTION.subsequent was disclosed AFTER the 2026-01-21
 * cutoff and is context only; none of it feeds the reconstruction.
 *
 * Deliberately absent (claim ledger: NOT SAFE): 8(a) program entry and graduation dates (third-party
 * profile only; SBA unconfirmed), any Halvik revenue figure, and any eligibility consequence.
 */

const TENQ_Q2 = 'https://www.sec.gov/Archives/edgar/data/831641/000083164126000011/ttek-20260329.htm';
const PR = 'https://investor.tetratech.com/news/news-details/2026/Tetra-Tech-Acquires-Halvik-Corp/default.aspx';

export const STUDY_META = {
  kicker: 'Transaction Study 001',
  title: 'The Federal Portfolio Behind a $210 Million Acquisition',
  subhead:
    "Reconstructing Halvik's public contract record as it stood the day before Tetra Tech announced the deal — and what that record can and cannot tell a buyer.",
  description:
    "Mindy Institute Transaction Study 001: Halvik's federal prime-contract portfolio as of January 21, 2026 — 245 awards and vehicles, $724.7M in cumulative public obligations, reconciled against Halvik's public claims.",
  version: 'v1.0 (draft)',
  publishedDate: 'not yet published',
  citation:
    'The Federal Portfolio Behind a $210 Million Acquisition: Halvik / Tetra Tech. Mindy Institute Transaction Study 001, v1.0, historical cutoff January 21, 2026.',
  executive:
    "By January 21, 2026, the federal record held 245 prime awards and vehicles for Halvik, LLC, carrying $724.7 million in cumulative public federal obligations. Almost all of that money came through awards reserved for small business, from four departments, and through five contract vehicles. The record supports every contract vehicle Halvik named in public. It cannot confirm three of the dollar figures Halvik attached to individual wins, and it says nothing about revenue, backlog or value.",
  findings: [
    '<b>A decade of compounding.</b> Annual public obligations grew from $3.1M in FY2017 to $186.7M in FY2025, with no down year in between.',
    '<b>Built on set-asides.</b> 92.6% of cumulative obligations flowed through awards competed or placed under a small-business, 8(a) or women-owned small-business set-aside. 7.0% came through awards recorded with no set-aside.',
    '<b>Concentrated.</b> Defense, Transportation, Commerce and NASA account for 94.1% of obligations. The five largest vehicles carried 78.0%, and the single largest order (NASA) carried 15.8%.',
    '<b>Public claims reconcile, mostly.</b> All 17 contract vehicles Halvik named publicly are held by its UEI, and 11 had orders by the cutoff. NASA\'s announced $148.8M potential value for its largest award ties to the record within 0.03%. Three dollar claims (Army G-4, Army CCSA and USPTO) cannot be tied to a specific contract.',
    '<b>Near-term end dates.</b> 21 of the 46 contracts and orders active at the cutoff, holding 59.9% of active obligations, reached their recorded potential end date (all options) within twelve months.',
  ],
  flags: [
    '<b>Customer concentration.</b> Four departments account for 94.1% of cumulative obligations and 99.7% of trailing-twelve-month obligations.',
    '<b>Contract concentration.</b> The five largest awards hold 44.1% of cumulative obligations. The largest, NASA order 80TECH22FA001, holds 15.8%.',
    '<b>End dates.</b> 21 of 46 active contracts and orders, holding $327.6M of $547.2M active obligations, carried a recorded potential end date (all options) on or before January 21, 2027. These include the NASA order (November 30, 2026), the Army G-4 enterprise-services order W52P1J21F0063 (February 25, 2026) and the Navy order N0016421F3025 (August 16, 2026). A potential end date marks when the recorded options run out. It does not mean the work ends, and follow-on work may be awarded to Halvik or to others.',
    '<b>Set-aside and 8(a) exposure.</b> 136 of the 245 awards and vehicles carry an 8(a) basis on the award or its parent vehicle. 16 of the 30 vehicles are set-aside or reserved multiple-award vehicles.',
    '<b>Unresolved assertions.</b> The Army G-4 (~$62M), Army CCSA (~$34M) and USPTO ("$250M in task orders") claims name no contract number and cannot be tied to the record.',
    '<b>Size determinations already mixed.</b> On the latest pre-cutoff action of the 46 active awards, contracting officers recorded Halvik as small on 23 and other than small on 23.',
  ],
  whyItMatters: `<p>Halvik's record shows a pattern that small federal contractors talk about and rarely see measured end to end: a firm that held a GSA Schedule contract by 2014, began winning awards with an 8(a) basis in 2017, then accumulated multiple-award vehicles (OASIS, STARS, ITES-3S, SeaPort-NxG, agency BPAs) whose orders became most of its federal business. By the time it was acquired, the vehicles carried the portfolio more than any single contract did.</p>
  <p>That raises research questions we cannot answer from one case: how firms carry an 8(a)-era portfolio past graduation; which assets (vehicles, agency relationships, recompete positions) keep their value when ownership changes; and how acquisitions of small firms change the supplier base agencies rely on for set-aside work. The Institute will study those across many transactions. This case shows the method. It does not establish a cause or a general rule.</p>`,
  sources: [
    `USASpending.gov custom award download for UEI VMRTJLWMQRH7 (prime transactions and subawards), retrieved 2026-10-07. Primary, federal.`,
    `Tetra Tech, Inc., Form 10-Q for the quarter ended March 29, 2026 (filed May 1, 2026), Note 4 "Acquisitions and Divestitures". Primary, SEC filing. <a href="${TENQ_Q2}">${TENQ_Q2}</a>`,
    `Tetra Tech, Inc., Form 10-Q for the quarter ended December 28, 2025, "Subsequent Event". Primary, SEC filing. Available on EDGAR, CIK 831641.`,
    `Tetra Tech, "Tetra Tech Acquires Halvik Corp," press release, January 22, 2026. Primary, acquirer. <a href="${PR}">${PR}</a>`,
    `NASA, contract release C21-033, "NASA Awards Contract for Information Technology Support Services," November 9, 2021. Primary, agency. <a href="https://www.nasa.gov/news-release/nasa-awards-contract-for-information-technology-support-services/">nasa.gov</a>`,
    `Halvik, "Halvik Acquires SP Systems," PR Newswire, July 12, 2016. Primary, company. <a href="https://www.prnewswire.com/news-releases/halvik-acquires-sp-systems-a-small-business-alliant-prime-contract-holder-300297148.html">prnewswire.com</a>`,
    `Halvik, "Halvik Corp Awarded U.S. Army G-4 Contract," PR Newswire, August 17, 2021. Primary, company. <a href="https://www.prnewswire.com/news-releases/halvik-corp-awarded-us-army-g-4-contract-301357091.html">prnewswire.com</a>`,
    `Halvik contract-vehicle pages and June 2020 OASIS capability sheet, halvik.com (several pages undated). Primary, company.`,
    `Halvik, "Our Story," halvik.com (undated). Primary, company. Founding year only.`,
    `SAM.gov entity registration for UEI VMRTJLWMQRH7 (retrieved 2026-10-07). Primary, federal. Entity start date only.`,
    `Washington Technology, "Tetra Tech acquires IT modernization, analytics outfit," January 22, 2026. Secondary, press. Cited only for its own estimate, which is a different measure from ours.`,
  ],
};

export const TRANSACTION = {
  prose: `<p><b>Buyer:</b> Tetra Tech, Inc. <b>Target:</b> Halvik Corp, which the federal record lists as HALVIK, LLC (UEI VMRTJLWMQRH7, CAGE 5GRR4). Tetra Tech's filings describe Halvik as a 600-employee firm providing advisory consulting in data analytics, systems modernization and cybersecurity to federal defense and civilian agencies.</p>
  <p><b>Dates.</b> Tetra Tech's 10-Q for the quarter ended December 28, 2025 reports, as a subsequent event: "On January 16, 2026, we acquired Halvik Corp." Tetra Tech announced the completed acquisition on January 22, 2026. This study's cutoff is <b>January 21, 2026</b>, the day before the announcement. Two federal actions fall between the closing and the cutoff; both are $0 administrative modifications, so the figures here are identical whether measured to the day before closing or the day before the announcement.</p>
  <p>The filings do not say whether the transaction was a purchase of stock or of assets.</p>`,
  subsequent: `<p>Tetra Tech's 10-Q for the quarter ended March 29, 2026 reports that "the fair value of the purchase price was approximately $210 million." That figure consists of <b>$150 million</b> in initial cash payments to the sellers, <b>$25 million</b> of cash held in escrow and <b>$35 million</b>, the estimated fair value of contingent earn-out obligations. The earn-out has a maximum of <b>$97 million</b>, based on operating-income targets in each of the three years after the acquisition.</p>
  <p>The preliminary allocation assigns $24 million to net tangible assets, $26 million to identifiable intangible assets and <b>$160 million to goodwill</b>. Halvik is reported in Tetra Tech's Government Services Group. The filing discloses no Halvik revenue, operating income or backlog.</p>
  <p class="src">Source: <a href="${TENQ_Q2}">Tetra Tech Form 10-Q, quarter ended March 29, 2026, Note 4</a>. These figures were published after the cutoff. They are context, not inputs: no figure in sections 3–6 uses them, and the public award record cannot be reconciled to them.</p>`,
};

export const HISTORY = {
  prose: `<p>Halvik says it was founded in 2007. SAM.gov records an entity start date of September 26, 2007. In July 2016 Halvik, describing itself as "an 8(a) certified" company, announced that it had acquired SP Systems, Inc., a Greenbelt, Maryland firm. The federal record confirms the link: SP Systems reports Halvik as its parent from August 2016.</p>
  <p>In the award record, the first award with an 8(a) basis (on the award or its parent vehicle) is dated February 9, 2017 (Department of Transportation), and the most recent before the cutoff is dated December 19, 2024. We do not state Halvik's 8(a) program entry or graduation dates. The only source we found for them is a third-party profile, and we could not confirm them with SBA.</p>`,
};

type Status = 'match' | 'partial' | 'unresolved' | 'context';
export const RECONCILIATION: { claim: string; source: string; record: string; result: string; status: Status }[] = [
  {
    claim: '17 named contract vehicles (OASIS SB Pools 1, 3, 4 and 8(a) subpool; 8(a) STARS II and III; ITES-3S; SeaPort-NxG; DOT SWES; DHS SEAD; NOAA NMITS; State ITPS; FAA eFAST; FAA ITIPSS; Commerce CATTS; GSA Schedule 70; OASIS+)',
    source: 'halvik.com vehicle pages and 2020 capability sheet (10 undated); GSA eLibrary for STARS III',
    record: 'All 17 held by UEI VMRTJLWMQRH7. 11 had orders by the cutoff; 6 had none (OASIS SB Pools 3 and 4, NOAA NMITS, OASIS+, FAA eFAST, FAA ITIPSS).',
    result: '17 of 17 matched',
    status: 'match',
  },
  {
    claim: 'NASA IT Support Services (SITSS), potential value $148.8M, five years',
    source: 'NASA contract release C21-033, Nov 9, 2021 (primary, agency)',
    record: 'Order 80TECH22FA001 under the OASIS 8(a) subpool. First action Nov 9, 2021. Ceiling $148,756,175; $114,250,000 obligated by the cutoff.',
    result: 'Matched; ceiling within 0.03% of stated value',
    status: 'match',
  },
  {
    claim: 'Army G-4 supply-chain and logistics support, five years, estimated $62M',
    source: 'Halvik release, Aug 17, 2021 (primary, company)',
    record: 'The release names no contract number. Two Army G-4 orders exist: W52P1J21F0063 "Enterprise Services for G-4" (first action Jan 25, 2021; $76.2M obligated) and W52P1J21F0515 (Sept 13, 2021; $1.4M).',
    result: 'Unresolved — candidate identified, not confirmed',
    status: 'unresolved',
  },
  {
    claim: 'Army Command and Control Support Agency IT support, five years, estimated $34M',
    source: 'Secondary reproduction of a Halvik release, Sept 2021',
    record: 'No contract number named; no award in the record can be tied to it.',
    result: 'Unresolved',
    status: 'unresolved',
  },
  {
    claim: 'USPTO BOSS: "first of $250M in task orders"',
    source: 'halvik.com "Our Story" (undated)',
    record: '21 candidate USPTO orders; the claim names none. Obligations on Halvik\'s USPTO IDIQ orders through the cutoff total $95.7M.',
    result: 'Unresolved — a program total, not a single award',
    status: 'unresolved',
  },
  {
    claim: 'SP Systems acquisition, July 2016',
    source: 'Halvik release, Jul 12, 2016 (primary, company)',
    record: 'SP Systems (UEI GBNYDRT5ZZ53) reports Halvik as parent on 110 actions, Aug 4, 2016 to May 14, 2025.',
    result: 'Matched',
    status: 'match',
  },
  {
    claim: '"Approximately $148.2 million in unclassified prime contract revenue over the trailing 12 months," 28% defense',
    source: 'Washington Technology, Jan 22, 2026 (secondary, press)',
    record: 'Prime obligations Jan 22, 2025 to Jan 21, 2026: $169.2M, of which Defense 37.2%.',
    result: 'Different measures (a revenue estimate vs obligations); not a tie-out',
    status: 'context',
  },
];
