/**
 * GET /pilot — Mindy for Government pilot program (one page).
 *
 * POSITIONING PAGE ONLY (src/lib/gov/shell.ts). Who qualifies, what's included, timeline,
 * success metrics, FAQ. Concrete + honest — describes an offer, no fabricated results.
 * The case-study framework is present as a STRUCTURE (Challenge / Solution / Metrics /
 * Lessons), explicitly labeled as the shape a completed pilot will fill.
 */
import { NextResponse } from 'next/server';
import { govPage } from '@/lib/gov/shell';

export const dynamic = 'force-static';

const PAGE_CSS = `
  .phero{padding:88px 0 20px}
  .phero h1{font-size:clamp(36px,5.6vw,60px);margin:22px 0 0;max-width:16ch}
  .phero .sub{font-size:clamp(18px,2.3vw,22px);color:var(--ink-soft);max-width:58ch;margin:24px 0 0;line-height:1.5}
  .phero .cta-row{margin-top:32px}

  .sec{padding:60px 0;border-top:1px solid var(--hair)}
  .sec > .wrap > .eyebrow{display:block;margin-bottom:12px}
  .sec h2{font-size:clamp(24px,3.4vw,32px);max-width:18ch}
  .sec .lede{color:var(--ink-soft);font-size:17.5px;max-width:56ch;margin:14px 0 0;line-height:1.6}

  .qual{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:32px}
  .qual .q{border:1px solid var(--line);border-radius:14px;padding:22px 20px;background:var(--paper)}
  .qual .q .chk{width:26px;height:26px;border-radius:7px;background:var(--teal-wash);color:var(--teal-deep);display:grid;place-items:center;flex:none}
  .qual .q .chk svg{width:15px;height:15px}
  .qual .q h3{font-size:16px;margin:14px 0 0}
  .qual .q p{margin-top:8px;color:var(--ink-soft);font-size:14.5px;line-height:1.5}

  .incl{margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:14px 32px}
  .incl .row{display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-top:1px solid var(--hair)}
  .incl .row .ic{color:var(--teal-deep);flex:none;margin-top:2px}
  .incl .row .ic svg{width:20px;height:20px}
  .incl .row b{font-size:16px;color:var(--ink);font-weight:600;display:block}
  .incl .row span{color:var(--ink-soft);font-size:15px;line-height:1.5}

  .timeline{margin-top:32px;display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden}
  .tl{background:var(--paper);padding:24px 22px}
  .tl .wk{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--teal-deep)}
  .tl h3{font-size:16px;margin:12px 0 0}
  .tl p{margin-top:8px;color:var(--ink-soft);font-size:14px;line-height:1.5}

  .metrics{margin-top:32px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  .metric{border:1px solid var(--line);border-left:3px solid var(--teal);border-radius:12px;padding:22px 20px;background:var(--paper)}
  .metric h3{font-size:16px}
  .metric p{margin-top:8px;color:var(--ink-soft);font-size:14.5px;line-height:1.5}
  .metric .how{margin-top:12px;font-family:var(--mono);font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}

  .casewrap{margin-top:28px;border:1px dashed color-mix(in srgb,var(--teal) 40%,var(--line));border-radius:16px;padding:28px 26px;background:var(--paper-2)}
  .casewrap .note{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:16px}
  .casegrid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
  .casegrid .c h3{font-size:15px;color:var(--teal-deep)}
  .casegrid .c p{margin-top:8px;color:var(--ink-soft);font-size:13.5px;line-height:1.5}

  .faq{margin-top:20px}
  .faq details{border-top:1px solid var(--hair);padding:18px 0}
  .faq details:last-child{border-bottom:1px solid var(--hair)}
  .faq summary{font-family:var(--serif);font-size:19px;font-weight:500;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:16px;color:var(--ink)}
  .faq summary::-webkit-details-marker{display:none}
  .faq summary .pm{font-family:var(--sans);color:var(--teal-deep);font-weight:700;flex:none;transition:transform .15s}
  .faq details[open] summary .pm{transform:rotate(45deg)}
  .faq details p{margin-top:12px;color:var(--ink-soft);font-size:16px;line-height:1.6;max-width:64ch}

  .close{padding:80px 0}
  .closecard{background:var(--ink);color:var(--paper);border-radius:22px;padding:52px 46px;text-align:center}
  .closecard .eyebrow{color:var(--teal)}
  .closecard h2{color:var(--paper);font-size:clamp(26px,3.8vw,38px);margin:14px auto 0;max-width:18ch}
  .closecard p{color:color-mix(in srgb,var(--paper) 80%,transparent);font-size:17px;max-width:50ch;margin:14px auto 0}
  .closecard .cta-row{justify-content:center;margin-top:28px}

  @media (max-width:820px){
    .qual,.metrics{grid-template-columns:1fr}
    .incl,.timeline,.casegrid{grid-template-columns:1fr}
    .phero{padding:60px 0 12px}
  }
`;

const CHK = `<span class="chk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>`;
const IC = `<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></svg></span>`;

const BODY = `
<style>${PAGE_CSS}</style>

<header class="phero">
  <div class="wrap">
    <span class="kicker">Pilot program</span>
    <h1>Run a discovery pilot on one real requirement.</h1>
    <p class="sub">Pick a solicitation. We'll show you the qualified suppliers your current channels are missing &mdash; and measure the difference in competition. No procurement change required to start.</p>
    <div class="cta-row">
      <a class="btn primary" href="mailto:hello@getmindy.ai?subject=Mindy%20for%20Government%20%E2%80%94%20Pilot%20inquiry">Apply for Pilot &rarr;</a>
      <a class="btn ghost" href="/gov">Why it matters</a>
    </div>
  </div>
</header>

<section class="sec">
  <div class="wrap">
    <span class="eyebrow">Who qualifies</span>
    <h2>Built for the office that owns a real requirement.</h2>
    <div class="qual">
      <div class="q">${CHK}<h3>A public agency or buying office</h3><p>Federal, state, or local &mdash; any office responsible for issuing solicitations and accountable for competition.</p></div>
      <div class="q">${CHK}<h3>One requirement to focus on</h3><p>An upcoming or recurring buy where you'd like to see more qualified small-business competition.</p></div>
      <div class="q">${CHK}<h3>A goal you can measure against</h3><p>Broader participation, more qualified bids, or reaching new entrants &mdash; something you can point to at the end.</p></div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <span class="eyebrow">What the pilot includes</span>
    <h2>A focused engagement on your requirement &mdash; not a platform rollout.</h2>
    <div class="incl">
      <div class="row">${IC}<div><b>A supplier discovery scan</b><span>Mindy maps the real market for your requirement and surfaces qualified small businesses beyond your current vendor list &mdash; including firms new to the marketplace.</span></div></div>
      <div class="row">${IC}<div><b>A qualified-supplier shortlist</b><span>The capable firms, with the award history and capability signals behind why they qualify &mdash; so your team can see the reasoning, not just a list.</span></div></div>
      <div class="row">${IC}<div><b>A competition baseline</b><span>We establish what participation looks like today for this requirement, so the pilot's effect is measurable rather than anecdotal.</span></div></div>
      <div class="row">${IC}<div><b>A read-out with your team</b><span>A working session on what we found, what it means for competition, and whether it's worth widening beyond one requirement.</span></div></div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <span class="eyebrow">Timeline</span>
    <h2>Weeks, not a procurement cycle.</h2>
    <div class="timeline">
      <div class="tl"><div class="wk">Week 1</div><h3>Scope</h3><p>Pick the requirement, define the goal, and agree on how we'll measure competition.</p></div>
      <div class="tl"><div class="wk">Weeks 2&ndash;3</div><h3>Discover</h3><p>Mindy maps the market and builds the qualified-supplier shortlist for your requirement.</p></div>
      <div class="tl"><div class="wk">Week 4</div><h3>Read-out</h3><p>Review the suppliers found, the competition baseline, and the participation gap.</p></div>
      <div class="tl"><div class="wk">After</div><h3>Decide</h3><p>Decide whether to widen the approach across more requirements &mdash; or not. No obligation.</p></div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <span class="eyebrow">Success metrics</span>
    <h2>How we'll know it worked.</h2>
    <p class="lede">We agree on these up front, so the pilot is judged on outcomes your office already cares about &mdash; not on activity.</p>
    <div class="metrics">
      <div class="metric"><h3>Qualified suppliers surfaced</h3><p>Capable firms identified beyond your current channels for this requirement.</p><div class="how">count vs. your existing list</div></div>
      <div class="metric"><h3>New entrants reached</h3><p>Qualified firms that haven't bid with you before &mdash; the population the government has been losing.</p><div class="how">share that are first-time bidders</div></div>
      <div class="metric"><h3>Change in competition</h3><p>Movement in qualified participation for the requirement against the baseline we set in week 1.</p><div class="how">baseline vs. pilot</div></div>
    </div>

    <div class="casewrap">
      <div class="note">Case-study framework &mdash; the structure each completed pilot fills. Shown here as a template; not results from a specific engagement.</div>
      <div class="casegrid">
        <div class="c"><h3>Challenge</h3><p>The requirement, and why reaching qualified small businesses for it was hard.</p></div>
        <div class="c"><h3>Solution</h3><p>What Mindy's discovery scan surfaced, and how the office used it.</p></div>
        <div class="c"><h3>Metrics</h3><p>The measured change in qualified participation against the baseline.</p></div>
        <div class="c"><h3>Lessons</h3><p>What transferred to other requirements &mdash; and what didn't.</p></div>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <span class="eyebrow">FAQ</span>
    <h2>The questions procurement teams ask first.</h2>
    <div class="faq">
      <details><summary>Does this change how we run procurement? <span class="pm">+</span></summary><p>No. The pilot sits alongside your existing process. Mindy helps qualified suppliers discover a requirement you're already running &mdash; it doesn't change your solicitation, evaluation, or award rules.</p></details>
      <details><summary>Are you posting our solicitation somewhere new? <span class="pm">+</span></summary><p>The pilot is about discovery, not another posting board. We identify qualified suppliers for your requirement and help the right firms find the opportunity you've published through your normal channels.</p></details>
      <details><summary>Where does the supplier data come from? <span class="pm">+</span></summary><p>Public federal award history, entity registration, and capability signals &mdash; the same public record procurement teams already rely on, read at a scale and specificity a manual search can't match.</p></details>
      <details><summary>What does the pilot cost? <span class="pm">+</span></summary><p>Pilot scope and terms are set per engagement based on the requirement. Start a conversation and we'll size it to your goal &mdash; there's no platform commitment to run one.</p></details>
      <details><summary>What do you need from us to start? <span class="pm">+</span></summary><p>One requirement, a point of contact, and a goal to measure against. We handle the discovery work and bring the read-out to you.</p></details>
    </div>
  </div>
</section>

<section class="close">
  <div class="wrap">
    <div class="closecard">
      <span class="eyebrow">Start a pilot</span>
      <h2>Pick one requirement. See who you're missing.</h2>
      <p>Tell us the requirement and the goal. We'll come back with the qualified suppliers your current channels aren't reaching.</p>
      <div class="cta-row">
        <a class="btn primary" href="mailto:hello@getmindy.ai?subject=Mindy%20for%20Government%20%E2%80%94%20Pilot%20inquiry">Apply for Pilot &rarr;</a>
        <a class="btn ghost" href="/institute" style="color:var(--paper);border-color:color-mix(in srgb,var(--paper) 30%,transparent)">About the Institute</a>
      </div>
    </div>
  </div>
</section>
`;

const HTML = govPage({
  title: 'Pilot Program — Mindy for Government',
  description:
    'Run a discovery pilot on one real requirement. Mindy surfaces the qualified small businesses your current channels are missing and measures the difference in competition. No procurement change required.',
  active: 'pilot',
  body: BODY,
});

export function GET() {
  return new NextResponse(HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
