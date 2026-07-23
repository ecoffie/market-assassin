/**
 * /home-v4 — the HYBRID: a minimal, confident Robinhood-style hero on top (one promise,
 * one action, a single row of big tabular "Top Movers" numbers) that then scrolls into the
 * full gamification substance below (Today's intel, progress ring, leaderboard, Ideas,
 * events). Answers "v3 is too simple" — keeps the clean top, brings the sticky command
 * center back. Same real data as /home. A layout-comparison build, not the post-signin dest.
 *
 * Preview: pass ?email=<user> to render that user's real stats.
 */
import Link from 'next/link';
import { getGameStats, getLeaderboard, RANKS } from '@/lib/gamification/stats';
import { queryExpiringContracts, type ExpiringContract } from '@/lib/recompete/query';
import { contractScope } from '@/lib/discover/scope';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';
import CopyPrompt from '@/components/home/CopyPrompt';

export const dynamic = 'force-dynamic';

const IDEAS: Array<{ tag: string; title: string; prompt: string }> = [
  { tag: 'Discover', title: 'Find your next contract', prompt: 'Using Mindy, find open federal contracts in my NAICS codes expiring in the next 90 days, sorted by fit.' },
  { tag: 'Intel', title: 'Scope the incumbent', prompt: 'Using Mindy, who is the incumbent on this solicitation, what is the ceiling, and when does it expire?' },
  { tag: 'Report', title: 'Build a $5,000 market report', prompt: 'Using Mindy, build me a full market report for "janitorial services" — total market, top agencies, top NAICS, and set-aside mix.' },
  { tag: 'Write', title: 'Draft a proposal', prompt: 'Using Mindy, draft a technical approach for this RFP grounded in my past performance and capabilities.' },
  { tag: 'Teaming', title: 'Find teaming partners', prompt: 'Using Mindy, find HUBZone-certified contractors in my state who have won similar work I could team with.' },
  { tag: 'Compete', title: 'Track a competitor', prompt: 'Using Mindy, show me what my top competitor has won in the last year and where their contracts expire.' },
];

// Whole days until a PoP end date (module scope so the clock read isn't an impure call in
// the render body — same pattern as up-for-grabs' monthsUntil). Null when there's no date.
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.max(0, Math.round((new Date(dateStr).getTime() - new Date().getTime()) / 864e5));
}

export default async function LoggedInHomeV4({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const email = (sp.email || 'eric@govcongiants.com').toLowerCase().trim();

  const [stats, board, opps] = await Promise.all([
    getGameStats(email).catch(() => null),
    getLeaderboard(email, 6).catch(() => ({ rows: [], you: null, total: 0 })),
    queryExpiringContracts({ monthsWindow: 12, minValue: 10_000_000, limit: 20 })
      .then((r) => r.contracts).catch(() => [] as ExpiringContract[]),
  ]);

  // rank progress ring
  const cur = RANKS[(stats?.level ?? 1) - 1] ?? RANKS[0];
  const nextAt = stats?.nextAt ?? null;
  const pct = stats && nextAt ? Math.min(1, Math.max(0, (stats.xp - cur.min) / (nextAt - cur.min))) : 1;
  const C = 2 * Math.PI * 30;

  // The single biggest live opportunity + the top hunter — the "Top Movers" proof numbers.
  const biggest = opps.reduce((m, c) => Math.max(m, Number(c.potential_total_value ?? c.total_obligation ?? 0)), 0);
  const leader = board.rows[0] ?? null;

  return (
    <div className="mhome">
      <style>{CSS}</style>

      <header className="nav"><div className="wrap nav-in">
        <a className="brand" href="#top"><span className="mark"><span>M</span></span> Mindy</a>
        <nav className="links">
          <a className="active" href="#top">Home</a>
          <a href="#ideas">Ideas</a>
          <a href="#board">Leaderboard</a>
          <a href="/pricing">Pricing</a>
        </nav>
        <div className="nav-r">
          <span className="streakpill">🔥 <b>{stats?.streak ?? 0}</b>-day streak</span>
          <span className="pill"><span className="dot" /> {stats?.rankName ?? 'Recruit'} · Lvl {stats?.level ?? 1}</span>
          <span className="avatar" />
        </div>
      </div></header>

      <main className="wrap" id="top">
        {/* MINIMAL HERO — one promise, one action (Robinhood-style top), welcome woven in */}
        <section className="chero">
          <p className="chero-eye">Welcome back{stats ? `, ${stats.codename}` : ''} · Government contracting for everyone</p>
          <h1 className="disp chero-h1">Win <span className="chero-ac">federal contracts.</span><br />Skip the $10K tools.</h1>
          <p className="chero-sub">The U.S. government is legally required to buy. Mindy finds your contracts, sizes your market, and drafts your bids — just ask, in plain English.</p>
          <div className="chero-cta">
            <Link className="btn-primary" href="/mcp">Connect your agent →</Link>
            <a className="btn-ghost" href="#board">See your progress ↓</a>
          </div>
          <div className="chero-proof">
            <div className="cp"><div className="cp-n gain">{biggest ? fmtMoney(biggest) : '—'}</div><div className="cp-l">biggest contract up for grabs today</div></div>
            <div className="cp"><div className="cp-n">{board.total.toLocaleString()}</div><div className="cp-l">hunters playing this week</div></div>
            <div className="cp"><div className="cp-n">{leader ? leader.weekXp.toLocaleString() : '—'}</div><div className="cp-l">{leader ? `top score · ${leader.handle}` : 'top score this week'}</div></div>
          </div>
        </section>

        {/* TODAY ON MINDY — live intel (the detail behind the proof) */}
        <div className="sec-h"><h3 className="disp">Today on Mindy</h3><div className="live"><span className="dot" />Live</div></div>
        <section className="today-sec">
          <div className="card today">
            {opps.length === 0 ? <div className="muted">Updating…</div> : opps.slice(0, 4).map((c) => {
              const d = daysUntil(c.period_of_performance_current_end);
              return (
                <div className="opp" key={c.contract_id}>
                  <div className="ti">{contractScope(c)}</div>
                  <div className="me"><span>{fmtMoney(Number(c.potential_total_value ?? c.total_obligation ?? 0))}</span><span>{c.incumbent_name ? `held by ${c.incumbent_name}` : c.awarding_agency}</span>{d != null && <span className="fit">{d}d</span>}</div>
                </div>
              );
            })}
            <Link className="all" href="/up-for-grabs">See more up for grabs →</Link>
          </div>
        </section>

        {/* COMMAND CENTER — your game stats + the real leaderboard */}
        <div className="sec-h"><h3 className="disp">Your progress</h3><a href="#board">Full board →</a></div>
        <section className="cc">
          <div className="card you">
            <div className="ring">
              <svg width="86" height="86" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="30" fill="none" stroke="#231d33" strokeWidth="8" />
                <circle cx="36" cy="36" r="30" fill="none" stroke="#a855f7" strokeWidth="8" strokeLinecap="round"
                  strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 36 36)" />
              </svg>
              <div className="rt">
                <div className="rk">{stats?.rankName ?? 'Recruit'}</div>
                <div className="lv">Level {stats?.level ?? 1}</div>
              </div>
            </div>
            <div className="xprow"><span>{(stats?.xp ?? 0).toLocaleString()} XP</span>{nextAt && <span className="mut">{(nextAt - (stats?.xp ?? 0)).toLocaleString()} to {stats?.nextName}</span>}</div>
            <div className="chips">
              <div className="chip"><b>{stats?.streak ?? 0}</b> day streak 🔥</div>
              <div className="chip"><b>{stats?.toolUseWeek ?? 0}</b> tools this week</div>
              <div className="chip"><b>{stats?.activeDaysWeek ?? 0}/7</b> active days</div>
            </div>
            <div className="goal">Activation goal: <b>16 tool calls across 4+ days</b> this week → you&apos;re {Math.min(100, Math.round(((stats?.toolUseWeek ?? 0) / 16) * 100))}% there.</div>
          </div>

          <div className="card board" id="board">
            <div className="hd"><div className="eyebrow">This week&apos;s hunters</div><span className="mut">{board.total} playing</span></div>
            {board.rows.map((r) => (
              <div className={`lb${r.isYou ? ' me' : ''}`} key={r.rank}>
                <span className="rk">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}`}</span>
                <span className="av" />
                <span className="nm">{r.handle}{r.isYou && <small> · you</small>}</span>
                <span className="xp">{r.weekXp.toLocaleString()}<small> XP</small></span>
              </div>
            ))}
            {board.you && board.you.rank > 6 && (
              <div className="lb me sep"><span className="rk">#{board.you.rank}</span><span className="av" /><span className="nm">{board.you.handle}<small> · you</small></span><span className="xp">{board.you.weekXp.toLocaleString()}<small> XP</small></span></div>
            )}
          </div>
        </section>

        {/* IDEAS GALLERY — what to build with Mindy (drives tool-call depth) */}
        <div className="sec-h" id="ideas"><h3 className="disp">What to build with Mindy</h3><span className="mut">copy → paste into your agent</span></div>
        <section className="ideas">
          {IDEAS.map((i) => (
            <div className="idea" key={i.title}>
              <div className="ih"><span className="itag">{i.tag}</span><CopyPrompt text={i.prompt} /></div>
              <div className="it">{i.title}</div>
              <div className="ip">&ldquo;{i.prompt}&rdquo;</div>
            </div>
          ))}
        </section>

        {/* HAPPENING ON MINDY — events + rewards */}
        <div className="sec-h"><h3 className="disp">Happening on Mindy</h3></div>
        <section className="event">
          <div className="cnt">
            <div className="kk"><span className="flag">Live event</span><span className="when">Coming soon</span></div>
            <h3 className="disp">Mindy Demo Day</h3>
            <p>Watch real contractors pitch live, see Mindy find their next award on stage, and get the exact playbook. Free to attend.</p>
            <div className="act"><Link className="seat" href="/signup">Save your seat →</Link></div>
          </div>
        </section>
        <section className="promos">
          <div className="promo grant"><span className="pk">Giveaway</span><h4>$10K Grant Giveaway</h4><div className="amt">$10,000</div><p>One small business, one working-capital grant to chase its first federal award.</p><span className="lnk">Get notified →</span></div>
          <div className="promo contest"><span className="pk">Contest</span><h4>Demo Day Pitch Contest</h4><p>Pitch how you&apos;d win a target contract — winner takes a year of Pro + a founder call.</p><span className="lnk">Enter →</span></div>
          <div className="promo challenge"><span className="pk">Challenge</span><h4>First-Contract Challenge</h4><p>30 days, guided by Mindy, from profile to your first submitted bid. Finish it, unlock bonus credits.</p><span className="lnk">Join →</span></div>
        </section>

        {/* De-emphasized: the app is the free fallback */}
        <section className="appfall">
          <div><div className="eyebrow">Prefer clicking?</div><div className="at">The web app is still here — free.</div><div className="ad">Daily alerts, Discover, and the dashboard in your browser. But the real power is the agent above.</div></div>
          <Link className="btn-ghost2" href="/app">Open the web app →</Link>
        </section>
      </main>

      <footer className="f"><div className="wrap f-in"><span>© 2026 GovCon Giants AI · Mindy</span><span>Home · Ideas · Leaderboard · Pricing</span></div></footer>
    </div>
  );
}

const CSS = `
.mhome{--bg:#0b0a12;--bg2:#100e1a;--surface:#17141f;--surface2:#1e1a2b;--line:#2a2438;--line2:#372f4d;--violet:#7c3aed;--violet2:#a855f7;--violet-deep:#4c1d95;--emerald:#10b981;--amber:#f59e0b;--ink:#f6f4ff;--ink2:#c5bfd8;--mut:#8a8399;--r:18px;--maxw:1240px;--grad:linear-gradient(135deg,#7c3aed,#a855f7 55%,#6d28d9);background:var(--bg);color:var(--ink);min-height:100vh;font-family:"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.mhome *{box-sizing:border-box}
.mhome a{color:inherit;text-decoration:none}
.mhome .wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
.mhome .disp{font-weight:800;letter-spacing:-.02em;text-wrap:balance}
.mhome .eyebrow{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.mhome .mut{color:var(--mut)}
.mhome .muted{color:var(--mut);font-size:13px;padding:14px 0}
.mhome header.nav{position:sticky;top:0;z-index:40;background:rgba(11,10,18,.82);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.mhome .nav-in{display:flex;align-items:center;gap:24px;height:64px}
.mhome .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px}
.mhome .brand .mark{width:30px;height:30px;border-radius:9px;background:var(--grad);display:grid;place-items:center;box-shadow:0 4px 14px rgba(124,58,237,.45)}
.mhome .brand .mark span{font-weight:900;color:#fff;transform:translateY(-1px)}
.mhome nav.links{display:flex;gap:4px;margin-left:6px}
.mhome nav.links a{padding:8px 12px;border-radius:9px;color:var(--ink2);font-size:14px;font-weight:600}
.mhome nav.links a:hover,.mhome nav.links a.active{background:var(--surface2);color:var(--ink)}
@media(max-width:720px){.mhome nav.links{display:none}}
.mhome .nav-r{margin-left:auto;display:flex;align-items:center;gap:10px}
.mhome .streakpill{display:flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:10px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);font-size:13px;font-weight:700;color:#fcd34d}
.mhome .pill{display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:10px;background:var(--surface2);border:1px solid var(--line);font-size:13px;font-weight:600;color:var(--ink2)}
.mhome .pill .dot{width:7px;height:7px;border-radius:50%;background:var(--emerald);box-shadow:0 0 8px var(--emerald)}
@media(max-width:560px){.mhome .pill{display:none}}
.mhome .avatar{width:34px;height:34px;border-radius:50%;background:conic-gradient(from 200deg,#a855f7,#6d28d9,#c4b5fd,#7c3aed);border:2px solid #2b2340}
.mhome main{padding:30px 0 70px}
.mhome .hello h1{font-size:30px;margin:6px 0 0}
.mhome .hello p{color:var(--mut);margin:6px 0 0;font-size:15px}
.mhome .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);position:relative;overflow:hidden}
.mhome .hero{display:grid;grid-template-columns:1.55fr 1fr;gap:18px;margin:18px 0}
@media(max-width:900px){.mhome .hero{grid-template-columns:1fr}}
.mhome .connect{padding:30px;background:radial-gradient(120% 140% at 82% 12%,rgba(124,58,237,.42),transparent 55%),radial-gradient(90% 120% at 100% 100%,rgba(168,85,247,.22),transparent 60%),var(--surface2);border-color:#342a4d;display:flex;flex-direction:column;min-height:290px}
.mhome .grid-tex{position:absolute;inset:0;opacity:.5;background-image:linear-gradient(rgba(168,85,247,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(168,85,247,.06) 1px,transparent 1px);background-size:34px 34px;mask-image:radial-gradient(80% 80% at 80% 10%,#000,transparent 70%)}
.mhome .connect>*{position:relative}
.mhome .connect h2{font-size:36px;margin:14px 0 8px;line-height:1.02}
.mhome .connect .sub{color:var(--ink2);font-size:15px;max-width:46ch;line-height:1.5}
.mhome .cta{margin-top:auto;display:flex;align-items:center;gap:14px;padding-top:24px}
.mhome .btn-primary{background:var(--grad);color:#fff;font-weight:700;font-size:15px;padding:13px 22px;border-radius:12px;box-shadow:0 8px 24px rgba(124,58,237,.4)}
.mhome .btn-primary:hover{filter:brightness(1.08)}
.mhome .btn-ghost{color:var(--ink2);font-weight:600;font-size:14px}
.mhome .btn-ghost:hover{color:var(--ink)}
.mhome .today{padding:22px;display:flex;flex-direction:column;min-height:290px}
.mhome .today .hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.mhome .today .live{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--emerald)}
.mhome .today .live .dot{width:7px;height:7px;border-radius:50%;background:var(--emerald);box-shadow:0 0 8px var(--emerald)}
.mhome .opp{padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--bg2);margin-bottom:9px}
.mhome .opp .ti{font-size:13.5px;font-weight:600;line-height:1.35}
.mhome .opp .me{font-size:12px;color:var(--mut);margin-top:5px;display:flex;gap:12px;align-items:center}
.mhome .opp .me .fit{margin-left:auto;font-weight:800;color:var(--amber)}
.mhome .today .all{margin-top:auto;padding-top:10px;font-size:13px;color:var(--violet2);font-weight:700}
.mhome .sec-h{display:flex;align-items:baseline;justify-content:space-between;margin:34px 0 14px}
.mhome .sec-h h3{font-size:19px;margin:0}
.mhome .sec-h a{font-size:13px;color:var(--mut);font-weight:600}
.mhome .cc{display:grid;grid-template-columns:1fr 1.2fr;gap:18px}
@media(max-width:900px){.mhome .cc{grid-template-columns:1fr}}
.mhome .you{padding:22px}
.mhome .ring{display:flex;align-items:center;gap:16px}
.mhome .ring .rt .rk{font-size:20px;font-weight:800}
.mhome .ring .rt .lv{font-size:13px;color:var(--mut)}
.mhome .xprow{display:flex;justify-content:space-between;align-items:baseline;margin:16px 0 12px;font-weight:800;font-size:15px}
.mhome .chips{display:flex;gap:8px;flex-wrap:wrap}
.mhome .chip{font-size:12px;font-weight:600;color:var(--ink2);background:var(--surface2);border:1px solid var(--line);border-radius:99px;padding:6px 11px}
.mhome .chip b{color:var(--ink);font-weight:800}
.mhome .goal{margin-top:14px;font-size:12.5px;color:var(--mut);line-height:1.5;border-top:1px solid var(--line);padding-top:12px}
.mhome .goal b{color:var(--violet2)}
.mhome .board{padding:16px 12px}
.mhome .board .hd{display:flex;justify-content:space-between;align-items:center;padding:4px 8px 12px}
.mhome .lb{display:grid;grid-template-columns:34px 30px 1fr auto;gap:10px;align-items:center;padding:10px 10px;border-radius:12px}
.mhome .lb+.lb{border-top:1px solid var(--line)}
.mhome .lb.me{background:linear-gradient(90deg,rgba(124,58,237,.16),transparent);border-radius:12px}
.mhome .lb.sep{margin-top:6px;border-top:1px dashed var(--line2)}
.mhome .lb .rk{font-weight:800;text-align:center;color:var(--mut);font-size:14px}
.mhome .lb .av{width:30px;height:30px;border-radius:50%;background:conic-gradient(from 210deg,#a855f7,#6d28d9,#22e08a,#7c3aed)}
.mhome .lb .nm{font-weight:700;font-size:14px}
.mhome .lb .nm small{color:var(--violet2);font-weight:700}
.mhome .lb .xp{font-weight:800;font-size:14px;font-variant-numeric:tabular-nums}
.mhome .lb .xp small{color:var(--mut);font-size:11px;font-weight:700;margin-left:3px}
.mhome .ideas{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:900px){.mhome .ideas{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.mhome .ideas{grid-template-columns:1fr}}
.mhome .idea{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px}
.mhome .idea:hover{border-color:var(--line2)}
.mhome .ih{display:flex;align-items:center;justify-content:space-between}
.mhome .itag{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#d8b4fe;background:rgba(124,58,237,.18);padding:3px 8px;border-radius:6px}
.mhome .copybtn{font-size:12px;font-weight:700;color:var(--ink2);background:var(--surface2);border:1px solid var(--line2);border-radius:8px;padding:5px 11px;cursor:pointer}
.mhome .copybtn:hover{color:#fff;border-color:var(--violet)}
.mhome .idea .it{font-size:15px;font-weight:700}
.mhome .idea .ip{font-size:13px;color:var(--ink2);line-height:1.5;font-style:italic}
.mhome .event{margin-top:6px;border-radius:var(--r);border:1px solid #3a2d5c;overflow:hidden;position:relative;background:radial-gradient(90% 160% at 88% 20%,rgba(168,85,247,.5),transparent 55%),radial-gradient(70% 140% at 100% 100%,rgba(245,158,11,.28),transparent 60%),linear-gradient(100deg,#1a1330,#241a44);padding:26px 30px;min-height:150px}
.mhome .event .kk{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.mhome .event .flag{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;background:#dc2626;color:#fff;padding:3px 9px;border-radius:6px}
.mhome .event .when{font-size:12px;font-weight:700;color:#fbbf24}
.mhome .event h3{font-size:27px;margin:0 0 6px}
.mhome .event p{margin:0;color:var(--ink2);font-size:14px;max-width:52ch;line-height:1.5}
.mhome .event .act{margin-top:16px}
.mhome .event .seat{display:inline-block;background:#fff;color:#1a1330;font-weight:800;font-size:14px;padding:11px 20px;border-radius:11px}
.mhome .promos{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:16px}
@media(max-width:900px){.mhome .promos{grid-template-columns:1fr}}
.mhome .promo{padding:20px;border-radius:14px;border:1px solid var(--line);position:relative;overflow:hidden;min-height:150px;display:flex;flex-direction:column;background:var(--surface)}
.mhome .promo .pk{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:6px;align-self:flex-start;margin-bottom:12px}
.mhome .promo h4{margin:0 0 6px;font-size:17px}
.mhome .promo p{margin:0;font-size:13px;color:var(--ink2);line-height:1.45}
.mhome .promo .amt{font-size:22px;font-weight:800;margin:2px 0 4px}
.mhome .promo .lnk{margin-top:auto;padding-top:14px;font-size:13px;font-weight:700;color:var(--violet2)}
.mhome .promo.grant{background:radial-gradient(110% 120% at 100% 0%,rgba(16,185,129,.18),transparent 55%),var(--surface)}
.mhome .promo.grant .pk{background:rgba(16,185,129,.18);color:#6ee7b7}.mhome .promo.grant .amt{color:#6ee7b7}
.mhome .promo.contest{background:radial-gradient(110% 120% at 100% 0%,rgba(124,58,237,.2),transparent 55%),var(--surface)}
.mhome .promo.contest .pk{background:rgba(124,58,237,.2);color:#d8b4fe}
.mhome .promo.challenge{background:radial-gradient(110% 120% at 100% 0%,rgba(245,158,11,.16),transparent 55%),var(--surface)}
.mhome .promo.challenge .pk{background:rgba(245,158,11,.18);color:#fcd34d}
.mhome .appfall{margin-top:34px;border:1px solid var(--line);border-radius:var(--r);background:var(--bg2);padding:22px 24px;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
.mhome .appfall .at{font-size:16px;font-weight:700;margin-top:4px}
.mhome .appfall .ad{font-size:13px;color:var(--mut);margin-top:4px;max-width:60ch}
.mhome .btn-ghost2{color:var(--ink);font-weight:700;font-size:14px;padding:11px 18px;border-radius:11px;border:1px solid var(--line2);white-space:nowrap}
.mhome .btn-ghost2:hover{background:var(--surface2)}
.mhome footer.f{border-top:1px solid var(--line);margin-top:50px;padding:26px 0;color:var(--mut);font-size:12px}
.mhome .f-in{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}

/* v4 minimal hero (Robinhood-style top) */
.mhome .chero{text-align:center;padding:clamp(56px,10vw,120px) 0 clamp(34px,5vw,56px)}
.mhome .chero-eye{font-size:12.5px;letter-spacing:.05em;color:#a78bda;margin:0 0 22px;font-weight:600}
.mhome .chero-h1{font-size:clamp(40px,8vw,80px);line-height:1.02;letter-spacing:-.035em;margin:0}
.mhome .chero-ac{color:#c084fc}
.mhome .chero-sub{max-width:640px;margin:24px auto 0;font-size:clamp(15px,1.9vw,18px);line-height:1.6;color:var(--ink2)}
.mhome .chero-cta{margin-top:34px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap}
.mhome .chero-proof{margin-top:clamp(44px,6vw,68px);display:grid;grid-template-columns:repeat(3,1fr);gap:20px;
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:38px 0}
.mhome .cp-n{font-weight:800;font-size:clamp(28px,5vw,50px);letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1}
.mhome .cp-n.gain{color:var(--emerald)}
.mhome .cp-l{margin-top:11px;font-size:12.5px;color:var(--mut);line-height:1.4;max-width:200px;margin-left:auto;margin-right:auto}
.mhome .today-sec{margin-top:4px}
.mhome .today-sec .card.today{max-width:none}
@media(max-width:680px){.mhome .chero-proof{grid-template-columns:1fr;gap:30px}}
`;
