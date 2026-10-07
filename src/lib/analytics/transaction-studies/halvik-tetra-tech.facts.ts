/**
 * Non-federal facts and prose for Transaction Study 001 (Halvik / Tetra Tech). Every claim is traced in
 * tasks/halvik-transaction-study-publication-gate-2026-10-07.md (the material-claim ledger).
 *
 * Federal figures do NOT live here — they come from halvik-tetra-tech.data.json, so prose cannot drift
 * from the frozen register. Everything in TRANSACTION.subsequent was disclosed AFTER the 2026-01-21
 * cutoff and is context only; none of it feeds the reconstruction (Research Standard v1, principle 2).
 *
 * Deliberately absent (ledger: NOT SAFE): 8(a) program entry and graduation dates (third-party profile
 * only; SBA unconfirmed), any Halvik revenue figure, headquarters city (sources disagree), and any
 * eligibility consequence of the acquisition.
 */

const TENQ_Q1 = 'https://www.sec.gov/Archives/edgar/data/831641/000083164126000005/ttek-20251228.htm';
const TENQ_Q2 = 'https://www.sec.gov/Archives/edgar/data/831641/000083164126000011/ttek-20260329.htm';
const PR = 'https://investor.tetratech.com/news/news-details/2026/Tetra-Tech-Acquires-Halvik-Corp/default.aspx';

/** The kind of statement (Research Standard v1, principle 6). */
export type StatementKind = 'fact' | 'derived' | 'interpretation' | 'filing';
export const KIND_LABEL: Record<StatementKind, string> = {
  fact: 'Federal fact',
  derived: 'Derived measure',
  interpretation: 'Interpretation',
  filing: 'Company filing',
};

export const STUDY_META = {
  kicker: 'Transaction Study 001',
  title: 'The Federal Portfolio Behind a $210 Million Acquisition',
  subhead:
    "Reconstructing Halvik's federal contract portfolio as it stood the day before Tetra Tech announced the deal — and what that public record can and cannot tell a buyer.",
  description:
    "Mindy Institute Transaction Study 001: Halvik's federal prime-contract portfolio as of January 21, 2026 — 245 awards and vehicles, $724.7M in cumulative public federal obligations, reconciled against Halvik's public claims.",
  measuredOn: '2026-10-07',
  executive:
    "By January 21, 2026, the federal record held 245 prime awards and contract vehicles for Halvik, LLC, carrying $724.7 million in cumulative public federal obligations. Those obligations rose every year from FY2017 to FY2025. Most were associated with awards recorded under small-business, 8(a) or WOSB set-aside classifications; most came from four departments and through five contract vehicles. The record supports every contract vehicle Halvik named in public. It does not establish three of the dollar figures Halvik attached to individual wins, and it does not establish revenue, backlog or value.",
  findings: [
    { kind: 'fact' as StatementKind, html: '<b>245 prime awards and contract vehicles</b> were in the federal record for Halvik by January 21, 2026: 215 contracts and orders, and 30 vehicles.' },
    { kind: 'derived' as StatementKind, html: '<b>$724,711,413.15</b> in cumulative public federal obligations through the cutoff. Annual obligations rose from $3.1M in FY2017 to $186.7M in FY2025, with no down year in between.' },
    { kind: 'derived' as StatementKind, html: "<b>92.6%</b> of Halvik's cumulative public federal obligations through the cutoff were associated with awards recorded under small-business, 8(a) or WOSB set-aside classifications." },
    { kind: 'derived' as StatementKind, html: '<b>Concentrated.</b> Of cumulative obligations, four departments (Defense, Transportation, Commerce, NASA) account for 94.1%, orders under the five largest vehicles for 78.0%, and the single largest order (NASA) for 15.8%.' },
    { kind: 'derived' as StatementKind, html: "<b>Public claims, checked.</b> All 17 contract vehicles Halvik named publicly are held by its UEI, and 11 had orders by the cutoff. NASA's announced $148.8M potential value for its largest award reconciles to the record within 0.03%. Three dollar claims (Army G-4, Army command-support, USPTO) remain <b>unresolved</b>." },
  ],
  /** WHAT THE PUBLIC RECORD CAN / CANNOT ESTABLISH — completeness per Research Standard v1, principle 4. */
  canEstablish: [
    ['245 prime awards and contract vehicles at the cutoff', 'COMPLETE — 253 of 253 listed awards downloaded; 245 admissible at the cutoff'],
    ['$724.7M cumulative public federal obligations, FY2014 to cutoff', 'COMPLETE for prime obligations'],
    ['Historical concentration by department, vehicle and award', 'COMPLETE for prime obligations'],
    ['Set-aside classification recorded on each award or its parent vehicle', 'COMPLETE — 1 award ($2.7M) has none recorded, shown as such'],
    ['Whether each publicly named vehicle is held by Halvik', 'COMPLETE — 17 of 17'],
    ["Reconciliation of NASA's announced value for its largest award", 'COMPLETE — within 0.03%'],
    ['Ceiling (base plus all options) of each contract and order', 'COMPLETE for 215 contracts and orders; vehicle ceilings are program-wide and UNKNOWN for Halvik'],
  ] as [string, string][],
  cannotEstablish: [
    'Recognized revenue',
    'Financial backlog',
    'Margins',
    'EBITDA',
    'Complete subcontract revenue (subaward reporting is PARTIAL by nature)',
    'Classified work',
    'Indirect rates',
    'CPARS performance narratives or quality ratings',
    'Employee retention',
    'Pending proposals',
    'Transaction-specific eligibility consequences after the acquisition',
    'Why Tetra Tech paid what it paid',
  ],
  flags: [
    '<b>Customer concentration.</b> Four departments account for 94.1% of cumulative obligations and 99.7% of obligations in the twelve months before the cutoff.',
    '<b>Contract concentration.</b> The five largest awards hold 44.1% of cumulative obligations. The largest, NASA order 80TECH22FA001, holds 15.8%.',
    '<b>End dates.</b> 21 of the 46 contracts and orders active at the cutoff, holding $327.6M of their $547.2M obligations, carried a recorded potential end date (all options) on or before January 21, 2027. These include the NASA order (November 30, 2026), the Army G-4 enterprise-services order W52P1J21F0063 (February 25, 2026) and the Navy order N0016421F3025 (August 16, 2026). A potential end date marks when the recorded options run out. It does not mean the work ends, and follow-on work may be awarded to Halvik or to others.',
    '<b>Set-aside and 8(a) classifications.</b> 136 of the 245 awards and vehicles carry an 8(a) classification on the award or its parent vehicle. 16 of the 30 vehicles are set-aside or reserved multiple-award vehicles. These instruments warrant transaction-specific review.',
    '<b>Unresolved assertions.</b> The Army G-4 (~$62M), Army command-support (~$34M) and USPTO ("$250M in task orders") claims name no contract number and remain unresolved against the record.',
    '<b>Size determinations already mixed.</b> On the latest pre-cutoff action of the 46 active contracts and orders, contracting officers recorded Halvik as small on 23 and other than small on 23.',
  ],
  whyItMatters: `<p>Halvik's record shows a pattern small federal contractors talk about and rarely see measured end to end. The firm held a GSA Schedule contract by 2014 and began receiving awards with an 8(a) classification in 2017. It then accumulated multiple-award vehicles: OASIS, STARS, ITES-3S, SeaPort-NxG and agency BPAs. By the cutoff, orders under those vehicles carried most of its obligations, more than any single contract did.</p>
  <p>That raises research questions one case cannot answer. How do firms carry a portfolio built with 8(a) awards forward as they grow? Which assets, such as vehicles, agency relationships and recompete positions, keep their value when ownership changes? How do acquisitions of small firms change the supplier base agencies rely on for set-aside work? The Institute will study those across many transactions. This case shows the method. It does not establish a cause or a general rule.</p>`,
  sources: [
    { kind: 'Primary · federal', html: 'USASpending.gov custom award download for UEI VMRTJLWMQRH7 (prime transactions and subawards), file PrimeTransactionsAndSubawards_2026-10-07_H07M45S24618047.zip, retrieved 2026-10-07.' },
    { kind: 'Primary · SEC filing', html: `Tetra Tech, Inc., Form 10-Q for the quarter ended December 28, 2025 (filed January 30, 2026), "Subsequent Event." <a href="${TENQ_Q1}">sec.gov</a>` },
    { kind: 'Primary · acquirer', html: `Tetra Tech, "Tetra Tech Acquires Halvik Corp," Business Wire release, January 22, 2026. <a href="${PR}">investor.tetratech.com</a>` },
    { kind: 'Primary · SEC filing', html: `Tetra Tech, Inc., Form 10-Q for the quarter ended March 29, 2026 (filed May 1, 2026), Note 4, "Acquisitions and Divestitures." <a href="${TENQ_Q2}">sec.gov</a>` },
    { kind: 'Primary · agency', html: 'NASA, contract release C21-033, "NASA Awards Contract for Information Technology Support Services," November 9, 2021. <a href="https://www.nasa.gov/news-release/nasa-awards-contract-for-information-technology-support-services/">nasa.gov</a>' },
    { kind: 'Primary · company', html: 'Halvik, "Halvik Acquires SP Systems," PR Newswire, July 12, 2016. <a href="https://www.prnewswire.com/news-releases/halvik-acquires-sp-systems-a-small-business-alliant-prime-contract-holder-300297148.html">prnewswire.com</a>' },
    { kind: 'Primary · company', html: 'Halvik, "Halvik Corp Awarded U.S. Army G-4 Contract," PR Newswire, August 17, 2021. <a href="https://www.prnewswire.com/news-releases/halvik-corp-awarded-us-army-g-4-contract-301357091.html">prnewswire.com</a>' },
    { kind: 'Primary · company', html: 'Halvik contract-vehicle pages and June 2020 OASIS capability sheet, halvik.com (several pages undated); "Our Story," halvik.com (undated), cited for the founding year only.' },
    { kind: 'Primary · federal', html: 'SAM.gov entity registration for UEI VMRTJLWMQRH7, retrieved 2026-10-07, cited for the entity start date only.' },
    { kind: 'Secondary · government listing', html: 'GSA eLibrary contractor listing, cited only to name the 8(a) STARS III vehicle; the vehicle itself is verified in the federal record.' },
    { kind: 'Secondary · press', html: 'Washington Technology, "Tetra Tech acquires IT modernization, analytics outfit," January 22, 2026. Cited only for its own estimate, which measures something different from this study.' },
    { kind: 'Secondary · press', html: 'Battle-updates.com reproduction of a 2021 Halvik release (Army command-support claim). The claim is unresolved.' },
  ],
};

export const TRANSACTION = {
  prose: `<p><b>Buyer:</b> Tetra Tech, Inc. <b>Target:</b> Halvik Corp, which the federal record lists as HALVIK, LLC (UEI VMRTJLWMQRH7, CAGE 5GRR4). Tetra Tech's filings describe Halvik as a 600-employee firm providing advisory consulting in data analytics, systems modernization and cybersecurity to federal defense and civilian agencies.</p>
  <p><b>Acquisition date: January 16, 2026.</b> Tetra Tech's 10-Q for the quarter ended December 28, 2025 reports, as a subsequent event: "On January 16, 2026, we acquired Halvik Corp."</p>
  <p><b>Public announcement date: January 22, 2026.</b> That day Tetra Tech announced "that it has acquired Halvik Corp." The release stated that "the terms of the acquisition were not disclosed."</p>
  <p><b>This study's historical cutoff: January 21, 2026.</b> The study reconstructs what the public federal record showed immediately before the announcement, the point at which an outside observer first learned of the deal. Two Halvik award actions are dated between the acquisition date and the cutoff. Both are $0 administrative modifications, so they do not change any financial measurement here. The figures are the same whether the cutoff is the day before the acquisition or the day before the announcement.</p>
  <p>The filings do not say whether the transaction was a purchase of stock or of assets. This study uses the acquisition date only to describe the transaction. It does not use it to reach any conclusion about recertification or eligibility.</p>`,
  subsequent: `<p>Tetra Tech's 10-Q for the quarter ended March 29, 2026, filed May 1, 2026, reports that "the fair value of the purchase price was approximately $210 million." That consisted of:</p>
  <ul>
    <li><b>$150 million</b> in initial cash payments to the sellers;</li>
    <li><b>$25 million</b> of cash held in escrow; and</li>
    <li><b>$35 million</b>, the estimated fair value of contingent earn-out obligations.</li>
  </ul>
  <p>The earn-out has a total maximum of <b>$97 million</b>, based on operating-income targets in each of the three years after the acquisition. The preliminary allocation assigns $24 million to net tangible assets, $26 million to identifiable intangible assets and <b>$160 million to goodwill</b>. Halvik is reported in Tetra Tech's Government Services Group. The filing discloses no Halvik revenue, operating income or backlog.</p>
  <p class="src">Source: <a href="${TENQ_Q2}">Tetra Tech Form 10-Q, quarter ended March 29, 2026, Note 4</a>. Published after the cutoff. These figures are context, not inputs: no figure in sections 3–6 uses them, and the public award record cannot be reconciled to them.</p>`,
};

export const HISTORY = {
  prose: `<p>Halvik says it was founded in 2007. SAM.gov records an entity start date of September 26, 2007. In July 2016 Halvik announced that it had acquired SP Systems, Inc., describing itself in that release as "an 8(a) certified" company. The federal record confirms the link: SP Systems reports Halvik as its parent from August 2016.</p>
  <p>In the award record, the first award carrying an 8(a) classification (on the award or its parent vehicle) is dated February 9, 2017 (Department of Transportation). The most recent before the cutoff is dated December 19, 2024. This study does not state Halvik's 8(a) program entry or exit dates. The only source we found for them is a third-party profile, and they are <b>not established</b> by SBA or the federal record.</p>`,
};

type Status = 'match' | 'unresolved' | 'context';
export const RECONCILIATION: { claim: string; source: string; record: string; result: string; status: Status }[] = [
  {
    claim: '17 named contract vehicles (OASIS SB Pools 1, 3, 4 and the 8(a) subpool; 8(a) STARS II and III; ITES-3S; SeaPort-NxG; DOT SWES; DHS SEAD; NOAA NMITS; State ITPS; FAA eFAST; FAA ITIPSS; Commerce CATTS; GSA Schedule 70; OASIS+)',
    source: 'halvik.com vehicle pages and 2020 capability sheet (primary, company; 10 pages undated); GSA eLibrary for STARS III (secondary)',
    record: 'All 17 held by UEI VMRTJLWMQRH7. 11 had orders by the cutoff. 6 had none: OASIS SB Pools 3 and 4, NOAA NMITS, OASIS+, FAA eFAST and FAA ITIPSS.',
    result: '17 of 17 found',
    status: 'match',
  },
  {
    claim: 'NASA IT Support Services (SITSS), potential value $148.8M, five years',
    source: 'NASA contract release C21-033, Nov 9, 2021 (primary, agency)',
    record: 'Order 80TECH22FA001 under the OASIS 8(a) subpool. First action Nov 9, 2021. Ceiling $148,756,175; $114,250,000 obligated by the cutoff.',
    result: 'Reconciles within 0.03%',
    status: 'match',
  },
  {
    claim: 'Army G-4 supply-chain and logistics support, five years, estimated $62M',
    source: 'Halvik release, Aug 17, 2021 (primary, company)',
    record: 'The release names no contract number. Two Army G-4 orders exist: W52P1J21F0063, "Enterprise Services for G-4" (first action Jan 25, 2021; $76.2M obligated), and W52P1J21F0515 (Sept 13, 2021; $1.4M).',
    result: 'Unresolved — a candidate exists but is not confirmed',
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
    source: 'halvik.com "Our Story" (primary, company; undated)',
    record: "21 candidate USPTO orders; the claim names none. Obligations on orders under Halvik's USPTO IDIQ through the cutoff total $95.7M.",
    result: 'Unresolved — a program total, not a single award',
    status: 'unresolved',
  },
  {
    claim: 'SP Systems acquisition, July 2016',
    source: 'Halvik release, Jul 12, 2016 (primary, company)',
    record: 'SP Systems (UEI GBNYDRT5ZZ53) reports Halvik as parent on 110 actions, Aug 4, 2016 to May 14, 2025.',
    result: 'Found',
    status: 'match',
  },
  {
    claim: '"Approximately $148.2 million in unclassified prime contract revenue over the trailing 12 months," 28% defense',
    source: 'Washington Technology, Jan 22, 2026 (secondary, press)',
    record: 'Prime obligations Jan 22, 2025 to Jan 21, 2026: $169.2M, of which Defense 37.2%.',
    result: 'Different measures (a press revenue estimate vs obligations); not a tie-out',
    status: 'context',
  },
];
