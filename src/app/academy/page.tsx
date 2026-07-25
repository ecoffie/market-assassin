/* eslint-disable @next/next/no-html-link-for-pages -- marketing stub uses full-nav <a>. */
/**
 * /academy — Mindy Academy landing (COMING SOON stub). Academy = Mindy's OWN how-to lessons
 * (using the app, building market reports, finding opportunities, bidding contracts) — NOT
 * FHC training / podcast lessons. Linked from the nav on the gamified home + community hubs;
 * this stub keeps that link landing somewhere on-brand until the real lessons ship.
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mindy Academy — Coming soon',
  description: 'Short, practical lessons on winning federal contracts with Mindy — coming soon.',
};

const LESSONS = [
  { tag: 'Start here', title: 'Set up your profile the right way', blurb: 'NAICS, keywords, and set-asides so your matches are actually yours.' },
  { tag: 'Discover', title: 'Find your first real opportunity', blurb: 'Read a match, judge the fit, and decide what’s worth chasing.' },
  { tag: 'Research', title: 'Build a market report in 5 minutes', blurb: 'Total market, top agencies, and where the money actually is.' },
  { tag: 'Win', title: 'From pursuit to a submitted bid', blurb: 'Track it, scope the incumbent, and draft the proposal with Mindy.' },
];

export default function Academy() {
  return (
    <div className="acad">
      <style>{CSS}</style>

      <header className="nav"><div className="wrap nav-in">
        <a className="brand" href="/"><span className="mk"><span>M</span></span> Mindy</a>
        <span className="crumb">Academy</span>
        <div className="nav-r"><a className="btn-login" href="/app">Log in</a><a className="btn-cta" href="/signup">Get started free →</a></div>
      </div></header>

      <main className="wrap">
        <section className="hero">
          <span className="badge">🎓 Coming soon</span>
          <h1 className="disp">Mindy Academy.</h1>
          <p className="lead">Short, no-fluff lessons on winning federal contracts — how to set up your profile, find real opportunities, build a market report, and take a pursuit all the way to a submitted bid. Made by us, for the way Mindy actually works.</p>
          <div className="cta">
            <a className="btn-lg" href="/signup">Get notified when it drops →</a>
            <a className="btn-ghost" href="/discover">Explore Discover meanwhile</a>
          </div>
        </section>

        <section className="grid">
          {LESSONS.map((l) => (
            <div className="card" key={l.title}>
              <span className="tag">{l.tag}</span>
              <div className="t">{l.title}</div>
              <div className="b">{l.blurb}</div>
              <span className="soon">Coming soon</span>
            </div>
          ))}
        </section>
      </main>

      <footer className="f"><div className="wrap f-in"><span>© 2026 GovCon Giants AI · Mindy</span><span>Academy — coming soon</span></div></footer>
    </div>
  );
}

const CSS = `
.acad{--bg:#08060f;--card:#141021;--line:#241d3a;--line2:#342a52;--ink:#f4f1ff;--ink2:#b3aacb;--mut:#7a7192;
  --violet:#a855f7;--grad:linear-gradient(135deg,#8b5cf6,#a855f7 55%,#6d28d9);--maxw:1000px;
  background:var(--bg);color:var(--ink);min-height:100dvh;overflow-x:hidden;
  font-family:"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.acad *{box-sizing:border-box}
.acad a{color:inherit;text-decoration:none}
.acad .wrap{max-width:var(--maxw);margin:0 auto;padding:0 22px}
.acad .disp{font-weight:850;letter-spacing:-.03em}
.acad .nav{position:sticky;top:0;z-index:40;background:rgba(8,6,15,.85);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.acad .nav-in{display:flex;align-items:center;gap:16px;height:62px}
.acad .brand{display:flex;align-items:center;gap:9px;font-weight:850;font-size:17px}
.acad .brand .mk{width:30px;height:30px;border-radius:9px;background:var(--grad);display:grid;place-items:center;box-shadow:0 4px 16px rgba(139,92,246,.5)}
.acad .brand .mk span{font-weight:900;color:#fff;transform:translateY(-1px)}
.acad .crumb{font-size:13px;color:var(--mut);font-weight:600}
.acad .nav-r{margin-left:auto;display:flex;align-items:center;gap:10px}
.acad .btn-login{font-weight:700;font-size:14px;color:var(--ink2);padding:9px 12px}
.acad .btn-cta{background:var(--grad);color:#fff;font-weight:800;font-size:14px;padding:10px 18px;border-radius:10px}

.acad .hero{text-align:center;padding:clamp(60px,10vw,110px) 0 clamp(34px,5vw,54px)}
.acad .badge{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:800;color:#d8b4fe;background:rgba(139,92,246,.14);border:1px solid var(--line2);padding:6px 13px;border-radius:99px}
.acad .hero h1{font-size:clamp(40px,7vw,68px);line-height:1;margin:20px 0 0}
.acad .hero .lead{max-width:60ch;margin:20px auto 0;font-size:clamp(15px,2vw,18px);line-height:1.6;color:var(--ink2)}
.acad .cta{margin-top:30px;display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap}
.acad .btn-lg{background:var(--grad);color:#fff;font-weight:800;font-size:16px;padding:15px 26px;border-radius:14px;box-shadow:0 12px 34px rgba(139,92,246,.5)}
.acad .btn-lg:hover{filter:brightness(1.08)}
.acad .btn-ghost{color:var(--ink2);font-weight:700;font-size:15px}
.acad .btn-ghost:hover{color:var(--ink)}

.acad .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;padding-bottom:70px}
@media(max-width:720px){.acad .grid{grid-template-columns:1fr}}
.acad .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;position:relative;opacity:.9}
.acad .card .tag{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:#a78bda}
.acad .card .t{font-size:19px;font-weight:800;letter-spacing:-.02em;margin-top:12px}
.acad .card .b{font-size:14px;color:var(--ink2);line-height:1.5;margin-top:8px}
.acad .card .soon{display:inline-block;margin-top:16px;font-size:11.5px;font-weight:800;color:var(--mut);border:1px solid var(--line2);border-radius:99px;padding:4px 11px}

.acad .f{border-top:1px solid var(--line);padding:26px 0;color:var(--mut);font-size:12.5px}
.acad .f-in{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap}
`;
