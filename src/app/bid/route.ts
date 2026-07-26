/**
 * GET /bid — "Bid with confidence" landing page (Zillow's Sell-page analogue).
 *
 * The dataset dropdown's third option (Open Opportunities / Past Opportunities / **Bid**)
 * routes here instead of switching the map — mirroring how Zillow's Buy/Rent open the map
 * but Sell opens a marketing/conversion page. This is a STUB to be fleshed out from the
 * Zillow sell-page copy Eric is providing; it promotes the MCP/bid features (bid-no-bid,
 * proposal drafting, compliance matrix, M-Win) that help contractors bid and win.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bid with confidence — Mindy</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,-apple-system,sans-serif;color:#111c26;background:#fff;-webkit-font-smoothing:antialiased}
.top{display:flex;align-items:center;justify-content:space-between;padding:18px 28px;border-bottom:1px solid #e6eaef}
.top .nav{display:flex;gap:26px;align-items:center}
.top .nav a{font:600 14px Inter,system-ui,sans-serif;color:#111c26;text-decoration:none}
.top .nav a:hover{color:#3b82f6}.top .nav a.on{color:#3b82f6}
.brand{display:flex;align-items:center;gap:8px;font:700 19px Inter;letter-spacing:-.02em}
.brand img{height:24px}
.wrap{max-width:1120px;margin:0 auto;padding:64px 28px 80px;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
@media(max-width:820px){.wrap{grid-template-columns:1fr;padding:44px 22px 60px}}
h1{font:800 clamp(38px,6vw,64px) Inter,system-ui,sans-serif;letter-spacing:-.03em;line-height:1.02;margin-bottom:20px}
.lead{font:400 18px/1.55 Inter,system-ui,sans-serif;color:#42505f;max-width:44ch;margin-bottom:30px}
.cta{display:inline-flex;align-items:center;gap:9px;background:#006aff;color:#fff;font:700 16px Inter;padding:15px 26px;border-radius:10px;text-decoration:none;transition:filter .15s}
.cta:hover{filter:brightness(.94)}
.art{background:linear-gradient(135deg,#eef4ff,#f4f0fe);border:1px solid #e6eaef;border-radius:20px;min-height:340px;display:flex;align-items:center;justify-content:center;padding:28px}
.feat{max-width:1120px;margin:0 auto;padding:0 28px 90px}
.feat h2{font:700 26px Inter;letter-spacing:-.02em;margin-bottom:6px}
.feat .sub{color:#6b7787;font:400 15px Inter;margin-bottom:26px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.card{border:1px solid #e6eaef;border-radius:14px;padding:20px 18px;background:#fff}
.card h3{font:700 16px Inter;margin-bottom:6px}
.card p{font:400 13.5px/1.5 Inter;color:#6b7787}
.tag{display:inline-block;font:600 11px Inter;color:#137a4e;background:#e7f4ee;padding:3px 9px;border-radius:6px;margin-bottom:11px}
.note{max-width:1120px;margin:0 auto;padding:0 28px 60px;color:#9aa5b3;font:400 12.5px Inter}
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
<section class="wrap">
  <div>
    <h1>Bid with<br>confidence</h1>
    <p class="lead">Finding the opportunity is step one. Mindy helps you decide, draft, and win — so you bid on the right work and put in a stronger proposal than you could alone.</p>
    <a class="cta" href="/app?panel=vault">Explore your options ↓</a>
  </div>
  <div class="art"><span style="color:#6b7787;font:600 14px Inter">“Bid with confidence” — hero art (from Zillow sell copy)</span></div>
</section>
<section class="feat">
  <h2>What Mindy does before you bid</h2>
  <p class="sub">The tools that turn a listing into a win.</p>
  <div class="grid">
    <div class="card"><span class="tag">Decide</span><h3>Bid / No-Bid</h3><p>An honest go/no-go grounded in the notice, the incumbent, and your fit — so you don't burn weeks on a bid you can't win.</p></div>
    <div class="card"><span class="tag">Odds</span><h3>M-Win score</h3><p>A win-probability read on each opportunity, so you spend effort where you actually have a shot.</p></div>
    <div class="card"><span class="tag">Draft</span><h3>Proposal Assist</h3><p>Compliance matrix, drafted sections woven from your real past performance, and a referee pass before you submit.</p></div>
    <div class="card"><span class="tag">Intel</span><h3>Incumbent &amp; pricing</h3><p>Who holds it now, what it's worth, and real GSA labor rates — the context that makes a proposal credible.</p></div>
  </div>
</section>
<p class="note">Placeholder — final copy &amp; layout to be modeled on the Zillow sell page.</p>
</body></html>`;

export async function GET() {
  return new NextResponse(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
