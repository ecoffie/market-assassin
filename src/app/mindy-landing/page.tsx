import Link from 'next/link';
import { MindySignupForm } from '@/components/mindy/MindySignupForm';
import { MindyDayBar } from '@/components/mindy/MindyDayBar';
import { queryExpiringContracts, type ExpiringContract } from '@/lib/recompete/query';
import { getWeirdAwards } from '@/lib/discover/weird-awards';
import { getMarketPanels } from '@/lib/discover/market-panels';
import { contractScope } from '@/lib/discover/scope';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

// Route paid CTAs through /checkout first so purchase attribution (UTM /
// referrer captured pre-checkout) is joined to the Stripe purchase event.
const CHECKOUT_MONTHLY = '/checkout/mindy-pro-monthly'; // $149/mo
const FREE_SIGNUP_URL = '/signup';
const DASHBOARD_URL = '/app';

// The gamified home reads live, public federal data (the "Discover" growth engine).
// ISR: rebuild daily; the panel-cache cron refreshes the two computed panels.
export const revalidate = 86400;

function daysLeft(end?: string | null): number | null {
  if (!end) return null;
  const t = new Date(end).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - Date.now()) / 86_400_000));
}

export default async function MindyLandingPage() {
  // Live Discover data — each degrades to empty so a dead upstream never blanks the page.
  const [expiring, weird, panels] = await Promise.all([
    queryExpiringContracts({ monthsWindow: 12, minValue: 10_000_000, limit: 8, orderBy: 'value' })
      .then((r) => r.contracts)
      .catch(() => [] as ExpiringContract[]),
    getWeirdAwards(3).catch(() => []),
    getMarketPanels().catch(() => ({ naicsLeaderboard: [], underserved: [], builtAt: null })),
  ]);

  const upForGrabs = [...expiring]
    .sort((a, b) => Number(b.potential_total_value ?? b.total_obligation ?? 0) - Number(a.potential_total_value ?? a.total_obligation ?? 0))
    .slice(0, 4);
  const naicsBoard = panels.naicsLeaderboard.slice(0, 5);
  const underserved = panels.underserved.slice(0, 4);

  // JSON-LD — preserved from the prior landing (Organization + SoftwareApplication + FAQ).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://getmindy.ai/#organization',
        name: 'Mindy',
        alternateName: 'Mindy AI',
        url: 'https://getmindy.ai',
        logo: 'https://getmindy.ai/icon.png',
        description: 'AI-powered federal market intelligence for small business contractors.',
        email: 'hello@getmindy.ai',
        sameAs: ['https://govcongiants.com'],
      },
      {
        '@type': 'SoftwareApplication',
        '@id': 'https://getmindy.ai/#software',
        name: 'Mindy',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: 'Your 24/7 federal market intelligence analyst. Scans 88,000+ opportunities daily, tracks competitors, and delivers personalized briefings.',
        offers: [
          { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Pro', price: '149', priceCurrency: 'USD', priceSpecification: { '@type': 'UnitPriceSpecification', price: '149', priceCurrency: 'USD', unitCode: 'MON' } },
          { '@type': 'Offer', name: 'Teams', price: '499', priceCurrency: 'USD', priceSpecification: { '@type': 'UnitPriceSpecification', price: '499', priceCurrency: 'USD', unitCode: 'MON' } },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': 'https://getmindy.ai/#faq',
        mainEntity: [
          { '@type': 'Question', name: 'How is this different from SAM.gov alerts?', acceptedAnswer: { '@type': 'Answer', text: 'SAM.gov sends you everything that matches a keyword. Mindy learns your business and sends you what actually matters — with context on competition, incumbents, and why this opportunity fits you.' } },
          { '@type': 'Question', name: 'I already have a BD person. Why do I need Mindy?', acceptedAnswer: { '@type': 'Answer', text: "Mindy doesn't replace your BD team — she supercharges them. She handles the 20 hours/week of searching so your people can focus on relationships and proposals." } },
          { '@type': 'Question', name: "What if I'm brand new to federal contracting?", acceptedAnswer: { '@type': 'Answer', text: "Perfect. Mindy explains opportunities in plain English and tells you exactly what you need to compete. She's like having a mentor who never sleeps." } },
          { '@type': 'Question', name: 'Is Mindy really free?', acceptedAnswer: { '@type': 'Answer', text: 'Yes — daily opportunity alerts and the public Discover data are free forever, no card. Pro ($149/mo) adds AI briefings, competitor tracking, recompete alerts, and the full tool suite.' } },
        ],
      },
    ],
  };

  const movementEl = (m: number | 'new' | null) => {
    if (m === 'new') return <span className="mv new">NEW</span>;
    if (typeof m === 'number' && m > 0) return <span className="mv up">▲ {m}</span>;
    if (typeof m === 'number' && m < 0) return <span className="mv dn">▼ {Math.abs(m)}</span>;
    return <span className="mv" style={{ color: 'var(--mut)' }}>—</span>;
  };

  return (
    <div className="gland">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <style>{GLAND_CSS}</style>

      <MindyDayBar />

      {/* NAV */}
      <header className="g-nav"><div className="wrap nav-in">
        <a className="brand" href="#top"><span className="mk"><span>M</span></span> Mindy</a>
        <nav className="links">
          <a href="#discover">Discover</a>
          <a href="#community">Community</a>
          <a href="#ranks">Ranks</a>
          <a href="#rewards">Rewards</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="nav-r">
          <span className="streakpill">🎁 Free forever</span>
          <Link className="btn-login" href={DASHBOARD_URL}>Log in</Link>
          <Link className="btn-cta" href={FREE_SIGNUP_URL}>Play free →</Link>
        </div>
      </div></header>

      {/* HERO */}
      <section className="hero" id="top"><div className="glow" /><div className="wrap hero-in">
        <div>
          <div className="kick">🎯 Level up your federal contracting</div>
          <h1 className="disp">Winning contracts,<br /><em>turned into a game.</em></h1>
          <p className="lead">Read your matches, save pursuits, submit bids — earn progress, climb the board, and win the work the government has to buy. Mindy makes the grind of GovCon something you actually want to open every morning.</p>
          <div className="cta">
            <Link className="btn-lg" href={FREE_SIGNUP_URL}>Play free →</Link>
            <a className="btn-ghost2" href="#discover">▼ See the live data</a>
          </div>
          <div className="under"><span>🎁 <b>Free daily alerts</b></span><span>🧭 <b>Public Discover data</b></span><span>🔒 <b>No card required</b></span></div>
        </div>

        <div className="quest">
          <div className="qh"><div className="t">Your first-contract quest</div><div className="lv">Starts at signup</div></div>
          <div className="ring">
            <svg width="72" height="72" viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="30" fill="none" stroke="#241d3a" strokeWidth="9" />
              <circle cx="36" cy="36" r="30" fill="none" stroke="#22e08a" strokeWidth="9" strokeLinecap="round" strokeDasharray="188.5" strokeDashoffset="113" transform="rotate(-90 36 36)" />
            </svg>
            <div className="rt"><div className="n num">5 steps</div><div className="s">to your first-win badge</div></div>
          </div>
          <div className="step"><div className="box">1</div><div className="lab">Set up your profile</div><div className="rw">2 min</div></div>
          <div className="step"><div className="box">2</div><div className="lab">Read your first match</div><div className="rw">day 1</div></div>
          <div className="step"><div className="box">3</div><div className="lab">Run a market report</div><div className="rw">1 click</div></div>
          <div className="step"><div className="box">4</div><div className="lab">Save your first pursuit</div><div className="rw">track it</div></div>
          <div className="step lock"><div className="box">🏁</div><div className="lab">Submit your first bid</div><div className="rw">🏆 win</div></div>
        </div>
      </div></section>

      {/* BIG STATS — real, verified figures */}
      <section className="sec"><div className="wrap">
        <div className="bigstats">
          <div className="bstat"><div className="n num">$750B</div><div className="l">on the board</div><div className="s">Addressable federal market, in play</div></div>
          <div className="bstat"><div className="n num">88,000+</div><div className="l">plays tracked</div><div className="s">Opportunities scanned + archived, searchable</div></div>
          <div className="bstat"><div className="n num">9,900+</div><div className="l">contractors hunting</div><div className="s">Getting matched by Mindy — free</div></div>
        </div>
      </div></section>

      {/* DISCOVER — shareable federal data, ALL LIVE */}
      <section className="sec" id="discover"><div className="wrap">
        <div className="head"><div className="eyebrow">Discover · free &amp; public · live data</div><h2 className="disp">The federal market, decoded</h2><p>Real numbers nobody else packages — built to be screenshot, shared, and argued about. Every figure below is live from USASpending &amp; SAM.gov. Not a feature list.</p></div>
        <div className="discover">

          {/* NAICS Leaderboard — live */}
          <div className="dpanel">
            <div className="dh"><div className="t">📊 NAICS Leaderboard</div><Link className="share" href="/discover">↗ Share</Link></div>
            <p className="sub">Top codes by federal spend · movement vs last year</p>
            {naicsBoard.length === 0 ? <div className="empty">Updating…</div> : naicsBoard.map((r, i) => (
              <div className="drow" key={r.code}><span className="rk">{i + 1}</span><span className="nm">{r.code} <small>{r.title}</small></span><span className="vl">{fmtMoney(r.amount)}</span>{movementEl(r.movement)}</div>
            ))}
            <Link className="foot" href="/discover">See the full market →</Link>
          </div>

          {/* Up For Grabs — live */}
          <div className="dpanel">
            <div className="dh"><div className="t">⏳ Up For Grabs</div><Link className="share" href="/up-for-grabs">↗ Share</Link></div>
            <p className="sub">Biggest contracts expiring soon — the recompete window is open</p>
            {upForGrabs.length === 0 ? <div className="empty">Updating…</div> : upForGrabs.map((c, i) => {
              const d = daysLeft(c.period_of_performance_current_end);
              return (
                <div className="drow" key={c.contract_id}><span className="rk">{i + 1}</span><span className="nm">{contractScope(c)} <small>{c.incumbent_name ? `held by ${c.incumbent_name}` : c.awarding_agency || ''}</small></span><span className="vl">{fmtMoney(Number(c.potential_total_value ?? c.total_obligation ?? 0))}</span><span className="mv dn">{d != null ? `${d}d` : '—'}</span></div>
              );
            })}
            <Link className="foot" href="/up-for-grabs">129,249 recompetes tracked →</Link>
          </div>

          {/* Weird Awards — live */}
          <div className="dpanel">
            <div className="dh"><div className="t">🧐 Weird Awards</div><Link className="share" href="/weird">↗ Share</Link></div>
            <p className="sub">Your tax dollars, hard at work — the internet&apos;s favorite feed</p>
            {weird.length === 0 ? <div className="empty">Updating…</div> : weird.map((w) => (
              <div className="weird" key={w.award_id}><span className="amt">{fmtMoney(w.obligation_amount)}</span><span className="wx">on <b>{w.category}</b></span></div>
            ))}
            <Link className="foot" href="/weird">See the full Weird Awards feed →</Link>
          </div>

          {/* Most concentrated markets (top-5 vendor share) — live */}
          <div className="dpanel">
            <div className="dh"><div className="t">🔒 Most Concentrated Markets</div><Link className="share" href="/discover">↗ Share</Link></div>
            <p className="sub">Big federal money held by just a handful of primes — % = share the top 5 vendors take</p>
            {underserved.length === 0 ? <div className="empty">Updating…</div> : underserved.map((u, i) => (
              <div className="drow" key={u.code}><span className="rk">{i + 1}</span><span className="nm">{u.title} <small>{u.code}</small></span><span className="vl">{fmtMoney(u.amount)}</span><span className="mv" style={{ color: 'var(--amber)' }}>{Math.round(u.topVendorShare * 100)}%</span></div>
            ))}
            <Link className="foot" href="/discover">Know who owns your space →</Link>
          </div>

        </div>
      </div></section>

      {/* COMMUNITIES */}
      <section className="sec tint" id="community"><div className="wrap">
        <div className="head"><div className="eyebrow">Find your crew</div><h2 className="disp">Built for how <em style={{ fontStyle: 'normal', color: 'var(--violet2)' }}>you</em> serve</h2><p>Government contracting isn&apos;t one-size-fits-all — so Mindy speaks your language, tracks the money set aside for <em>you</em>, and puts you on a board with your own people.</p></div>
        <div className="crews">
          <div className="crew vet">
            <div className="em">🎖️</div>
            <div className="cl">For those who served</div>
            <h3 className="disp">You served the mission.<br />Now go win it.</h3>
            <p>The government sets aside <b style={{ color: '#fff' }}>billions</b> for veteran-owned businesses — SDVOSB &amp; VOSB work most contractors can&apos;t even bid. Mindy finds your share, surfaces veteran grants, and stands you up next to your fellow vets. Same discipline that got the job done in uniform, pointed at federal contracts.</p>
            <div className="chips"><span className="chip">SDVOSB / VOSB set-asides</span><span className="chip">Veteran grants</span><span className="chip">VA &amp; DoD focus</span><span className="chip">Veteran community</span></div>
            <div className="cta2"><span className="gold">🎖️ Nominate a vet for the Hero Award →</span></div>
          </div>
          <div className="crew">
            <div className="em">🎓</div>
            <div className="cl">For researchers &amp; universities</div>
            <h3>Turn your research into federal funding.</h3>
            <p>SBIR/STTR and research grants, in plain English — fund the work without giving up equity. Made for university labs, PIs, and spinouts.</p>
            <div className="cta2"><span className="vlt">Explore research funding →</span></div>
          </div>
          <div className="crew">
            <div className="em">🔬</div>
            <div className="cl">For builders &amp; innovators</div>
            <h3>The coolest stuff the government&apos;s buying.</h3>
            <p>An SBIR feed of the weird, ambitious tech Uncle Sam is funding right now — drones, AI, biotech, space. Find the program that fits what you build.</p>
            <div className="cta2"><span className="vlt">See what&apos;s funded →</span></div>
          </div>
        </div>
      </div></section>

      {/* HERO AWARD */}
      <section className="sec"><div className="wrap">
        <div className="hero-award">
          <div className="medal">🎖️</div>
          <div className="cnt">
            <div className="cl">The Mindy Hero Award</div>
            <h2 className="disp">Honoring the veterans winning the mission.</h2>
            <p>Every month we spotlight a veteran-owned business crushing it in federal contracting — their story, their wins, their playbook — in front of the whole Mindy community. Nominate a vet who&apos;s earned it (or throw your own hat in). Winners get featured, celebrated, and a year of Mindy Pro.</p>
            <div className="act"><Link className="btn-gold" href={FREE_SIGNUP_URL}>Nominate a veteran →</Link><a className="btn-goldout" href="#community">Learn more</a></div>
          </div>
        </div>
      </div></section>

      {/* RANKS = tiers */}
      <section className="sec tint" id="ranks"><div className="wrap">
        <div className="head"><div className="eyebrow">Ranks</div><h2 className="disp">From Recruit to Prime</h2><p>Level up as you work the market. Every rank unlocks more of Mindy — and more of the market you can see. Ranks are just our plans, reframed for the hunt.</p></div>
        <div className="ladder">
          <div className="rank"><div className="tier">Free</div><div className="rn">Recruit</div><p>Free daily alerts + the public Discover data. Learn the board.</p></div>
          <div className="rank cur"><div className="youare">Most popular</div><div className="tier">$149/mo</div><div className="rn">Hunter</div><p>AI briefings, forecasts, recompetes &amp; competitor tracking. Start scoring fits.</p></div>
          <div className="rank"><div className="tier">Pro+</div><div className="rn">Closer</div><p>Pipeline, CRM &amp; proposal drafting. Turn pursuits into submitted bids.</p></div>
          <div className="rank"><div className="tier">$499/mo</div><div className="rn g">Prime</div><p>The whole platform + MCP for your team. You&apos;re running a BD department.</p></div>
        </div>
      </div></section>

      {/* PRICING — real Free / Pro / Teams (conversion + SEO offers) */}
      <section className="sec" id="pricing"><div className="wrap">
        <div className="head"><div className="eyebrow">Pricing</div><h2 className="disp">Enterprise intelligence, small-business price</h2><p>The big contractors have armies. You have Mindy. Start free — upgrade when you&apos;re ready to hunt.</p></div>
        <div className="pricing">
          <div className="pcard">
            <div className="pn">Free</div><div className="pp"><span className="num">$0</span><small>/mo</small></div>
            <p className="pd">Start finding opportunities today</p>
            <ul className="pl"><li>✓ Daily opportunity alerts</li><li>✓ 5 NAICS codes</li><li>✓ Public Discover data</li><li className="off">— No AI analysis</li></ul>
            <Link className="pbtn ghost" href={FREE_SIGNUP_URL}>Start free</Link>
          </div>
          <div className="pcard hot">
            <div className="tag">Most popular</div>
            <div className="pn">Pro</div><div className="pp"><span className="num">$149</span><small>/mo</small></div>
            <p className="pd">The $150K capture manager in your pocket</p>
            <ul className="pl"><li>✓ Full AI daily briefings</li><li>✓ Unlimited NAICS codes</li><li>✓ Competitor + recompete tracking</li><li>✓ Weekly deep dives &amp; pursuit briefs</li><li>✓ Pipeline, CRM &amp; proposal drafting</li></ul>
            <Link className="pbtn solid" href={CHECKOUT_MONTHLY}>Get Mindy Pro</Link>
          </div>
          <div className="pcard">
            <div className="pn">Teams</div><div className="pp"><span className="num">$499</span><small>/mo</small></div>
            <p className="pd">For growing contractors with BD teams</p>
            <ul className="pl"><li>✓ Everything in Pro</li><li>✓ Multiple users</li><li>✓ Shared pipeline</li><li>✓ Team dashboard + MCP</li></ul>
            <Link className="pbtn ghost" href="mailto:hello@getmindy.ai?subject=Mindy%20Teams%20Inquiry">Contact sales</Link>
          </div>
        </div>
        <p className="annual">Save $298/yr with annual billing — $1,490 instead of $1,788 (2 months free).</p>
      </div></section>

      {/* REWARDS */}
      <section className="sec tint" id="rewards"><div className="wrap">
        <div className="head"><div className="eyebrow">Rewards</div><h2 className="disp">Play, refer, win real prizes</h2></div>
        <div className="rewards">
          <div className="rw refer"><span className="pk">Refer &amp; earn</span><h4>Bring a contractor</h4><div className="amt num">+500</div><p>Credits for you <em>and</em> them the moment they run their first report. No cap.</p><Link className="go" href={FREE_SIGNUP_URL}>Grab your invite link →</Link></div>
          <div className="rw grant"><span className="pk">Giveaway</span><h4>$10K Grant Giveaway</h4><div className="amt num">$10,000</div><p>One small business, one working-capital grant to chase its first federal award. Coming soon.</p><Link className="go" href={FREE_SIGNUP_URL}>Get notified →</Link></div>
          <div className="rw contest"><span className="pk">Live event</span><h4>Demo Day Pitch Contest</h4><p style={{ marginTop: 6 }}>Pitch how you&apos;d win a target contract on stage. Winner takes a year of Pro + a founder call.</p><Link className="go" href={FREE_SIGNUP_URL}>Save your seat →</Link></div>
        </div>
      </div></section>

      {/* SIGNUP */}
      <section className="sec"><div className="wrap">
        <div className="head" style={{ textAlign: 'center' }}><h2 className="disp">Start your streak today</h2><p style={{ margin: '0 auto' }}>Play free — no card. Read one match, run one report, and see why 9,900+ contractors open Mindy every morning.</p></div>
        <div className="signup-wrap"><MindySignupForm /></div>
      </div></section>

      {/* FAQ (kept for SEO parity with the JSON-LD graph) */}
      <section className="sec tint"><div className="wrap faqwrap">
        <div className="head"><div className="eyebrow">FAQ</div><h2 className="disp">Questions? Mindy has answers.</h2></div>
        <div className="faq">
          <div className="fa"><h3>How is this different from SAM.gov alerts?</h3><p>SAM.gov sends you everything that matches a keyword. Mindy learns your business and sends you what actually matters — with context on competition, incumbents, and why this opportunity fits you.</p></div>
          <div className="fa"><h3>I already have a BD person. Why do I need Mindy?</h3><p>Mindy doesn&apos;t replace your BD team — she supercharges them. She handles the 20 hours/week of searching so your people can focus on relationships and proposals.</p></div>
          <div className="fa"><h3>What if I&apos;m brand new to federal contracting?</h3><p>Perfect. Mindy explains opportunities in plain English and tells you exactly what you need to compete — like a mentor who never sleeps.</p></div>
          <div className="fa"><h3>Is Mindy really free?</h3><p>Yes — daily alerts and the public Discover data are free forever, no card. Pro ($149/mo) adds AI briefings, competitor tracking, recompete alerts, and the full tool suite.</p></div>
        </div>
      </div></section>

      {/* FINAL */}
      <section className="final"><div className="glow" /><div className="wrap final-in">
        <h2 className="disp">The big contractors won&apos;t share their secrets.<br /><em>Mindy will.</em></h2>
        <p>Every day you search manually is a day you fall behind. The contractors winning federal work aren&apos;t smarter than you — they just have better intelligence. Now you do too.</p>
        <Link className="btn-lg" href={FREE_SIGNUP_URL}>Play free →</Link>
      </div></section>

      <footer className="g-foot"><div className="wrap f-in">
        <span>© 2026 GovCon Giants AI · Mindy</span>
        <span className="fl">
          <a href="tel:5082906692">508-290-6692</a>
          <a href="mailto:hello@getmindy.ai">hello@getmindy.ai</a>
          <Link href="/privacy-policy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </span>
      </div></footer>
    </div>
  );
}

const GLAND_CSS = `
.gland{--bg:#08060f;--bg2:#0e0b1a;--card:#141021;--card2:#1a1530;--line:#241d3a;--line2:#342a52;--ink:#f4f1ff;--ink2:#b3aacb;--mut:#7a7192;--violet:#8b5cf6;--violet2:#a855f7;--win:#22e08a;--amber:#ffb020;--rose:#fb6a8a;--grad:linear-gradient(135deg,#8b5cf6,#a855f7 55%,#6d28d9);--gwin:linear-gradient(135deg,#22e08a,#10b981);--maxw:1140px;background:var(--bg);color:var(--ink);min-height:100vh;font-family:"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.gland *{box-sizing:border-box}
.gland a{color:inherit;text-decoration:none;cursor:pointer}
.gland .wrap{max-width:var(--maxw);margin:0 auto;padding:0 22px}
.gland .disp{font-weight:850;letter-spacing:-.03em;text-wrap:balance}
.gland .num{font-weight:850;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.gland .eyebrow{font-size:11.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--violet2)}
.gland .g-nav{position:sticky;top:0;z-index:50;background:rgba(8,6,15,.82);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.gland .nav-in{display:flex;align-items:center;gap:24px;height:62px}
.gland .brand{display:flex;align-items:center;gap:9px;font-weight:850;font-size:17px}
.gland .brand .mk{width:30px;height:30px;border-radius:9px;background:var(--grad);display:grid;place-items:center;box-shadow:0 4px 16px rgba(139,92,246,.5)}
.gland .brand .mk span{font-weight:900;color:#fff;transform:translateY(-1px)}
.gland nav.links{display:flex;gap:2px;margin-left:6px}
.gland nav.links a{padding:8px 11px;border-radius:8px;font-size:14px;font-weight:600;color:var(--ink2)}
.gland nav.links a:hover{background:var(--card2);color:var(--ink)}
@media(max-width:760px){.gland nav.links{display:none}}
.gland .nav-r{margin-left:auto;display:flex;align-items:center;gap:10px}
.gland .streakpill{display:flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:99px;background:rgba(34,224,138,.12);border:1px solid rgba(34,224,138,.3);font-size:13px;font-weight:800;color:var(--win)}
@media(max-width:520px){.gland .streakpill{display:none}}
.gland .btn-cta{background:var(--grad);color:#fff;font-weight:800;font-size:14px;padding:10px 18px;border-radius:10px;box-shadow:0 6px 20px rgba(139,92,246,.4)}
.gland .btn-cta:hover{filter:brightness(1.08)}
.gland .btn-login{font-weight:700;font-size:14px;color:var(--ink2);padding:9px 12px}
.gland .hero{position:relative;overflow:hidden}
.gland .hero .glow{position:absolute;inset:0;background:radial-gradient(55% 70% at 78% 0%,rgba(139,92,246,.4),transparent 60%),radial-gradient(45% 60% at 8% 100%,rgba(34,224,138,.14),transparent 60%)}
.gland .hero-in{position:relative;display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center;padding:64px 0 60px}
@media(max-width:900px){.gland .hero-in{grid-template-columns:1fr;padding:44px 0}}
.gland .kick{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:800;color:#d8b4fe;background:rgba(139,92,246,.14);border:1px solid var(--line2);padding:6px 13px;border-radius:99px;margin-bottom:20px}
.gland .hero h1{font-size:56px;line-height:.98;margin:0 0 16px}
@media(max-width:900px){.gland .hero h1{font-size:40px}}
.gland .hero h1 em{font-style:normal;background:var(--gwin);-webkit-background-clip:text;background-clip:text;color:transparent}
.gland .hero .lead{font-size:18px;color:var(--ink2);line-height:1.5;max-width:46ch;margin:0 0 26px}
.gland .hero .cta{display:flex;gap:13px;align-items:center;flex-wrap:wrap}
.gland .btn-lg{background:var(--grad);color:#fff;font-weight:800;font-size:16px;padding:15px 26px;border-radius:14px;border:0;cursor:pointer;box-shadow:0 12px 34px rgba(139,92,246,.5);display:inline-flex;gap:9px;align-items:center}
.gland .btn-lg:hover{filter:brightness(1.08)}
.gland .btn-ghost2{color:var(--ink);font-weight:700;font-size:15px;padding:14px 18px;border-radius:14px;border:1px solid var(--line2)}
.gland .btn-ghost2:hover{background:var(--card2)}
.gland .hero .under{margin-top:16px;font-size:13px;color:var(--mut);display:flex;gap:16px;flex-wrap:wrap}
.gland .hero .under b{color:var(--ink2)}
.gland .quest{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line2);border-radius:22px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.gland .quest .qh{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.gland .quest .qh .t{font-weight:800;font-size:15px}
.gland .quest .qh .lv{font-size:11px;font-weight:800;color:var(--win);background:rgba(34,224,138,.12);border:1px solid rgba(34,224,138,.3);padding:4px 9px;border-radius:99px}
.gland .ring{display:flex;align-items:center;gap:16px;margin-bottom:18px}
.gland .ring svg{flex:none}
.gland .ring .rt .n{font-size:15px;font-weight:800}
.gland .ring .rt .s{font-size:12.5px;color:var(--mut)}
.gland .step{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.gland .step .box{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font-size:13px;font-weight:800;flex:none;background:var(--grad);color:#fff}
.gland .step.lock .box{background:var(--card);border:1px solid var(--line2);color:var(--mut)}
.gland .step .lab{font-size:14px;font-weight:600}
.gland .step.lock .lab{color:var(--mut)}
.gland .step .rw{margin-left:auto;font-size:11.5px;font-weight:800;color:var(--amber)}
.gland .sec{padding:64px 0}
.gland .sec .head{margin-bottom:26px}
.gland .sec .head h2{font-size:34px;margin:8px 0 8px;line-height:1.06}
@media(max-width:760px){.gland .sec .head h2{font-size:26px}}
.gland .sec .head p{font-size:16px;color:var(--ink2);margin:0;max-width:60ch}
.gland .sec.tint{background:var(--bg2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.gland .bigstats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:760px){.gland .bigstats{grid-template-columns:1fr}}
.gland .bstat{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px}
.gland .bstat .n{font-size:46px;line-height:1;background:var(--gwin);-webkit-background-clip:text;background-clip:text;color:transparent}
.gland .bstat .l{font-size:14px;color:var(--ink2);margin-top:8px;font-weight:600}
.gland .bstat .s{font-size:12.5px;color:var(--mut);margin-top:2px}
.gland .discover{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:820px){.gland .discover{grid-template-columns:1fr}}
.gland .dpanel{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:20px;display:flex;flex-direction:column}
.gland .dpanel .dh{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.gland .dpanel .dh .t{font-weight:850;font-size:16px;display:flex;align-items:center;gap:9px}
.gland .dpanel .sub{font-size:12.5px;color:var(--mut);margin:0 0 12px}
.gland .empty{padding:18px 0;color:var(--mut);font-size:13px;border-top:1px solid var(--line)}
.gland .share{font-size:11.5px;font-weight:800;color:var(--violet2);border:1px solid var(--line2);padding:5px 11px;border-radius:99px;background:rgba(139,92,246,.08);white-space:nowrap}
.gland .share:hover{background:rgba(139,92,246,.18)}
.gland .drow{display:grid;grid-template-columns:20px 1fr auto 52px;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line);font-size:13.5px}
.gland .drow .rk{color:var(--mut);font-weight:850;text-align:center}
.gland .drow .nm{font-weight:600;line-height:1.25;min-width:0}
.gland .drow .nm small{display:block;color:var(--mut);font-weight:500;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gland .drow .vl{font-weight:850;font-variant-numeric:tabular-nums;text-align:right}
.gland .drow .mv{font-size:12px;font-weight:850;text-align:right}
.gland .mv.up{color:var(--win)}.gland .mv.dn{color:var(--rose)}.gland .mv.new{color:var(--amber)}
.gland .dpanel .foot{margin-top:auto;padding-top:12px;font-size:12.5px;font-weight:800;color:var(--violet2)}
.gland .weird{border-top:1px solid var(--line);padding:14px 0;display:flex;gap:12px;align-items:flex-start}
.gland .weird .amt{font-size:22px;font-weight:850;color:var(--amber);font-variant-numeric:tabular-nums;white-space:nowrap}
.gland .weird .wx{font-size:13.5px;color:var(--ink2);line-height:1.4}
.gland .weird .wx b{color:var(--ink)}
.gland .crews{display:grid;grid-template-columns:1.5fr 1fr;grid-auto-rows:1fr;gap:16px}
@media(max-width:820px){.gland .crews{grid-template-columns:1fr}}
.gland .crew{border-radius:20px;padding:24px;border:1px solid var(--line);position:relative;overflow:hidden;display:flex;flex-direction:column;background:var(--card)}
.gland .crew.vet{grid-row:1 / span 2;border-color:var(--line2);background:radial-gradient(120% 80% at 88% 0%,rgba(255,176,32,.16),transparent 52%),radial-gradient(80% 90% at 0% 100%,rgba(139,92,246,.16),transparent 58%),var(--card2)}
@media(max-width:820px){.gland .crew.vet{grid-row:auto}}
.gland .crew .cl{font-size:11.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.gland .crew.vet .cl{color:#ffce6e}
.gland .crew h3{margin:9px 0 8px;font-size:20px;line-height:1.12}
.gland .crew.vet h3{font-size:30px}
.gland .crew p{margin:0;font-size:13.5px;color:var(--ink2);line-height:1.5}
.gland .crew.vet p{font-size:15px}
.gland .crew .chips{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 0}
.gland .crew .chip{font-size:11.5px;font-weight:700;padding:5px 11px;border-radius:99px;background:var(--bg2);border:1px solid var(--line2);color:var(--ink2)}
.gland .crew.vet .chip{background:rgba(255,176,32,.1);border-color:rgba(255,176,32,.32);color:#ffce6e}
.gland .crew .cta2{margin-top:auto;padding-top:16px;font-size:14px;font-weight:850}
.gland .crew .cta2 .gold{color:var(--amber)}
.gland .crew .cta2 .vlt{color:var(--violet2)}
.gland .crew .em{font-size:30px;margin-bottom:2px}
.gland .crew.vet .em{position:absolute;top:20px;right:22px;font-size:38px;margin:0}
.gland .hero-award{position:relative;overflow:hidden;border-radius:22px;padding:32px;display:flex;gap:28px;align-items:center;background:radial-gradient(80% 150% at 86% 12%,rgba(255,176,32,.26),transparent 52%),linear-gradient(100deg,#191227,#2c1e12);border:1px solid #4a3a1c}
@media(max-width:720px){.gland .hero-award{flex-direction:column;text-align:center}}
.gland .hero-award .medal{font-size:66px;flex:none;filter:drop-shadow(0 6px 16px rgba(255,176,32,.35))}
.gland .hero-award .cl{font-size:11.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#ffce6e}
.gland .hero-award h2{font-size:29px;margin:8px 0 8px;line-height:1.08}
.gland .hero-award p{margin:0;color:#e7ddc9;font-size:15px;max-width:62ch;line-height:1.5}
.gland .hero-award .act{margin-top:18px;display:flex;gap:12px;flex-wrap:wrap}
@media(max-width:720px){.gland .hero-award .act{justify-content:center}}
.gland .btn-gold{background:linear-gradient(135deg,#ffce6e,#ffb020);color:#3a2a08;font-weight:850;font-size:14px;padding:12px 20px;border-radius:12px;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(255,176,32,.32)}
.gland .btn-goldout{color:#ffce6e;font-weight:800;font-size:14px;padding:11px 16px;border-radius:12px;border:1px solid rgba(255,176,32,.4)}
.gland .ladder{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
@media(max-width:820px){.gland .ladder{grid-template-columns:1fr 1fr}}
.gland .rank{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;position:relative;overflow:hidden}
.gland .rank.cur{border-color:var(--violet);box-shadow:0 0 0 1px var(--violet),0 16px 40px rgba(139,92,246,.2)}
.gland .rank .tier{font-size:12px;font-weight:800;color:var(--mut);letter-spacing:.08em;text-transform:uppercase}
.gland .rank .rn{font-size:24px;font-weight:850;margin:6px 0 4px;letter-spacing:-.02em}
.gland .rank .rn.g{background:var(--gwin);-webkit-background-clip:text;background-clip:text;color:transparent}
.gland .rank p{font-size:13px;color:var(--ink2);margin:8px 0 0;line-height:1.45}
.gland .rank .youare{position:absolute;top:14px;right:14px;font-size:10px;font-weight:800;color:var(--violet2);background:rgba(139,92,246,.15);border:1px solid var(--line2);padding:3px 8px;border-radius:99px}
.gland .pricing{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start}
@media(max-width:820px){.gland .pricing{grid-template-columns:1fr}}
.gland .pcard{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:26px;position:relative}
.gland .pcard.hot{border:1px solid var(--violet);box-shadow:0 0 0 1px var(--violet),0 18px 44px rgba(139,92,246,.22);background:linear-gradient(180deg,var(--card2),var(--card))}
.gland .pcard .tag{position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:var(--grad);color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:99px}
.gland .pcard .pn{font-size:16px;font-weight:800}
.gland .pcard .pp{display:flex;align-items:baseline;gap:4px;margin:8px 0 2px}
.gland .pcard .pp .num{font-size:40px}
.gland .pcard .pp small{color:var(--mut);font-weight:600}
.gland .pcard .pd{font-size:13px;color:var(--ink2);margin:0 0 16px}
.gland .pcard .pl{list-style:none;padding:0;margin:0 0 20px;display:flex;flex-direction:column;gap:10px;font-size:13.5px;color:var(--ink2)}
.gland .pcard .pl li.off{color:var(--mut)}
.gland .pbtn{display:block;text-align:center;padding:12px;border-radius:12px;font-weight:800;font-size:14px}
.gland .pbtn.solid{background:var(--grad);color:#fff;box-shadow:0 8px 22px rgba(139,92,246,.35)}
.gland .pbtn.ghost{background:var(--card2);color:var(--ink);border:1px solid var(--line2)}
.gland .annual{text-align:center;color:var(--mut);font-size:13px;margin:20px 0 0}
.gland .rewards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:820px){.gland .rewards{grid-template-columns:1fr}}
.gland .rw{border-radius:18px;padding:22px;border:1px solid var(--line);position:relative;overflow:hidden;min-height:172px;display:flex;flex-direction:column;background:var(--card)}
.gland .rw .pk{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;align-self:flex-start;padding:4px 9px;border-radius:7px;margin-bottom:12px}
.gland .rw h4{margin:0 0 6px;font-size:18px}
.gland .rw p{margin:0;font-size:13.5px;color:var(--ink2);line-height:1.45}
.gland .rw .go{margin-top:auto;padding-top:14px;font-size:13.5px;font-weight:800}
.gland .rw.refer{background:radial-gradient(120% 120% at 100% 0%,rgba(34,224,138,.14),transparent 55%),var(--card)}
.gland .rw.refer .pk{background:rgba(34,224,138,.14);color:var(--win)}.gland .rw.refer .go{color:var(--win)}.gland .rw.refer .amt{color:var(--win)}
.gland .rw .amt{font-size:26px;font-weight:850;margin:2px 0 4px}
.gland .rw.grant{background:radial-gradient(120% 120% at 100% 0%,rgba(255,176,32,.13),transparent 55%),var(--card)}
.gland .rw.grant .pk{background:rgba(255,176,32,.14);color:var(--amber)}.gland .rw.grant .go{color:var(--amber)}.gland .rw.grant .amt{color:var(--amber)}
.gland .rw.contest{background:radial-gradient(120% 120% at 100% 0%,rgba(139,92,246,.16),transparent 55%),var(--card)}
.gland .rw.contest .pk{background:rgba(139,92,246,.18);color:#d8b4fe}.gland .rw.contest .go{color:var(--violet2)}
.gland .signup-wrap{max-width:520px;margin:0 auto}
.gland .faqwrap{max-width:820px}
.gland .faq{display:flex;flex-direction:column;gap:12px}
.gland .fa{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.gland .fa h3{margin:0 0 6px;font-size:16px;font-weight:800}
.gland .fa p{margin:0;font-size:14px;color:var(--ink2);line-height:1.5}
.gland .final{position:relative;overflow:hidden;text-align:center}
.gland .final .glow{position:absolute;inset:0;background:radial-gradient(60% 130% at 50% 0%,rgba(139,92,246,.42),transparent 60%)}
.gland .final-in{position:relative;padding:76px 0}
.gland .final h2{font-size:42px;margin:0 0 12px;line-height:1.05}
.gland .final h2 em{font-style:normal;background:var(--gwin);-webkit-background-clip:text;background-clip:text;color:transparent}
@media(max-width:760px){.gland .final h2{font-size:30px}}
.gland .final p{font-size:17px;color:var(--ink2);margin:0 auto 24px;max-width:52ch}
.gland .g-foot{border-top:1px solid var(--line);padding:26px 0;color:var(--mut);font-size:12.5px}
.gland .f-in{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}
.gland .f-in .fl{display:flex;gap:16px;flex-wrap:wrap}
.gland .f-in a:hover{color:var(--ink2)}
`;
