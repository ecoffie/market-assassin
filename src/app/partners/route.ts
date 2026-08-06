/**
 * GET /partners — Mindy × APEX Accelerators (the counselor / partner angle).
 *
 * POSITIONING PAGE ONLY (src/lib/gov/shell.ts). Written for the APEX Accelerators room:
 * 650+ procurement counselors + the small businesses they serve. The thesis: APEX makes
 * suppliers FOUND-READY; Mindy makes sure agencies FIND them — same mission (grow the number
 * of small businesses winning government work) from two ends. Counselors are the channel to
 * the agency pilots.
 *
 * GROUNDED: APEX facts are real (DoD OSBP program, formerly PTAP, ~650 counselors, mission to
 * "increase the number of government contracts awarded to small businesses"). The county proof
 * is REAL but ANONYMIZED ("two county governments") until they sign + approve naming — no
 * names/logos. The −38%/−79% figures carry the shared sources footer. Nothing fabricated.
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';

export const dynamic = 'force-static';

const PAGE_CSS = `
  .phero{padding:88px 0 20px;position:relative}
  .phero .kicker{margin-bottom:22px}
  .phero h1{font-size:clamp(36px,5.6vw,62px);margin:0;max-width:16ch}
  .phero h1 .hl{color:var(--teal-deep);font-style:italic}
  .phero .sub{font-size:clamp(18px,2.3vw,22px);color:var(--ink-soft);max-width:58ch;margin:24px 0 0;line-height:1.5}
  .phero .cta-row{margin-top:32px}

  /* live proof strip */
  .proofstrip{margin-top:40px;background:var(--ink);color:var(--paper);border-radius:16px;padding:22px 26px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  .proofstrip .pulse{width:11px;height:11px;border-radius:50%;background:var(--teal);flex:none;box-shadow:0 0 0 0 color-mix(in srgb,var(--teal) 60%,transparent);animation:pl 2.4s infinite}
  @keyframes pl{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--teal) 55%,transparent)}70%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}
  @media (prefers-reduced-motion:reduce){.proofstrip .pulse{animation:none}}
  .proofstrip .txt{font-size:16.5px;line-height:1.45}
  .proofstrip .txt b{color:var(--paper);font-weight:600}
  .proofstrip .lbl{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--teal);font-weight:700;margin-right:4px}

  /* two ends of one mission */
  .ends{padding:76px 0}
  .ends h2{font-size:clamp(26px,3.6vw,38px);max-width:20ch}
  .ends .lede{color:var(--ink-soft);font-size:18px;max-width:56ch;margin:14px 0 0}
  .pair{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;margin-top:40px;align-items:stretch}
  .side{border:1px solid var(--line);border-radius:16px;padding:28px 26px;background:var(--paper)}
  .side.apex{border-color:color-mix(in srgb,var(--gold) 45%,var(--line))}
  .side.mindy{border-color:color-mix(in srgb,var(--teal) 45%,var(--line));box-shadow:0 20px 40px -30px rgba(14,124,123,.5)}
  .side .who{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700}
  .side.apex .who{color:var(--gold)}
  .side.mindy .who{color:var(--teal-deep)}
  .side h3{font-family:var(--serif);font-size:22px;font-weight:600;margin:12px 0 0;line-height:1.2}
  .side p{margin-top:12px;color:var(--ink-soft);font-size:15.5px;line-height:1.55}
  .side ul{margin:14px 0 0;padding:0;list-style:none}
  .side li{position:relative;padding:8px 0 8px 22px;font-size:14.5px;color:var(--ink-soft);line-height:1.5}
  .side li::before{content:"";position:absolute;left:2px;top:15px;width:7px;height:7px;border-radius:50%}
  .side.apex li::before{background:var(--gold)}
  .side.mindy li::before{background:var(--teal)}
  .joiner{display:grid;place-items:center}
  .joiner span{width:46px;height:46px;border-radius:999px;background:var(--paper);border:1px solid var(--line);display:grid;place-items:center;color:var(--teal-deep)}
  .joiner span svg{width:22px;height:22px}
  .together{margin-top:26px;text-align:center;font-family:var(--serif);font-size:clamp(19px,2.6vw,24px);font-style:italic;color:var(--ink);max-width:30ch;margin-left:auto;margin-right:auto}
  .together b{font-style:normal;color:var(--teal-deep)}

  /* the shared number */
  .shared{background:var(--paper-2);border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);padding:70px 0}
  .shared h2{font-size:clamp(24px,3.4vw,32px);max-width:22ch}
  .shared p{color:var(--ink-soft);font-size:17px;max-width:58ch;margin:14px 0 0;line-height:1.6}
  .shared p b{color:var(--ink)}
  .shared .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-top:30px}
  .shared .st{background:var(--paper);padding:22px 20px;text-align:center}
  .shared .st .n{font-family:var(--serif);font-size:40px;font-weight:600;line-height:1;color:var(--red);font-variant-numeric:tabular-nums}
  .shared .st.up .n{color:var(--teal-deep)}
  .shared .st .l{margin-top:9px;font-size:13px;color:var(--ink-soft);line-height:1.4}
  .shared .st .s{margin-top:9px;font-family:var(--mono);font-size:9.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--muted)}

  /* how counselors plug in */
  .how{padding:76px 0}
  .how h2{font-size:clamp(24px,3.4vw,34px);max-width:18ch}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:38px}
  .card{border:1px solid var(--line);border-radius:16px;padding:26px 24px;background:var(--paper)}
  .card .n{font-family:var(--mono);font-size:12px;font-weight:700;color:var(--teal-deep);letter-spacing:.06em}
  .card h3{font-family:var(--serif);font-size:19px;font-weight:600;margin:12px 0 0}
  .card p{margin-top:10px;color:var(--ink-soft);font-size:15px;line-height:1.55}

  .close{padding:80px 0}
  .closecard{background:linear-gradient(160deg,var(--teal-wash),var(--paper));border:1px solid color-mix(in srgb,var(--teal) 26%,var(--line));border-radius:22px;padding:50px 44px;text-align:center}
  .closecard .eyebrow{color:var(--teal-deep)}
  .closecard h2{font-size:clamp(26px,3.8vw,40px);margin:14px auto 0;max-width:18ch}
  .closecard p{color:var(--ink-soft);font-size:17px;max-width:52ch;margin:14px auto 0}
  .closecard .cta-row{justify-content:center;margin-top:28px}
  .closecard .fine{margin-top:18px;font-family:var(--mono);font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}

  @media (max-width:820px){
    .pair{grid-template-columns:1fr}
    .joiner span{transform:rotate(90deg)}
    .shared .stats,.steps{grid-template-columns:1fr}
    .phero{padding:60px 0 12px}
  }
`;

const ARROWS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l5 5-5 5"/><path d="M13 7l5 5-5 5"/></svg>`;

const BODY = `
<style>${PAGE_CSS}</style>

<header class="phero">
  <div class="wrap">
    <span class="kicker">For APEX Accelerators &amp; the small businesses you serve</span>
    <h1>You make suppliers found-ready. We make sure agencies <span class="hl">find them</span>.</h1>
    <p class="sub">APEX Accelerators help small businesses get ready to win. Mindy works the other end &mdash; helping public agencies reach those qualified suppliers, including the new ones. Same mission, two ends. Let's close the loop.</p>
    <div class="cta-row">
      <a class="btn primary" href="mailto:hello@getmindy.ai?subject=Mindy%20%C3%97%20APEX%20Accelerators%20%E2%80%94%20partner%20inquiry">Partner with us &rarr;</a>
      <a class="btn ghost" href="/institute/competition-gap">Read the research</a>
    </div>
    <div class="proofstrip">
      <span class="pulse"></span>
      <span class="txt"><span class="lbl">Live now</span> <b>Two county governments</b> are onboarding their procurement data with Mindy &mdash; so the right small businesses get found on their real requirements.</span>
    </div>
  </div>
</header>

<section class="ends">
  <div class="wrap">
    <span class="eyebrow">Two ends of one mission</span>
    <h2 style="margin-top:14px">The same goal, worked from opposite sides.</h2>
    <p class="lede">Congress created the APEX Accelerators (formerly PTAP) to grow the number of small businesses winning government contracts. That is exactly the number Mindy exists to move &mdash; from the buyer's side of the table.</p>
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
        <div class="who">Mindy</div>
        <h3>Make the agency find them</h3>
        <p>Mindy reads the public record so a buying office can reach qualified suppliers &mdash; including new entrants &mdash; on a specific requirement.</p>
        <ul>
          <li>Supplier discovery by capability</li>
          <li>Surfaces firms not already on file</li>
          <li>Measures the change in competition</li>
        </ul>
      </div>
    </div>
    <p class="together">A supplier that's ready is only half the equation. <b>Discovery is the other half.</b></p>
  </div>
</section>

<section class="shared">
  <div class="wrap">
    <span class="eyebrow">Why this partnership matters now</span>
    <h2 style="margin-top:14px">Your mission&rsquo;s core metric is going the wrong way.</h2>
    <p>The APEX mission is to increase the number of small businesses winning government work. But the count of small firms in the federal marketplace has been falling for years &mdash; even as small-business <em>dollars</em> rise. The money is concentrating among fewer suppliers. Closing that gap needs both ends: a supplier made ready, <b>and</b> an agency that actually finds them.</p>
    <div class="stats">
      <div class="st"><div class="n">&minus;38%</div><div class="l">small-business suppliers of common goods &amp; services, 2010&ndash;2019</div><div class="s">BPC 2021</div></div>
      <div class="st"><div class="n">&minus;79%</div><div class="l">new small-business entrants, 2005&ndash;2019</div><div class="s">CSIS + SBA</div></div>
      <div class="st up"><div class="n">28.4%</div><div class="l">of FY23 dollars to small business &mdash; goal met, yet fewer firms</div><div class="s">SBA Scorecard</div></div>
    </div>
  </div>
</section>

<section class="how">
  <div class="wrap">
    <span class="eyebrow">How a counselor plugs in</span>
    <h2 style="margin-top:14px">You already have the agency relationships. We bring the discovery layer.</h2>
    <div class="steps">
      <div class="card"><div class="n">01</div><h3>Bring us an agency</h3><p>A buying office you already work with that wants more qualified small-business competition on a real requirement.</p></div>
      <div class="card"><div class="n">02</div><h3>We run the discovery pilot</h3><p>Mindy maps the market and surfaces qualified suppliers the agency's channels are missing &mdash; and measures the difference against a baseline.</p></div>
      <div class="card"><div class="n">03</div><h3>Your clients get found</h3><p>The ready suppliers you've been coaching become the firms an agency actually discovers &mdash; the outcome you exist to create.</p></div>
    </div>
  </div>
</section>

<section class="close">
  <div class="wrap">
    <div class="closecard">
      <span class="eyebrow">Partner with Mindy</span>
      <h2>Let's grow the supplier base &mdash; from both ends.</h2>
      <p>Two county governments are already onboarding. If you counsel small businesses or work with a buying office, let's talk about closing the discovery gap together.</p>
      <div class="cta-row">
        <a class="btn primary" href="mailto:hello@getmindy.ai?subject=Mindy%20%C3%97%20APEX%20Accelerators%20%E2%80%94%20partner%20inquiry">Start a conversation &rarr;</a>
        <a class="btn ghost" href="/pilot">See how a pilot works</a>
      </div>
      <div class="fine">Mindy is a program of GovCon Giants AI &middot; not affiliated with or endorsed by the APEX Accelerators program</div>
    </div>
  </div>
</section>
`;

const HTML = govPage({
  title: 'For APEX Accelerators — Mindy × the Small Businesses You Serve',
  description:
    'APEX Accelerators make small businesses found-ready. Mindy makes sure agencies find them. Same mission, two ends — with two county governments already onboarding their data.',
  active: 'partners',
  body: BODY,
});

export function GET() {
  return new NextResponse(HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
