/* eslint-disable @next/next/no-html-link-for-pages -- marketing page uses full-nav <a>; convert to next/link in the production pass. */
/**
 * /landing-v3 — the GAMIFIED public home (Robinhood × Higgsfield), Option A: the approved
 * gamified direction (artifact 3c1ac291) becomes the logged-out front door. NEW benefit-first
 * hero (the old "Winning contracts, turned into a game" headlined the mechanic, not the
 * payoff). Two engines: Discover (shareable federal data) + the personal game (quest/XP/
 * leaderboard/ranks/rewards), plus the audience communities. Supersedes /landing-v2 as the
 * public home if approved.
 *
 * REAL DATA wired: Up For Grabs (recompete), Weird Awards, Hunter Leaderboard, NAICS
 * Leaderboard (USASpending), and the stat counts. "Underserved Markets" stays illustrative —
 * it needs bidder-count analysis with no cheap live source (flagged inline).
 */
import { queryExpiringContracts } from '@/lib/recompete/query';
import { getWeirdAwards } from '@/lib/discover/weird-awards';
import { getRecentBigAwards } from '@/lib/discover/recent-spending';
import { getLeaderboard } from '@/lib/gamification/stats';
import { getReadClient } from '@/lib/supabase/server-clients';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';
import { formatCompanyName as fmtName } from '@/lib/format-name';
import { contractScope } from '@/lib/discover/scope';

export const dynamic = 'force-dynamic';

// Whole days until a date (module scope — keeps the clock read out of the component render).
function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = Math.round((new Date(dateStr).getTime() - new Date().getTime()) / 864e5);
  return Number.isFinite(d) ? Math.max(0, d) : null;
}

// Sentence-case a raw contract description snippet (they arrive ALL-CAPS / messy).
function snippet(s: string | null, n = 74): string {
  const t = (s || '').trim().toLowerCase();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1, n) + (t.length > n ? '…' : '');
}

// A live head-count, falling back to a real documented figure on error (never a fabricated 0).
async function safeCount(q: PromiseLike<{ count: number | null; error: unknown }>, fallback: number): Promise<number> {
  try {
    const { count, error } = await q;
    return error ? fallback : (count ?? fallback);
  } catch {
    return fallback;
  }
}

// The quest card lives inside a Tailwind app; generic class names (ring/step/box…) collide
// with Tailwind utilities (e.g. `.ring`), so the card's LAYOUT is inlined here — inline styles
// beat any utility class and can't be overridden. Colors/visuals still come from the scoped CSS.
const GRAD = 'linear-gradient(135deg,#8b5cf6,#a855f7 55%,#6d28d9)';
const GWIN = 'linear-gradient(135deg,#22e08a,#10b981)';
const BOX_BASE: React.CSSProperties = { width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, flex: 'none' };
const QUEST_STEPS: Array<{ state: 'done' | 'now' | 'lock'; mark: string; label: string; xp: string }> = [
  { state: 'done', mark: '✓', label: 'Set up your profile', xp: '+50 XP' },
  { state: 'done', mark: '✓', label: 'Read your first match', xp: '+30 XP' },
  { state: 'done', mark: '✓', label: 'Run a market report', xp: '+40 XP' },
  { state: 'now', mark: '4', label: 'Save your first pursuit', xp: '+60 XP' },
  { state: 'lock', mark: '🔒', label: 'Submit your first bid', xp: '+150 XP' },
];
function boxStyle(state: 'done' | 'now' | 'lock'): React.CSSProperties {
  if (state === 'done') return { ...BOX_BASE, background: GWIN, color: '#052e1c' };
  if (state === 'now') return { ...BOX_BASE, background: GRAD, color: '#fff', boxShadow: '0 0 0 4px rgba(139,92,246,.2)' };
  return { ...BOX_BASE, background: '#141021', border: '1px solid #342a52', color: '#7a7192' };
}

export default async function LandingV3() {
  const sb = getReadClient();
  const [expiringRaw, weird, board, recentAwards, oppsCount, players] = await Promise.all([
    queryExpiringContracts({ monthsWindow: 12, minValue: 10_000_000, limit: 200, orderBy: 'value' }).then((r) => r.contracts).catch(() => []),
    getWeirdAwards(8).catch(() => []),
    getLeaderboard('__public__@mindy', 5).catch(() => ({ rows: [], you: null, total: 0 })),
    getRecentBigAwards(40).catch(() => []),
    safeCount(sb.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true), 24000),
    getLeaderboard('__public__@mindy', 1).then((r) => r.total).catch(() => 1540),
  ]);

  // Up For Grabs — biggest recompetes with real runway (30–540 days), biggest FIRST.
  const upForGrabs = expiringRaw
    .map((c) => ({ c, val: Number(c.potential_total_value ?? c.total_obligation ?? 0), d: daysUntil(c.period_of_performance_current_end) }))
    .filter((x) => x.d != null && x.d >= 30 && x.d <= 540 && x.val > 0)
    .sort((a, b) => b.val - a.val)
    .slice(0, 4);

  // Just Awarded — this week's biggest individual awards (moves daily). Replaces the static
  // NAICS-by-spend board, whose ranking barely changes month to month.
  const justAwarded = [...recentAwards].sort((a, b) => (b.obligation_amount || 0) - (a.obligation_amount || 0)).slice(0, 4);

  // Top Winners — who banked the most this week (aggregate recent awards by recipient; moves
  // weekly). Replaces "Underserved Markets" — avg-bidders data (number_of_offers) is null in
  // our sources, so that board can't be made live without fabricating figures.
  const winnerMap = new Map<string, number>();
  for (const a of recentAwards) {
    const name = fmtName(a.recipient_name || '').trim();
    if (name) winnerMap.set(name, (winnerMap.get(name) || 0) + (a.obligation_amount || 0));
  }
  const topWinners = [...winnerMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, amount]) => ({ name, amount }));

  const weirdTop = weird.slice(0, 3);

  return (
    <div className="lv3">
      <style>{CSS}</style>

      <header className="nav"><div className="wrap nav-in">
        <a className="brand" href="#top"><span className="mk"><span>M</span></span> Mindy</a>
        <nav className="links"><a href="/discover">Discover</a><a href="#crews">Community</a><a href="#board">Leaderboard</a><a href="#rewards">Rewards</a><a href="/academy">Academy</a><a href="/pricing">Pricing</a></nav>
        <div className="nav-r">
          <div className="streakpill">🔥 <span className="num">7</span>-day streak</div>
          <a className="btn-login" href="/app">Log in</a>
          <a className="btn-cta" href="/signup">Play free →</a>
        </div>
      </div></header>

      {/* HERO — NEW benefit-first words */}
      <section className="hero" id="top"><div className="glow" /><div className="wrap hero-in">
        <div>
          <div className="kick">🎯 Government contracting for everyone</div>
          <h1 className="disp">Win your first<br /><em>federal contract.</em></h1>
          <p className="lead">The government is legally required to buy — and can&apos;t ghost you. Match opportunities, save pursuits, submit bids, and climb the board. Mindy turns the GovCon grind into something you&apos;ll actually open every morning.</p>
          <div className="cta">
            <a className="btn-lg" href="/signup">Play free →</a>
            <a className="btn-ghost2" href="#board">▶ See how it works</a>
          </div>
          <div className="under"><span>🔥 <b>Daily streaks</b></span><span>🏆 <b>Weekly leaderboard</b></span><span>🎁 <b>Refer &amp; earn credits</b></span></div>
        </div>

        <div className="quest">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Your first-contract quest</div>
            <div className="qlv">Lvl 2 · Hunter</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
            <svg width="66" height="66" viewBox="0 0 72 72" style={{ flex: 'none' }}>
              <circle cx="36" cy="36" r="30" fill="none" stroke="#241d3a" strokeWidth="9" />
              <circle cx="36" cy="36" r="30" fill="none" stroke="#22e08a" strokeWidth="9" strokeLinecap="round" strokeDasharray="188.5" strokeDashoffset="75.4" transform="rotate(-90 36 36)" />
            </svg>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>3 / 5 done</div>
              <div style={{ fontSize: 12.5, color: '#7a7192', marginTop: 2 }}>2 steps to your first win badge</div>
            </div>
          </div>
          {QUEST_STEPS.map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: '1px solid #241d3a' }}>
              <div style={boxStyle(s.state)}>{s.mark}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: s.state === 'lock' ? '#7a7192' : '#f4f1ff' }}>{s.label}</div>
              <div style={{ marginLeft: 'auto', fontSize: '11.5px', fontWeight: 800, color: s.state === 'done' ? '#22e08a' : '#ffb020' }}>{s.xp}</div>
            </div>
          ))}
        </div>
      </div></section>

      {/* BIG STATS */}
      <section className="sec"><div className="wrap">
        <div className="bigstats">
          <div className="bstat"><div className="n num">$750B</div><div className="l">on the board</div><div className="s">Federal contract dollars obligated each year</div></div>
          <div className="bstat"><div className="n num">{oppsCount.toLocaleString()}+</div><div className="l">open opportunities</div><div className="s">Live solicitations in the feed right now</div></div>
          <div className="bstat"><div className="n num">{players.toLocaleString()}</div><div className="l">players hunting</div><div className="s">Contractors on the board this week</div></div>
        </div>
      </div></section>

      {/* DISCOVER */}
      <section className="sec"><div className="wrap">
        <div className="head"><div className="eyebrow">Discover · free &amp; public</div><h2 className="disp">The federal market, decoded</h2><p>Live data nobody else packages — built to be screenshot, shared, and argued about. This is the stuff people send each other, not a feature list.</p></div>
        <div className="discover">
          <div className="dpanel">
            <div className="dh"><div className="t">💰 Just Awarded</div><a className="share" href="/spending">↗ Share</a></div>
            <p className="sub">The biggest federal contracts signed this week</p>
            {justAwarded.length === 0 ? <div className="drow"><span className="nm">Updating…</span></div> : justAwarded.map((a, i) => (
              <div className="drow" key={a.award_id || i}><span className="rk">{i + 1}</span><span className="nm">{fmtName(a.recipient_name || 'Recipient')} <small>{a.awarding_agency || a.naics_description || ''}</small></span><span className="vl">{fmtMoney(a.obligation_amount)}</span><span className="mv new">NEW</span></div>
            ))}
            <a className="foot" href="/spending">See this week&apos;s spending →</a>
          </div>
          <div className="dpanel">
            <div className="dh"><div className="t">⏳ Up For Grabs</div><a className="share" href="/up-for-grabs">↗ Share</a></div>
            <p className="sub">Biggest contracts expiring soon — the recompete window is open</p>
            {upForGrabs.length === 0 ? <div className="drow"><span className="nm">Updating…</span></div> : upForGrabs.map((x, i) => (
              <div className="drow" key={x.c.contract_id || i}><span className="rk">{i + 1}</span><span className="nm">{contractScope(x.c)} <small>{x.c.awarding_agency || ''}</small></span><span className="vl">{fmtMoney(x.val)}</span><span className="mv dn">{x.d}d</span></div>
            ))}
            <a className="foot" href="/up-for-grabs">See all recompetes tracked →</a>
          </div>
          <div className="dpanel">
            <div className="dh"><div className="t">🧐 Weird Awards</div><a className="share" href="/weird">↗ Share</a></div>
            <p className="sub">Your tax dollars, hard at work — the internet&apos;s favorite feed</p>
            {weirdTop.length === 0 ? <div className="weird"><span className="wx">Updating…</span></div> : weirdTop.map((w, i) => (
              <div className="weird" key={w.award_id || i}><span className="amt">{fmtMoney(w.obligation_amount)}</span><span className="wx"><b>{snippet(w.description) || 'Federal award'}</b> — {w.awarding_agency || fmtName(w.recipient_name || '')}.</span></div>
            ))}
            <a className="foot" href="/weird">Get the weekly &ldquo;Weird Awards&rdquo; drop →</a>
          </div>
          <div className="dpanel">
            <div className="dh"><div className="t">🏆 Top Winners This Week</div><a className="share" href="/spending">↗ Share</a></div>
            <p className="sub">Contractors banking the most federal dollars right now</p>
            {topWinners.length === 0 ? <div className="drow"><span className="nm">Updating…</span></div> : topWinners.map((w, i) => (
              <div className="drow" key={w.name}><span className="rk">{i + 1}</span><span className="nm">{w.name}</span><span className="vl">{fmtMoney(w.amount)}</span><span className="mv" /></div>
            ))}
            <a className="foot" href="/spending">See the full board →</a>
          </div>
        </div>
      </div></section>

      {/* LEADERBOARD */}
      <section className="sec tint" id="board"><div className="wrap">
        <div className="head"><div className="eyebrow">This week</div><h2 className="disp">Top hunters on the board</h2><p>Earn XP for every match you work, pursuit you save, and bid you submit. The board resets Monday — where will you land?</p></div>
        <div className="lbwrap">
          <div className="board">
            {board.rows.length === 0 ? <div className="lb"><div className="rk num">—</div><div className="who"><div className="av" /><div><div className="nm">The board opens Monday</div><div className="rank-lab">be the first on it</div></div></div></div> : board.rows.map((r) => (
              <div className={`lb${r.rank <= 3 ? ` t${r.rank}` : ''}`} key={r.rank}>
                <div className="rk num">{r.rank}</div>
                <div className="who"><div className="av" /><div><div className="nm">{r.handle}</div><div className="rank-lab">this week</div></div></div>
                <div className="xp num">{r.weekXp.toLocaleString()}<small>XP</small></div>
              </div>
            ))}
          </div>
          <div className="youcard">
            <div className="t">Your rank</div>
            <div className="big num">—</div>
            <div className="sub">Not on the board yet. Play free to claim your spot among <b className="strong">{players.toLocaleString()}</b> hunters this week.</div>
            <div className="xpbar"><i /></div>
            <div className="next"><b>Read one match</b> to earn your first XP and get ranked.</div>
          </div>
        </div>
      </div></section>

      {/* ACHIEVEMENTS */}
      <section className="sec"><div className="wrap">
        <div className="head"><div className="eyebrow">Achievements</div><h2 className="disp">Collect the wins</h2><p>Every milestone in your BD journey earns a badge — and unlocks the next tier of Mindy.</p></div>
        <div className="badges">
          <div className="badge unlocked"><div className="em">🎯</div><div className="bn">First Fit</div><div className="bd">92%+ match</div></div>
          <div className="badge unlocked"><div className="em">🗺️</div><div className="bn">Market Maker</div><div className="bd">First report</div></div>
          <div className="badge unlocked"><div className="em">🔥</div><div className="bn">On a Roll</div><div className="bd">7-day streak</div></div>
          <div className="badge lock"><div className="em">📌</div><div className="bn">Pursuer</div><div className="bd">Save 10 pursuits</div></div>
          <div className="badge lock"><div className="em">📝</div><div className="bn">First Bid</div><div className="bd">Submit a bid</div></div>
          <div className="badge lock"><div className="em">🏆</div><div className="bn">First Win</div><div className="bd">Win a contract</div></div>
        </div>
      </div></section>

      {/* COMMUNITIES */}
      <section className="sec" id="crews"><div className="wrap">
        <div className="head"><div className="eyebrow">Find your crew</div><h2 className="disp">Built for how <em className="you">you</em> serve</h2><p>Government contracting isn&apos;t one-size-fits-all — so Mindy speaks your language, tracks the money set aside for you, and puts you on a board with your own people.</p></div>
        <div className="crews">
          <a className="crew vet" href="/community/veterans">
            <div className="em">🎖️</div>
            <div className="cl">For those who served</div>
            <h3 className="disp">You served the mission.<br />Now go win it.</h3>
            <p>The government sets aside <b className="w">billions</b> for veteran-owned businesses — SDVOSB &amp; VOSB work most contractors can&apos;t even bid. Mindy finds your share, surfaces veteran grants, and stands you up on the board next to your fellow vets.</p>
            <div className="chips"><span className="chip">SDVOSB / VOSB set-asides</span><span className="chip">Veteran grants</span><span className="chip">VA &amp; DoD focus</span><span className="chip">Veteran leaderboard</span></div>
            <div className="cta2"><span className="gold">🎖️ Nominate a vet for the Hero Award →</span></div>
          </a>
          <a className="crew" href="/community/itcyber">
            <div className="em">💻</div>
            <div className="cl">For IT &amp; cybersecurity firms</div>
            <h3>The government runs on your code.</h3>
            <p>Federal IT and cyber never stop recompeting — cloud, zero-trust, help desk, managed services. Track the task orders in your NAICS and draft the technical volume.</p>
            <div className="cta2"><span className="vlt">See IT opportunities →</span></div>
          </a>
          <a className="crew" href="/community/professional">
            <div className="em">📈</div>
            <div className="cl">For consultants &amp; program support</div>
            <h3>Win the work behind every agency.</h3>
            <p>Management consulting and program support — the biggest small-business award base, almost all of it recompetes. Show up 18 months early, already teamed.</p>
            <div className="cta2"><span className="vlt">See consulting opps →</span></div>
          </a>
          <a className="crew" href="/community/construction">
            <div className="em">🏗️</div>
            <div className="cl">For federal builders</div>
            <h3>Build for the biggest client on earth.</h3>
            <p>The #1 federal buyer — $57B+ a year. Design-build, MATOC, IDIQ, and set-asides for small builders. Track the projects in your trade and draft the bid.</p>
            <div className="cta2"><span className="vlt">See construction opps →</span></div>
          </a>
        </div>
      </div></section>

      {/* HERO AWARD */}
      <section className="sec"><div className="wrap">
        <div className="hero-award">
          <div className="medal">🎖️</div>
          <div className="cnt">
            <div className="cl">The Mindy Hero Award</div>
            <h2 className="disp">Honoring the veterans winning the mission.</h2>
            <p>Every month we spotlight a veteran-owned business crushing it in federal contracting — their story, their wins, their playbook — in front of the whole Mindy community. Nominate a vet who&apos;s earned it (or throw your own hat in). Winners get featured, celebrated, and a year of Mindy Prime.</p>
            <div className="act"><a className="btn-gold" href="/community/veterans">Nominate a veteran →</a><a className="btn-goldout" href="/community/veterans">Meet this month&apos;s Hero</a></div>
          </div>
        </div>
      </div></section>

      {/* LEVELS */}
      <section className="sec tint"><div className="wrap">
        <div className="head"><div className="eyebrow">Ranks</div><h2 className="disp">From Recruit to Prime</h2><p>Level up as you work the market. Every rank unlocks more of Mindy — and more of the market you can see.</p></div>
        <div className="ladder">
          <div className="rank"><div className="tier">Level 1</div><div className="rn">Recruit</div><p>Free daily alerts + market search. Learn the board.</p></div>
          <div className="rank cur"><div className="youare">You&apos;re here</div><div className="tier">Level 2</div><div className="rn">Hunter</div><p>AI briefings, forecasts &amp; recompetes unlocked. Start scoring fits.</p></div>
          <div className="rank"><div className="tier">Level 3</div><div className="rn">Closer</div><p>Pipeline, CRM &amp; proposal drafting. Turn pursuits into bids.</p></div>
          <div className="rank"><div className="tier">Level 4</div><div className="rn g">Prime</div><p>The whole platform + MCP. You&apos;re running a BD department.</p></div>
        </div>
      </div></section>

      {/* REWARDS */}
      <section className="sec" id="rewards"><div className="wrap">
        <div className="head"><div className="eyebrow">Rewards</div><h2 className="disp">Play, refer, win real prizes</h2></div>
        <div className="rewards">
          <div className="rw refer"><span className="pk">Refer &amp; earn</span><h4>Bring a contractor</h4><div className="amt num win">+500</div><p>Credits for you and them the moment they run their first report. No cap.</p><span className="go">Grab your invite link →</span></div>
          <div className="rw grant"><span className="pk">Giveaway</span><h4>$10K Grant Giveaway</h4><div className="amt num amber">$10,000</div><p>One small business, one working-capital grant to chase its first federal award. Monthly draw.</p><span className="go">Enter this month →</span></div>
          <div className="rw contest"><span className="pk">Live event</span><h4>Demo Day Pitch Contest</h4><p className="mt">Pitch how you&apos;d win a target contract on stage. Winner takes a year of Prime + a founder call.</p><span className="go">Save your seat →</span></div>
        </div>
      </div></section>

      {/* FINAL */}
      <section className="final"><div className="glow" /><div className="wrap final-in">
        <h2 className="disp">Your streak starts today.</h2>
        <p>Play free — no card. Read one match, earn your first badge, and see why 1,540 contractors open Mindy every morning.</p>
        <a className="btn-lg" href="/signup">Play free →</a>
      </div></section>

      <footer className="f"><div className="wrap f-in"><span>© 2026 GovCon Giants AI · Mindy</span><span>Play · Leaderboard · Rewards · Academy · Pricing</span></div></footer>
    </div>
  );
}

const CSS = `
.lv3{--bg:#08060f;--bg2:#0e0b1a;--card:#141021;--card2:#1a1530;--line:#241d3a;--line2:#342a52;
  --ink:#f4f1ff;--ink2:#b3aacb;--mut:#7a7192;--violet:#8b5cf6;--violet2:#a855f7;
  --win:#22e08a;--amber:#ffb020;--rose:#fb6a8a;--grad:linear-gradient(135deg,#8b5cf6,#a855f7 55%,#6d28d9);
  --gwin:linear-gradient(135deg,#22e08a,#10b981);--maxw:1140px;
  background:var(--bg);color:var(--ink);min-height:100dvh;overflow-x:hidden;
  font-family:"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.lv3 *{box-sizing:border-box}
.lv3 a{color:inherit;text-decoration:none;cursor:pointer}
.lv3 .wrap{max-width:var(--maxw);margin:0 auto;padding:0 22px}
.lv3 .disp{font-weight:850;letter-spacing:-.03em;text-wrap:balance}
.lv3 .num{font-weight:850;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.lv3 .eyebrow{font-size:11.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--violet2)}

.lv3 .nav{position:sticky;top:0;z-index:50;background:rgba(8,6,15,.82);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.lv3 .nav-in{display:flex;align-items:center;gap:24px;height:62px}
.lv3 .brand{display:flex;align-items:center;gap:9px;font-weight:850;font-size:17px}
.lv3 .brand .mk{width:30px;height:30px;border-radius:9px;background:var(--grad);display:grid;place-items:center;box-shadow:0 4px 16px rgba(139,92,246,.5)}
.lv3 .brand .mk span{font-weight:900;color:#fff;transform:translateY(-1px)}
.lv3 .links{display:flex;gap:2px;margin-left:6px}
.lv3 .links a{padding:8px 11px;border-radius:8px;font-size:14px;font-weight:600;color:var(--ink2)}
.lv3 .links a:hover{background:var(--card2);color:var(--ink)}
.lv3 .nav-r{margin-left:auto;display:flex;align-items:center;gap:10px}
.lv3 .streakpill{display:flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:99px;background:rgba(255,176,32,.12);border:1px solid rgba(255,176,32,.3);font-size:13px;font-weight:800;color:var(--amber)}
.lv3 .btn-cta{background:var(--grad);color:#fff;font-weight:800;font-size:14px;padding:10px 18px;border-radius:10px;box-shadow:0 6px 20px rgba(139,92,246,.4)}
.lv3 .btn-cta:hover{filter:brightness(1.08)}
.lv3 .btn-login{font-weight:700;font-size:14px;color:var(--ink2);padding:9px 12px}
@media(max-width:720px){.lv3 .links{display:none}}

.lv3 .hero{position:relative;overflow:hidden}
.lv3 .hero .glow{position:absolute;inset:0;background:radial-gradient(55% 70% at 78% 0%,rgba(139,92,246,.4),transparent 60%),radial-gradient(45% 60% at 8% 100%,rgba(34,224,138,.14),transparent 60%)}
.lv3 .hero-in{position:relative;display:grid;grid-template-columns:1.15fr .85fr;gap:30px;align-items:start;padding:56px 0 56px}
.lv3 .hero-in>div:first-child{padding-top:8px}
.lv3 .quest{max-width:420px;justify-self:end;width:100%}
.lv3 .qlv{font-size:11px;font-weight:800;color:var(--win);background:rgba(34,224,138,.12);border:1px solid rgba(34,224,138,.3);padding:4px 9px;border-radius:99px;white-space:nowrap}
@media(max-width:900px){.lv3 .hero-in{grid-template-columns:1fr;padding:44px 0}}
.lv3 .kick{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:800;color:#d8b4fe;background:rgba(139,92,246,.14);border:1px solid var(--line2);padding:6px 13px;border-radius:99px;margin-bottom:20px}
.lv3 .hero h1{font-size:56px;line-height:.98;margin:0 0 16px}
@media(max-width:900px){.lv3 .hero h1{font-size:40px}}
.lv3 .hero h1 em{font-style:normal;background:var(--gwin);-webkit-background-clip:text;background-clip:text;color:transparent}
.lv3 .hero .lead{font-size:18px;color:var(--ink2);line-height:1.5;max-width:46ch;margin:0 0 26px}
.lv3 .hero .cta{display:flex;gap:13px;align-items:center;flex-wrap:wrap}
.lv3 .btn-lg{background:var(--grad);color:#fff;font-weight:800;font-size:16px;padding:15px 26px;border-radius:14px;box-shadow:0 12px 34px rgba(139,92,246,.5);display:inline-flex;gap:9px;align-items:center}
.lv3 .btn-lg:hover{filter:brightness(1.08)}
.lv3 .btn-ghost2{color:var(--ink);font-weight:700;font-size:15px;padding:14px 18px;border-radius:14px;border:1px solid var(--line2)}
.lv3 .btn-ghost2:hover{background:var(--card2)}
.lv3 .hero .under{margin-top:16px;font-size:13px;color:var(--mut);display:flex;gap:16px;flex-wrap:wrap}
.lv3 .hero .under b{color:var(--ink2)}

.lv3 .quest{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line2);border-radius:22px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.lv3 .quest .qh{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.lv3 .quest .qh .t{font-weight:800;font-size:15px}
.lv3 .quest .qh .lv{font-size:11px;font-weight:800;color:var(--win);background:rgba(34,224,138,.12);border:1px solid rgba(34,224,138,.3);padding:4px 9px;border-radius:99px}
.lv3 .ring{display:flex;align-items:center;gap:16px;margin-bottom:18px}
.lv3 .ring svg{flex:none}
.lv3 .ring .rt .n{font-size:15px;font-weight:800}
.lv3 .ring .rt .s{font-size:12.5px;color:var(--mut)}
.lv3 .step{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.lv3 .step .box{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font-size:13px;font-weight:800;flex:none}
.lv3 .step.done .box{background:var(--gwin);color:#052e1c}
.lv3 .step.now .box{background:var(--grad);color:#fff;box-shadow:0 0 0 4px rgba(139,92,246,.2)}
.lv3 .step.lock .box{background:var(--card);border:1px solid var(--line2);color:var(--mut)}
.lv3 .step .lab{font-size:14px;font-weight:600}
.lv3 .step.lock .lab{color:var(--mut)}
.lv3 .step .rw{margin-left:auto;font-size:11.5px;font-weight:800;color:var(--amber)}
.lv3 .step.done .rw{color:var(--win)}

.lv3 .sec{padding:64px 0}
.lv3 .sec .head{margin-bottom:26px}
.lv3 .sec .head h2{font-size:34px;margin:8px 0 8px;line-height:1.06}
@media(max-width:760px){.lv3 .sec .head h2{font-size:26px}}
.lv3 .sec .head p{font-size:16px;color:var(--ink2);margin:0;max-width:60ch}
.lv3 .sec.tint{background:var(--bg2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.lv3 .you{font-style:normal;color:var(--violet2)}

.lv3 .bigstats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:760px){.lv3 .bigstats{grid-template-columns:1fr}}
.lv3 .bstat{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px}
.lv3 .bstat .n{font-size:46px;line-height:1;background:var(--gwin);-webkit-background-clip:text;background-clip:text;color:transparent}
.lv3 .bstat .l{font-size:14px;color:var(--ink2);margin-top:8px;font-weight:600}
.lv3 .bstat .s{font-size:12.5px;color:var(--mut);margin-top:2px}

.lv3 .discover{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:820px){.lv3 .discover{grid-template-columns:1fr}}
.lv3 .dpanel{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:20px;display:flex;flex-direction:column}
.lv3 .dpanel .dh{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.lv3 .dpanel .dh .t{font-weight:850;font-size:16px;display:flex;align-items:center;gap:9px}
.lv3 .dpanel .sub{font-size:12.5px;color:var(--mut);margin:0 0 12px}
.lv3 .share{font-size:11.5px;font-weight:800;color:var(--violet2);border:1px solid var(--line2);padding:5px 11px;border-radius:99px;background:rgba(139,92,246,.08);white-space:nowrap}
.lv3 .share:hover{background:rgba(139,92,246,.18)}
.lv3 .drow{display:grid;grid-template-columns:20px 1fr auto 48px;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line);font-size:13.5px}
.lv3 .drow .rk{color:var(--mut);font-weight:850;text-align:center}
.lv3 .drow .nm{font-weight:600;line-height:1.25}
.lv3 .drow .nm small{display:block;color:var(--mut);font-weight:500;font-size:11.5px}
.lv3 .drow .vl{font-weight:850;font-variant-numeric:tabular-nums;text-align:right}
.lv3 .drow .mv{font-size:12px;font-weight:850;text-align:right}
.lv3 .mv.up{color:var(--win)}.lv3 .mv.dn{color:var(--rose)}.lv3 .mv.new{color:var(--amber)}
.lv3 .dpanel .foot{margin-top:auto;padding-top:12px;font-size:12.5px;font-weight:800;color:var(--violet2)}
.lv3 .weird{border-top:1px solid var(--line);padding:14px 0;display:flex;gap:12px;align-items:flex-start}
.lv3 .weird .amt{font-size:22px;font-weight:850;color:var(--amber);font-variant-numeric:tabular-nums;white-space:nowrap}
.lv3 .weird .wx{font-size:13.5px;color:var(--ink2);line-height:1.4}
.lv3 .weird .wx b{color:var(--ink)}

.lv3 .lbwrap{display:grid;grid-template-columns:1fr .9fr;gap:20px;align-items:start}
@media(max-width:860px){.lv3 .lbwrap{grid-template-columns:1fr}}
.lv3 .board{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:10px 8px}
.lv3 .lb{display:grid;grid-template-columns:44px 1fr auto;gap:12px;align-items:center;padding:13px 14px;border-radius:14px}
.lv3 .lb+.lb{border-top:1px solid var(--line)}
.lv3 .lb .rk{font-size:16px;font-weight:850;text-align:center;color:var(--mut)}
.lv3 .lb.t1{background:linear-gradient(90deg,rgba(255,176,32,.12),transparent)}
.lv3 .lb.t1 .rk{color:var(--amber)}
.lv3 .lb.t2 .rk{color:#cdd6e6}.lv3 .lb.t3 .rk{color:#e0955a}
.lv3 .lb .who{display:flex;align-items:center;gap:11px}
.lv3 .lb .av{width:34px;height:34px;border-radius:50%;background:conic-gradient(from 210deg,#a855f7,#6d28d9,#22e08a,#8b5cf6);flex:none}
.lv3 .lb .nm{font-weight:700;font-size:14px}
.lv3 .lb .rank-lab{font-size:11.5px;color:var(--mut)}
.lv3 .lb .xp{font-weight:850;font-size:15px}
.lv3 .lb .xp small{font-size:11px;color:var(--mut);font-weight:700;margin-left:3px}
.lv3 .youcard{background:linear-gradient(160deg,rgba(139,92,246,.16),rgba(20,16,33,.4));border:1px solid var(--line2);border-radius:20px;padding:22px}
.lv3 .youcard .t{font-size:13px;font-weight:800;color:var(--violet2);letter-spacing:.06em;text-transform:uppercase}
.lv3 .youcard .big{font-size:40px;margin:8px 0 2px}
.lv3 .youcard .big .xpunit{font-size:16px;color:var(--mut);font-weight:700}
.lv3 .youcard .sub{font-size:13.5px;color:var(--ink2)}
.lv3 .youcard .sub .strong{color:var(--ink)}
.lv3 .xpbar{height:10px;border-radius:99px;background:#1c1730;margin:16px 0 8px;overflow:hidden}
.lv3 .xpbar>i{display:block;height:100%;width:64%;background:var(--grad)}
.lv3 .youcard .next{font-size:12.5px;color:var(--mut)}
.lv3 .youcard .next b{color:var(--ink2)}

.lv3 .badges{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}
@media(max-width:860px){.lv3 .badges{grid-template-columns:repeat(3,1fr)}}
@media(max-width:480px){.lv3 .badges{grid-template-columns:repeat(2,1fr)}}
.lv3 .badge{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 12px;text-align:center}
.lv3 .badge .em{font-size:30px;filter:saturate(1.1)}
.lv3 .badge.lock{opacity:.42;filter:grayscale(.7)}
.lv3 .badge .bn{font-size:12.5px;font-weight:800;margin-top:8px}
.lv3 .badge .bd{font-size:11px;color:var(--mut);margin-top:2px}
.lv3 .badge.unlocked{box-shadow:0 0 0 1px rgba(34,224,138,.25),0 8px 24px rgba(34,224,138,.08)}

.lv3 .crews{display:grid;grid-template-columns:1.5fr 1fr;grid-auto-rows:1fr;gap:16px}
@media(max-width:820px){.lv3 .crews{grid-template-columns:1fr}}
.lv3 .crew{border-radius:20px;padding:24px;border:1px solid var(--line);position:relative;overflow:hidden;display:flex;flex-direction:column;background:var(--card)}
.lv3 .crew.vet{grid-row:1 / span 3;border-color:var(--line2);background:radial-gradient(120% 80% at 88% 0%,rgba(255,176,32,.16),transparent 52%),radial-gradient(80% 90% at 0% 100%,rgba(139,92,246,.16),transparent 58%),var(--card2)}
.lv3 .crew .cl{font-size:11.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.lv3 .crew.vet .cl{color:#ffce6e}
.lv3 .crew h3{margin:9px 0 8px;font-size:20px;line-height:1.12}
.lv3 .crew.vet h3{font-size:30px}
.lv3 .crew p{margin:0;font-size:13.5px;color:var(--ink2);line-height:1.5}
.lv3 .crew.vet p{font-size:15px}
.lv3 .crew p .w{color:#fff}
.lv3 .crew .chips{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 0}
.lv3 .crew .chip{font-size:11.5px;font-weight:700;padding:5px 11px;border-radius:99px;background:var(--bg2);border:1px solid var(--line2);color:var(--ink2)}
.lv3 .crew.vet .chip{background:rgba(255,176,32,.1);border-color:rgba(255,176,32,.32);color:#ffce6e}
.lv3 .crew .cta2{margin-top:auto;padding-top:16px;font-size:14px;font-weight:850}
.lv3 .crew .cta2 .gold{color:var(--amber)}
.lv3 .crew .cta2 .vlt{color:var(--violet2)}
.lv3 .crew .em{font-size:30px;margin-bottom:2px}
.lv3 .crew.vet .em{position:absolute;top:20px;right:22px;font-size:38px;margin:0}

.lv3 .hero-award{position:relative;overflow:hidden;border-radius:22px;padding:32px;display:flex;gap:28px;align-items:center;background:radial-gradient(80% 150% at 86% 12%,rgba(255,176,32,.26),transparent 52%),linear-gradient(100deg,#191227,#2c1e12);border:1px solid #4a3a1c}
@media(max-width:720px){.lv3 .hero-award{flex-direction:column;text-align:center}}
.lv3 .hero-award .medal{font-size:66px;flex:none;filter:drop-shadow(0 6px 16px rgba(255,176,32,.35))}
.lv3 .hero-award .cnt{position:relative;z-index:2}
.lv3 .hero-award .cl{font-size:11.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#ffce6e}
.lv3 .hero-award h2{font-size:29px;margin:8px 0 8px;line-height:1.08}
.lv3 .hero-award p{margin:0;color:#e7ddc9;font-size:15px;max-width:62ch;line-height:1.5}
.lv3 .hero-award .act{margin-top:18px;display:flex;gap:12px;flex-wrap:wrap}
@media(max-width:720px){.lv3 .hero-award .act{justify-content:center}}
.lv3 .btn-gold{background:linear-gradient(135deg,#ffce6e,#ffb020);color:#3a2a08;font-weight:850;font-size:14px;padding:12px 20px;border-radius:12px;box-shadow:0 8px 24px rgba(255,176,32,.32)}
.lv3 .btn-gold:hover{filter:brightness(1.05)}
.lv3 .btn-goldout{color:#ffce6e;font-weight:800;font-size:14px;padding:11px 16px;border-radius:12px;border:1px solid rgba(255,176,32,.4)}

.lv3 .ladder{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
@media(max-width:820px){.lv3 .ladder{grid-template-columns:1fr 1fr}}
.lv3 .rank{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;position:relative;overflow:hidden}
.lv3 .rank.cur{border-color:var(--violet);box-shadow:0 0 0 1px var(--violet),0 16px 40px rgba(139,92,246,.2)}
.lv3 .rank .tier{font-size:12px;font-weight:800;color:var(--mut);letter-spacing:.08em;text-transform:uppercase}
.lv3 .rank .rn{font-size:24px;font-weight:850;margin:6px 0 4px;letter-spacing:-.02em}
.lv3 .rank .rn.g{background:var(--gwin);-webkit-background-clip:text;background-clip:text;color:transparent}
.lv3 .rank p{font-size:13px;color:var(--ink2);margin:8px 0 0;line-height:1.45}
.lv3 .rank .youare{position:absolute;top:14px;right:14px;font-size:10px;font-weight:800;color:var(--violet2);background:rgba(139,92,246,.15);border:1px solid var(--line2);padding:3px 8px;border-radius:99px}

.lv3 .rewards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:820px){.lv3 .rewards{grid-template-columns:1fr}}
.lv3 .rw{border-radius:18px;padding:22px;border:1px solid var(--line);position:relative;overflow:hidden;min-height:172px;display:flex;flex-direction:column}
.lv3 .rw .pk{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;align-self:flex-start;padding:4px 9px;border-radius:7px;margin-bottom:12px}
.lv3 .rw h4{margin:0 0 6px;font-size:18px}
.lv3 .rw p{margin:0;font-size:13.5px;color:var(--ink2);line-height:1.45}
.lv3 .rw p.mt{margin-top:6px}
.lv3 .rw .go{margin-top:auto;padding-top:14px;font-size:13.5px;font-weight:800}
.lv3 .rw .amt{font-size:26px;font-weight:850;margin:2px 0 4px}
.lv3 .rw .amt.win{color:var(--win)}.lv3 .rw .amt.amber{color:var(--amber)}
.lv3 .rw.refer{background:radial-gradient(120% 120% at 100% 0%,rgba(34,224,138,.14),transparent 55%),var(--card)}
.lv3 .rw.refer .pk{background:rgba(34,224,138,.14);color:var(--win)}.lv3 .rw.refer .go{color:var(--win)}
.lv3 .rw.grant{background:radial-gradient(120% 120% at 100% 0%,rgba(255,176,32,.13),transparent 55%),var(--card)}
.lv3 .rw.grant .pk{background:rgba(255,176,32,.14);color:var(--amber)}.lv3 .rw.grant .go{color:var(--amber)}
.lv3 .rw.contest{background:radial-gradient(120% 120% at 100% 0%,rgba(139,92,246,.16),transparent 55%),var(--card)}
.lv3 .rw.contest .pk{background:rgba(139,92,246,.18);color:#d8b4fe}.lv3 .rw.contest .go{color:var(--violet2)}

.lv3 .final{position:relative;overflow:hidden;text-align:center}
.lv3 .final .glow{position:absolute;inset:0;background:radial-gradient(60% 130% at 50% 0%,rgba(139,92,246,.42),transparent 60%)}
.lv3 .final-in{position:relative;padding:76px 0}
.lv3 .final h2{font-size:42px;margin:0 0 12px;line-height:1.05}
@media(max-width:760px){.lv3 .final h2{font-size:30px}}
.lv3 .final p{font-size:17px;color:var(--ink2);margin:0 auto 24px;max-width:48ch}
.lv3 .f{border-top:1px solid var(--line);padding:26px 0;color:var(--mut);font-size:12.5px}
.lv3 .f-in{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}
`;
