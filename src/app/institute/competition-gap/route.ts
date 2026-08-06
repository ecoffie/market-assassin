/**
 * GET /institute/competition-gap — "The Competition Gap" white paper.
 *
 * POSITIONING / RESEARCH DELIVERABLE (see src/lib/gov/shell.ts). A screen-readable paper
 * with a Download-PDF button (browser print; print @media CSS tuned for clean pagination).
 * The leave-behind behind the /gov argument. Every figure is real and sourced on the final
 * page — no modeled or projected numbers. The honest thesis: the dollars flow (agencies
 * EXCEED the 23% goal), but the supplier base is shrinking and concentrating.
 */
import { NextResponse } from 'next/server';
import { GOV_CSS, govBrand } from '@/lib/gov/shell';

export const dynamic = 'force-static';

const PAPER_CSS = `
  /* Screen layout — a document, not a landing page. */
  body{background:var(--paper-2)}
  .doc{max-width:820px;margin:0 auto;background:var(--paper);box-shadow:0 1px 0 var(--line),0 30px 60px -40px rgba(15,27,45,.35)}
  .docbar{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--paper) 90%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--hair)}
  .docbar .in{max-width:820px;margin:0 auto;padding:0 40px;height:56px;display:flex;align-items:center;justify-content:space-between;gap:16px}
  .docbar .dl{font-family:var(--sans);font-weight:600;font-size:13.5px;color:var(--paper);background:var(--teal-deep);padding:9px 15px;border-radius:8px;text-decoration:none;border:0;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
  .docbar .dl:hover{background:var(--teal)}
  .docbar .back{font-family:var(--sans);font-size:13.5px;color:var(--ink-soft);text-decoration:none;font-weight:500}
  .docbar .back:hover{color:var(--teal-deep)}

  .page{padding:56px 64px}
  .page + .page{border-top:1px solid var(--hair)}
  .paper-h1{font-family:var(--serif);font-size:44px;line-height:1.1;font-weight:600;letter-spacing:-.015em}
  .paper-h2{font-family:var(--serif);font-size:26px;line-height:1.2;font-weight:600;margin:0 0 4px;letter-spacing:-.01em}
  .paper-h3{font-family:var(--serif);font-size:19px;font-weight:600;margin:26px 0 0}
  .snum{font-family:var(--mono);font-size:12px;letter-spacing:.1em;color:var(--teal-deep);font-weight:700;text-transform:uppercase}
  .paper p{font-size:16.5px;line-height:1.66;color:var(--ink-soft);margin:14px 0 0}
  .paper p.first{margin-top:18px}
  .paper b{color:var(--ink);font-weight:600}
  .paper .lead{font-size:18.5px;line-height:1.6;color:var(--ink)}
  .cite{font-family:var(--mono);font-size:11px;color:var(--muted);vertical-align:super;padding:0 1px}

  /* Cover */
  .cover{padding:96px 64px 72px;position:relative;min-height:60vh}
  .cover .tag{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--teal-deep);font-weight:600}
  .cover .sub{font-family:var(--serif);font-size:22px;font-style:italic;color:var(--ink-soft);margin-top:14px;max-width:30ch}
  .cover .meta{margin-top:44px;padding-top:22px;border-top:1px solid var(--line);font-family:var(--mono);font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);line-height:1.9}
  .cover .rule{width:64px;height:3px;background:var(--teal);margin:28px 0 0}

  /* Exhibits */
  .exhibit{margin:26px 0 6px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--paper)}
  .exhibit .cap{background:var(--paper-2);border-bottom:1px solid var(--line);padding:12px 18px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);font-weight:700}
  .exhibit .body{padding:22px 20px}
  .statrow{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;text-align:center}
  .statrow .s .n{font-family:var(--serif);font-size:40px;font-weight:600;line-height:1;color:var(--red);font-variant-numeric:tabular-nums}
  .statrow .s.up .n{color:var(--teal-deep)}
  .statrow .s .l{margin-top:8px;font-size:13px;color:var(--ink-soft);line-height:1.4}
  .statrow .s .src{margin-top:8px;font-family:var(--mono);font-size:9.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--muted)}

  /* Bar exhibit (DoD vendor decline) */
  .bars{display:flex;align-items:flex-end;gap:26px;height:190px;padding:0 10px}
  .bars .col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
  .bars .col .bar{width:74px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,var(--teal),var(--teal-deep))}
  .bars .col.down .bar{background:linear-gradient(180deg,#d47a7e,var(--red))}
  .bars .col .v{font-family:var(--serif);font-weight:600;font-size:18px;margin-bottom:8px;color:var(--ink)}
  .bars .col .yr{margin-top:10px;font-family:var(--mono);font-size:12px;color:var(--muted)}
  .barnote{margin-top:14px;font-size:13px;color:var(--muted);text-align:center;font-style:italic}

  .pull{margin:26px 0 6px;border-left:3px solid var(--teal);padding:6px 0 6px 22px}
  .pull .q{font-family:var(--serif);font-size:22px;line-height:1.35;font-style:italic;color:var(--ink)}
  .pull .who{margin-top:10px;font-family:var(--mono);font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}

  .keylist{margin:16px 0 0;padding:0;list-style:none}
  .keylist li{position:relative;padding:12px 0 12px 30px;border-top:1px solid var(--hair);font-size:16px;line-height:1.55;color:var(--ink-soft)}
  .keylist li:first-child{border-top:0}
  .keylist li::before{content:"";position:absolute;left:2px;top:19px;width:9px;height:9px;border-radius:50%;background:var(--teal)}
  .keylist li b{color:var(--ink)}

  .toc{margin-top:26px;border-top:1px solid var(--line)}
  .toc a{display:flex;justify-content:space-between;gap:20px;padding:13px 0;border-bottom:1px solid var(--hair);text-decoration:none;color:var(--ink)}
  .toc a:hover{color:var(--teal-deep)}
  .toc a .t{font-family:var(--serif);font-size:17px;font-weight:500}
  .toc a .p{font-family:var(--mono);font-size:12px;color:var(--muted)}

  /* Sources */
  .refs{margin-top:18px;counter-reset:ref}
  .refs .r{position:relative;padding:14px 0 14px 40px;border-top:1px solid var(--hair);font-size:14px;line-height:1.55;color:var(--ink-soft)}
  .refs .r:first-child{border-top:0}
  .refs .r::before{counter-increment:ref;content:counter(ref);position:absolute;left:0;top:14px;width:24px;height:24px;border-radius:6px;background:var(--paper-2);border:1px solid var(--line);font-family:var(--mono);font-size:12px;font-weight:700;color:var(--teal-deep);display:grid;place-items:center}
  .refs .r b{color:var(--ink)}

  @media (max-width:760px){
    .page,.cover{padding-left:26px;padding-right:26px}
    .docbar .in{padding:0 20px}
    .statrow{grid-template-columns:1fr;gap:16px}
    .bars{gap:14px;height:160px}.bars .col .bar{width:52px}
    .paper-h1{font-size:34px}
  }

  /* ── PRINT: clean paginated PDF ── */
  @media print{
    @page{size:letter;margin:0.7in 0.75in}
    :root{--paper:#fff;--paper-2:#fff}
    body{background:#fff;font-size:11pt}
    .docbar{display:none}
    .top,footer.gov{display:none}
    .doc{max-width:none;box-shadow:none;margin:0}
    .page,.cover{padding:0;min-height:0}
    .page{break-before:page;padding-top:0}
    .cover{break-after:page}
    .paper-h1{font-size:30pt}
    .paper-h2{font-size:17pt}
    .paper p{font-size:10.5pt;line-height:1.5;color:#1a2433}
    .exhibit,.pull,.bars,.statrow{break-inside:avoid}
    .paper-h2,.paper-h3{break-after:avoid}
    a{color:#0a5c5b;text-decoration:none}
    .cite{color:#666}
  }
`;

// A small helper to keep citation superscripts consistent.
const c = (n: string) => `<sup class="cite">${n}</sup>`;

const BODY = `
<style>${PAPER_CSS}</style>

<div class="docbar"><div class="in">
  <a class="back" href="/institute">&larr; The Institute</a>
  <button class="dl" onclick="window.print()">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>
    Download PDF
  </button>
</div></div>

<article class="doc paper">

  <!-- COVER -->
  <section class="cover">
    <span class="tag">The Mindy Institute for Public Procurement &middot; White Paper No. 1</span>
    <h1 class="paper-h1" style="margin-top:26px;max-width:16ch">The Competition Gap</h1>
    <p class="sub">Why public agencies struggle to reach qualified small businesses &mdash; and what it costs.</p>
    <div class="rule"></div>
    <div class="meta">
      A research paper on supplier discovery in federal procurement<br>
      Published by GovCon Giants AI &middot; getmindy.ai/institute<br>
      All figures cited as published &middot; no data modeled or projected
    </div>
  </section>

  <!-- EXECUTIVE SUMMARY -->
  <section class="page">
    <div class="snum">Executive summary</div>
    <h2 class="paper-h2" style="margin-top:8px">The money is flowing. The supplier base is not.</h2>
    <p class="first lead">Federal agencies are hitting their small-business numbers. In FY2023 the government directed a record <b>28.4%</b> of eligible contract dollars &mdash; <b>$178.6 billion</b> &mdash; to small businesses, well past the 23% statutory goal.${c('1')} By the headline metric, small-business contracting is a success story.</p>
    <p>That headline hides the problem. Over roughly the same period, the number of small businesses actually <em>selling</em> to the government has fallen sharply. From 2010 to 2019, small firms providing common products and services to federal agencies declined <b>38%</b>. The number of <b>new</b> small businesses entering the federal marketplace fell <b>79%</b> from 2005 to 2019.${c('2')} At the Department of Defense, the count of small-business vendors dropped from <b>42,723 in 2011 to 24,296 in 2020</b> &mdash; a 43% decline &mdash; even as the dollars going to small business rose.${c('3')}</p>
    <p>The same money is reaching fewer firms. As one SBA official put it, <b>&ldquo;the increase in small-business dollars obscures that there is less small-business opportunity.&rdquo;</b>${c('2')} The Office of Management and Budget has named the problem directly, making a &ldquo;more diverse and resilient federal marketplace&rdquo; an explicit priority and directing agencies to focus on new-entrant participation.${c('4')}</p>
    <p>This paper argues that the root cause is not how agencies <b>post</b> opportunities. It is how &mdash; or whether &mdash; qualified suppliers <b>discover</b> them. Publishing a solicitation is the solved part. Making sure the right small businesses, especially first-time bidders, find it is the unsolved part. We call that unsolved part <b>the competition gap</b>, and we argue it is now measurable, addressable, and squarely within an agency's control.</p>

    <div class="exhibit">
      <div class="cap">Exhibit 1 &middot; The paradox in three numbers</div>
      <div class="body"><div class="statrow">
        <div class="s"><div class="n">&minus;38%</div><div class="l">small-business suppliers of common goods &amp; services, 2010&ndash;2019</div><div class="src">BPC 2021</div></div>
        <div class="s"><div class="n">&minus;79%</div><div class="l">new small-business entrants, 2005&ndash;2019</div><div class="src">CSIS + SBA, via BPC</div></div>
        <div class="s up"><div class="n">28.4%</div><div class="l">of FY23 dollars to small business &mdash; goal exceeded</div><div class="src">SBA Scorecard</div></div>
      </div></div>
    </div>
  </section>

  <!-- CONTENTS -->
  <section class="page">
    <div class="snum">Contents</div>
    <nav class="toc">
      <a href="#s1"><span class="t">1. The problem: a shrinking, concentrating supplier base</span><span class="p">03</span></a>
      <a href="#s2"><span class="t">2. Why it exists: procurement optimizes for posting, not discovery</span><span class="p">04</span></a>
      <a href="#s3"><span class="t">3. The limits of today's channels</span><span class="p">05</span></a>
      <a href="#s4"><span class="t">4. Why supplier discovery matters</span><span class="p">06</span></a>
      <a href="#s5"><span class="t">5. The future: procurement intelligence</span><span class="p">07</span></a>
      <a href="#s6"><span class="t">6. A vision for measurable competition</span><span class="p">08</span></a>
      <a href="#s7"><span class="t">What an agency can do now</span><span class="p">09</span></a>
      <a href="#refs"><span class="t">Sources</span><span class="p">10</span></a>
    </nav>
  </section>

  <!-- 1 -->
  <section class="page" id="s1">
    <div class="snum">Section 1</div>
    <h2 class="paper-h2">The problem: a shrinking, concentrating supplier base</h2>
    <p class="first">Federal small-business contracting is usually judged by a single number: the share of eligible dollars awarded to small firms against the 23% government-wide goal. By that measure the last several years look excellent &mdash; the goal has been met or exceeded, reaching 28.4% in FY2023.${c('1')} But a dollar share answers only one question: <em>how much money went to small business?</em> It says nothing about <em>how many firms shared it.</em></p>
    <p>When you count firms instead of dollars, the picture inverts. Analysis compiled by the Bipartisan Policy Center found a <b>38% decline</b> in the number of small businesses providing common products and services to the federal government between 2010 and 2019, and a <b>79% decline</b> in new small-business entrants between 2005 and 2019.${c('2')} The Government Accountability Office documented the same dynamic at the Department of Defense: small-business vendors fell from <b>42,723 in 2011 to 24,296 in 2020</b>, even while DoD's small-business obligations increased.${c('3')}</p>

    <div class="exhibit">
      <div class="cap">Exhibit 2 &middot; DoD small-business vendors, 2011 vs. 2020</div>
      <div class="body">
        <div class="bars">
          <div class="col"><div class="v">42,723</div><div class="bar" style="height:100%"></div><div class="yr">2011</div></div>
          <div class="col down"><div class="v">24,296</div><div class="bar" style="height:57%"></div><div class="yr">2020</div></div>
        </div>
        <div class="barnote">A 43% decline in the number of firms &mdash; while total small-business dollars rose. Source: GAO&#8209;22&#8209;104621.</div>
      </div>
    </div>

    <p>These two facts are not in tension; together they define the problem. When the dollar target is met but the number of firms falls, the mathematics are simple: <b>the same allocation is concentrating among fewer suppliers.</b> The Bipartisan Policy Center states it plainly &mdash; &ldquo;fewer small businesses are entering the procurement marketplace and the requisite small-business allocation must go somewhere, which results in greater concentration.&rdquo;${c('2')}</p>
    <p>Concentration is not a small-business advocacy issue alone. Fewer suppliers per requirement means fewer bids, less price tension, more single-award risk, and a supplier base less able to absorb a disruption. It is, in the end, a <b>competition</b> problem &mdash; and competition is the outcome contracting offices are most directly measured on.</p>
  </section>

  <!-- 2 -->
  <section class="page" id="s2">
    <div class="snum">Section 2</div>
    <h2 class="paper-h2">Why it exists: the system optimizes for posting, not discovery</h2>
    <p class="first">Federal procurement is built to make opportunities <b>public</b>. Statute and regulation require open publication; a solicitation posted to the government's system-of-record is, by design, available to anyone. That machinery works. What the system does not do &mdash; what no rule requires and no tool guarantees &mdash; is ensure that the <b>right qualified suppliers actually see and respond</b> to a given requirement.</p>
    <p>The implicit model is discovery-by-search: an opportunity is posted, and firms are expected to find it by monitoring the board. That model quietly assumes every capable supplier is already watching, already registered, already fluent in the codes and keywords that surface a notice. For established incumbents, that assumption largely holds. For the firms the government is losing &mdash; small businesses, and especially <b>new entrants</b> &mdash; it does not.</p>

    <div class="pull">
      <div class="q">Posting isn't the hard part. Reaching qualified small businesses is.</div>
      <div class="who">The reframe at the center of this paper</div>
    </div>

    <p>This is why the standard remedies have limited reach. Raising a dollar goal changes how much money is set aside, not who competes for it. Requiring more outreach events adds effort without a reliable way to know which capable firms were actually reached. The problem is structural: the system measures and enforces <b>publication</b>, then leaves <b>discovery</b> to chance.</p>
    <p>Recognizing this, OMB's 2023 guidance, <em>Creating a More Diverse and Resilient Federal Marketplace</em>, directs agencies to increase management attention specifically on <b>new-entrant participation</b>, &ldquo;where the decline in the supplier base has been especially acute.&rdquo;${c('4')} That is an official acknowledgment that the gap is real and that the lever is discovery &mdash; reaching firms that today's channels do not.</p>
  </section>

  <!-- 3 -->
  <section class="page" id="s3">
    <div class="snum">Section 3</div>
    <h2 class="paper-h2">The limits of today's channels</h2>
    <p class="first">Contracting offices are not passive; they use real tools to widen participation. But each of the common channels has a structural ceiling that leaves the discovery gap open.</p>
    <ul class="keylist">
      <li><b>The posting board.</b> Open publication guarantees availability, not attention. A capable firm that is not monitoring the right codes, keywords, or agencies on the right day simply never sees the notice.</li>
      <li><b>Market research by keyword and code.</b> A manual search returns the firms whose registrations happen to match the terms an officer chose. It systematically misses capable suppliers described differently &mdash; and it cannot surface a firm that has never been in the system before.</li>
      <li><b>Incumbent and known-vendor lists.</b> The fastest path is to invite the firms already on file. That is exactly the mechanism that concentrates awards among the same suppliers and freezes out new entrants.</li>
      <li><b>Outreach events and matchmaking.</b> Valuable, but bounded by who attends, and rarely tied back to a specific requirement or measured for whether the <em>qualified</em> firms were reached.</li>
    </ul>
    <p>None of these is wrong; each is simply incomplete. What they share is a blind spot: they reach the firms already visible to the process. The suppliers driving the 38% and 79% declines are, almost by definition, the ones these channels do not surface. Closing the gap requires a capability the current toolkit lacks &mdash; the ability to identify <b>qualified suppliers the agency is not already reaching</b>, for a specific requirement, and to do it at a scale and specificity a manual search cannot match.</p>
  </section>

  <!-- 4 -->
  <section class="page" id="s4">
    <div class="snum">Section 4</div>
    <h2 class="paper-h2">Why supplier discovery matters</h2>
    <p class="first">Supplier discovery is the missing half of the procurement transaction. Publication makes an opportunity <em>available</em>; discovery makes it <em>found</em> by the firms best positioned to deliver it. When discovery is left to chance, the cost lands in three places every contracting office cares about.</p>
    <p><b>Price and value.</b> The number of qualified bidders per requirement is the most direct lever a contracting office has on price, quality, and delivery risk. Concentration works against all three: fewer credible offers means less tension on price and fewer alternatives when a supplier falters.</p>
    <p><b>Participation that is real, not nominal.</b> Meeting a dollar goal while the number of participating firms shrinks is a hollow success. Genuine small-business participation is measured in <em>firms competing</em> &mdash; and especially in new entrants, the population the data shows the government has been losing fastest.${c('2')}</p>
    <p><b>Resilience.</b> A concentrated supplier base is a brittle one. When a handful of firms hold a category, a single disruption &mdash; a merger, an exit, a shock &mdash; has outsized effect. Breadth of qualified suppliers is what lets the government weather that. This is precisely the concern OMB names in calling for a more &ldquo;resilient&rdquo; marketplace.${c('4')}</p>

    <div class="pull">
      <div class="q">Discovery is the difference between an opportunity that is public and one that is genuinely competed.</div>
      <div class="who">Section 4</div>
    </div>
  </section>

  <!-- 5 -->
  <section class="page" id="s5">
    <div class="snum">Section 5</div>
    <h2 class="paper-h2">The future: procurement intelligence</h2>
    <p class="first">The public record needed to solve discovery already exists. Federal award history, entity registration, and capability signals describe, in the open, which firms have done what work, for whom, and where. The barrier has never been data availability &mdash; it has been the ability to <b>read that record at scale</b> and turn it into a specific, defensible answer to a specific question: <em>for this requirement, which qualified suppliers are we not reaching?</em></p>
    <p>That is what modern supplier intelligence makes possible. Instead of matching the keywords an officer thought to type, it reasons over what firms have actually delivered and can plausibly deliver &mdash; surfacing capable suppliers, including new entrants, that a manual search structurally misses. It complements the existing process rather than replacing it: the agency still writes the requirement, still runs the solicitation, still evaluates and awards under the same rules. The only thing that changes is that the right firms find the opportunity.</p>

    <div class="exhibit">
      <div class="cap">Exhibit 3 &middot; From posting to discovery</div>
      <div class="body">
        <ul class="keylist" style="margin:0">
          <li><b>Today.</b> Agency writes the requirement &rarr; posts the solicitation &rarr; hopes the right vendors find it. Result: the same incumbents bid; competition stays flat.</li>
          <li><b>With supplier intelligence.</b> Agency defines the requirement &rarr; the market is mapped and qualified suppliers (including new entrants) are identified &rarr; those suppliers discover the opportunity. Result: more qualified competition, broader participation, better outcomes.</li>
        </ul>
      </div>
    </div>

    <p>The distinction that matters is this: procurement intelligence is not another portal to post into. It is a layer that answers the discovery question the posting board cannot &mdash; and it does so on the requirements an office chooses, without asking anyone to change the rules they operate under.</p>
  </section>

  <!-- 6 -->
  <section class="page" id="s6">
    <div class="snum">Section 6</div>
    <h2 class="paper-h2">A vision for measurable competition</h2>
    <p class="first">If discovery is the lever, then competition has to become something an agency can <b>measure at the requirement level</b> &mdash; not just infer from an annual dollar total. A dollar share is a lagging, aggregate figure; it can rise while the number of firms falls. The metrics that would actually surface the competition gap are more specific:</p>
    <ul class="keylist">
      <li><b>Qualified suppliers reached</b> for a requirement, beyond the firms already on file &mdash; a direct read on whether discovery widened the pool.</li>
      <li><b>New entrants engaged</b> &mdash; the share of qualified firms that have not bid with the office before, aimed squarely at the population in decline.</li>
      <li><b>Change in qualified participation</b> against a baseline &mdash; did more capable firms actually respond than would have otherwise?</li>
    </ul>
    <p>Measured this way, competition stops being an abstraction and becomes a managed outcome. An office can set a baseline for a requirement, apply supplier discovery, and see whether the qualified pool widened &mdash; the same discipline procurement already applies to cost and schedule, extended to the one outcome that has resisted it.</p>
    <p>None of this requires a regulatory change or a new mandate. It requires treating discovery as a measurable step in the process rather than an assumption &mdash; and giving contracting offices a way to reach the qualified suppliers, especially the new ones, that today's channels leave out.</p>
  </section>

  <!-- WHAT AN AGENCY CAN DO -->
  <section class="page" id="s7">
    <div class="snum">In practice</div>
    <h2 class="paper-h2">What an agency can do now</h2>
    <p class="first">The competition gap is addressable without waiting for policy to change. A contracting office can test the thesis on a single, real requirement:</p>
    <ul class="keylist">
      <li><b>Pick one requirement</b> &mdash; an upcoming or recurring buy where more qualified small-business competition would help.</li>
      <li><b>Baseline the competition</b> &mdash; establish what participation looks like today for that requirement, so any change is measurable rather than anecdotal.</li>
      <li><b>Run a discovery scan</b> &mdash; map the real market and identify qualified suppliers beyond the current vendor list, including firms new to the marketplace.</li>
      <li><b>Measure the difference</b> &mdash; compare qualified participation against the baseline, and decide whether to extend the approach to more requirements.</li>
    </ul>
    <p>This is the pilot the Mindy Institute proposes: a focused engagement on one requirement, judged against metrics the office already cares about. It changes nothing about how the agency solicits, evaluates, or awards. It simply closes the gap between an opportunity that is <em>public</em> and one that is genuinely <em>found</em> &mdash; and lets the office see, on its own requirement, what widening the qualified pool is worth.</p>
    <p class="lead" style="margin-top:22px">The dollars are already flowing. The next gain in public procurement will not come from posting more &mdash; it will come from making sure the right suppliers discover what is already there.</p>
  </section>

  <!-- SOURCES -->
  <section class="page" id="refs">
    <div class="snum">Sources</div>
    <h2 class="paper-h2">References</h2>
    <p class="first" style="margin-bottom:6px">Every figure in this paper is cited as published by its original source. No data is modeled, projected, or estimated by the author.</p>
    <div class="refs">
      <div class="r"><b>U.S. Small Business Administration.</b> Small Business Procurement Scorecard (FY2023). The federal government awarded a record 28.4% of eligible contract dollars &mdash; $178.6 billion &mdash; to small businesses, exceeding the 23% statutory goal. sba.gov/federal-contracting/contracting-data/small-business-procurement-scorecard.</div>
      <div class="r"><b>Bipartisan Policy Center.</b> <em>Supporting Small Business and Strengthening the Economy Through Procurement Reform</em> (2021). Reports a 38% decline (2010&ndash;2019) in small businesses providing common goods and services, and a 79% decline (2005&ndash;2019) in new small-business entrants (combining a CSIS analysis of 2005&ndash;2016 with SBA data through 2019); includes the cited SBA-official statement on concentration. bipartisanpolicy.org.</div>
      <div class="r"><b>U.S. Government Accountability Office.</b> <em>Small Business Contracting: Actions Needed to Implement and Monitor DoD's Small Business Strategy</em>, GAO&#8209;22&#8209;104621 (2022). Documents the decline in DoD small-business vendors from 42,723 (2011) to 24,296 (2020) alongside rising small-business obligations. gao.gov.</div>
      <div class="r"><b>Office of Management and Budget.</b> Memorandum M&#8209;23&#8209;11, <em>Creating a More Diverse and Resilient Federal Marketplace</em> (2023). Directs agencies to increase attention on new-entrant participation, where the supplier-base decline has been especially acute. whitehouse.gov.</div>
    </div>
    <p style="margin-top:26px;font-family:var(--mono);font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)">The Mindy Institute for Public Procurement &middot; A program of GovCon Giants AI &middot; getmindy.ai/institute</p>
  </section>

</article>
`;

const HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Competition Gap — A White Paper on Supplier Discovery in Federal Procurement</title>
<meta name="description" content="Why public agencies struggle to reach qualified small businesses — and what it costs. A grounded white paper from The Mindy Institute for Public Procurement.">
<style>${GOV_CSS}</style>
</head><body>
<div class="top"><div class="wrap" style="justify-content:space-between">${govBrand()}<a class="topcta" href="/pilot">Run a pilot</a></div></div>
${BODY}
</body></html>`;

export function GET() {
  return new NextResponse(HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
