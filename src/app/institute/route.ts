/**
 * GET /institute — The Research Backlog (Concept gallery).
 *
 * ⚠️ THIS IS NOT THE INSTITUTE. There is ONE Institute and it lives at /research (the
 * Observatory-grounded publications). This page holds the six RESEARCH CONCEPTS — hypotheses
 * awaiting the Observatory standards that would let them become publications. Every concept is
 * honestly labeled "Research Concept · Awaiting OBS-###" (or "standard not yet defined") and
 * links to /research/how-we-publish. Kept indexable + archived even after the real publication
 * ships (Eric: never hide truthful content, always label it accurately). The canonical Institute
 * front door, mission, and charter all live at /research — this page defers to it up top.
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';

export const dynamic = 'force-static';

const PAGE_CSS = `
  .ihero{padding:44px 0 20px;position:relative}
  .backlog-banner{display:flex;gap:16px;align-items:flex-start;background:color-mix(in srgb,var(--teal) 8%,var(--paper));border:1px solid color-mix(in srgb,var(--teal) 26%,var(--line));border-radius:14px;padding:16px 20px;margin:0 0 40px}
  .backlog-banner .bb-tag{flex:0 0 auto;font-family:var(--mono);font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:700;color:var(--teal-deep);background:var(--paper);border:1px solid color-mix(in srgb,var(--teal) 30%,var(--line));border-radius:999px;padding:6px 12px;margin-top:1px}
  .backlog-banner p{margin:0;color:var(--ink-soft);font-size:14.5px;line-height:1.55}
  .backlog-banner a{color:var(--teal-deep);font-weight:600;white-space:nowrap}
  .ihero h1{font-size:clamp(36px,5.6vw,60px);margin:22px 0 0;max-width:18ch}
  .ihero .sub a{color:var(--teal-deep);font-weight:600}
  .ihero .sub{font-size:clamp(18px,2.3vw,22px);color:var(--ink-soft);max-width:60ch;margin:24px 0 0;line-height:1.5}
  .ihero .cta-row{margin-top:32px}

  .mission{padding:20px 0 76px}
  .mission .band{background:var(--ink);color:var(--paper);border-radius:22px;padding:52px 46px;position:relative;overflow:hidden}
  .mission .eyebrow{color:var(--teal)}
  .mission blockquote{font-family:var(--serif);font-size:clamp(24px,3.6vw,36px);line-height:1.28;font-weight:500;margin:16px 0 0;max-width:26ch;letter-spacing:-.01em}
  .mission blockquote em{color:var(--teal);font-style:italic}

  .sec{padding:64px 0;border-top:1px solid var(--hair)}
  .sec .lead{display:grid;grid-template-columns:280px 1fr;gap:44px;align-items:start}
  .sec h2{font-size:clamp(24px,3.4vw,32px);max-width:14ch}
  .sec .prose p{color:var(--ink-soft);font-size:17.5px;line-height:1.62}
  .sec .prose p + p{margin-top:16px}
  .sec .prose b{color:var(--ink);font-weight:600}

  .pubs{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-top:8px}
  .pub{background:var(--paper);padding:26px 24px;display:flex;flex-direction:column;text-decoration:none;color:inherit;transition:background .15s ease}
  .pub:hover{background:var(--teal-wash)}
  .pub .tag{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--teal-deep)}
  .pub h3{font-size:18px;margin:12px 0 0;line-height:1.25;color:var(--ink)}
  .pub p{margin-top:10px;color:var(--ink-soft);font-size:14.5px;line-height:1.5}
  .pub .read{margin-top:auto;padding-top:16px;font-family:var(--sans);font-size:13.5px;font-weight:600;color:var(--teal-deep)}
  .pub:hover .read{color:var(--teal)}

  .priorities{margin-top:8px;display:flex;flex-direction:column;gap:2px}
  .prio{display:grid;grid-template-columns:52px 1fr;gap:20px;padding:22px 0;border-top:1px solid var(--hair);align-items:baseline}
  .prio:first-child{border-top:0}
  .prio .num{font-family:var(--serif);font-size:34px;font-weight:600;color:color-mix(in srgb,var(--teal) 60%,var(--muted));line-height:1;font-variant-numeric:tabular-nums}
  .prio h3{font-size:19px}
  .prio p{margin-top:6px;color:var(--ink-soft);font-size:15.5px;line-height:1.55}

  .close{padding:80px 0}
  .closecard{background:linear-gradient(160deg,var(--teal-wash),var(--paper));border:1px solid color-mix(in srgb,var(--teal) 26%,var(--line));border-radius:22px;padding:48px 44px;text-align:center}
  .closecard h2{font-size:clamp(24px,3.4vw,34px);margin:0 auto;max-width:20ch}
  .closecard p{color:var(--ink-soft);font-size:17px;max-width:50ch;margin:14px auto 0}
  .closecard .cta-row{justify-content:center;margin-top:26px}

  @media (max-width:820px){
    .sec .lead{grid-template-columns:1fr;gap:16px}
    .pubs{grid-template-columns:1fr}
    .ihero{padding:64px 0 12px}
    .prio{grid-template-columns:1fr;gap:6px}
  }
`;

const BODY = `
<style>${PAGE_CSS}</style>

<header class="ihero">
  <div class="wrap">
    <div class="backlog-banner">
      <span class="bb-tag">Research Backlog</span>
      <p>These are <b>research concepts</b> &mdash; hypotheses awaiting the Observatory standards that would let them be published. They are not yet Institute publications. The Institute&rsquo;s published work lives at <a href="/research">The Mindy Institute &rarr;</a></p>
    </div>
    <span class="kicker">The Research Backlog</span>
    <h1>The questions we&rsquo;re working toward &mdash; before the evidence is ready to publish.</h1>
    <p class="sub">Each concept below states a claim we believe is true and names the Observatory standard it depends on. When that standard reaches publication maturity, the concept graduates into a publication at <a href="/research">The Mindy Institute</a>. Until then, we keep it here &mdash; honestly labeled, not published as a finding.</p>
    <div class="cta-row">
      <a class="btn primary" href="/research">The Institute &rarr;</a>
      <a class="btn ghost" href="/research/how-we-publish">Why some research isn&rsquo;t published yet</a>
    </div>
  </div>
</header>

<section class="mission">
  <div class="wrap">
    <div class="band">
      <span class="eyebrow">The editorial rule</span>
      <blockquote>The Institute publishes a conclusion only when the <em>Observatory standards</em> behind it are mature. Everything on this page is still waiting.</blockquote>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="lead">
      <h2>The thread that connects them</h2>
      <div class="prose">
        <p>The federal government knows how to <b>publish</b> opportunities. What it has never solved is how to make sure the <b>right suppliers discover them</b> &mdash; especially small businesses that have never bid before.</p>
        <p>The cost of that gap is now measurable. From 2010 to 2019 the number of small businesses selling common goods and services to the government fell <b>38%</b>; new entrants fell <b>79%</b> from 2005 to 2019. Dollars to small business went up over the same period &mdash; the money is simply concentrating among fewer firms.</p>
        <p>OMB has already named a more diverse and resilient supplier base a priority. The Institute exists to turn that priority into method: research, measurement, and a way to actually close the discovery gap.</p>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="lead">
      <h2>The concepts</h2>
      <div class="prose">
        <p style="margin-bottom:22px">Each is a claim we believe the evidence will support &mdash; and the Observatory standard it&rsquo;s waiting on. When the standard matures, the concept graduates into a publication at <a href="/research">The Mindy Institute</a>.</p>
        <div class="pubs">
          <a class="pub" href="/institute/competition-gap"><div class="tag">Research Concept &middot; Awaiting OBS-008</div><h3>The Competition Gap</h3><p>Why public agencies struggle to reach qualified small businesses &mdash; and what the shrinking supplier base is costing procurement outcomes.</p><div class="read">Read the concept &rarr;</div></a>
          <a class="pub" href="/institute/mls-problem"><div class="tag">Research Concept &middot; Standard not yet defined</div><h3>The MLS Problem in Public Procurement</h3><p>Bid notices are public by law, but the path to them runs through paid intermediaries &mdash; what the access layer charges, and what it costs the city that published the notice.</p><div class="read">Read the concept &rarr;</div></a>
          <a class="pub" href="/institute/90887-front-doors"><div class="tag">Research Concept &middot; Standard not yet defined</div><h3>90,887 Front Doors</h3><p>Federal = one front door; state and local = 90,887 fragmented purchasing entities with no equivalent &mdash; what that fragmentation costs the governments doing the buying.</p><div class="read">Read the concept &rarr;</div></a>
          <a class="pub" href="/institute/who-isnt-bidding"><div class="tag">Research Concept &middot; Awaiting OBS-004</div><h3>Who Isn't Bidding on Your City's Contracts</h3><p>The top reason firms don't bid is that they never knew the opportunity existed (Raleigh: 52% of white male-owned firms cited it) &mdash; what a thin bidder pool costs on every award.</p><div class="read">Read the concept &rarr;</div></a>
          <a class="pub" href="/institute/bidder-pool-shrinking"><div class="tag">Research Concept &middot; Awaiting OBS-009</div><h3>The Bidder Pool Is Shrinking</h3><p>DOT-funded research: bidder outreach is correlated with 17.6% lower project costs, and 70% of states rarely do it &mdash; the gap between what the research found and what states do.</p><div class="read">Read the concept &rarr;</div></a>
          <a class="pub" href="/institute/evidence"><div class="tag">Evidence Library</div><h3>The Case File</h3><p>The full body of verified research behind our work &mdash; every source linked to the original document, organized by claim, each marked confirmed or lead. The data, ready when you ask.</p><div class="read">Browse the evidence &rarr;</div></a>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="lead">
      <h2>Research priorities</h2>
      <div class="prose">
        <div class="priorities">
          <div class="prio"><div class="num">01</div><div><h3>Measuring discovery, not just posting</h3><p>Moving the metric from "did we publish it" to "did qualified suppliers actually find and respond to it."</p></div></div>
          <div class="prio"><div class="num">02</div><div><h3>The new-entrant collapse</h3><p>Why first-time small-business bidders have declined so steeply, and what actually brings them into a competition.</p></div></div>
          <div class="prio"><div class="num">03</div><div><h3>Concentration &amp; resilience</h3><p>What a narrowing supplier base does to price, delivery risk, and the government's ability to weather disruption.</p></div></div>
          <div class="prio"><div class="num">04</div><div><h3>Supplier intelligence in the acquisition workflow</h3><p>How AI-driven supplier discovery fits inside real procurement practice &mdash; without changing the rules an office has to follow.</p></div></div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="close">
  <div class="wrap">
    <div class="closecard">
      <h2>See what the Institute has actually published.</h2>
      <p>These concepts are still waiting on their evidence. The published, Observatory-grounded work &mdash; and the standard behind each claim &mdash; lives at The Mindy Institute.</p>
      <div class="cta-row">
        <a class="btn primary" href="/research">The Mindy Institute &rarr;</a>
        <a class="btn ghost" href="/research/how-we-publish">Why some research isn&rsquo;t published yet</a>
      </div>
    </div>
  </div>
</section>
`;

const HTML = govPage({
  title: 'The Research Backlog — The Mindy Institute',
  description:
    'Research concepts awaiting the Observatory standards that would let them be published. The Institute publishes a conclusion only when the standards behind it are mature. Published work lives at /research.',
  active: 'institute',
  body: BODY,
});

export function GET() {
  return new NextResponse(HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
