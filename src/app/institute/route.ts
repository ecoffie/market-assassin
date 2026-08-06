/**
 * GET /institute — The Mindy Institute for Public Procurement (one page).
 *
 * POSITIONING PAGE ONLY (src/lib/gov/shell.ts). Deliberately restrained: mission, why we
 * exist, what we'll publish, research priorities. Signals a point of view, not a finished
 * research institute. Every statistic is real + sourced in the shared footer.
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';

export const dynamic = 'force-static';

const PAGE_CSS = `
  .ihero{padding:92px 0 20px;position:relative}
  .ihero h1{font-size:clamp(36px,5.6vw,60px);margin:22px 0 0;max-width:18ch}
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
  .pub{background:var(--paper);padding:26px 24px}
  .pub .tag{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--teal-deep)}
  .pub h3{font-size:18px;margin:12px 0 0;line-height:1.25}
  .pub p{margin-top:10px;color:var(--ink-soft);font-size:14.5px;line-height:1.5}
  .pub .status{margin-top:14px;font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}

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
    <span class="kicker">The Mindy Institute for Public Procurement</span>
    <h1>A research effort on the problem procurement has quietly accepted.</h1>
    <p class="sub">We study one question: how public agencies can reach the qualified small businesses they're not reaching today &mdash; and what happens to competition when they do.</p>
    <div class="cta-row">
      <a class="btn primary" href="/gov">See the argument &rarr;</a>
      <a class="btn ghost" href="/pilot">The pilot program</a>
    </div>
  </div>
</header>

<section class="mission">
  <div class="wrap">
    <div class="band">
      <span class="eyebrow">Mission</span>
      <blockquote>We exist to make <em>supplier discovery</em> a measurable part of public procurement &mdash; not an afterthought left to chance.</blockquote>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="lead">
      <h2>Why we exist</h2>
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
      <h2>What we'll publish</h2>
      <div class="prose">
        <p style="margin-bottom:22px">Original, data-grounded work agencies and small businesses can actually use &mdash; not commentary. Our first titles:</p>
        <div class="pubs">
          <a class="pub" href="/institute/competition-gap" style="text-decoration:none;color:inherit;display:block"><div class="tag">White paper</div><h3>The Competition Gap</h3><p>Why public agencies struggle to reach qualified small businesses &mdash; and what the shrinking supplier base is costing procurement outcomes.</p><div class="status" style="color:var(--teal-deep)">Read now &rarr;</div></a>
          <div class="pub"><div class="tag">Field guide</div><h3>The Discovery Playbook</h3><p>Practical methods a contracting office can use to widen the qualified bidder pool on a single requirement.</p><div class="status">In progress</div></div>
          <div class="pub"><div class="tag">Measurement</div><h3>The Participation Index</h3><p>A repeatable way to measure new-entrant and small-business participation at the requirement level, not just the agency total.</p><div class="status">Planned</div></div>
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
      <h2>Read the first paper, or run the pilot behind it.</h2>
      <p>The Competition Gap lays out the argument. The pilot program puts it to the test on one of your real requirements.</p>
      <div class="cta-row">
        <a class="btn primary" href="/institute/competition-gap">Read The Competition Gap &rarr;</a>
        <a class="btn ghost" href="/pilot">Explore a pilot</a>
      </div>
    </div>
  </div>
</section>
`;

const HTML = govPage({
  title: 'The Mindy Institute for Public Procurement',
  description:
    'A research effort on how public agencies can reach the qualified small businesses they are not reaching today — and what happens to competition when they do.',
  active: 'institute',
  body: BODY,
});

export function GET() {
  return new NextResponse(HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
