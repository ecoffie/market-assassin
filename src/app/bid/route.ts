/**
 * GET /bid — "Bid with confidence" landing page.
 *
 * Modeled 1:1 on Zillow's /sell page ("Sell your home with confidence"), translated to
 * GovCon bidding. The dataset dropdown's third option (Open / Past / **Bid**) routes here
 * instead of switching the map — mirroring how Zillow's Buy/Rent open the map but Sell
 * opens a marketing/conversion page.
 *
 * Section-for-section mirror of Zillow's sell page:
 *   hero → "improve your Zestimate" strip (→ M-Win) → TEAL featured band w/ two white cards
 *   → "Explore more ways to win" = alternating navy split panels (Decide / Draft / Team up,
 *   = Zillow's cash-offer / find-agent / FSBO) → resources w/ "min read" cards → FAQ →
 *   closing CTA.
 * Every feature named is real (Bid/No-Bid, M-Win, Proposal Assist, incumbent + pricing
 * intel, teaming). No fabrication. Brand = Mindy (exit-safe — no "Eric Coffie").
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bid with confidence — Mindy</title>
<meta name="description" content="Finding the opportunity is step one. Mindy helps you decide, draft, and win federal bids — bid/no-bid, win-probability (M-Win), proposal drafting, and incumbent intel.">
<style>
:root{--ink:#111c26;--sub:#42505f;--faint:#6b7787;--line:#e6eaef;--blue:#006aff;--navy:#0b1f66;--navy2:#1e3a8a;--purple:#7c3aed;--teal:#116a5b;--green:#137a4e;--cyan:#3fc4e0;--wash:#f5f7f9}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,-apple-system,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased;line-height:1.5}
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;padding:15px 28px;border-bottom:1px solid var(--line);background:#fff}
.top .nav{display:flex;gap:24px;align-items:center}
.top .nav a{font:600 14px Inter;color:var(--ink);text-decoration:none;white-space:nowrap}
.top .nav a:hover{color:var(--blue)}.top .nav a.on{color:var(--blue)}
.brand{display:flex;align-items:center;gap:8px;font:700 19px Inter;letter-spacing:-.02em;text-decoration:none;color:var(--ink)}
.brand img{height:24px}
@media(max-width:720px){.top .nav a:not(.on){display:none}}
.btn{display:inline-flex;align-items:center;gap:9px;background:var(--blue);color:#fff;font:700 16px Inter;padding:15px 26px;border-radius:10px;text-decoration:none;transition:filter .15s;border:0;cursor:pointer}
.btn:hover{filter:brightness(.94)}
.btn.white{background:#fff;color:var(--blue)}
.btn.sm{font-size:14.5px;padding:13px 22px}
h1{font:800 clamp(42px,6.4vw,72px) Inter;letter-spacing:-.03em;line-height:1.0}
.hi-cyan{color:var(--cyan)}.hi-green{color:#7ee0a8}
/* HERO */
.hero{max-width:1180px;margin:0 auto;padding:72px 28px 58px;display:grid;grid-template-columns:1.05fr .95fr;gap:52px;align-items:center}
@media(max-width:880px){.hero{grid-template-columns:1fr;padding:46px 22px 40px;gap:30px}}
.hero .lead{font:400 18px/1.55 Inter;color:var(--sub);max-width:46ch;margin:20px 0 30px}
.heroart{background:linear-gradient(135deg,#eef4ff,#f4f0fe);border:1px solid var(--line);border-radius:22px;padding:26px;min-height:340px;display:flex;flex-direction:column;justify-content:center;gap:14px}
.mock{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 12px 34px -14px rgba(16,24,40,.24)}
.mock .r{display:flex;justify-content:space-between;align-items:center}
.mock .t{font:700 14.5px Inter;margin:9px 0 3px}.mock .s{font:500 12px Inter;color:var(--faint)}
.mwin{display:inline-flex;align-items:baseline;gap:6px;font:800 14px Inter;color:var(--navy2)}.mwin b{font:800 24px Inter;color:var(--green)}
.bar{height:8px;border-radius:6px;background:#e9eef5;overflow:hidden;margin:10px 0 6px}.bar i{display:block;height:100%;width:72%;background:linear-gradient(90deg,#12805c,#22a06b)}
.tag{display:inline-block;font:600 11px Inter;padding:3px 9px;border-radius:6px}
.tag.n{color:var(--navy2);background:#eef2ff}.tag.g{color:var(--green);background:#e7f4ee}.tag.b{color:var(--blue);background:#eef4ff}
/* Zestimate strip */
.strip{background:var(--wash);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.strip .in{max-width:1180px;margin:0 auto;padding:18px 28px;display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap;font:500 15px Inter;color:var(--sub)}
.strip a{color:var(--blue);font-weight:700;text-decoration:none}
/* TEAL featured band */
.feature{background:var(--teal);color:#fff;padding:64px 28px 68px}
.feature .in{max-width:1180px;margin:0 auto}
.feature h2{text-align:center;font:800 clamp(30px,4.2vw,48px) Inter;letter-spacing:-.02em;margin-bottom:36px}
.feature .cards{display:grid;grid-template-columns:1fr 1fr;gap:24px}
@media(max-width:820px){.feature .cards{grid-template-columns:1fr}}
.fcard{background:#fff;color:var(--ink);border-radius:18px;padding:34px 32px;text-align:center}
.fcard .ic{width:88px;height:88px;border-radius:50%;background:#fdeee2;margin:0 auto 22px;display:flex;align-items:center;justify-content:center}
.fcard .ic svg{width:40px;height:40px;stroke:var(--teal);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.fcard h3{font:800 22px Inter;margin-bottom:12px}
.fcard p{font:400 15.5px/1.55 Inter;color:var(--sub);max-width:38ch;margin:0 auto}
.fcard a{color:var(--blue);font-weight:700;text-decoration:none}
.feature .cta{text-align:center;margin-top:34px}.feature .note{text-align:center;font:400 15px Inter;color:#d6ece6;max-width:64ch;margin:26px auto 0}
/* Explore split panels */
.explore{max-width:1180px;margin:0 auto;padding:72px 28px 20px;text-align:center}
.explore h2{font:800 clamp(30px,4vw,46px) Inter;letter-spacing:-.02em;margin-bottom:12px}
.explore>p{font:400 17px Inter;color:var(--sub);margin-bottom:8px}
.panels{max-width:1180px;margin:0 auto;padding:22px 28px}
.panel{display:grid;grid-template-columns:1fr 1fr;background:var(--navy);border-radius:22px;overflow:hidden;margin-bottom:26px;min-height:400px}
.panel .pc{padding:52px 48px;color:#fff;display:flex;flex-direction:column;justify-content:center}
.panel .pi{background-size:cover;background-position:center;min-height:280px}
.panel.rev .pc{order:2}.panel.rev .pi{order:1}
@media(max-width:820px){.panel,.panel.rev{grid-template-columns:1fr}.panel .pc{order:2;padding:34px 26px}.panel .pi{order:1;min-height:200px}}
.panel h3{font:800 clamp(28px,3.4vw,40px) Inter;letter-spacing:-.02em;margin-bottom:22px}
.panel ul{list-style:none;display:flex;flex-direction:column;gap:16px;margin-bottom:26px}
.panel li{position:relative;padding-left:34px;font:400 16px/1.45 Inter;color:#e6ecff}
.panel li:before{content:"";position:absolute;left:0;top:3px;width:16px;height:10px;border-left:2.6px solid var(--cyan);border-bottom:2.6px solid var(--cyan);transform:rotate(-45deg)}
.panel li b{color:#fff}
.panel .sub2{font:400 15px/1.5 Inter;color:#c3ccec;margin-top:4px}
.panel .go{align-self:flex-start;margin-top:6px}
/* Resources */
.res{background:var(--wash);padding:64px 28px 66px}
.res .in{max-width:1180px;margin:0 auto}
.res h2{font:800 30px Inter;letter-spacing:-.02em;margin-bottom:6px}.res .sub{color:var(--faint);font:400 15px Inter;margin-bottom:28px}
.rgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}
.rc{background:#fff;border-radius:16px;overflow:hidden;text-decoration:none;color:inherit;box-shadow:0 8px 24px -14px rgba(16,24,40,.2);transition:transform .15s,box-shadow .15s;display:flex;flex-direction:column}
.rc:hover{transform:translateY(-3px);box-shadow:0 16px 32px -14px rgba(16,24,40,.26)}
.rc .thumb{height:150px;background:linear-gradient(135deg,#1e3a8a,#7c3aed)}
.rc .b{padding:18px 20px 22px;display:flex;flex-direction:column;gap:10px;flex:1}
.rc .pill{align-self:flex-start;font:700 11px Inter;color:#0b6b86;background:#d6f2fb;padding:3px 10px;border-radius:999px}
.rc h4{font:700 16.5px Inter;line-height:1.3}
.rc .read{color:var(--blue);font:700 14px Inter;margin-top:auto}
.res .guide{margin-top:26px;font:400 15px Inter;color:var(--sub)}.res .guide a{color:var(--ink);font-weight:700}
/* FAQ */
.faq{max-width:920px;margin:0 auto;padding:64px 28px 30px}
.faq h2{font:800 30px Inter;letter-spacing:-.02em;margin-bottom:20px;text-align:center}
details{border-bottom:1px solid var(--line);padding:18px 4px}
details summary{font:700 17px Inter;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px}
details summary::-webkit-details-marker{display:none}
details summary:after{content:"+";font-weight:400;font-size:24px;color:var(--faint)}
details[open] summary:after{content:"\\2013"}
details p{font:400 15px/1.62 Inter;color:var(--sub);padding-top:12px;max-width:74ch}
details a{color:var(--blue)}
/* Close */
.close{background:linear-gradient(135deg,#0b1f66,#7c3aed);color:#fff;margin-top:44px}
.close .in{max-width:1180px;margin:0 auto;padding:64px 28px;text-align:center}
.close h2{font:800 clamp(28px,3.6vw,42px) Inter;letter-spacing:-.02em;margin-bottom:12px;color:#fff}
.close p{font:400 17px Inter;color:#dbe4ff;max-width:58ch;margin:0 auto 26px}
.foot{max-width:1180px;margin:0 auto;padding:30px 28px 60px;color:#9aa5b3;font:400 12.5px/1.6 Inter}
</style></head><body>
<header class="top">
  <nav class="nav">
    <a href="/opportunity-map">Open Opportunities</a>
    <a href="/opportunity-map">Past Opportunities</a>
    <a class="on">Bid</a>
    <a href="/opportunity-map">Contacts</a>
  </nav>
  <a class="brand" href="/app"><img src="/brand/mindy-logo-icon.png" alt="">Mindy</a>
</header>

<!-- HERO -->
<section class="hero">
  <div>
    <h1>Bid your way,<br>bid to <span class="hi-green">win</span></h1>
    <p class="lead">We give you multiple ways to compete for federal work with the flexibility to choose what fits your capacity, timeline, and goals — from the go/no-go call to a submission-ready proposal.</p>
    <a class="btn" href="#explore">Explore your options ↓</a>
  </div>
  <div class="heroart">
    <div class="mock">
      <div class="r"><span class="tag n">SDVOSB set-aside</span><span class="tag g">Good fit</span></div>
      <div class="t">IRST Fleet Service Representative</div>
      <div class="s">Dept of the Navy · Patuxent River, MD</div>
      <div class="bar"><i></i></div>
      <div class="r" style="margin-top:2px"><span class="mwin">M-Win <b>72</b></span><span class="s">5 days left</span></div>
    </div>
    <div class="mock" style="opacity:.94">
      <div class="r"><span class="tag b">Bid / No-Bid</span><span class="s" style="font-weight:700;color:var(--green)">Go</span></div>
      <div class="s" style="margin-top:8px">Incumbent: L3Harris · ceiling $21.9M · recompetes in 8 mo</div>
    </div>
  </div>
</section>

<!-- Zestimate → M-Win strip -->
<div class="strip"><div class="in">
  <span>See your <strong>M-Win</strong> — a win-probability read on any opportunity.</span>
  <a href="/opportunity-map">Open the map →</a>
</div></div>

<!-- TEAL FEATURED BAND (= Zillow "Sell with a partner agent") -->
<section class="feature"><div class="in">
  <h2>Win more with <span class="hi-green">Mindy Proposal Assist</span></h2>
  <div class="cards">
    <div class="fcard">
      <div class="ic"><svg viewBox="0 0 24 24"><path d="M4 4h11l5 5v11a1 1 0 01-1 1H5a1 1 0 01-1-1z"/><path d="M14 4v5h5M8 13h8M8 17h6"/></svg></div>
      <h3>Draft a stronger proposal</h3>
      <p>Mindy builds the <a href="/app?panel=vault">compliance matrix</a> from the RFP and drafts sections woven from your real past performance — then a referee pass checks compliance before you export to Word.</p>
    </div>
    <div class="fcard">
      <div class="ic"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6M8 11h6"/></svg></div>
      <h3>Bid where you can win</h3>
      <p>Every opportunity gets an <a href="/opportunity-map">M-Win</a> win-probability read and an honest Bid / No-Bid — so you reach the work you're most likely to land, not everything on SAM.</p>
    </div>
  </div>
  <div class="cta"><a class="btn white" href="/opportunity-map">Get started</a></div>
  <p class="note">Answer a few questions and Mindy points you at the opportunities you're most competitive for — in minutes, with no commitment.</p>
</div></section>

<!-- EXPLORE MORE WAYS TO WIN (alternating navy split panels) -->
<section class="explore" id="explore">
  <h2>Explore more ways to win</h2>
  <p>Bid your way. Choose the path that fits your capture.</p>
</section>
<div class="panels">
  <div class="panel">
    <div class="pc">
      <h3>Decide <span class="hi-cyan">before you bid</span></h3>
      <ul>
        <li><b>An honest Bid / No-Bid</b> grounded in the notice, the incumbent, and your fit.</li>
        <li><b>M-Win win-probability</b> so you spend effort where you have a real shot.</li>
        <li><b>Don't burn weeks</b> on a bid you were never going to win.</li>
      </ul>
      <p class="sub2" style="margin-bottom:18px">Check any opportunity in seconds. No commitment.</p>
      <a class="btn white sm go" href="/opportunity-map">Check an opportunity →</a>
    </div>
    <div class="pi" style="background:linear-gradient(135deg,#12805c,#0b1f66)"></div>
  </div>
  <div class="panel rev">
    <div class="pc">
      <h3>Draft it <span class="hi-cyan">fast</span></h3>
      <ul>
        <li><b>Proposal Assist</b> builds a compliance matrix from the RFP automatically.</li>
        <li>Drafted sections woven from your <b>real past performance</b> in the Vault.</li>
        <li>A <b>referee pass</b> checks compliance before you submit — then export to .docx.</li>
      </ul>
      <p class="sub2" style="margin-bottom:18px">Set up your Vault once; reuse it on every bid.</p>
      <a class="btn white sm go" href="/app?panel=vault">Set up your Vault →</a>
    </div>
    <div class="pi" style="background:linear-gradient(135deg,#7c3aed,#0b1f66)"></div>
  </div>
  <div class="panel">
    <div class="pc">
      <h3>Know who you're <span class="hi-cyan">up against</span></h3>
      <ul>
        <li>The likely <b>incumbent</b>, the contract's <b>ceiling</b>, and when it recompetes.</li>
        <li>Real <b>GSA labor rates</b> so your pricing is credible, not a guess.</li>
        <li>Find <b>teaming partners</b> when the work needs a team to win it.</li>
      </ul>
      <p class="sub2" style="margin-bottom:18px">Turn a listing into a capture plan.</p>
      <a class="btn white sm go" href="/app?panel=pipeline">Build your pipeline →</a>
    </div>
    <div class="pi" style="background:linear-gradient(135deg,#1e3a8a,#12805c)"></div>
  </div>
</div>

<!-- RESOURCES -->
<section class="res"><div class="in">
  <h2>Go-to resources for a winning bid</h2>
  <p class="sub">Practical guides for every step of your capture and proposal process.</p>
  <div class="rgrid">
    <a class="rc" href="/opportunity-map"><div class="thumb"></div><div class="b"><span class="pill">6 min read</span><h4>How to read a solicitation before you bid</h4><span class="read">Read guide</span></div></a>
    <a class="rc" href="/app?panel=vault"><div class="thumb"></div><div class="b"><span class="pill">8 min read</span><h4>Building a capability statement that wins</h4><span class="read">Read guide</span></div></a>
    <a class="rc" href="/opportunity-map"><div class="thumb"></div><div class="b"><span class="pill">5 min read</span><h4>Sources Sought: shape the requirement early</h4><span class="read">Read guide</span></div></a>
    <a class="rc" href="/pricing"><div class="thumb"></div><div class="b"><span class="pill">4 min read</span><h4>How Mindy helps you bid and win</h4><span class="read">Read guide</span></div></a>
  </div>
  <p class="guide">As you take the steps to bid, learn what to expect with our <a href="/pricing">bidding guide</a>.</p>
</div></section>

<!-- FAQ -->
<section class="faq">
  <h2>Frequently asked questions</h2>
  <details><summary>How do I know if I should bid on something?</summary><p>Mindy's Bid / No-Bid gives you an honest go/no-go grounded in the actual notice, the likely incumbent, and how well your profile fits — plus an M-Win win-probability score. The point is to say no to the bids you can't win so you can go all-in on the ones you can.</p></details>
  <details><summary>What is M-Win?</summary><p>M-Win is Mindy's win-probability read on a specific opportunity — think of it like a Zestimate, but for your odds of winning a bid. It weighs set-aside fit, agency history, your capabilities, and more. It's a directional signal to help you prioritize, not a guarantee.</p></details>
  <details><summary>Does Mindy actually write the proposal?</summary><p>Proposal Assist builds the compliance matrix from the RFP, drafts sections woven from your real past performance in the Vault, and runs a referee pass for compliance before you export to Word. It's an assist that gets you to a strong first draft fast — you stay in control of the final submission.</p></details>
  <details><summary>How does Mindy know who the incumbent is?</summary><p>Mindy matches the opportunity against real federal award history (USASpending) to surface the likely incumbent, the contract ceiling, and roughly when it recompetes — plus real GSA labor rates for pricing context. Every figure traces to a real data source; nothing is invented.</p></details>
  <details><summary>What if I need a partner to win the work?</summary><p>Mindy helps you find capable contractors and manage teaming in your pipeline, so you can pursue work that's bigger than your company can deliver alone.</p></details>
  <details><summary>Do I have to pay to start?</summary><p>Daily opportunity alerts and the map are free. The bid-and-win tools (Bid/No-Bid, Proposal Assist, full intel) are part of Mindy Pro. See <a href="/pricing">pricing</a>.</p></details>
</section>

<!-- CLOSING CTA -->
<div class="close"><div class="in">
  <h2>Find your best path to win</h2>
  <p>Open an opportunity and let Mindy tell you whether to bid, how you stack up, and what it takes to win it.</p>
  <a class="btn white" href="/opportunity-map">Explore opportunities</a>
</div></div>

<p class="foot">Mindy by GovCon Giants AI. M-Win is a directional win-probability estimate, not a guarantee. Incumbent, ceiling, and pricing figures are sourced from public federal data (USASpending, GSA).</p>
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
