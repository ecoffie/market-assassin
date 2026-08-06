/**
 * GET /gov — Mindy for Government landing page (the APEX QR-code sales tool).
 *
 * POSITIONING PAGE ONLY (see src/lib/gov/shell.ts). No app/auth/DB. Public + indexable.
 * Every statistic is real and sourced in the footer. The thesis is the "discovery problem,
 * not a posting problem" reframe, grounded in the government's own numbers.
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';

export const dynamic = 'force-static';

const PAGE_CSS = `
  .hero{padding:88px 0 24px;position:relative;overflow:hidden}
  .hero .wrap{position:relative;z-index:1}
  .hero h1{font-size:clamp(38px,6.4vw,68px);margin:22px 0 0;max-width:15ch}
  .hero h1 .hl{color:var(--teal-deep);font-style:italic}
  .hero .sub{font-size:clamp(18px,2.3vw,22px);color:var(--ink-soft);max-width:60ch;margin:24px 0 0;line-height:1.5}
  .hero .cta-row{margin-top:34px}
  .heroline{display:flex;gap:28px;flex-wrap:wrap;margin-top:44px;padding-top:26px;border-top:1px solid var(--hair);color:var(--muted);font-size:13.5px}
  .heroline b{color:var(--ink);font-weight:600}
  .hero-bg{position:absolute;inset:0;z-index:0;opacity:.5;pointer-events:none}

  .reframe{background:var(--ink);color:var(--paper);padding:76px 0}
  .reframe .eyebrow{color:var(--teal)}
  .reframe .quote{font-family:var(--serif);font-size:clamp(26px,4vw,40px);line-height:1.25;font-weight:500;max-width:20ch;margin:18px 0 0;letter-spacing:-.01em}
  .reframe .quote .strike{position:relative;color:color-mix(in srgb,var(--paper) 55%,transparent)}
  .reframe .quote .strike::after{content:"";position:absolute;left:-2%;right:-2%;top:52%;height:2px;background:var(--red);transform:rotate(-1.5deg)}
  .reframe .quote em{color:var(--teal);font-style:italic}
  .reframe .exp{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:44px;max-width:820px}
  .reframe .exp .cell{border-left:2px solid color-mix(in srgb,var(--paper) 20%,transparent);padding-left:18px}
  .reframe .exp .cell.now{border-color:var(--red)}
  .reframe .exp .cell.next{border-color:var(--teal)}
  .reframe .exp .l{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:color-mix(in srgb,var(--paper) 60%,transparent);font-weight:600}
  .reframe .exp .t{margin-top:8px;font-size:16px;color:color-mix(in srgb,var(--paper) 88%,transparent);line-height:1.5}

  .proof{padding:80px 0}
  .proof h2{font-size:clamp(28px,4vw,40px);max-width:16ch}
  .proof .lede{color:var(--ink-soft);font-size:18px;max-width:56ch;margin:16px 0 0}
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-top:40px}
  .stat{background:var(--paper);padding:30px 26px}
  .stat .fig{font-family:var(--serif);font-size:clamp(44px,6vw,60px);font-weight:600;line-height:1;color:var(--red);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .stat .cap{margin-top:12px;font-size:15px;color:var(--ink-soft);line-height:1.45}
  .stat .src{margin-top:14px;font-family:var(--mono);font-size:10.5px;letter-spacing:.03em;color:var(--muted);text-transform:uppercase}
  .paradox{margin-top:34px;background:var(--paper-2);border:1px solid var(--line);border-radius:16px;padding:32px 30px;display:flex;gap:22px;align-items:flex-start}
  .paradox .mark{font-family:var(--serif);font-size:56px;line-height:.7;color:var(--teal);flex:none}
  .paradox .q{font-family:var(--serif);font-size:clamp(19px,2.6vw,24px);line-height:1.4;color:var(--ink);font-style:italic}
  .paradox .who{margin-top:12px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-style:normal}

  .diagram{background:var(--paper-2);border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);padding:80px 0}
  .diagram h2{font-size:clamp(26px,3.6vw,36px);max-width:18ch}
  .flowgrid{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;margin-top:44px;align-items:stretch}
  .flow{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:26px 24px}
  .flow.today{border-color:color-mix(in srgb,var(--red) 30%,var(--line))}
  .flow.tomorrow{border-color:color-mix(in srgb,var(--teal) 40%,var(--line));box-shadow:0 1px 0 var(--teal-wash),0 20px 40px -28px rgba(14,124,123,.5)}
  .flow .badge{display:inline-block;font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;padding:5px 11px;border-radius:999px}
  .flow.today .badge{background:var(--red-wash);color:var(--red)}
  .flow.tomorrow .badge{background:var(--teal-wash);color:var(--teal-deep)}
  .flow .step{display:flex;align-items:center;gap:12px;padding:12px 0;font-size:16px;color:var(--ink)}
  .flow .step + .step{border-top:1px dashed var(--hair)}
  .flow .step .dot{width:9px;height:9px;border-radius:50%;flex:none;background:var(--muted)}
  .flow.today .step .dot{background:var(--red)}
  .flow.tomorrow .step .dot{background:var(--teal)}
  .flow .out{margin-top:10px;padding-top:14px;border-top:1px solid var(--line);font-family:var(--serif);font-style:italic;font-size:16px}
  .flow.today .out{color:var(--red)}
  .flow.tomorrow .out{color:var(--teal-deep)}
  .vs{display:grid;place-items:center}
  .vs span{background:var(--paper);border:1px solid var(--line);border-radius:999px;width:44px;height:44px;display:grid;place-items:center;font-family:var(--mono);font-size:12px;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;font-weight:700}

  .how{padding:80px 0}
  .how h2{font-size:clamp(26px,3.6vw,36px);max-width:16ch}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:40px}
  .card{border:1px solid var(--line);border-radius:16px;padding:28px 24px;background:var(--paper)}
  .card .n{font-family:var(--mono);font-size:12px;font-weight:700;color:var(--teal-deep);letter-spacing:.06em}
  .card h3{font-size:20px;margin:14px 0 0}
  .card p{margin-top:10px;color:var(--ink-soft);font-size:15.5px;line-height:1.55}

  .why{background:var(--ink);color:var(--paper);padding:76px 0}
  .why .eyebrow{color:var(--teal)}
  .why h2{color:var(--paper);font-size:clamp(26px,3.6vw,36px);max-width:20ch;margin-top:16px}
  .whygrid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:40px}
  .whygrid .w{border-top:2px solid var(--teal);padding-top:18px}
  .whygrid .w h3{color:var(--paper);font-size:18px}
  .whygrid .w p{margin-top:10px;color:color-mix(in srgb,var(--paper) 78%,transparent);font-size:15px;line-height:1.55}

  .pilot{padding:84px 0}
  .pilotcard{background:linear-gradient(160deg,var(--teal-wash),var(--paper));border:1px solid color-mix(in srgb,var(--teal) 26%,var(--line));border-radius:22px;padding:52px 44px;text-align:center}
  .pilotcard .eyebrow{color:var(--teal-deep)}
  .pilotcard h2{font-size:clamp(28px,4vw,42px);margin:16px auto 0;max-width:18ch}
  .pilotcard p{color:var(--ink-soft);font-size:18px;max-width:52ch;margin:16px auto 0}
  .pilotcard .cta-row{justify-content:center;margin-top:30px}
  .pilotcard .fineprint{margin-top:20px;font-family:var(--mono);font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}

  @media (max-width:820px){
    .reframe .exp,.stats,.steps,.whygrid{grid-template-columns:1fr}
    .flowgrid{grid-template-columns:1fr}
    .vs{padding:4px 0}.vs span{transform:rotate(90deg)}
    .hero{padding:60px 0 16px}
    .paradox{flex-direction:column;gap:10px}
  }
`;

const BODY = `
<style>${PAGE_CSS}</style>

<header class="hero">
  <svg class="hero-bg" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="var(--hair)" stroke-width="1"/></pattern></defs>
    <rect width="1200" height="400" fill="url(#grid)"/>
  </svg>
  <div class="wrap">
    <span class="kicker">The Mindy Institute for Public Procurement</span>
    <h1>Increase competition. Reach the small businesses you're <span class="hl">missing</span>.</h1>
    <p class="sub">Mindy helps public agencies reach qualified small businesses beyond traditional procurement channels &mdash; using AI-powered supplier intelligence, not another posting board.</p>
    <div class="cta-row">
      <a class="btn primary" href="/pilot">Start a pilot &rarr;</a>
      <a class="btn ghost" href="#how">See how it works</a>
    </div>
    <div class="heroline">
      <span><b>The reframe:</b> agencies don't have a posting problem &mdash; they have a discovery problem.</span>
      <span><b>The proof:</b> a 38% smaller supplier base, and 79% fewer new entrants.</span>
    </div>
  </div>
</header>

<section class="reframe">
  <div class="wrap">
    <span class="eyebrow">The idea worth 30 seconds</span>
    <p class="quote">Every procurement office has a <span class="strike">posting problem</span>.<br>We think they have a <em>discovery problem</em>.</p>
    <div class="exp">
      <div class="cell now"><div class="l">Posting isn't the hard part</div><div class="t">Solicitations get published. The system assumes the right vendors will find them &mdash; and hopes they do.</div></div>
      <div class="cell next"><div class="l">Discovery is</div><div class="t">Reaching qualified small businesses &mdash; especially the ones that have never bid before &mdash; is where competition is actually won or lost.</div></div>
    </div>
  </div>
</section>

<section class="proof" id="challenge">
  <div class="wrap">
    <span class="eyebrow">The Competition Gap</span>
    <h2 style="margin-top:14px">The dollars are flowing. The supplier base is shrinking.</h2>
    <p class="lede">Federal agencies exceeded the 23% small-business goal &mdash; a record 28.4%, or $178.6 billion, in FY2023. But that headline hides where the money actually goes: to a smaller and smaller pool of the same firms.</p>
    <div class="stats">
      <div class="stat"><div class="fig">&minus;38%</div><div class="cap">decline in small businesses providing common products and services to the federal government, 2010&ndash;2019.</div><div class="src">Bipartisan Policy Center, 2021</div></div>
      <div class="stat"><div class="fig">&minus;79%</div><div class="cap">decline in <b>new</b> small-business entrants into federal contracting, 2005&ndash;2019.</div><div class="src">CSIS + SBA, via BPC 2021</div></div>
      <div class="stat"><div class="fig">&minus;43%</div><div class="cap">fewer small-business vendors at DoD &mdash; from 42,723 in 2011 to 24,296 in 2020 &mdash; even as SB dollars rose.</div><div class="src">GAO&#8209;22&#8209;104621</div></div>
    </div>
    <div class="paradox">
      <div class="mark">&ldquo;</div>
      <div><div class="q">The increase in small-business dollars obscures that there is less small-business opportunity.</div>
      <div class="who">&mdash; SBA official, quoted in the Bipartisan Policy Center's procurement-reform report (2021)</div></div>
    </div>
  </div>
</section>

<section class="diagram">
  <div class="wrap">
    <span class="eyebrow">What changes</span>
    <h2 style="margin-top:14px">From <span style="color:var(--red)">hope they find it</span> to <span style="color:var(--teal-deep)">make sure they do</span>.</h2>
    <div class="flowgrid">
      <div class="flow today">
        <span class="badge">Today</span>
        <div class="step"><span class="dot"></span> Agency writes the requirement</div>
        <div class="step"><span class="dot"></span> Posts the solicitation</div>
        <div class="step"><span class="dot"></span> Hopes the right vendors find it</div>
        <div class="out">Result: the same incumbents bid. Competition stays flat.</div>
      </div>
      <div class="vs"><span>vs</span></div>
      <div class="flow tomorrow">
        <span class="badge">With Mindy</span>
        <div class="step"><span class="dot"></span> Agency defines the requirement</div>
        <div class="step"><span class="dot"></span> Mindy identifies qualified suppliers &mdash; including new entrants</div>
        <div class="step"><span class="dot"></span> Suppliers discover the opportunity</div>
        <div class="out">Result: more competition. Better procurement outcomes.</div>
      </div>
    </div>
  </div>
</section>

<section class="how" id="how">
  <div class="wrap">
    <span class="eyebrow">How Mindy works</span>
    <h2 style="margin-top:14px">Supplier intelligence, not another portal.</h2>
    <div class="steps">
      <div class="card"><div class="n">01</div><h3>Map the real market</h3><p>Mindy reads federal award history, capability signals, and registration data to build a live picture of which firms can actually deliver a given requirement &mdash; not just who happens to be watching the board.</p></div>
      <div class="card"><div class="n">02</div><h3>Surface qualified suppliers</h3><p>For any requirement, Mindy identifies capable small businesses by what they've done and what they can do &mdash; including new entrants who've never been in your pipeline.</p></div>
      <div class="card"><div class="n">03</div><h3>Close the discovery gap</h3><p>Those suppliers get pointed to the opportunity, so the right firms respond. More qualified bids, broader participation, measurable competition &mdash; on the requirements you choose.</p></div>
    </div>
  </div>
</section>

<section class="why">
  <div class="wrap">
    <span class="eyebrow">Why it matters</span>
    <h2>Competition is the outcome agencies are measured on &mdash; and the one hardest to move.</h2>
    <div class="whygrid">
      <div class="w"><h3>Better pricing &amp; outcomes</h3><p>More qualified bidders per requirement is the most direct lever on price, quality, and delivery risk that a contracting office controls.</p></div>
      <div class="w"><h3>Real small-business participation</h3><p>Not just hitting a dollar goal &mdash; expanding the actual number of firms competing, including the new entrants the government has been losing.</p></div>
      <div class="w"><h3>A resilient supplier base</h3><p>OMB has already named this a priority in "Creating a More Diverse and Resilient Federal Marketplace." Discovery is how you get there.</p></div>
    </div>
  </div>
</section>

<section class="pilot" id="pilot">
  <div class="wrap">
    <div class="pilotcard">
      <span class="eyebrow">Pilot program</span>
      <h2>Run a discovery pilot on one real requirement.</h2>
      <p>Pick a solicitation. We'll show you the qualified suppliers your current channels are missing &mdash; and measure the difference in competition. No procurement change required to start.</p>
      <div class="cta-row">
        <a class="btn primary" href="mailto:hello@getmindy.ai?subject=Mindy%20for%20Government%20%E2%80%94%20Pilot%20inquiry">Schedule a demo &rarr;</a>
        <a class="btn ghost" href="/pilot">See the pilot details</a>
      </div>
      <div class="fineprint">A program of The Mindy Institute for Public Procurement</div>
    </div>
  </div>
</section>
`;

const HTML = govPage({
  title: 'Mindy for Government — A Discovery Problem, Not a Posting Problem',
  description:
    "Public agencies don't have a posting problem — they have a discovery problem. Mindy helps agencies reach qualified small businesses beyond traditional procurement channels using AI-powered supplier intelligence.",
  active: 'gov',
  body: BODY,
});

export function GET() {
  return new NextResponse(HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
