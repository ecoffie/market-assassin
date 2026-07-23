/**
 * /landing-v2 — the EXTERNAL (logged-out) public home, Robinhood-2013 model: an acquisition
 * page for a stranger who isn't sold yet. This is the correct home for the plain acquisition
 * hero ("Win federal contracts. Skip the $10K tools.") — NOT the logged-in command center
 * (that's /home-v4, which shows YOUR rank/XP). Everything here is PUBLIC: real market proof
 * numbers, the shareable Discover content engine, events, pricing. No personal data.
 *
 * Preview route so it doesn't overwrite the live /mindy-landing. Real public data from the
 * recompete + recent-spending tables.
 */
import Link from 'next/link';
import { queryExpiringContracts } from '@/lib/recompete/query';
import { getRecentBigAwards } from '@/lib/discover/recent-spending';
import { formatCompanyName as fmtName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

export const dynamic = 'force-dynamic';

const DISCOVER = [
  { href: '/up-for-grabs', tag: 'Up for grabs', title: 'The biggest contracts expiring soon', blurb: 'Every federal contract coming up for recompete — who holds it now, what it’s worth, when the window opens.' },
  { href: '/top', tag: 'Leaderboards', title: 'The biggest federal contractors, ranked', blurb: 'Who’s winning the most — by agency, by set-aside, by state. Rank movement included.' },
  { href: '/spending', tag: 'This week', title: 'The latest big federal awards', blurb: 'The largest contracts the government signed this week — refreshed daily, every one real.' },
  { href: '/weird', tag: 'Weird awards', title: 'The strangest things the government bought', blurb: 'Proof the federal market buys everything. Real, citable, oddly shareable.' },
];

const PRICING = [
  { name: 'Free', price: '$0', note: 'Daily alerts + Discover, forever', cta: 'Start free', href: '/signup' },
  { name: 'Pro', price: '$149', unit: '/mo', note: 'AI briefings, forecasts, pipeline, CRM', cta: 'Go Pro', href: '/pricing', feat: true },
  { name: 'Teams', price: '$499', unit: '/mo', note: 'Everything, for a whole BD team', cta: 'Talk to us', href: '/pricing' },
];

export default async function LandingV2() {
  const [expiring, recent] = await Promise.all([
    queryExpiringContracts({ monthsWindow: 12, minValue: 10_000_000, limit: 100 }).catch(() => ({ contracts: [], total: 0 })),
    getRecentBigAwards(20).catch(() => []),
  ]);

  const biggestOpp = expiring.contracts.reduce((m, c) => Math.max(m, Number(c.potential_total_value ?? c.total_obligation ?? 0)), 0);
  const oppCount = expiring.total || expiring.contracts.length;
  const topAward = recent[0] ?? null;

  return (
    <div className="lv2">
      <style>{CSS}</style>

      <header className="nav"><div className="wrap nav-in">
        <a className="brand" href="#top"><span className="mk">M</span> Mindy</a>
        <nav className="links">
          <Link href="/discover">Discover</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/mcp">MCP &amp; Plugin</Link>
        </nav>
        <div className="nav-r">
          <Link className="signin" href="/app">Sign in</Link>
          <Link className="cta-sm" href="/signup">Get started free</Link>
        </div>
      </div></header>

      <main id="top">
        {/* HERO — acquisition (Robinhood 2013): one promise, name the enemy, one action */}
        <section className="hero"><div className="wrap">
          <p className="eyebrow">Government contracting for everyone</p>
          <h1>Win <span className="ac">federal contracts.</span><br />Skip the $10K tools.</h1>
          <p className="sub">The U.S. government is legally required to buy — and can&apos;t ghost you. Mindy finds your contracts, sizes your market, and drafts your bids. Just ask, in plain English.</p>
          <div className="cta">
            <Link className="go" href="/signup">Get started free →</Link>
            <Link className="ghost" href="/up-for-grabs">See what&apos;s up for grabs</Link>
          </div>

          {/* PUBLIC proof numbers — real market data, nothing personal */}
          <div className="proof">
            <div className="stat"><div className="num gain">{biggestOpp ? fmtMoney(biggestOpp) : '—'}</div><div className="lbl">biggest contract up for grabs right now</div></div>
            <div className="stat"><div className="num">{oppCount ? `${oppCount.toLocaleString()}+` : '—'}</div><div className="lbl">federal contracts expiring in the next year</div></div>
            <div className="stat"><div className="num">{topAward ? fmtMoney(topAward.obligation_amount) : '—'}</div><div className="lbl">{topAward ? `awarded this week · ${fmtName(topAward.recipient_name || '')}` : 'awarded this week'}</div></div>
          </div>
        </div></section>

        {/* POSITIONING — the brand spine */}
        <section className="spine"><div className="wrap">
          <h2>Everyone teaches you how to <span className="strike">make money</span>.<br /><span className="ac">Nobody hands you the customer.</span></h2>
          <p>Codie says buy a business — you need capital. Hormozi says scale one — you need customers. We hand you the customer: the U.S. government. Legally required to buy, can&apos;t stiff you, can&apos;t ghost you. Slower and more paperwork, sure. But bulletproof.</p>
        </div></section>

        {/* DISCOVER — the shareable content engine (public, SEO, social proof) */}
        <section className="disc"><div className="wrap">
          <div className="sec-h"><h2>See the market before you sign up</h2><Link href="/discover">All of Discover →</Link></div>
          <div className="dgrid">
            {DISCOVER.map((d) => (
              <Link className="dcard" key={d.href} href={d.href}>
                <span className="dtag">{d.tag}</span>
                <span className="dt">{d.title}</span>
                <span className="db">{d.blurb}</span>
                <span className="dgo">Open →</span>
              </Link>
            ))}
          </div>
        </div></section>

        {/* HOW — what Mindy does, plainly */}
        <section className="how"><div className="wrap">
          <div className="sec-h"><h2>What Mindy does for you</h2></div>
          <div className="hgrid">
            <div className="hcard"><div className="hn">01</div><div className="ht">Finds your contracts</div><div className="hb">Tell Mindy your business in plain English. She finds the open solicitations and the recompetes worth chasing — matched to what you actually do.</div></div>
            <div className="hcard"><div className="hn">02</div><div className="ht">Sizes your market</div><div className="hb">Who&apos;s buying, who holds it now, what it&apos;s worth, and where the money moves. The $10K-tool analysis, without the $10K.</div></div>
            <div className="hcard"><div className="hn">03</div><div className="ht">Drafts your bid</div><div className="hb">Grounded in your past performance and capabilities — a real first draft of the proposal, not a blank page.</div></div>
          </div>
        </div></section>

        {/* HAPPENING — events + community */}
        <section className="events"><div className="wrap">
          <div className="sec-h"><h2>Happening on Mindy</h2></div>
          <div className="evrow">
            <div className="ev big"><span className="pk live">Live event</span><h3>Mindy Demo Day</h3><p>Watch real contractors pitch, see Mindy find their next award on stage, and get the exact playbook. Free to attend.</p><Link className="evlnk" href="/signup">Save your seat →</Link></div>
            <div className="ev"><span className="pk">Giveaway</span><h4>$10K Grant Giveaway</h4><p>One small business, one working-capital grant to chase its first federal award.</p></div>
            <div className="ev"><span className="pk">Challenge</span><h4>First-Contract Challenge</h4><p>30 days, guided by Mindy, from profile to your first submitted bid.</p></div>
          </div>
        </div></section>

        {/* PRICING */}
        <section className="pricing"><div className="wrap">
          <div className="sec-h"><h2>Start free. Upgrade when it pays for itself.</h2></div>
          <div className="pgrid">
            {PRICING.map((p) => (
              <div className={`pcard${p.feat ? ' feat' : ''}`} key={p.name}>
                {p.feat && <span className="pbadge">Most popular</span>}
                <div className="pn">{p.name}</div>
                <div className="pp">{p.price}<span className="pu">{p.unit || ''}</span></div>
                <div className="pnote">{p.note}</div>
                <Link className="pcta" href={p.href}>{p.cta} →</Link>
              </div>
            ))}
          </div>
        </div></section>

        {/* FINAL CTA */}
        <section className="final"><div className="wrap">
          <h2>The customer is waiting.</h2>
          <p>Free to start. No card. Find your first contract today.</p>
          <Link className="go" href="/signup">Get started free →</Link>
        </div></section>
      </main>

      <footer className="f"><div className="wrap f-in">
        <span>© 2026 GovCon Giants AI · Mindy</span>
        <span>Discover · Pricing · MCP · Sign in</span>
      </div></footer>
    </div>
  );
}

const CSS = `
.lv2{--bg:#08060f;--surface:#110d1c;--line:#1c1729;--line2:#2a2340;--violet:#a855f7;--violet2:#c084fc;
  --emerald:#34d399;--ink:#ece9f5;--ink2:#b4aecb;--mut:#847f99;
  background:var(--bg);color:var(--ink);min-height:100dvh;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.lv2 *{box-sizing:border-box}
.lv2 a{color:inherit;text-decoration:none}
.lv2 .wrap{width:100%;max-width:1080px;margin:0 auto;padding:0 24px}
.lv2 h1,.lv2 h2,.lv2 h3{letter-spacing:-.03em;text-wrap:balance}
.lv2 .ac{color:var(--violet2)}

/* nav */
.lv2 .nav{position:sticky;top:0;z-index:20;background:rgba(8,6,15,.82);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.lv2 .nav-in{display:flex;align-items:center;justify-content:space-between;height:64px}
.lv2 .brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:16px}
.lv2 .mk{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:linear-gradient(140deg,#a855f7,#7c3aed);color:#fff;font-weight:800;font-size:14px}
.lv2 .links{display:flex;gap:26px;font-size:14px;color:var(--ink2)}
.lv2 .links a:hover{color:#fff}
.lv2 .nav-r{display:flex;align-items:center;gap:14px}
.lv2 .signin{font-size:14px;color:var(--ink2)}
.lv2 .signin:hover{color:#fff}
.lv2 .cta-sm{font-size:14px;font-weight:700;padding:9px 16px;border-radius:10px;background:linear-gradient(140deg,#a855f7,#7c3aed);color:#fff}
@media(max-width:640px){.lv2 .links{display:none}}

/* hero */
.lv2 .hero{text-align:center;padding:clamp(70px,12vw,140px) 0 clamp(48px,7vw,80px)}
.lv2 .eyebrow{font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:#a78bda;margin:0 0 22px;font-weight:600}
.lv2 .hero h1{font-weight:800;font-size:clamp(42px,8.5vw,88px);line-height:1.01;margin:0}
.lv2 .hero .sub{max-width:660px;margin:26px auto 0;font-size:clamp(16px,2vw,19px);line-height:1.6;color:var(--ink2)}
.lv2 .cta{margin-top:36px;display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap}
.lv2 .go{display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(140deg,#a855f7,#7c3aed);color:#fff;font-weight:700;font-size:16px;padding:16px 30px;border-radius:14px;box-shadow:0 12px 44px -12px rgba(168,85,247,.6);transition:transform .12s}
.lv2 .go:hover{transform:translateY(-1px)}
.lv2 .ghost{font-size:15px;color:var(--ink2)}
.lv2 .ghost:hover{color:#fff}
.lv2 .proof{margin-top:clamp(48px,7vw,76px);display:grid;grid-template-columns:repeat(3,1fr);gap:20px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:40px 0}
.lv2 .stat .num{font-weight:800;font-size:clamp(28px,5vw,50px);letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1}
.lv2 .stat .num.gain{color:var(--emerald)}
.lv2 .stat .lbl{margin-top:12px;font-size:12.5px;color:var(--mut);line-height:1.4;max-width:210px;margin-inline:auto}
@media(max-width:680px){.lv2 .proof{grid-template-columns:1fr;gap:30px}}

/* section heads */
.lv2 section{padding:clamp(56px,8vw,96px) 0}
.lv2 .sec-h{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:34px;flex-wrap:wrap}
.lv2 .sec-h h2{font-size:clamp(24px,3.5vw,36px);font-weight:800;margin:0}
.lv2 .sec-h a{font-size:14px;color:#a78bda}
.lv2 .sec-h a:hover{color:var(--violet2)}

/* spine */
.lv2 .spine{text-align:center;background:linear-gradient(180deg,transparent,rgba(124,58,237,.06),transparent)}
.lv2 .spine h2{font-size:clamp(28px,5vw,52px);font-weight:800;line-height:1.08;margin:0}
.lv2 .spine .strike{text-decoration:line-through;text-decoration-color:#6b6480;color:var(--mut)}
.lv2 .spine p{max-width:680px;margin:28px auto 0;font-size:clamp(15px,1.9vw,18px);line-height:1.65;color:var(--ink2)}

/* discover */
.lv2 .dgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.lv2 .dcard{display:flex;flex-direction:column;gap:8px;padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--surface);transition:border-color .15s,transform .15s}
.lv2 .dcard:hover{border-color:var(--line2);transform:translateY(-2px)}
.lv2 .dtag{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:#a78bda;font-weight:600}
.lv2 .dt{font-size:19px;font-weight:700;letter-spacing:-.02em}
.lv2 .db{font-size:14px;color:var(--ink2);line-height:1.5}
.lv2 .dgo{margin-top:4px;font-size:13.5px;color:var(--violet2);font-weight:600}
@media(max-width:680px){.lv2 .dgrid{grid-template-columns:1fr}}

/* how */
.lv2 .hgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.lv2 .hcard{padding:26px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
.lv2 .hn{font-weight:800;font-size:14px;color:var(--violet2);font-variant-numeric:tabular-nums}
.lv2 .ht{margin-top:12px;font-size:19px;font-weight:700;letter-spacing:-.02em}
.lv2 .hb{margin-top:10px;font-size:14px;color:var(--ink2);line-height:1.55}
@media(max-width:760px){.lv2 .hgrid{grid-template-columns:1fr}}

/* events */
.lv2 .evrow{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:16px}
.lv2 .ev{padding:24px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}
.lv2 .ev.big{background:linear-gradient(150deg,rgba(124,58,237,.22),var(--surface));border-color:var(--line2)}
.lv2 .pk{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:#a78bda}
.lv2 .pk.live{color:var(--emerald)}
.lv2 .ev h3{font-size:26px;font-weight:800;margin:14px 0 0}
.lv2 .ev h4{font-size:18px;font-weight:700;margin:12px 0 0}
.lv2 .ev p{font-size:13.5px;color:var(--ink2);line-height:1.5;margin:10px 0 0}
.lv2 .evlnk{display:inline-block;margin-top:16px;font-size:14px;font-weight:700;color:var(--violet2)}
@media(max-width:760px){.lv2 .evrow{grid-template-columns:1fr}}

/* pricing */
.lv2 .pgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.lv2 .pcard{position:relative;padding:28px 24px;border:1px solid var(--line);border-radius:18px;background:var(--surface);text-align:center}
.lv2 .pcard.feat{border-color:var(--violet);box-shadow:0 0 0 1px var(--violet),0 20px 60px -30px rgba(168,85,247,.7)}
.lv2 .pbadge{position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:linear-gradient(140deg,#a855f7,#7c3aed);color:#fff;font-size:11px;font-weight:700;padding:5px 12px;border-radius:999px}
.lv2 .pn{font-size:14px;font-weight:700;color:var(--ink2)}
.lv2 .pp{margin-top:8px;font-size:42px;font-weight:800;letter-spacing:-.03em}
.lv2 .pu{font-size:15px;color:var(--mut);font-weight:600}
.lv2 .pnote{margin-top:8px;font-size:13.5px;color:var(--ink2);line-height:1.4;min-height:38px}
.lv2 .pcta{display:inline-block;margin-top:18px;font-weight:700;font-size:14px;padding:11px 20px;border-radius:11px;border:1px solid var(--line2)}
.lv2 .pcard.feat .pcta{background:linear-gradient(140deg,#a855f7,#7c3aed);color:#fff;border:none}
.lv2 .pcta:hover{border-color:var(--violet2)}
@media(max-width:760px){.lv2 .pgrid{grid-template-columns:1fr}}

/* final */
.lv2 .final{text-align:center}
.lv2 .final h2{font-size:clamp(30px,5vw,54px);font-weight:800;margin:0}
.lv2 .final p{margin:16px auto 30px;font-size:16px;color:var(--ink2)}

.lv2 .f{border-top:1px solid var(--line);padding:26px 0}
.lv2 .f-in{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--mut)}
`;
