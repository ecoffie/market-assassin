/**
 * GET /gov/apex — "For APEX Accelerators" — the SHARED-MISSION page + NAPEX conference surface.
 *
 * MOVED from /partners (2026-08-16) so the conference QR prints ONE clean URL:
 * getmindy.ai/gov/apex. /partners 308s here — printed collateral and any existing
 * link must never break.
 *
 * FOUNDING 50 IS NOT APEX (Eric, 2026-08-16). The 50 are PUBLIC BUYING
 * ORGANIZATIONS — cities, counties, transit, school districts. An APEX counselor
 * cannot "join" it; their role is the INTRODUCTION to a city's procurement
 * leadership they already work with. So the CTA is "Introduce a buying
 * organization", never "Join the Founding 50" — an ask a counselor can actually
 * act on.
 *
 * POSITIONING PAGE ONLY (src/lib/gov/shell.ts). Rebuilt from a strong external critique:
 * sell a SHARED MISSION, not a partnership ("we exist because you exist"). Agencies are the
 * primary market; APEX is the most important distribution partner. Coins and repeats one
 * category name — "Supplier Discovery" — and owns it. Ends on a mission statement, not a CTA.
 *
 * GROUNDED: APEX facts real (DoD OSBP, ~650 counselors). Counties are REAL but ANONYMIZED and
 * described exactly at their true stage — ONBOARDING to bring Supplier Discovery to their live
 * procurements (NOT a live pilot with results). The −38%/−79% figures carry the shared sources
 * footer. Honesty guardrail: "not affiliated with or endorsed by the APEX Accelerators program."
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';

export const dynamic = 'force-static';

const PAGE_CSS = `
  /* Founding 50 — the collaborative, and the counselor's role in it */
  .f50{padding:76px 0;background:var(--mp-wash);color:var(--mp-ink);border-top:1px solid var(--mp-line);border-bottom:1px solid var(--mp-line)}
  .f50 .eyebrow{color:var(--mp-accent)}
  .f50 h2{font-size:clamp(26px,3.6vw,38px);max-width:20ch;color:var(--mp-ink);margin:14px 0 0}
  .f50 .lede{color:var(--mp-body);font-size:18px;max-width:60ch;margin:16px 0 0;line-height:1.6}
  .f50 .notclaim{margin-top:22px;padding:16px 20px;border-left:2px solid var(--mp-navy);background:var(--mp-surface);border-radius:0;font-size:15px;line-height:1.6;color:var(--mp-body);max-width:62ch}
  .steps{display:grid;gap:14px;margin-top:34px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
  .step{border:1px solid var(--mp-line);border-radius:0;padding:20px;background:var(--mp-surface)}
  .step .n{font-family:var(--mp-font-mono);font-size:11px;letter-spacing:.1em;color:var(--mp-navy);font-weight:600}
  .step h3{font-family:var(--mp-font-serif);font-size:18px;font-weight:700;margin:10px 0 0;color:var(--mp-ink);line-height:1.25}
  .step p{margin-top:8px;font-size:14.5px;line-height:1.55;color:var(--mp-body)}

  /* the introduction form */
  .intro{padding:76px 0}
  .intro h2{font-size:clamp(26px,3.6vw,36px);max-width:18ch}
  .intro .lede{color:var(--mp-body);font-size:17.5px;max-width:56ch;margin:14px 0 0;line-height:1.6}
  .frm{margin-top:32px;max-width:720px}
  .frm .row{display:grid;gap:16px;grid-template-columns:1fr 1fr}
  @media(max-width:640px){.frm .row{grid-template-columns:1fr}}
  .frm label{display:block;margin-top:16px;font-size:13px;font-weight:600;color:var(--mp-ink)}
  .frm .opt{font-weight:400;color:var(--mp-muted)}
  .frm input,.frm select,.frm textarea{margin-top:6px;width:100%;padding:11px 13px;border:1px solid var(--mp-line);border-radius:8px;font:inherit;font-size:15px;background:var(--mp-surface);color:var(--mp-ink)}
  .frm input:focus-visible,.frm select:focus-visible,.frm textarea:focus-visible{border-color:var(--mp-navy)}
  .frm textarea{min-height:88px;resize:vertical}
  .frm .btn{margin-top:22px}
  .frm .note{margin-top:14px;font-size:13px;color:var(--mp-muted);line-height:1.55;max-width:56ch}
  .frm .ok{margin-top:18px;padding:16px 18px;border:1px solid var(--mp-navy);border-radius:0;background:var(--mp-navy-wash);font-size:15px;line-height:1.55}

  /* hero — the shared-mission triad */
  .phero{padding:84px 0 20px}
  .phero .kicker{margin-bottom:24px}
  .triad{display:grid;gap:2px}
  .triad .t1,.triad .t2{font-family:var(--mp-font-serif);font-weight:700;font-size:clamp(30px,5vw,52px);line-height:1.08;letter-spacing:-.015em}
  .triad .t2{color:var(--mp-navy)}
  .triad .t3{font-family:var(--mp-font-serif);font-weight:400;font-size:clamp(22px,3.4vw,34px);line-height:1.15;letter-spacing:-.01em;color:var(--mp-ink);margin-top:18px;max-width:24ch}
  .phero .sub{font-size:clamp(17px,2.2vw,21px);color:var(--mp-body);max-width:56ch;margin:26px 0 0;line-height:1.5}
  .phero .cta-row{margin-top:30px}

  /* now-onboarding proof strip */
  .proofstrip{margin-top:38px;background:var(--mp-surface);color:var(--mp-body);border:1px solid var(--mp-line);border-radius:0;padding:20px 26px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  .proofstrip .pulse{width:11px;height:11px;border-radius:50%;background:var(--mp-accent);flex:none;box-shadow:0 0 0 0 color-mix(in srgb,var(--mp-accent) 60%,transparent);animation:pl 2.4s infinite}
  @keyframes pl{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--mp-accent) 55%,transparent)}70%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}
  @media (prefers-reduced-motion:reduce){.proofstrip .pulse{animation:none}}
  .proofstrip .txt{font-size:16px;line-height:1.45}
  .proofstrip .txt b{color:var(--mp-ink);font-weight:600}
  .proofstrip .lbl{font-family:var(--mp-font-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--mp-accent);font-weight:600;margin-right:5px}

  /* one mission, two sides */
  .ends{padding:76px 0}
  .ends h2{font-size:clamp(26px,3.6vw,38px);max-width:16ch}
  .ends .lede{color:var(--mp-body);font-size:18px;max-width:58ch;margin:14px 0 0;line-height:1.6}
  .pair{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;margin-top:40px;align-items:stretch}
  .side{border:1px solid var(--mp-line);border-radius:0;padding:28px 26px;background:var(--mp-surface)}
  .side.apex{border-top:2px solid var(--mp-accent)}
  .side.mindy{border-top:2px solid var(--mp-navy)}
  .side .who{font-family:var(--mp-font-mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:600}
  .side.apex .who{color:var(--mp-accent)}
  .side.mindy .who{color:var(--mp-navy)}
  .side h3{font-family:var(--mp-font-serif);font-size:22px;font-weight:700;margin:12px 0 0;line-height:1.2}
  .side p{margin-top:12px;color:var(--mp-body);font-size:15.5px;line-height:1.55}
  .side ul{margin:14px 0 0;padding:0;list-style:none}
  .side li{position:relative;padding:8px 0 8px 22px;font-size:14.5px;color:var(--mp-body);line-height:1.5}
  .side li::before{content:"";position:absolute;left:2px;top:15px;width:7px;height:7px;border-radius:50%}
  .side.apex li::before{background:var(--mp-accent)}
  .side.mindy li::before{background:var(--mp-navy)}
  .joiner{display:grid;place-items:center}
  .joiner span{width:46px;height:46px;border-radius:999px;background:var(--mp-surface);border:1px solid var(--mp-line);display:grid;place-items:center;color:var(--mp-navy)}
  .joiner span svg{width:22px;height:22px}

  /* the philosophy band — the best sentence, made huge */
  .philo{background:var(--mp-wash);color:var(--mp-ink);border-top:1px solid var(--mp-line);border-bottom:1px solid var(--mp-line);padding:80px 0}
  .philo .eyebrow{color:var(--mp-accent);display:block;text-align:center;margin-bottom:22px}
  .philo p{font-family:var(--mp-font-serif);font-size:clamp(28px,5vw,52px);line-height:1.16;font-weight:400;text-align:center;max-width:20ch;margin:0 auto;letter-spacing:-.015em}
  .philo p b{color:var(--mp-navy);font-weight:700;font-style:normal}

  /* why discovery matters — the flow diagram */
  .whyd{padding:76px 0}
  .whyd h2{font-size:clamp(26px,3.6vw,36px);max-width:16ch}
  .whyd .lede{color:var(--mp-body);font-size:17.5px;max-width:56ch;margin:14px 0 0;line-height:1.6}
  .flows{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:40px}
  .flow{border:1px solid var(--mp-line);border-radius:0;padding:26px 24px;background:var(--mp-surface)}
  .flow.trad{border-top:2px solid var(--mp-muted)}
  .flow.disc{border-top:2px solid var(--mp-navy)}
  .flow .badge{display:inline-block;font-family:var(--mp-font-mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;padding:5px 11px;border-radius:6px;margin-bottom:8px}
  .flow.trad .badge{background:var(--mp-wash);color:var(--mp-muted)}
  .flow.disc .badge{background:var(--mp-navy-wash);color:var(--mp-navy)}
  .flow .step{display:flex;align-items:center;gap:11px;padding:10px 0;font-size:15px;color:var(--mp-ink)}
  .flow .step .dot{width:8px;height:8px;border-radius:50%;flex:none}
  .flow.trad .step .dot{background:var(--mp-muted)}
  .flow.disc .step .dot{background:var(--mp-navy)}
  .flow .arrow{color:var(--mp-faint);text-align:center;font-size:14px;line-height:0;padding:1px 0}
  .flow.disc .arrow{color:var(--mp-navy)}
  .flow .term{margin-top:8px;padding-top:12px;border-top:1px solid var(--mp-line);font-family:var(--mp-font-serif);font-style:italic;font-size:15.5px}
  .flow.trad .term{color:var(--mp-muted)}
  .flow.disc .term{color:var(--mp-navy)}

  /* the supplier base is shrinking */
  .shared{background:var(--mp-wash);border-top:1px solid var(--mp-hair);border-bottom:1px solid var(--mp-hair);padding:70px 0}
  .shared h2{font-size:clamp(26px,3.8vw,40px);max-width:14ch}
  .shared p{color:var(--mp-body);font-size:18px;max-width:52ch;margin:14px 0 0;line-height:1.55}
  .shared p b{color:var(--mp-ink)}
  .shared .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--mp-line);border:1px solid var(--mp-line);border-radius:0;overflow:hidden;margin-top:30px}
  .shared .st{background:var(--mp-surface);padding:22px 20px;text-align:center}
  .shared .st .n{font-family:var(--mp-font-serif);font-size:40px;font-weight:700;line-height:1;color:var(--mp-accent);font-variant-numeric:tabular-nums}
  .shared .st.up .n{color:var(--mp-navy)}
  .shared .st .l{margin-top:9px;font-size:13px;color:var(--mp-body);line-height:1.4}
  .shared .st .s{margin-top:9px;font-family:var(--mp-font-mono);font-size:9.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--mp-muted)}

  /* why we're studying this — authority */
  .study{padding:76px 0}
  .study .band{border:1px solid var(--mp-line);border-radius:0;padding:44px 40px;background:var(--mp-surface)}
  .study .eyebrow{color:var(--mp-accent)}
  .study h2{font-size:clamp(24px,3.4vw,32px);margin:14px 0 0;max-width:22ch}
  .study .q{font-family:var(--mp-font-serif);font-size:clamp(20px,2.8vw,26px);font-style:italic;color:var(--mp-ink);margin:18px 0 0;max-width:26ch;line-height:1.3}
  .study p{color:var(--mp-body);font-size:16.5px;margin:18px 0 0;line-height:1.6;max-width:56ch}
  .study .topics{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}
  .study .topic{font-family:var(--mp-font-mono);font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;color:var(--mp-navy);background:var(--mp-navy-wash);border:1px solid var(--mp-line);padding:7px 13px;border-radius:6px}
  .study .link{margin-top:22px;font-family:var(--mp-font-sans);font-weight:600;font-size:15px;color:var(--mp-navy);text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  .study .link:hover{color:var(--mp-navy-hover);text-decoration:underline}

  /* how a counselor plugs in */
  .how{padding:70px 0;border-top:1px solid var(--mp-hair)}
  .how h2{font-size:clamp(24px,3.4vw,34px);max-width:18ch}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:36px}
  .card{border:1px solid var(--mp-line);border-radius:0;padding:26px 24px;background:var(--mp-surface)}
  .card .n{font-family:var(--mp-font-mono);font-size:12px;font-weight:600;color:var(--mp-navy);letter-spacing:.06em}
  .card h3{font-family:var(--mp-font-serif);font-size:19px;font-weight:700;margin:12px 0 0}
  .card p{margin-top:10px;color:var(--mp-body);font-size:15px;line-height:1.55}

  /* the mission-statement close */
  .close{padding:88px 0}
  .missioncard{background:var(--mp-surface);border:1px solid var(--mp-line);border-top:2px solid var(--mp-ink);border-radius:0;padding:56px 46px;text-align:center}
  .missioncard .eyebrow{color:var(--mp-accent)}
  .missioncard .mission{font-family:var(--mp-font-serif);font-size:clamp(24px,3.6vw,34px);line-height:1.28;font-weight:400;color:var(--mp-ink);max-width:26ch;margin:18px auto 0;letter-spacing:-.01em}
  .missioncard .mission b{color:var(--mp-navy);font-weight:700}
  .missioncard .cta-row{justify-content:center;margin-top:30px}
  .missioncard .fine{margin-top:20px;font-family:var(--mp-font-mono);font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--mp-muted)}

  @media (max-width:820px){
    .pair,.flows,.steps{grid-template-columns:1fr}
    .joiner span{transform:rotate(90deg)}
    .shared .stats{grid-template-columns:1fr}
    .phero{padding:56px 0 12px}
    .study .band{padding:32px 24px}
  }
`;

const ARROWS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l5 5-5 5"/><path d="M13 7l5 5-5 5"/></svg>`;
const DOWN = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>`;

const BODY = `
<style>${PAGE_CSS}</style>

<header class="phero">
  <div class="wrap">
    <span class="kicker">For APEX Accelerators &amp; the small businesses you serve</span>
    <div class="triad">
      <div class="t1">You prepare small businesses to compete.</div>
      <div class="t2">We help public agencies discover them.</div>
      <div class="t3">Together, we strengthen the public procurement marketplace.</div>
    </div>
    <p class="sub">APEX Accelerators make small businesses <b>found-ready</b>. Mindy makes agencies <b>discovery-ready</b> &mdash; helping them reach those qualified suppliers, including the new ones. We exist because you exist.</p>
    <div class="cta-row">
      <a class="btn primary" href="#introduce">Introduce a buying organization &rarr;</a>
      <a class="btn ghost" href="#founding50">What is the Founding 50?</a>
    </div>
    <div class="proofstrip">
      <span class="pulse"></span>
      <span class="txt"><span class="lbl">Now onboarding</span> <b>Two county governments</b> are bringing Supplier Discovery to their live procurements &mdash; so the right small businesses get found on real requirements.</span>
    </div>
  </div>
</header>

<section class="ends">
  <div class="wrap">
    <span class="eyebrow">One mission. Two sides of the market.</span>
    <h2 style="margin-top:14px">The same goal, from both sides of the table.</h2>
    <p class="lede">Congress created the APEX Accelerators to grow the number of small businesses winning government contracts. That is the same number Mindy exists to move &mdash; through <b>Supplier Discovery</b> on the buyer's side.</p>
    <div class="pair">
      <div class="side apex">
        <div class="who">APEX Accelerators</div>
        <h3>Make the supplier found-ready</h3>
        <p>Your 650+ counselors get a small business prepared to compete &mdash; one relationship at a time.</p>
        <ul>
          <li>Registration &amp; certifications</li>
          <li>Bid reviews &amp; capability statements</li>
          <li>Market research &amp; teaming</li>
        </ul>
      </div>
      <div class="joiner"><span>${ARROWS}</span></div>
      <div class="side mindy">
        <div class="who">Mindy &middot; Supplier Discovery</div>
        <h3>Make the agency discovery-ready</h3>
        <p>Mindy reads the public record so a buying office can discover qualified suppliers &mdash; including firms not already on file &mdash; on a specific requirement.</p>
        <ul>
          <li>Supplier Discovery by capability</li>
          <li>Surfaces firms the agency isn't reaching</li>
          <li>Measures the change in competition</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="philo">
  <div class="wrap">
    <span class="eyebrow">Our philosophy</span>
    <p>A supplier that's ready is only half the equation. <b>Discovery is the other half.</b></p>
  </div>
</section>

<section class="whyd">
  <div class="wrap">
    <span class="eyebrow">Why Discovery matters</span>
    <h2 style="margin-top:14px">From &ldquo;hope they find it&rdquo; to Supplier Discovery.</h2>
    <p class="lede">Publication makes a solicitation available. Supplier Discovery makes it found &mdash; by the qualified firms best positioned to deliver it.</p>
    <div class="flows">
      <div class="flow trad">
        <span class="badge">Traditional procurement</span>
        <div class="step"><span class="dot"></span>Agency publishes the solicitation</div>
        <div class="arrow">${DOWN}</div>
        <div class="step"><span class="dot"></span>Hope the right suppliers find it</div>
        <div class="arrow">${DOWN}</div>
        <div class="step"><span class="dot"></span>Receive whatever bids arrive</div>
        <div class="term">The same incumbents bid. Competition stays flat.</div>
      </div>
      <div class="flow disc">
        <span class="badge">Supplier Discovery</span>
        <div class="step"><span class="dot"></span>Agency publishes the solicitation</div>
        <div class="arrow">${DOWN}</div>
        <div class="step"><span class="dot"></span>Qualified suppliers are identified</div>
        <div class="arrow">${DOWN}</div>
        <div class="step"><span class="dot"></span>Suppliers discover the opportunity</div>
        <div class="arrow">${DOWN}</div>
        <div class="step"><span class="dot"></span>More qualified competition</div>
        <div class="term">Better procurement outcomes.</div>
      </div>
    </div>
  </div>
</section>

<section class="shared">
  <div class="wrap">
    <span class="eyebrow">Why this matters now</span>
    <h2 style="margin-top:14px">The supplier base is shrinking.</h2>
    <p>That's a problem for small businesses, procurement offices, and taxpayers alike. The count of small firms in the marketplace has fallen for years &mdash; even as small-business <em>dollars</em> rise. The money is concentrating among fewer suppliers.</p>
    <div class="stats">
      <div class="st"><div class="n">&minus;38%</div><div class="l">small-business suppliers of common goods &amp; services, 2010&ndash;2019</div><div class="s">BPC 2021</div></div>
      <div class="st"><div class="n">&minus;79%</div><div class="l">new small-business entrants, 2005&ndash;2019</div><div class="s">CSIS + SBA</div></div>
      <div class="st up"><div class="n">28.4%</div><div class="l">of FY23 dollars to small business &mdash; goal met, yet fewer firms</div><div class="s">SBA Scorecard</div></div>
    </div>
  </div>
</section>

<section class="study">
  <div class="wrap">
    <div class="band">
      <span class="eyebrow">Why we're studying this</span>
      <h2>The Mindy Institute exists to understand one question.</h2>
      <p class="q">How can public agencies consistently reach more qualified suppliers?</p>
      <p>We're not just building software &mdash; we're studying the problem, in public, and publishing what we find. Our research covers:</p>
      <div class="topics">
        <span class="topic">Competition</span>
        <span class="topic">Supplier Discovery</span>
        <span class="topic">Small-business participation</span>
        <span class="topic">Procurement intelligence</span>
      </div>
      <a class="link" href="/institute">Read the research from the Mindy Institute &rarr;</a>
    </div>
  </div>
</section>

<section class="how">
  <div class="wrap">
    <span class="eyebrow">How a counselor plugs in</span>
    <h2 style="margin-top:14px">You have the agency relationships. We bring Supplier Discovery.</h2>
    <div class="steps">
      <div class="card"><div class="n">01</div><h3>Bring us an agency</h3><p>A buying office you already work with that wants more qualified small-business competition on a real requirement.</p></div>
      <div class="card"><div class="n">02</div><h3>We run a Supplier Discovery pilot</h3><p>Mindy identifies qualified suppliers the agency's channels are missing &mdash; and measures the difference against a baseline.</p></div>
      <div class="card"><div class="n">03</div><h3>Your clients get found</h3><p>The ready suppliers you've been coaching become the firms an agency actually discovers &mdash; the outcome you exist to create.</p></div>
    </div>
  </div>
</section>


<section class="f50" id="founding50">
  <div class="wrap">
    <span class="eyebrow">The Founding 50</span>
    <h2>Fifty public buying organizations, helping establish how this should work.</h2>
    <p class="lede">Mindy is inviting an initial cohort of <b>public buying organizations</b> &mdash; cities, counties, transit authorities, school districts, state agencies &mdash; to help test and shape a better approach to supplier discovery, market research and procurement competition. The objective is not fifty software customers. It is fifty organizations helping establish better ways to understand and expand public procurement markets.</p>
    <div class="notclaim">
      We are not claiming Mindy increases competition by some percentage, or saves agencies money, or guarantees more bids. We do not have that evidence yet. The Founding 50 exists partly to measure those questions &mdash; and participating organizations help us measure the effect.
    </div>
    <div class="steps">
      <div class="step"><div class="n">STEP 1</div><h3>Bring us a buyer</h3><p>You already know procurement leadership at a city, county or district that wants more qualified bidders. Introduce us. That is the whole ask.</p></div>
      <div class="step"><div class="n">STEP 2</div><h3>Mindy works the requirement</h3><p>We work directly with the buying organization &mdash; market research, supplier discovery, competition analysis. No software for you to implement.</p></div>
      <div class="step"><div class="n">STEP 3</div><h3>Your clients become discoverable</h3><p>Qualified businesses &mdash; including the ones your counselors spent months getting ready &mdash; become part of the supplier market that buyer can see.</p></div>
      <div class="step"><div class="n">STEP 4</div><h3>We measure what changed</h3><p>Suppliers identified, small businesses reached, competition depth. Where the evidence is insufficient we say so rather than publish a number.</p></div>
    </div>
  </div>
</section>

<section class="intro" id="introduce">
  <div class="wrap">
    <span class="eyebrow">The ask</span>
    <h2>Bring us a buying organization.</h2>
    <p class="lede">You make suppliers found-ready. We will work the other side of the market. If you know a public buyer that wants more qualified small-business participation, introduce us &mdash; that is the entire contribution.</p>
    <form class="frm" id="apexIntro" novalidate>
      <div class="row">
        <label>Your name<input name="name" required autocomplete="name"></label>
        <label>Your APEX Accelerator<input name="org" required></label>
      </div>
      <div class="row">
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Phone <span class="opt">(optional)</span><input name="phone" type="tel" autocomplete="tel"></label>
      </div>
      <label>Buying organization<input name="buyer" required placeholder="e.g. City of Jacksonville, Procurement Division"></label>
      <div class="row">
        <label>Agency type
          <select name="agencyType">
            <option>Federal</option><option>State</option><option>County</option>
            <option>City</option><option>School District</option><option>Higher Education</option>
            <option>Transit</option><option>Utility</option><option>Other</option>
          </select>
        </label>
        <label>Primary challenge
          <select name="challenge">
            <option>Need more bidders</option><option>Need more small businesses</option>
            <option>Need new suppliers</option><option>Market research</option>
            <option>Competition concerns</option><option>Supplier outreach</option><option>Other</option>
          </select>
        </label>
      </div>
      <label>Is there a specific requirement already?
        <select name="hasRequirement"><option>No</option><option>Yes</option></select>
      </label>
      <label>Anything we should know <span class="opt">(optional)</span><textarea name="notes"></textarea></label>
      <button class="btn primary" type="submit">Introduce a buying organization &rarr;</button>
      <div class="note">We will reach out to you first &mdash; never cold-contact the organization you name without your say-so.</div>
      <div id="apexOk" class="ok" hidden></div>
    </form>
  </div>
</section>


<script>
(function(){
  var f=document.getElementById('apexIntro'); if(!f) return;
  // Conference attribution: ?source=napex2026 on the QR, remembered for the
  // session so a counselor who browses before submitting is still attributed.
  try{
    var q=new URLSearchParams(location.search).get('source');
    if(q) sessionStorage.setItem('gov_source',q);
  }catch(e){}
  f.addEventListener('submit',function(ev){
    ev.preventDefault();
    var btn=f.querySelector('button[type=submit]');
    var ok=document.getElementById('apexOk');
    var d={}; new FormData(f).forEach(function(v,k){d[k]=v;});
    try{ d.source=sessionStorage.getItem('gov_source')||'gov-apex'; }catch(e){ d.source='gov-apex'; }
    btn.disabled=true; btn.textContent='Sending\u2026';
    fetch('/api/gov/apex-intro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
      .then(function(r){return r.json();})
      .then(function(j){
        if(!j.success) throw new Error(j.error||'Something went wrong');
        f.querySelectorAll('input,select,textarea,button').forEach(function(el){el.disabled=true;});
        ok.hidden=false;
        ok.textContent='Thank you \u2014 we have it. We will reach out to you first, before contacting '+(d.buyer||'the organization')+'.';
      })
      .catch(function(err){
        btn.disabled=false; btn.textContent='Introduce a buying organization \u2192';
        ok.hidden=false; ok.style.borderColor='var(--mp-warn)';
        ok.textContent='That did not send \u2014 '+err.message+'. Email hello@getmindy.ai and we will pick it up from there.';
      });
  });
})();
</script>

<section class="close">
  <div class="wrap">
    <div class="missioncard">
      <span class="eyebrow">Our mission</span>
      <p class="mission">Every qualified small business deserves the opportunity to be discovered. Every public agency deserves access to the broadest possible supplier market. <b>We're building the Supplier Discovery layer that connects the two.</b></p>
      <div class="cta-row">
        <a class="btn primary" href="#introduce">Introduce a buying organization &rarr;</a>
        <a class="btn ghost" href="/research">The Mindy Institute</a>
      </div>
      <div class="fine">Mindy is a program of GovCon Giants AI &middot; not affiliated with or endorsed by the APEX Accelerators program</div>
    </div>
  </div>
</section>
`;

const HTML = govPage({
  title: 'For APEX Accelerators — Supplier Discovery for Public Procurement | Mindy',
  description:
    'You prepare small businesses to compete. We help public agencies discover them. Mindy is the Supplier Discovery layer for public procurement — with two county governments now onboarding.',
  active: 'partners',
  body: BODY,
});

export function GET() {
  return new NextResponse(HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
