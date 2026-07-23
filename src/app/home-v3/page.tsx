/**
 * /home-v3 — the MINIMAL, original-Robinhood-style variant of the logged-in home.
 *
 * Where /home and /home-v2 are a busy "command center", this applies the 2013 Robinhood
 * design ethos: less is more. ONE bold promise, ONE action above the fold, radical
 * whitespace, a single confident row of big tabular numbers (their "Top Movers" move),
 * one electric accent on a near-black canvas. Everything that doesn't serve the single
 * action (connect your agent) is stripped. Same real data as /home; a layout comparison
 * build, not the post-signin destination.
 *
 * Preview: ?email=<user> renders that user's real rank/XP.
 */
import Link from 'next/link';
import { getGameStats, getLeaderboard } from '@/lib/gamification/stats';
import { queryExpiringContracts } from '@/lib/recompete/query';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

export const dynamic = 'force-dynamic';

export default async function LoggedInHomeV3({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const email = (sp.email || 'eric@govcongiants.com').toLowerCase().trim();

  const [stats, board, opps] = await Promise.all([
    getGameStats(email).catch(() => null),
    getLeaderboard(email, 1).catch(() => ({ rows: [], you: null, total: 0 })),
    queryExpiringContracts({ monthsWindow: 12, minValue: 10_000_000, limit: 25 })
      .then((r) => r.contracts).catch(() => []),
  ]);

  // ONE confident proof number, Robinhood Top-Movers style: the single biggest thing in
  // play right now.
  const biggest = opps.reduce((m, c) => Math.max(m, Number(c.potential_total_value ?? c.total_obligation ?? 0)), 0);
  const leader = board.rows[0] ?? null;

  return (
    <div className="mv3">
      <style>{CSS}</style>

      <header className="nav"><div className="wrap">
        <a className="brand" href="#top"><span className="mk">M</span> Mindy</a>
        <span className="rank">{stats?.rankName ?? 'Recruit'} · {(stats?.xp ?? 0).toLocaleString()} XP</span>
      </div></header>

      <main className="wrap" id="top">
        <section className="hero">
          <p className="eyebrow">Government contracting for everyone</p>
          <h1>Send your agent<br />to <span className="accent">the government.</span></h1>
          <p className="sub">No $10K tools, no gurus. Connect the AI agent you already use — Mindy finds your contracts, sizes your market, and drafts your bids. Just ask.</p>
          <div className="cta">
            <Link className="go" href="/mcp">Connect your agent →</Link>
            <Link className="ghost" href="/app">or open the web app</Link>
          </div>
        </section>

        {/* ONE confident row of big tabular numbers — the "Top Movers" proof */}
        <section className="proof">
          <div className="stat">
            <div className="num gain">{biggest ? fmtMoney(biggest) : '—'}</div>
            <div className="lbl">biggest contract up for grabs today</div>
          </div>
          <div className="stat">
            <div className="num">{board.total.toLocaleString()}</div>
            <div className="lbl">hunters playing this week</div>
          </div>
          <div className="stat">
            <div className="num">{leader ? leader.weekXp.toLocaleString() : '—'}</div>
            <div className="lbl">{leader ? `top score · ${leader.handle}` : 'top score this week'}</div>
          </div>
        </section>

        <Link className="seemore" href="/up-for-grabs">See what&apos;s up for grabs →</Link>
      </main>

      <footer className="f"><div className="wrap">© 2026 GovCon Giants AI · Mindy</div></footer>
    </div>
  );
}

const CSS = `
.mv3{min-height:100dvh;background:#08060f;color:#ece9f5;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
.mv3 .wrap{width:100%;max-width:920px;margin:0 auto;padding:0 24px}
.mv3 a{color:inherit;text-decoration:none}

.mv3 .nav{border-bottom:1px solid #17131f}
.mv3 .nav .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
.mv3 .brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:16px;letter-spacing:-.01em}
.mv3 .mk{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;
  background:linear-gradient(140deg,#a855f7,#7c3aed);color:#fff;font-weight:800;font-size:14px}
.mv3 .rank{font-size:12.5px;color:#8b86a0;font-variant-numeric:tabular-nums;
  border:1px solid #221c30;border-radius:999px;padding:6px 12px}

.mv3 .hero{text-align:center;padding:clamp(64px,12vw,140px) 0 clamp(40px,7vw,72px)}
.mv3 .eyebrow{font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:#a78bda;margin:0 0 22px}
.mv3 h1{font-weight:800;letter-spacing:-.035em;line-height:1.02;margin:0;
  font-size:clamp(40px,8.5vw,84px)}
.mv3 .accent{color:#c084fc}
.mv3 .sub{max-width:620px;margin:26px auto 0;font-size:clamp(15px,2vw,18px);line-height:1.6;color:#a8a2bd}
.mv3 .cta{margin-top:38px;display:flex;flex-direction:column;align-items:center;gap:14px}
.mv3 .go{display:inline-flex;align-items:center;justify-content:center;
  background:linear-gradient(140deg,#a855f7,#7c3aed);color:#fff;font-weight:700;font-size:16px;
  padding:16px 30px;border-radius:14px;box-shadow:0 10px 40px -12px rgba(168,85,247,.6);
  transition:transform .12s ease}
.mv3 .go:hover{transform:translateY(-1px)}
.mv3 .ghost{font-size:13.5px;color:#7c7791}
.mv3 .ghost:hover{color:#c9c4dc}

.mv3 .proof{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;
  border-top:1px solid #17131f;border-bottom:1px solid #17131f;padding:44px 0;text-align:center}
.mv3 .stat .num{font-weight:800;font-size:clamp(30px,5.5vw,52px);letter-spacing:-.03em;
  font-variant-numeric:tabular-nums;line-height:1}
.mv3 .stat .num.gain{color:#34d399}
.mv3 .stat .lbl{margin-top:12px;font-size:12.5px;color:#847f99;line-height:1.4;
  max-width:200px;margin-left:auto;margin-right:auto}

.mv3 .seemore{display:block;text-align:center;padding:34px 0;font-size:14.5px;color:#a78bda}
.mv3 .seemore:hover{color:#c084fc}

.mv3 .f{margin-top:auto;border-top:1px solid #17131f}
.mv3 .f .wrap{padding:24px;font-size:12.5px;color:#5f5b72;text-align:center}

@media(max-width:680px){
  .mv3 .proof{grid-template-columns:1fr;gap:32px}
  .mv3 .rank{display:none}
}
`;
