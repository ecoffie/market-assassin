/**
 * GET /institute/evidence — The Supplier Discovery evidence library (public case file).
 *
 * A real getmindy.ai page (shared gov shell) — NOT an artifact — so every source link
 * works natively and opens the original document. Renders the verified case file kept in
 * docs/evidence/SUPPLIER-DISCOVERY-EVIDENCE.md.
 *
 * GROUNDING: every source is real + independently verified; each carries a status
 * (CONFIRMED = read off the source / extracted from the primary PDF; LEAD = real source,
 * figure to confirm before printing). NEW sources only — additive to the white papers.
 * Load-bearing frame: under-SERVED, not under-SUPPLIED — the sole-source material is used
 * ONLY as contrast. The size-of-prize is a transparent RANGE on the one hard Census number.
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';

export const dynamic = 'force-static';

// ---- source model -------------------------------------------------------
type Status = 'confirmed' | 'lead';
interface Source {
  cite: string;          // the citation (author, title, venue, year)
  url?: string;          // link OUT to the original document
  ours?: { href: string; label: string }; // OUR related page, where relevant
  finding: string;       // the one-sentence finding (may contain <strong>)
  why?: string;          // why it matters to us
  scope: string;         // scope / caveat
  status: Status;
  statusNote?: string;   // e.g. "extracted from the primary PDF"
}
interface Claim {
  id: string;
  kicker: string;
  line: string;          // the claim, one sentence
  intro?: string;
  sources: Source[];
  alsoNote?: string;     // "also in file as leads…"
}

// ---- the verified case file (mirror of docs/evidence/SUPPLIER-DISCOVERY-EVIDENCE.md) ----
const CLAIMS: Claim[] = [
  {
    id: 'core',
    kicker: 'The on-thesis core',
    line: 'Competitive commercial categories — paving, janitorial, landscaping, roofing, staffing — draw too few bids despite ample capable suppliers. A reach problem, not a supply problem.',
    intro: 'The direct answer to "isn’t this just sole-source?" — No. These are ordinary, low-barrier trades with many firms, still under-competed because the notice doesn’t reach them.',
    sources: [
      {
        cite: 'South Carolina Legislative Audit Council, "A Review of Competition for the Department of Transportation’s Road Paving Contracts" (Dec. 2001)',
        url: 'https://lac.sc.gov/sites/default/files/Documents/Legislative%20Audit%20Council/Reports/L-Z/SCDOT_Road_Paving_Summary_2001.pdf',
        finding: 'Of 496 paving projects, <strong>49% drew two or fewer bidders and 12% drew only one.</strong> Single-bid projects came in <strong>5% above</strong> the cost estimate; competed ones <strong>4% below</strong> — a ~9-point swing.',
        why: 'The flagship on-thesis source. A routine, low-barrier trade with many capable contractors, yet half its solicitations were under-competed, and the uncompeted ones cost measurably more — a real market that isn’t being reached, not one that doesn’t exist.',
        scope: 'One state, one trade (paving), 2001. A state audit of competition (not an AASHTO/FHWA product).',
        status: 'confirmed',
        statusNote: 'text extracted from the primary PDF and confirmed firsthand',
      },
      {
        cite: 'Urban Institute, "Do Minority-Owned Businesses Get a Fair Share of Government Contracts?" (1997)',
        url: 'https://www.urban.org/sites/default/files/publication/67046/307416-Do-Minority-Owned-Businesses-Get-a-Fair-Share-of-Government-Contracts-.PDF',
        finding: 'A meta-analysis of <strong>95 disparity studies</strong> finds capable "ready, willing and able" firms are under-utilized across <strong>every</strong> ordinary category — construction, goods, professional and non-professional services.',
        why: 'Cross-jurisdiction proof that capable-firm availability outstrips utilization across ordinary categories, not one niche.',
        scope: '1997; disparity framing; broad industry buckets, not fine trades or bid counts.',
        status: 'confirmed',
      },
      {
        cite: 'BBC Research & Consulting, "State of Oregon Disparity Study" (2023)',
        finding: 'Disparity indices (100 = parity): <strong>construction 41, professional services 31, non-professional services / goods 21</strong> — with <strong>landscaping and janitorial named</strong> among the under-utilized commercial trades.',
        why: 'A recent statewide study putting disparity numbers on the exact reachable trades (landscaping, janitorial) that are our sweet spot.',
        scope: 'Oregon statewide, 2023; disparity/availability framing, not raw bid counts. (Re-extract a specific per-trade index before printing it.)',
        status: 'confirmed',
      },
    ],
    alsoNote: 'Also in file as leads (confirm figures before printing): Vancouver WA 2024 (names janitorial/landscaping/roofing/staffing), Alaska DOT&PF 2021 (<strong>59.55% of capable firms "seldom or never solicited"</strong>), New Jersey 2024 (~240k contracts).',
  },
  {
    id: 'a',
    kicker: 'Claim A',
    line: 'More competition lowers what governments pay — and advertising a solicitation more widely causally increases the number of bidders.',
    sources: [
      {
        cite: 'Coviello & Mariniello, "Publicity requirements in public procurement: Evidence from a regression discontinuity design," Journal of Public Economics 109 (2014), 76–100',
        url: 'https://ideas.repec.org/a/eee/pubeco/v109y2014icp76-100.html',
        finding: 'A stricter publicity requirement <strong>causally induced more bidders</strong>, and more bidders is the channel through which it <strong>lowered the price</strong> the government paid.',
        why: 'The cleanest causal evidence that wider advertising = lower cost — the exact mechanism of Supplier Discovery.',
        scope: 'Italian public-works auctions; regression-discontinuity design. One country / one contract type.',
        status: 'confirmed',
      },
      {
        cite: 'Hong & Shum, "Increasing Competition and the Winner’s Curse: Evidence from Procurement," Review of Economic Studies 69(4) (2002), 871–898',
        url: 'https://academic.oup.com/restud/article/69/4/871/1551658',
        finding: 'In <strong>common-value</strong> settings, procurement costs can <strong>rise</strong> with more bidders (the winner’s curse). Florida highway construction data.',
        why: 'We cite this against ourselves — the honest boundary. Our real claim is moving a solicitation from 1–2 bidders to 4–5, not chasing an unlimited count.',
        scope: 'Common-value environments; does not overturn the general result that more bidders lower price. Cite as nuance, not headline.',
        status: 'confirmed',
      },
    ],
    alsoNote: 'Also in file as leads (confirm figures first): Gupta 2002 (US, savings up to ~6–8 bidders), Iimi 2007 (~0.2%/bidder), Tas 2020 (cost-minimizing counts), Kenny & Crisman 2016 (publicity→competition).',
  },
  {
    id: 'b',
    kicker: 'Claim B',
    line: 'Firms don’t bid mainly because they never learned the opportunity existed. Reaching them is a distribution problem, not a posting-compliance one.',
    sources: [
      {
        cite: 'Blum, Datta, Fazekas, Samaddar & Siddique, "Introducing E-Procurement in Bangladesh: The Promise of Efficiency and Openness," World Bank Policy Research WP 10390 (2023)',
        url: 'https://www.govtransparency.eu/wp-content/uploads/2023/04/e-procurement_bangladesh_wp_WB_April2023.pdf',
        finding: 'Making tenders findable online raised the number of bidders by <strong>1.6–2.2</strong>, cut single-bidder tenders by <strong>7.8–13.5 percentage points</strong>, and raised the discounts firms offered by <strong>7.4–8.0 points</strong>.',
        why: 'The cornerstone number — findability delivers BOTH more bidders AND lower price, from the exact intervention we run.',
        scope: 'Bangladesh, 2011–16, fixed-effects on matched contracts. Developing-country e-GP — directional for US local, not literal.',
        status: 'confirmed',
        statusNote: 'abstract extracted from the primary PDF and confirmed firsthand',
      },
      {
        cite: 'OECD, "SMEs in Public Procurement: Practices and Strategies for Shared Benefits," OECD Public Governance Reviews (2018)',
        url: 'https://www.oecd.org/content/dam/oecd/en/publications/reports/2018/10/smes-in-public-procurement_g1g98d8f/9789264307476-en.pdf',
        finding: '"Finding opportunities on tendering platforms online" and suppliers who "do not know whom to contact" rank among the <strong>top barriers</strong> to SME participation.',
        why: 'Authoritative, cross-country confirmation that finding the opportunity — not price or capacity — is a leading barrier.',
        scope: '37 OECD/partner countries; a policy diagnosis, not a causal estimate.',
        status: 'confirmed',
      },
      {
        cite: 'U.S. GAO, "Government Contracting: Federal Efforts to Assist Small Minority Owned Businesses," GAO-12-873 (2012)',
        url: 'https://www.gao.gov/products/gao-12-873',
        finding: 'GAO names "knowledge of the federal contracting process" and "difficulty gaining access to contracting officials" as significant barriers. (A distinct GAO report from any we already cite.)',
        scope: 'US federal, minority-owned focus; supports the awareness/information-cost family.',
        status: 'confirmed',
      },
    ],
  },
  {
    id: 'c',
    kicker: 'Claim C',
    line: 'Fragmentation and paywalled access suppress competition. Open, findable procurement raises it.',
    sources: [
      {
        cite: 'Bandiera, Prat & Valletti, "Active and Passive Waste in Government Spending: Evidence from a Policy Experiment," American Economic Review 99(4) (2009), 1278–1308',
        url: 'https://www.aeaweb.org/articles?id=10.1257/aer.99.4.1278',
        finding: '<strong>83% of measured government overspending is "passive waste"</strong> — failure to shop the market — <strong>not</strong> corruption.',
        why: 'The single most powerful frame in the file: governments overpay mostly because buyers don’t reach the better option — exactly the access problem we attack. Also disarms the "this is really about corruption" objection.',
        scope: 'Standardized goods, Italian public bodies; top-journal quasi-experiment.',
        status: 'confirmed',
      },
      {
        cite: 'Lewis-Faupel, Neggers, Olken & Pande, "Can Electronic Procurement Improve Infrastructure Provision? Evidence from India and Indonesia," AEJ: Economic Policy 8(3) (2016), 258–283',
        url: 'https://www.aeaweb.org/articles?id=10.1257/pol.20140258',
        finding: 'E-procurement brought in winners from <strong>outside the local region</strong> and <strong>higher-quality contractors</strong> (no measured price drop — an honest result).',
        why: 'Evidence that making opportunities findable pulls in bidders beyond the usual local pool — our "reach the firms two counties over" pitch.',
        scope: 'Public works, two developing countries; benefit shows up as entry + quality, not price.',
        status: 'confirmed',
      },
      {
        cite: 'Electronic Frontier Foundation, "The Time Has Come to End the PACER Paywall" (2020)',
        url: 'https://www.eff.org/deeplinks/2020/09/end-pacer-paywall',
        finding: 'Charging <strong>$0.10/page</strong> to view <em>legally public</em> federal court records turns the system into a "gatekeeper to information."',
        why: 'A documented, on-record instance that paywalling legally-public government information is a recognized barrier — the direct analogy to bid-aggregator paywalls. Use as analogy (it’s advocacy, and about courts).',
        scope: 'US federal court records; advocacy source.',
        status: 'confirmed',
      },
    ],
    alsoNote: 'Also in file: Duguay/Rauter/Samuels (JAR 2023, EU open data → more open competitive bidding — direction confirmed, magnitude to verify); OECD (2018) & World Bank (2020) leads (the effect is conditional on institutions — an honest nuance).',
  },
];

// Claim D — used as contrast only (rendered as a compact table)
const CONTRAST: { src: string; url?: string; est: string; status: Status }[] = [
  { src: 'GAO-22-104154 (2022)', url: 'https://www.gao.gov/products/gao-22-104154', est: 'DOD names "reliance on foreign and single-source suppliers" as a risk to mitigate (200,000+ supplier base).', status: 'confirmed' },
  { src: 'GAO-24-106129 (2023)', url: 'https://www.gao.gov/products/gao-24-106129', est: 'Consolidation "may reduce competition and increase the risk of higher costs"; ~400 defense M&A/yr vs ~40 reviewed.', status: 'confirmed' },
  { src: 'GAO-25-107283 (2025)', url: 'https://www.gao.gov/products/gao-25-107283', est: 'Dependence treated as a national-security risk requiring supply-chain visibility.', status: 'confirmed' },
  { src: 'SBA (2024)', url: 'https://legacy.sba.gov/article/2024/04/12/sba-statement-biden-harris-administration-exceeding-small-disadvantaged-business-contracting-goal', est: 'Federal initiative to "reverse a decade-long decline in the contracting base."', status: 'confirmed' },
  { src: 'DoD "State of Competition" (2022)', url: 'https://media.defense.gov/2022/Feb/15/2002939087/-1/-1/1/STATE-OF-COMPETITION-WITHIN-THE-DEFENSE-INDUSTRIAL-BASE.PDF', est: 'Of ~51 A&D prime contractors in the 1990s, ~5 remain; remedy = broaden the base + small-biz outreach.', status: 'lead' },
];

// size-of-prize inputs
const SIZE_INPUTS: { k: string; v: string; conf: string }[] = [
  { k: 'Total S&L expenditure', v: '$3.7T (FY2021; $1.8T state + $1.9T local) — Census / Urban Institute', conf: 'measured (hard)' },
  { k: 'Procurement share of that', v: '~20–33% → ~$0.9T–$1.5T addressable', conf: 'assumption band' },
  { k: 'Under-competed AND contestable', v: '~40% single-bid, LESS genuine sole-source (~⅔ contestable)', conf: 'assumption — nets out sole-source' },
  { k: 'Savings when de-monopolized', v: '~2–3% of spend / ~1% per bidder → ~13.5% on affected contracts → 8.3%+ optimistic', conf: 'range, each end sourced' },
];

// ---- render helpers -----------------------------------------------------
const A = (url: string, label: string, cls = 'srclink') =>
  `<a class="${cls}" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;

const statusChip = (s: Status, note?: string) =>
  s === 'confirmed'
    ? `<span class="chip ok">&#10003; Confirmed</span>${note ? `<span class="chipnote">${note}</span>` : ''}`
    : `<span class="chip lead">&#9650; Lead</span>${note ? `<span class="chipnote">${note}</span>` : ''}`;

const sourceCard = (s: Source) => `
  <div class="src${s.status === 'lead' ? ' leaddim' : ''}">
    <div class="stop">
      <div class="cite">${s.cite}</div>
      <div class="chiprow">${statusChip(s.status, s.statusNote)}</div>
    </div>
    <p class="find">${s.finding}</p>
    ${s.why ? `<p class="why">${s.why}</p>` : ''}
    <p class="scope"><b>Scope:</b> ${s.scope}</p>
    <div class="links">
      ${s.url ? A(s.url, 'Open the source') : '<span class="nolink">Source: see full case file (no stable public URL)</span>'}
      ${s.ours ? A(s.ours.href, s.ours.label, 'srclink ours') : ''}
    </div>
  </div>`;

const claimBlock = (c: Claim) => `
  <section class="claim" id="${c.id}">
    <div class="kick">${c.kicker}</div>
    <h2 class="cl">${c.line}</h2>
    ${c.intro ? `<p class="cintro">${c.intro}</p>` : ''}
    ${c.sources.map(sourceCard).join('')}
    ${c.alsoNote ? `<p class="also">${c.alsoNote}</p>` : ''}
  </section>`;

const PAGE_CSS = `
  .ehero{padding:76px 0 8px}
  .ehero .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--teal-deep)}
  .ehero h1{font-size:clamp(32px,5vw,54px);margin:18px 0 0;max-width:20ch;line-height:1.05}
  .ehero .sub{font-size:clamp(17px,2.2vw,21px);color:var(--ink-soft);max-width:58ch;margin:22px 0 0;line-height:1.5}
  .ehero .meta{font-family:var(--mono);font-size:12px;color:var(--muted);margin-top:20px}
  .ehero .meta a{color:var(--teal-deep)}

  .legend{display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center;margin:26px 0 4px;font-family:var(--sans);font-size:13px;color:var(--muted)}
  .chip{display:inline-flex;align-items:center;gap:5px;font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.03em;padding:3px 10px;border-radius:100px;white-space:nowrap}
  .chip.ok{background:var(--teal-wash);color:var(--teal-deep);border:1px solid color-mix(in srgb,var(--teal) 34%,transparent)}
  .chip.lead{background:var(--gold-wash,#f6efdd);color:var(--gold);border:1px solid color-mix(in srgb,var(--gold) 40%,transparent)}
  .chipnote{font-family:var(--sans);font-size:11.5px;color:var(--muted);margin-left:8px}

  /* guardrail */
  .guard{background:color-mix(in srgb,var(--red) 7%,var(--paper));border:1px solid color-mix(in srgb,var(--red) 26%,transparent);border-left:4px solid var(--red);border-radius:14px;padding:22px 24px;margin:30px 0 8px}
  .guard .lbl{font-family:var(--sans);font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--red);display:block;margin-bottom:8px}
  .guard p{color:var(--ink-soft);font-size:15.5px;line-height:1.55;margin:8px 0}
  .guard b{color:var(--ink)}

  .claim{padding:44px 0 8px;border-top:1px solid var(--hair)}
  .claim .kick{font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--teal-deep)}
  .claim .cl{font-size:clamp(21px,2.9vw,28px);margin:8px 0 0;max-width:32ch;line-height:1.2;letter-spacing:-.01em}
  .claim .cintro{color:var(--ink-soft);font-size:15.5px;max-width:60ch;margin:12px 0 0}
  .claim .also{font-family:var(--sans);font-size:13.5px;color:var(--muted);margin-top:12px;line-height:1.55}

  .src{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-top:16px}
  .src.leaddim{background:color-mix(in srgb,var(--gold) 4%,var(--paper))}
  .src .stop{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap}
  .src .cite{font-family:var(--sans);font-weight:650;font-size:15px;line-height:1.4;max-width:46ch;color:var(--ink)}
  .src .chiprow{display:flex;align-items:center;flex-wrap:wrap}
  .src .find{font-size:17.5px;line-height:1.5;margin:12px 0 0;color:var(--ink)}
  .src .find strong{font-weight:650}
  .src .why{color:var(--ink-soft);font-size:15px;line-height:1.5;margin:11px 0 0;padding-left:14px;border-left:2px solid color-mix(in srgb,var(--teal) 32%,transparent)}
  .src .scope{font-family:var(--sans);font-size:13px;color:var(--muted);margin:11px 0 0}
  .src .scope b{color:var(--ink-soft)}
  .src .links{display:flex;flex-wrap:wrap;gap:10px;margin-top:15px}
  .src .nolink{font-family:var(--sans);font-size:12.5px;color:var(--muted);font-style:italic}

  a.srclink{display:inline-flex;align-items:center;gap:6px;font-family:var(--sans);font-size:13px;font-weight:650;color:var(--paper);background:var(--teal-deep);border:1px solid var(--teal-deep);border-radius:100px;padding:7px 15px;text-decoration:none;line-height:1.2}
  a.srclink::after{content:"\\2197";font-size:12px;opacity:.85}
  a.srclink:hover{background:var(--teal)}
  a.srclink.ours{color:var(--teal-deep);background:transparent;border-color:color-mix(in srgb,var(--teal) 40%,transparent)}
  a.srclink.ours:hover{background:var(--teal-wash)}

  .csec{padding:44px 0 8px;border-top:1px solid var(--hair)}
  .csec .kick{font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--teal-deep)}
  .csec .cl{font-size:clamp(21px,2.9vw,28px);margin:8px 0 0;max-width:34ch;line-height:1.2}
  .tbl{overflow-x:auto;margin-top:18px}
  table{border-collapse:collapse;width:100%;font-family:var(--sans);font-size:14px;min-width:34rem}
  th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--hair);vertical-align:top}
  th{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)}
  td:first-child{font-weight:650;white-space:nowrap;color:var(--ink)}
  td a{color:var(--teal-deep)}
  tr:last-child td{border-bottom:0}

  .model{background:var(--teal-wash);border:1px solid color-mix(in srgb,var(--teal) 26%,transparent);border-radius:16px;padding:26px 26px;margin:18px 0}
  .model h3{font-family:var(--sans);font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--teal-deep);margin:0 0 12px}
  .formula{font-family:var(--mono);font-size:13px;line-height:1.7;background:var(--paper);border:1px solid color-mix(in srgb,var(--teal) 22%,transparent);border-radius:10px;padding:14px 16px;overflow-x:auto;color:var(--ink);margin:0 0 16px}
  .rng3{display:grid;gap:12px}
  @media(min-width:620px){.rng3{grid-template-columns:repeat(3,1fr)}}
  .rng{background:var(--paper);border:1px solid color-mix(in srgb,var(--teal) 22%,transparent);border-radius:12px;padding:16px 18px}
  .rng .k{font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
  .rng .v{font-family:var(--serif);font-size:30px;font-weight:600;color:var(--teal-deep);margin:4px 0 5px;line-height:1}
  .rng .m{font-family:var(--mono);font-size:11.5px;color:var(--muted)}
  .modelnote{color:var(--ink-soft);font-size:14px;line-height:1.55;margin:14px 0 0;font-family:var(--sans)}

  .disc{padding:40px 0 80px}
  .disc .card{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:26px 26px}
  .disc h3{font-size:19px;margin:0}
  .disc p{color:var(--ink-soft);font-size:15px;line-height:1.6;margin:12px 0 0}
  .disc code{font-family:var(--mono);font-size:.9em;background:var(--teal-wash);padding:1px 6px;border-radius:4px}
`;

const BODY = `
<div class="wrap">
  <header class="ehero">
    <div class="eyebrow">The Mindy Institute &middot; Evidence library</div>
    <h1>Supplier Discovery: the case file</h1>
    <p class="sub">The marshaled, verified body of evidence behind the thesis — under-competed public
    solicitations cost governments money, firms mostly don’t bid because they never heard, and a large
    share is a reachable market, not a missing one. Every source links out to the original document.</p>
    <div class="meta">Every citation is real and independently checked. New sources — additive to our
    ${A('/institute', 'white papers', 'meta-link')}. &middot; getmindy.ai</div>

    <div class="legend">
      <span class="chip ok">&#10003; Confirmed</span> finding read directly off the source
      <span class="chip lead">&#9650; Lead</span> real source; exact figure to confirm before printing
    </div>
  </header>

  <div class="guard">
    <span class="lbl">&#9888; The one rule that governs this file — under-SERVED, not under-SUPPLIED</span>
    <p>Our market is <b>categories where a real competitive supplier base already exists but the
    solicitation isn’t reaching it</b> — janitorial, landscaping, IT services, construction trades,
    professional services, commodity goods. Firms exist; they just never heard.</p>
    <p>It is <b>NOT</b> sole-source markets — jet engines, satellites, missile systems — where only
    one vendor can do the work. The supplier-concentration sources below are used <b>only as
    contrast</b>; the size-of-prize model nets true sole-source out.</p>
  </div>

  ${CLAIMS.map(claimBlock).join('')}

  <section class="csec" id="d">
    <div class="kick">Claim D &mdash; contrast only</div>
    <h2 class="cl">Governments already treat supplier concentration as a named cost-and-risk problem &mdash; even in the hard sole-source markets that are <em>not</em> ours.</h2>
    <div class="tbl">
      <table>
        <thead><tr><th>Source</th><th>What it establishes</th><th>Status</th></tr></thead>
        <tbody>
          ${CONTRAST.map(r => `<tr><td>${r.url ? A(r.url, r.src, 'meta-link') : r.src}</td><td>${r.est}</td><td>${r.status === 'confirmed' ? '&#10003; confirmed' : '&#9650; lead'}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  </section>

  <section class="csec" id="size">
    <div class="kick">The size of the prize</div>
    <h2 class="cl">If under-competed <em>contestable</em> solicitations across U.S. state &amp; local government drew more qualified bidders, the savings run to billions a year.</h2>
    <div class="model">
      <h3>The transparent model</h3>
      <div class="formula">annual savings &#8776; [ addressable S&amp;L procurement $ ]
             &#215; [ share under-competed AND contestable ]
             &#215; [ cost reduction from real competition ]</div>
      <div class="rng3">
        <div class="rng"><div class="k">Conservative</div><div class="v">~$5B<span style="font-size:15px">/yr</span></div><div class="m">$0.9T &#215; 18% &#215; ~3%</div></div>
        <div class="rng"><div class="k">Midpoint</div><div class="v">~$26B<span style="font-size:15px">/yr</span></div><div class="m">$1.2T &#215; ~27% &#215; ~8%</div></div>
        <div class="rng"><div class="k">Optimistic</div><div class="v">~$68B<span style="font-size:15px">/yr</span></div><div class="m">$1.5T &#215; ~34% &#215; ~13.5%</div></div>
      </div>
      <p class="modelnote">These are arithmetic on the sourced inputs — not measured outcomes. The
      "contestable" haircut (~&#8532; of single-bid buys) removes genuine sole-source. We present the
      method and the range; we never quote one number. Even the conservative floor is billions.</p>
    </div>
    <div class="tbl">
      <table>
        <thead><tr><th>Input</th><th>Value / range</th><th>Confidence</th></tr></thead>
        <tbody>
          ${SIZE_INPUTS.map(r => `<tr><td>${r.k}</td><td>${r.v}</td><td>${r.conf}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="modelnote" style="margin-top:16px"><b>The data gap is part of the pitch.</b> There is no
    clean, primary, published distribution of bid counts for U.S. municipal/local solicitations. The
    best proxies (US federal single-bid ~44%, EU single-bid &gt;40%) both land near ~40% — stated as
    borrowed from federal + EU analogues, not measured on US local data. That missing dataset is
    exactly what a tool like ${A('/opportunity-map', 'the Mindy map', 'meta-link')} begins to produce.</p>
  </section>

  <section class="disc">
    <div class="card">
      <h3>On this document</h3>
      <p>Every source above is real and independently checked. <b>&#10003; Confirmed</b> = the finding
      was read directly off the source or extracted from the primary PDF; <b>&#9650; Lead</b> = the
      source is real and its figure is to be confirmed before printing in a government-facing document.
      New sources only — additive to the ${A('/institute', 'Institute white papers', 'meta-link')}.
      Mindy is a product of GovCon Giants AI, an independent platform, not affiliated with or endorsed
      by any government agency. Figures are cited as published; none are modeled except the
      explicitly-labeled size-of-prize range.</p>
    </div>
  </section>
</div>`;

export function GET() {
  const html = govPage({
    title: 'Supplier Discovery: the Case File — The Mindy Institute',
    description:
      'The verified evidence behind Supplier Discovery — under-competed public solicitations cost governments money, and a large share is a reachable market, not a missing one. Every source links to the original document.',
    active: 'institute',
    body: `<style>${PAGE_CSS}</style>${BODY}`,
  });
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
