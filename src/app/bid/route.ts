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
 *
 * Visual system: the Mindy public site (src/lib/public-site) — shared header/footer, self-hosted
 * fonts, `--mp-*` roles. The Zillow-style dark/teal bands became wash chapters (no dark surfaces
 * on public pages); the page's own Open / Past / Contacts bar stays under the shared header.
 */
import { NextResponse } from 'next/server';
import { mpRawBodyClose, mpRawBodyOpen, mpRawHeadHtml } from '@/lib/public-site/html';

export const dynamic = 'force-dynamic';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bid with confidence — Mindy</title>
<meta name="description" content="Finding the opportunity is step one. Mindy helps you decide, draft, and win federal bids — bid/no-bid, win-probability (M-Win), proposal drafting, and incumbent intel.">
${mpRawHeadHtml()}
<style>
/* Mindy public system (src/lib/public-site): page rules use only the --mp-* roles. Every rule is
   scoped to .bid so the shared header and footer keep their own styles. */
.bid{color:var(--mp-ink);line-height:1.5}
.bid *{margin:0;padding:0}
.bid .top{display:flex;align-items:center;justify-content:space-between;padding:12px 28px;border-bottom:1px solid var(--mp-line);background:var(--mp-surface)}
.bid .top .nav{display:flex;gap:24px;align-items:center}
.bid .top .nav a{font:600 14px var(--mp-font-sans);color:var(--mp-body);text-decoration:none;white-space:nowrap}
.bid .top .nav a:hover{color:var(--mp-navy)}.bid .top .nav a.on{color:var(--mp-navy)}
.bid .brand{display:flex;align-items:center;gap:8px;font:700 17px var(--mp-font-sans);letter-spacing:-.02em;text-decoration:none;color:var(--mp-ink)}
.bid .brand img{height:22px}
@media(max-width:720px){.bid .top .nav a:not(.on){display:none}.bid .top{padding:12px 16px}}
.bid .btn{display:inline-flex;align-items:center;gap:9px;background:var(--mp-navy);color:var(--mp-surface);font:600 16px var(--mp-font-sans);padding:15px 26px;border-radius:0;text-decoration:none;transition:background .15s;border:1px solid transparent;cursor:pointer}
.bid .btn:hover{background:var(--mp-navy-hover)}
.bid .btn.white{background:var(--mp-navy);color:var(--mp-surface)}
.bid .btn.white:hover{background:var(--mp-navy-hover)}
.bid .btn.sm{font-size:14.5px;padding:13px 22px}
.bid h1{font:700 clamp(40px,5.6vw,64px)/1.08 var(--mp-font-serif);letter-spacing:-.015em;color:var(--mp-ink)}
.bid .hi-cyan,.bid .hi-green{color:var(--mp-accent)}
/* HERO */
.bid .hero{max-width:1180px;margin:0 auto;padding:72px 28px 58px;display:grid;grid-template-columns:1.05fr .95fr;gap:52px;align-items:center}
@media(max-width:880px){.bid .hero{grid-template-columns:1fr;padding:46px 22px 40px;gap:30px}}
.bid .hero .lead{font:400 18px/1.6 var(--mp-font-serif);color:var(--mp-body);max-width:46ch;margin:22px 0 30px}
.bid .heroart{background:var(--mp-wash);border:1px solid var(--mp-line);border-radius:0;padding:26px;min-height:340px;display:flex;flex-direction:column;justify-content:center;gap:14px}
.bid .mock{background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:0;padding:16px 18px}
.bid .mock .r{display:flex;justify-content:space-between;align-items:center}
.bid .mock .t{font:700 14.5px var(--mp-font-sans);margin:9px 0 3px;color:var(--mp-ink)}.bid .mock .s{font:500 12px var(--mp-font-sans);color:var(--mp-subtle)}
.bid .mwin{display:inline-flex;align-items:baseline;gap:6px;font:700 14px var(--mp-font-sans);color:var(--mp-ink)}.bid .mwin b{font:600 24px var(--mp-font-mono);color:var(--mp-ok);font-variant-numeric:tabular-nums}
.bid .bar{height:8px;border-radius:0;background:var(--mp-hair);overflow:hidden;margin:10px 0 6px}.bid .bar i{display:block;height:100%;width:72%;background:var(--mp-ok)}
.bid .tag{display:inline-block;font:600 11px var(--mp-font-sans);padding:3px 9px;border-radius:var(--mp-radius-chip);border:1px solid var(--mp-line)}
.bid .tag.n{color:var(--mp-navy);background:var(--mp-navy-wash)}.bid .tag.g{color:var(--mp-ok);background:var(--mp-ok-bg);border-color:var(--mp-ok-line)}.bid .tag.b{color:var(--mp-body);background:var(--mp-wash)}
.bid .mock .ok-text{color:var(--mp-ok)}
/* M-Win strip */
.bid .strip{background:var(--mp-wash);border-top:1px solid var(--mp-line);border-bottom:1px solid var(--mp-line)}
.bid .strip .in{max-width:1180px;margin:0 auto;padding:18px 28px;display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap;font:400 15px var(--mp-font-sans);color:var(--mp-body)}
.bid .strip strong{color:var(--mp-ink)}
.bid .strip a{color:var(--mp-navy);font-weight:600;text-decoration:none}.bid .strip a:hover{text-decoration:underline}
/* Featured band: a wash chapter, not a dark band */
.bid .feature{background:var(--mp-wash);color:var(--mp-ink);padding:64px 28px 68px;border-bottom:1px solid var(--mp-line)}
.bid .feature .in{max-width:1180px;margin:0 auto}
.bid .feature h2{text-align:center;font:700 clamp(28px,3.8vw,42px)/1.2 var(--mp-font-serif);letter-spacing:-.01em;margin-bottom:36px;color:var(--mp-ink)}
.bid .feature .cards{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--mp-line);border:1px solid var(--mp-line)}
@media(max-width:820px){.bid .feature .cards{grid-template-columns:1fr}}
.bid .fcard{background:var(--mp-surface);color:var(--mp-ink);border-radius:0;padding:34px 32px;text-align:center}
.bid .fcard .ic{width:80px;height:80px;border-radius:50%;background:var(--mp-navy-wash);margin:0 auto 22px;display:flex;align-items:center;justify-content:center}
.bid .fcard .ic svg{width:38px;height:38px;stroke:var(--mp-navy);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.bid .fcard h3{font:700 21px/1.3 var(--mp-font-serif);margin-bottom:12px}
.bid .fcard p{font:400 15.5px/1.6 var(--mp-font-sans);color:var(--mp-body);max-width:38ch;margin:0 auto}
.bid .fcard a{color:var(--mp-navy);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.bid .feature .cta{text-align:center;margin-top:34px}.bid .feature .note{text-align:center;font:400 15px var(--mp-font-sans);color:var(--mp-muted);max-width:64ch;margin:26px auto 0}
/* Explore split panels */
.bid .explore{max-width:1180px;margin:0 auto;padding:72px 28px 20px;text-align:center}
.bid .explore h2{font:700 clamp(28px,3.6vw,42px)/1.2 var(--mp-font-serif);letter-spacing:-.01em;margin-bottom:12px}
.bid .explore>p{font:400 17px var(--mp-font-sans);color:var(--mp-body);margin-bottom:8px}
.bid .panels{max-width:1180px;margin:0 auto;padding:22px 28px}
.bid .panel{display:grid;grid-template-columns:1fr 1fr;background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:0;overflow:hidden;margin-bottom:26px;min-height:400px}
.bid .panel .pc{padding:52px 48px;color:var(--mp-ink);display:flex;flex-direction:column;justify-content:center}
.bid .panel .pi{background:var(--mp-navy-wash);border-left:1px solid var(--mp-line);min-height:280px}
.bid .panel.rev .pc{order:2}.bid .panel.rev .pi{order:1;border-left:0;border-right:1px solid var(--mp-line)}
@media(max-width:820px){.bid .panel,.bid .panel.rev{grid-template-columns:1fr}.bid .panel .pc{order:2;padding:34px 26px}.bid .panel .pi,.bid .panel.rev .pi{order:1;min-height:120px;border:0;border-bottom:1px solid var(--mp-line)}}
.bid .panel h3{font:700 clamp(26px,3vw,36px)/1.2 var(--mp-font-serif);letter-spacing:-.01em;margin-bottom:22px}
.bid .panel ul{list-style:none;display:flex;flex-direction:column;gap:16px;margin-bottom:26px}
.bid .panel li{position:relative;padding-left:34px;font:400 16px/1.5 var(--mp-font-sans);color:var(--mp-body)}
.bid .panel li:before{content:"";position:absolute;left:0;top:3px;width:16px;height:10px;border-left:2.6px solid var(--mp-navy);border-bottom:2.6px solid var(--mp-navy);transform:rotate(-45deg)}
.bid .panel li b{color:var(--mp-ink)}
.bid .panel .sub2{font:400 15px/1.5 var(--mp-font-sans);color:var(--mp-muted);margin-top:4px}
.bid .panel .go{align-self:flex-start;margin-top:6px}
/* Resources */
.bid .res{background:var(--mp-wash);padding:64px 28px 66px;border-top:1px solid var(--mp-line);border-bottom:1px solid var(--mp-line)}
.bid .res .in{max-width:1180px;margin:0 auto}
.bid .res h2{font:700 28px/1.25 var(--mp-font-serif);letter-spacing:-.01em;margin-bottom:6px}.bid .res .sub{color:var(--mp-muted);font:400 15px var(--mp-font-sans);margin-bottom:28px}
.bid .rgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1px;background:var(--mp-line);border:1px solid var(--mp-line)}
.bid .rc{background:var(--mp-surface);border-radius:0;overflow:hidden;text-decoration:none;color:inherit;transition:background .15s;display:flex;flex-direction:column}
.bid .rc:hover{background:var(--mp-paper)}
.bid .rc .thumb{height:120px;background:var(--mp-navy-wash);border-bottom:1px solid var(--mp-line)}
.bid .rc .b{padding:18px 20px 22px;display:flex;flex-direction:column;gap:10px;flex:1}
.bid .rc .pill{align-self:flex-start;font:600 11px var(--mp-font-sans);color:var(--mp-muted);background:var(--mp-wash);border:1px solid var(--mp-line);padding:3px 8px;border-radius:var(--mp-radius-chip)}
.bid .rc h4{font:700 16.5px/1.35 var(--mp-font-serif);color:var(--mp-ink)}
.bid .rc .read{color:var(--mp-navy);font:600 14px var(--mp-font-sans);margin-top:auto}
.bid .res .guide{margin-top:26px;font:400 15px var(--mp-font-sans);color:var(--mp-body)}.bid .res .guide a{color:var(--mp-navy);font-weight:600}
/* FAQ */
.bid .faq{max-width:920px;margin:0 auto;padding:64px 28px 30px}
.bid .faq h2{font:700 28px/1.25 var(--mp-font-serif);letter-spacing:-.01em;margin-bottom:20px;text-align:center}
.bid details{border-bottom:1px solid var(--mp-line);padding:18px 4px}
.bid details summary{font:600 17px var(--mp-font-sans);color:var(--mp-ink);cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:16px}
.bid details summary::-webkit-details-marker{display:none}
.bid details summary:after{content:"+";font-weight:400;font-size:24px;color:var(--mp-muted)}
.bid details[open] summary:after{content:"\\2013"}
.bid details p{font:400 15px/1.65 var(--mp-font-sans);color:var(--mp-body);padding-top:12px;max-width:74ch}
.bid details a{color:var(--mp-navy)}
/* Close: a quiet wash chapter with one navy button */
.bid .close{background:var(--mp-wash);color:var(--mp-ink);margin-top:44px;border-top:1px solid var(--mp-line);border-bottom:1px solid var(--mp-line)}
.bid .close .in{max-width:1180px;margin:0 auto;padding:64px 28px;text-align:center}
.bid .close h2{font:700 clamp(26px,3.4vw,38px)/1.2 var(--mp-font-serif);letter-spacing:-.01em;margin-bottom:12px;color:var(--mp-ink)}
.bid .close p{font:400 17px var(--mp-font-sans);color:var(--mp-body);max-width:58ch;margin:0 auto 26px}
.bid .foot{max-width:1180px;margin:0 auto;padding:30px 28px 8px;color:var(--mp-subtle);font:400 12.5px/1.6 var(--mp-font-sans)}
</style></head><body>
${mpRawBodyOpen()}
<div class="bid">
<header class="top">
  <nav class="nav">
    <a href="/opportunity-map">Open</a>
    <a href="/opportunity-map">Past</a>
    <a href="/opportunity-map">Contacts</a>
    <a class="on">Bid with confidence</a>
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
      <div class="r"><span class="tag b">Bid / No-Bid</span><span class="s ok-text" style="font-weight:700">Go</span></div>
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
    <div class="pi"></div>
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
    <div class="pi"></div>
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
    <div class="pi"></div>
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
</div>
${mpRawBodyClose()}
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
