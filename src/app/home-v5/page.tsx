/**
 * /home-v5 — the INTERNAL logged-in home, Higgsfield-style HUB (rebuild of the approved
 * mockup 47d2489f). This is the "what's possible" showcase layer that sits AFTER login/2FA
 * and BEFORE the app: greet the member, show what's moving in THEIR market today (real
 * NAICS-matched opps), push them into the app ("Enter the App"), then events, capabilities,
 * and sample outputs. NOT a gamified command center, NOT a marketing landing — a hub that
 * gives you something to do the moment you land.
 *
 * Auth: in production this renders for an authenticated (2FA-passed) member, so the matched
 * opps + credits come from their session. In this PREVIEW, ?email=<user> drives the same
 * data server-side (the lib calls below don't need the 2FA route gate).
 */
import Link from 'next/link';
import { fetchSamOpportunitiesFromCache } from '@/lib/briefings/pipelines/sam-gov';
import { getReadClient } from '@/lib/supabase/server-clients';
import CopyPrompt from '@/components/home/CopyPrompt';
import { Flame, Trophy, Terminal, GraduationCap, LayoutGrid } from 'lucide-react';
import { getGameStats, getLeaderboard } from '@/lib/gamification/stats';
import { getBalance } from '@/lib/mcp/credits';
import { getReferralStats } from '@/lib/mcp/referrals';
import { getMapOpportunities, SET_GROUPS } from '@/lib/opportunities/map-data';
import HeroOpportunityMap from '@/components/app/HeroOpportunityMap';

export const dynamic = 'force-dynamic';

const DEFAULT_NAICS = ['238220', '561720', '561730', '236220', '541512'];

// Module-scope (keeps the clock read out of the render body — the react-hooks/purity rule).
function greeting(): string {
  const h = new Date().getUTCHours() - 5; // ET-ish; a greeting, not a precise clock
  const hr = ((h % 24) + 24) % 24;
  return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}
function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = Math.round((new Date(dateStr).getTime() - new Date().getTime()) / 864e5);
  return Number.isFinite(d) ? d : null;
}
function nameFromEmail(email: string): string {
  const local = email.split('@')[0]?.split(/[.\-_+]/)[0] || 'there';
  return local.charAt(0).toUpperCase() + local.slice(1);
}
function badgeFor(noticeType: string): { label: string; cls: string } {
  const t = (noticeType || '').toLowerCase();
  if (t.includes('sources sought') || t.includes('rfi')) return { label: 'Sources Sought', cls: 'b-ss' };
  if (t.includes('presol') || t.includes('pre-sol')) return { label: 'Pre-Sol', cls: 'b-ss' };
  if (t.includes('combined') || t.includes('solicitation')) return { label: 'RFP', cls: 'b-rfp' };
  if (t.includes('award')) return { label: 'Award', cls: 'b-ss' };
  return { label: noticeType ? noticeType.slice(0, 14) : 'Notice', cls: 'b-rfp' };
}

async function getUserContext(email: string): Promise<{ naics: string[]; isPaid: boolean }> {
  try {
    const sb = getReadClient();
    const { data, error } = await sb
      .from('user_notification_settings')
      .select('naics_codes, paid_status')
      .eq('user_email', email)
      .maybeSingle();
    if (error) throw error;
    const codes = (data?.naics_codes as string[] | null || []).filter(Boolean);
    return { naics: codes.length ? codes : DEFAULT_NAICS, isPaid: data?.paid_status === true };
  } catch {
    return { naics: DEFAULT_NAICS, isPaid: false };
  }
}

export default async function LoggedInHomeV5({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const email = (sp.email || 'eric@govcongiants.com').toLowerCase().trim();

  const { naics, isPaid } = await getUserContext(email);
  const [oppsRes, game, board, balance, referral, mapOpps] = await Promise.all([
    fetchSamOpportunitiesFromCache({ naicsCodes: naics, limit: 8 }).catch(() => ({ opportunities: [] as Array<Record<string, unknown>> })),
    getGameStats(email).catch(() => null),
    getLeaderboard(email, 5).catch(() => ({ rows: [] as Array<{ handle: string; weekXp: number; rank: number; isYou: boolean }>, you: null as { handle: string; weekXp: number; rank: number; isYou: boolean } | null, total: 0 })),
    getBalance(email).catch(() => 0),
    getReferralStats(email, 'https://getmindy.ai').catch(() => null),
    getMapOpportunities(250).catch(() => []),
  ]);
  const mapPins = mapOpps.map((o) => ({ lat: o.lat, lng: o.lng, set: o.set }));
  const mapGroups = SET_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color }));
  const today = (oppsRes.opportunities as Array<Record<string, unknown>>).slice(0, 3);
  const name = nameFromEmail(email);

  return (
    <div className="hv5">
      <style>{CSS}</style>

      <header className="nav"><div className="wrap nav-in">
        <a className="brand" href="#top"><span className="mark"><span>M</span></span> Mindy</a>
        <nav className="links">
          <a className="active" href="#top">Home</a>
          <Link href="/app">The App</Link>
          <Link href="/mcp">MCP &amp; Plugin <span className="tag">49 tools</span></Link>
          <Link href="/academy">Academy <span className="tag">New</span></Link>
          <Link href="/pricing">Pricing</Link>
        </nav>
        <div className="nav-r">
          <Link className="pill" href="/mcp/account"><span className="dot" />Credits <b className="tnum">{balance.toLocaleString()}</b></Link>
          <span className="avatar" />
        </div>
      </div></header>

      <main className="wrap" id="top">
        <div className="hello">
          <div>
            <div className="eyebrow">Welcome back</div>
            <h1 className="disp">{greeting()}, {name}.</h1>
            <p>Here&apos;s what&apos;s moving in your federal market today — and everything Mindy can do for you.</p>
          </div>
        </div>

        {/* HERO — Enter the App (left) + Today's matched opps (right) */}
        <section className="hero">
          <div className="card enter">
            <HeroOpportunityMap pins={mapPins} setGroups={mapGroups} />
          </div>

          <div className="card today">
            <div className="hd">
              <div className="eyebrow">Today in your market</div>
              <div className="live"><span className="dot" />Live</div>
            </div>
            {today.length === 0 ? <div className="opp"><div className="ti">No new matches right now — check back soon.</div></div> : today.map((o, i) => {
              const b = badgeFor(String(o.noticeType || ''));
              const d = daysUntil(o.responseDeadline as string);
              return (
                <div className="opp" key={String(o.noticeId || i)}>
                  <div className="top"><span className={`badge ${b.cls}`}>{b.label}</span>{d != null && <span className="fit tnum">{d <= 0 ? 'closing' : `${d}d left`}</span>}</div>
                  <div className="ti">{String(o.title || 'Untitled opportunity')}</div>
                  <div className="me"><span>NAICS {String(o.naicsCode || '—')}</span><span>{String(o.department || '')}</span></div>
                </div>
              );
            })}
            <Link className="all" href="/app?panel=alerts">See all your matches →</Link>
          </div>
        </section>

        {/* ENGINE — real progress + credits + refer (Decision #024 band 2: the return + virality engines) */}
        <section className="engine">
          <div className="gcard">
            <div className="gh"><span className="glabel">Your streak</span>{game && game.streak > 0 && <span className="fire"><Flame size={13} strokeWidth={2.25} /> {game.streak}d</span>}</div>
            <div className="gbig tnum">{(game?.xp ?? 0).toLocaleString()}<span className="gu">XP</span></div>
            <div className="grank">{game?.rankName ?? 'Recruit'} · Level {game?.level ?? 1}</div>
            {game && game.nextAt != null ? (
              <>
                <div className="gbar"><i style={{ width: `${Math.min(100, Math.round((game.xp / game.nextAt) * 100))}%` }} /></div>
                <div className="gnext">{(game.nextAt - game.xp).toLocaleString()} XP to {game.nextName}</div>
              </>
            ) : <div className="gnext" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>{game ? <>Top rank reached <Trophy size={13} strokeWidth={2} /></> : 'Use Mindy to start earning XP.'}</div>}
            <div className="gmeta">{game?.toolUseWeek ?? 0} tool actions · {game?.activeDaysWeek ?? 0} active days this week</div>
          </div>

          <div className="gcard">
            <div className="gh"><span className="glabel">This week&apos;s board</span><Link className="glink" href="/app">Play →</Link></div>
            {board.rows.length === 0 ? (
              <div className="lbempty">Use Mindy this week to land on the board.</div>
            ) : board.rows.map((r) => (
              <div className={`lbrow${r.isYou ? ' you' : ''}`} key={r.rank}>
                <span className="lrk tnum">{r.rank}</span>
                <span className="lhandle">{r.handle}{r.isYou && <span className="ytag">you</span>}</span>
                <span className="lxp tnum">{r.weekXp.toLocaleString()}</span>
              </div>
            ))}
            {board.you && board.you.rank > 5 && (
              <div className="lbrow you">
                <span className="lrk tnum">{board.you.rank}</span>
                <span className="lhandle">{board.you.handle}<span className="ytag">you</span></span>
                <span className="lxp tnum">{board.you.weekXp.toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="gcard">
            <div className="gh"><span className="glabel">Mindy credits</span><Link className="glink" href="/mcp/account">Manage →</Link></div>
            <div className="gbig tnum">{balance.toLocaleString()}<span className="gu">cr</span></div>
            <div className="gnext">100 free on signup · earn +{referral?.reward ?? 100} for every friend</div>
            {referral && (
              <div className="refbox">
                <input className="reflink" readOnly value={referral.link} aria-label="Your referral link" />
                <CopyPrompt text={referral.link} />
              </div>
            )}
            <div className="gmeta">{referral ? `You've earned ${referral.creditsEarned.toLocaleString()} cr from ${referral.qualified} friend${referral.qualified === 1 ? '' : 's'}` : 'Invite a friend — you both get +100.'}</div>
          </div>
        </section>

        {/* EVENTS — surfaced here per Eric; real destinations are being built, so honest
            "coming soon" states instead of dead /signup links (a signed-in user → signup). */}
        <div className="sec-h"><h3 className="disp">Happening on Mindy</h3><span className="soon">Coming soon</span></div>
        <section className="event">
          <div className="cnt">
            <div className="kk"><span className="flag">Live event</span><span className="when">Coming soon</span></div>
            <h3 className="disp">Mindy Demo Day</h3>
            <p>Watch real contractors pitch live, see Mindy find their next award on stage, and get the exact playbook they used. Free to attend.</p>
            <div className="act"><span className="soonbtn">Coming soon</span></div>
          </div>
        </section>
        <section className="promos">
          <div className="promo contest"><span className="pk">Contest</span><h4>Demo Day Pitch Contest</h4><p>Pitch how you&apos;d win a target contract. Best entry takes a year of Pro + a founder strategy call.</p><span className="lnk soon-lnk">Coming soon</span></div>
          <div className="promo grant"><span className="pk">Giveaway</span><h4>Grant Giveaway</h4><div className="amt tnum">$10,000</div><p>One small business, one working-capital grant to go after its first federal award.</p><span className="lnk soon-lnk">Coming soon</span></div>
          <div className="promo challenge"><span className="pk">Challenge</span><h4>First-Contract Challenge</h4><p>30 days, guided by Mindy, from profile to your first submitted bid. Finish it, unlock bonus credits.</p><span className="lnk soon-lnk">Coming soon</span></div>
        </section>

        {/* CAPABILITIES */}
        <div className="sec-h"><h3 className="disp">What&apos;s possible</h3><Link href="/app">Explore everything →</Link></div>
        <section className="row3">
          <Link className="card cap mcp" href="/mcp">
            <span className="tag newtag">New</span>
            <div className="ic ic-mcp"><Terminal size={20} strokeWidth={1.75} /></div>
            <h4>MCP &amp; Plugin</h4>
            <p>Turn Claude — or any AI agent — into a GovCon analyst. 49 tools: opportunities, incumbents, pricing, win playbooks.</p>
            <div className="foot"><span className="go">Connect at mcp.getmindy.ai →</span></div>
          </Link>
          <Link className="card cap" href="/academy">
            <span className="tag newtag">Free</span>
            <div className="ic ic-aca"><GraduationCap size={20} strokeWidth={1.75} /></div>
            <h4>Academy</h4>
            <p>Short how-to lessons from us — using the app, building market reports, finding opportunities, and bidding contracts with Mindy.</p>
            <div className="foot"><span className="go">Start learning →</span></div>
          </Link>
          <Link className="card cap" href="/app">
            <div className="ic ic-tool"><LayoutGrid size={20} strokeWidth={1.75} /></div>
            <h4>The Tool Suite</h4>
            <p>Market Research, Forecasts, Recompetes, Contractor DB, Pipeline, Teaming CRM, Content Reaper, SBIR &amp; Grants.</p>
            <div className="foot"><span className="go">Open the app →</span></div>
          </Link>
        </section>

        {/* UPGRADE — single contextual nudge for free users (Decision #024: not a pricing brochure) */}
        {!isPaid && (
          <section className="upgrade">
            <div className="up-l">
              <div className="eyebrow" style={{ color: '#d8b4fe' }}>You&apos;re on Free</div>
              <h3 className="disp">Unlock the full BD department.</h3>
              <p>AI briefings, 7,700+ forecasts, recompete tracking, pipeline, teaming CRM, proposal drafting &amp; the MCP — everything, unlimited.</p>
            </div>
            <div className="up-r">
              <div className="up-price tnum">$149<small>/mo</small></div>
              <Link className="btn-primary" href="/pricing">Upgrade to Pro →</Link>
              <Link className="up-teams" href="/pricing">or Teams for a whole BD team →</Link>
            </div>
          </section>
        )}
      </main>

      <footer className="f"><div className="wrap f-in">
        <span>© 2026 GovCon Giants AI · Mindy</span>
        <span>Home · The App · MCP &amp; Plugin · Academy · Pricing</span>
      </div></footer>
    </div>
  );
}

const CSS = `
.hv5{--bg:#0b0a12;--bg2:#100e1a;--surface:#17141f;--surface2:#1e1a2b;--line:#2a2438;--line2:#372f4d;
  --violet:#7c3aed;--violet2:#a855f7;--violet-deep:#4c1d95;--emerald:#10b981;--amber:#f59e0b;
  --ink:#f6f4ff;--ink2:#c5bfd8;--mut:#8a8399;--mut2:#645d75;--r:18px;--maxw:1240px;
  --grad:linear-gradient(135deg,#7c3aed,#a855f7 55%,#6d28d9);
  background:var(--bg);color:var(--ink);min-height:100dvh;
  font-family:"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.hv5 *{box-sizing:border-box}
.hv5 a{color:inherit;text-decoration:none}
.hv5 .wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
.hv5 .disp{font-weight:800;letter-spacing:-.02em;text-wrap:balance}
.hv5 .eyebrow{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.hv5 .tnum{font-variant-numeric:tabular-nums}

.hv5 .nav{position:sticky;top:0;z-index:40;background:rgba(11,10,18,.82);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.hv5 .nav-in{display:flex;align-items:center;gap:26px;height:64px}
.hv5 .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px}
.hv5 .brand .mark{width:30px;height:30px;border-radius:9px;background:var(--grad);display:grid;place-items:center;box-shadow:0 4px 14px rgba(124,58,237,.45)}
.hv5 .brand .mark span{font-weight:900;color:#fff;font-size:17px}
.hv5 .links{display:flex;align-items:center;gap:4px;margin-left:6px}
.hv5 .links a{position:relative;padding:8px 12px;border-radius:9px;color:var(--ink2);font-size:14px;font-weight:600;display:flex;align-items:center;gap:7px}
.hv5 .links a:hover{background:var(--surface2);color:var(--ink)}
.hv5 .links a.active{color:var(--ink)}
.hv5 .tag{font-size:9px;font-weight:800;letter-spacing:.06em;padding:2px 6px;border-radius:6px;background:var(--violet-deep);color:#e9d5ff;text-transform:uppercase}
.hv5 .nav-r{margin-left:auto;display:flex;align-items:center;gap:12px}
.hv5 .pill{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:10px;background:var(--surface2);border:1px solid var(--line);font-size:13px;font-weight:600;color:var(--ink2)}
.hv5 .pill .dot{width:7px;height:7px;border-radius:50%;background:var(--emerald);box-shadow:0 0 8px var(--emerald)}
.hv5 .pill b{color:var(--ink)}
.hv5 .avatar{width:36px;height:36px;border-radius:50%;background:conic-gradient(from 200deg,#a855f7,#6d28d9,#c4b5fd,#7c3aed);border:2px solid #2b2340}
@media(max-width:720px){.hv5 .links{display:none}}

.hv5 main{padding:34px 0 70px}
.hv5 .hello{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:18px;flex-wrap:wrap}
.hv5 .hello h1{font-size:30px;margin:6px 0 0}
.hv5 .hello p{color:var(--mut);margin:6px 0 0;font-size:15px}
.hv5 .hero{display:grid;grid-template-columns:1.55fr 1fr;gap:18px;margin-bottom:18px}
@media(max-width:900px){.hv5 .hero{grid-template-columns:1fr}}

.hv5 .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);position:relative;overflow:hidden}
.hv5 .enter{position:relative;padding:0;overflow:hidden;min-height:440px;border-color:#342a4d;background:#e8eef2}
.hv5 .enter-l{display:flex;flex-direction:column;min-width:0}
.hv5 .enter-r{align-self:stretch;position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line2);min-height:300px;background:#e8eef2}
.hv5 .heromap{position:absolute;inset:0;display:block}
.hv5 .heromap-canvas{position:absolute;inset:0}
.hv5 .heromap-canvas .leaflet-container{background:#e8eef2}
.hv5 .enter h2{font-size:34px;margin:14px 0 8px;line-height:1.03}
.hv5 .enter .sub{color:var(--ink2);font-size:15px;max-width:44ch;line-height:1.5}
.hv5 .statline{display:flex;gap:26px;margin:22px 0 0;flex-wrap:wrap}
.hv5 .statline .s .n{font-size:22px;font-weight:800;letter-spacing:-.02em}
.hv5 .statline .s .l{font-size:12px;color:var(--mut);margin-top:2px}
.hv5 .enter .cta{margin-top:auto;display:flex;align-items:center;gap:14px;padding-top:24px}
.hv5 .btn-primary{background:var(--grad);color:#fff;font-weight:700;font-size:15px;padding:13px 22px;border-radius:12px;display:inline-flex;align-items:center;gap:9px;box-shadow:0 8px 24px rgba(124,58,237,.4)}
.hv5 .btn-primary:hover{filter:brightness(1.08)}
.hv5 .btn-ghost{color:var(--ink2);font-weight:600;font-size:14px}
.hv5 .btn-ghost:hover{color:var(--ink)}

.hv5 .today{padding:22px;display:flex;flex-direction:column;min-height:280px}
.hv5 .today .hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.hv5 .today .live{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--emerald)}
.hv5 .today .live .dot{width:7px;height:7px;border-radius:50%;background:var(--emerald);box-shadow:0 0 8px var(--emerald)}
.hv5 .opp{padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--bg2);margin-bottom:9px}
.hv5 .opp:hover{border-color:var(--line2)}
.hv5 .opp .top{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.hv5 .badge{font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 7px;border-radius:6px}
.hv5 .b-rfp{background:rgba(16,185,129,.16);color:#6ee7b7}
.hv5 .b-ss{background:rgba(168,85,247,.16);color:#d8b4fe}
.hv5 .opp .ti{font-size:13.5px;font-weight:600;line-height:1.35}
.hv5 .opp .me{font-size:12px;color:var(--mut);margin-top:5px;display:flex;gap:12px;flex-wrap:wrap}
.hv5 .fit{margin-left:auto;font-weight:800;color:var(--emerald)}
.hv5 .today .all{margin-top:auto;padding-top:12px;font-size:13px;color:var(--violet2);font-weight:700}

.hv5 .sec-h{display:flex;align-items:baseline;justify-content:space-between;margin:34px 0 14px}
.hv5 .sec-h h3{font-size:19px;margin:0}
.hv5 .sec-h a{font-size:13px;color:var(--mut);font-weight:600}
.hv5 .sec-h a:hover{color:var(--ink2)}
.hv5 .row3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:900px){.hv5 .row3{grid-template-columns:1fr}}
.hv5 .cap{padding:22px;min-height:186px;display:flex;flex-direction:column;overflow:hidden}
.hv5 .cap:hover{border-color:var(--line2)}
.hv5 .cap .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;margin-bottom:14px}
.hv5 .ic-mcp{color:#93c5fd}
.hv5 .ic-aca{color:#d8b4fe}
.hv5 .ic-tool{color:#6ee7b7}
.hv5 .cap h4{font-size:18px;margin:0 0 6px}
.hv5 .cap p{color:var(--ink2);font-size:13.5px;line-height:1.5;margin:0}
.hv5 .cap .foot{margin-top:auto;padding-top:16px;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700}
.hv5 .cap .newtag{position:absolute;top:16px;right:16px}
.hv5 .ic-mcp{background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155}
.hv5 .ic-aca{background:linear-gradient(135deg,rgba(124,58,237,.28),rgba(76,29,149,.3));border:1px solid #4c2f7a}
.hv5 .ic-tool{background:linear-gradient(135deg,rgba(16,185,129,.22),rgba(6,95,70,.3));border:1px solid #17513f}
.hv5 .cap.mcp{background:radial-gradient(120% 120% at 90% 10%,rgba(59,130,246,.14),transparent 55%),var(--surface)}
.hv5 .cap .foot .go{color:var(--violet2)}

.hv5 .show{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
@media(max-width:980px){.hv5 .show{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.hv5 .show{grid-template-columns:1fr}}
.hv5 .shot{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.hv5 .shot .pv{height:118px;padding:14px;position:relative;overflow:hidden;border-bottom:1px solid var(--line)}
.hv5 .shot .lb{position:absolute;bottom:10px;left:12px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#fff;opacity:.9}
.hv5 .pv-report{background:radial-gradient(100% 100% at 20% 0%,#3b2a63,#1a1330)}
.hv5 .pv-brief{background:radial-gradient(100% 100% at 100% 0%,#0f3d34,#0d1f1c)}
.hv5 .pv-recompete{background:radial-gradient(100% 100% at 0% 100%,#4a2338,#1f0f1a)}
.hv5 .pv-contractor{background:radial-gradient(100% 100% at 80% 100%,#26314f,#0f1424)}
.hv5 .mini{display:flex;gap:4px;align-items:flex-end;height:44px;margin-top:8px}
.hv5 .mini i{flex:1;background:rgba(255,255,255,.34);border-radius:2px}
.hv5 .shot .bd{padding:13px 14px}
.hv5 .shot .bd .t{font-size:14px;font-weight:700}
.hv5 .shot .bd .d{font-size:12px;color:var(--mut);margin-top:4px;line-height:1.4}

.hv5 .event{margin-top:6px;border-radius:var(--r);border:1px solid #3a2d5c;overflow:hidden;position:relative;background:radial-gradient(90% 160% at 88% 20%,rgba(168,85,247,.5),transparent 55%),radial-gradient(70% 140% at 100% 100%,rgba(245,158,11,.28),transparent 60%),linear-gradient(100deg,#1a1330,#241a44);padding:26px 30px;display:flex;align-items:center;gap:24px;min-height:150px}
.hv5 .event .cnt{position:relative;z-index:2;max-width:60%}
.hv5 .event .kk{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.hv5 .event .flag{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;background:#dc2626;color:#fff;padding:3px 9px;border-radius:6px}
.hv5 .event .when{font-size:12px;font-weight:700;color:#fbbf24}
.hv5 .event h3{font-size:27px;margin:0 0 6px;line-height:1.05}
.hv5 .event p{margin:0;color:var(--ink2);font-size:14px;max-width:48ch;line-height:1.5}
.hv5 .event .act{margin-top:16px;display:flex;align-items:center;gap:14px}
.hv5 .event .seat{background:#fff;color:#1a1330;font-weight:800;font-size:14px;padding:11px 20px;border-radius:11px}
.hv5 .event .seat:hover{filter:brightness(.94)}
@media(max-width:760px){.hv5 .event{flex-wrap:wrap}.hv5 .event .cnt{max-width:100%}}

.hv5 .promos{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:16px}
@media(max-width:900px){.hv5 .promos{grid-template-columns:1fr}}
.hv5 .promo{padding:20px;border-radius:14px;border:1px solid var(--line);position:relative;overflow:hidden;min-height:150px;display:flex;flex-direction:column}
.hv5 .promo:hover{border-color:var(--line2)}
.hv5 .promo .pk{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:6px;align-self:flex-start;margin-bottom:12px}
.hv5 .promo h4{margin:0 0 6px;font-size:17px}
.hv5 .promo p{margin:0;font-size:13px;color:var(--ink2);line-height:1.45}
.hv5 .promo .lnk{margin-top:auto;padding-top:14px;font-size:13px;font-weight:700;color:var(--violet2)}
.hv5 .promo.contest{background:radial-gradient(110% 120% at 100% 0%,rgba(124,58,237,.2),transparent 55%),var(--surface)}
.hv5 .promo.contest .pk{background:rgba(124,58,237,.2);color:#d8b4fe}
.hv5 .promo.grant{background:radial-gradient(110% 120% at 100% 0%,rgba(16,185,129,.18),transparent 55%),var(--surface)}
.hv5 .promo.grant .pk{background:rgba(16,185,129,.18);color:#6ee7b7}
.hv5 .promo.grant .amt{font-size:22px;font-weight:800;letter-spacing:-.02em;margin:2px 0 4px}
.hv5 .promo.challenge{background:radial-gradient(110% 120% at 100% 0%,rgba(245,158,11,.16),transparent 55%),var(--surface)}
.hv5 .promo.challenge .pk{background:rgba(245,158,11,.18);color:#fcd34d}

.hv5 .price{margin-top:40px;border:1px solid var(--line);border-radius:var(--r);background:var(--bg2);display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr;overflow:hidden}
@media(max-width:820px){.hv5 .price{grid-template-columns:1fr 1fr}}
.hv5 .price .cell{padding:22px}
.hv5 .price .cell+.cell{border-left:1px solid var(--line)}
@media(max-width:820px){.hv5 .price .cell+.cell{border-left:0;border-top:1px solid var(--line)}}
.hv5 .price .lead h3{margin:0 0 6px;font-size:18px}
.hv5 .price .lead p{margin:0;color:var(--mut);font-size:13px;line-height:1.5}
.hv5 .price .tier .nm{font-weight:700;font-size:14px;color:var(--ink2)}
.hv5 .price .tier .amt{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:6px 0 2px}
.hv5 .price .tier .amt small{font-size:13px;color:var(--mut);font-weight:600}
.hv5 .price .tier.pro{background:linear-gradient(180deg,rgba(124,58,237,.12),transparent)}
.hv5 .price .tier .b{display:inline-block;margin-top:10px;font-size:12px;font-weight:700;color:var(--violet2)}

.hv5 .f{border-top:1px solid var(--line);margin-top:60px;padding:26px 0;color:var(--mut2);font-size:12px}
.hv5 .f-in{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}

/* ENGINE — real progress + credits + refer (#024 band 2) */
.hv5 .engine{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-top:18px}
@media(max-width:900px){.hv5 .engine{grid-template-columns:1fr}}
.hv5 .gcard{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:20px;display:flex;flex-direction:column;min-height:190px}
.hv5 .gh{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.hv5 .glabel{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.hv5 .glink{font-size:12px;font-weight:700;color:var(--violet2)}
.hv5 .fire{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:800;color:var(--amber)}
.hv5 .gbig{font-size:34px;font-weight:800;letter-spacing:-.03em;line-height:1}
.hv5 .gbig .gu{font-size:14px;color:var(--mut);font-weight:700;margin-left:6px;letter-spacing:0}
.hv5 .grank{font-size:13px;font-weight:700;color:var(--ink2);margin-top:7px}
.hv5 .gbar{height:7px;border-radius:99px;background:var(--bg2);border:1px solid var(--line);margin:12px 0 6px;overflow:hidden}
.hv5 .gbar i{display:block;height:100%;background:var(--grad)}
.hv5 .gnext{font-size:12px;color:var(--mut)}
.hv5 .gmeta{margin-top:auto;padding-top:12px;font-size:12px;color:var(--mut2)}
.hv5 .lbrow{display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line);font-size:13px;color:var(--ink2)}
.hv5 .lbrow:first-of-type{border-top:0}
.hv5 .lbrow.you{color:var(--ink);font-weight:600}
.hv5 .lrk{color:var(--mut);font-weight:800;text-align:center}
.hv5 .lhandle{font-weight:600;display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hv5 .ytag{font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:5px;background:var(--violet-deep);color:#e9d5ff}
.hv5 .lxp{font-weight:800;color:var(--emerald)}
.hv5 .lbempty{color:var(--mut);font-size:13px;padding:8px 0}
.hv5 .refbox{display:flex;gap:8px;margin:12px 0 4px}
.hv5 .reflink{flex:1;min-width:0;background:var(--bg2);border:1px solid var(--line);border-radius:9px;padding:8px 10px;font-size:12px;color:var(--ink2);font-family:inherit}
.hv5 .copybtn{background:var(--grad);color:#fff;border:0;border-radius:9px;padding:8px 13px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap}
.hv5 .copybtn:hover{filter:brightness(1.08)}

/* Coming-soon states (no dead /signup links) */
.hv5 .soon{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--mut2);border:1px solid var(--line);padding:4px 9px;border-radius:99px}
.hv5 .soonbtn{background:var(--surface2);color:var(--mut);font-weight:800;font-size:14px;padding:11px 20px;border-radius:11px;border:1px solid var(--line)}
.hv5 .soon-lnk{color:var(--mut2)!important}

/* MAKE — real tool actions (#024) */
.hv5 .makes{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
@media(max-width:980px){.hv5 .makes{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.hv5 .makes{grid-template-columns:1fr}}
.hv5 .mk-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;min-height:162px}
.hv5 .mk-card:hover{border-color:var(--line2)}
.hv5 .mk-ic{margin-bottom:10px;line-height:0;color:var(--violet2)}
.hv5 .mk-t{font-size:15px;font-weight:800}
.hv5 .mk-d{font-size:12.5px;color:var(--ink2);line-height:1.45;margin-top:5px}
.hv5 .mk-go{margin-top:auto;padding-top:14px;font-size:13px;font-weight:800;color:var(--violet2)}

/* UPGRADE — single contextual nudge (#024, replaces the pricing brochure) */
.hv5 .upgrade{margin-top:40px;border:1px solid #342a4d;border-radius:var(--r);padding:28px 30px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;background:radial-gradient(90% 160% at 88% 10%,rgba(124,58,237,.34),transparent 55%),var(--surface2)}
.hv5 .upgrade .up-l h3{font-size:24px;margin:8px 0 8px}
.hv5 .upgrade .up-l p{margin:0;color:var(--ink2);font-size:14px;max-width:62ch;line-height:1.5}
.hv5 .upgrade .up-r{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.hv5 .up-price{font-size:30px;font-weight:800;letter-spacing:-.02em}
.hv5 .up-price small{font-size:14px;color:var(--mut);font-weight:600}
.hv5 .up-teams{font-size:12px;color:var(--mut);font-weight:600}
@media(max-width:640px){.hv5 .upgrade .up-r{align-items:flex-start}}
`;
