import type { Metadata } from 'next';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import { countContactsByTag } from '@/lib/ghl/event-registration';
import SeatDialog from './SeatDialog';
import Countdown from './Countdown';

const URL = `https://getmindy.ai${EVENT.path}`;
const CREDITS = EVENT.claimCredits.toLocaleString('en-US');
const DESCRIPTION =
  `A free live event with Eric Coffie: how small businesses find and win federal contracts without the busywork, with Mindy doing the heavy lifting. Live attendees get ${CREDITS} free Mindy credits. Saturday, November 28, 2026.`;

export const metadata: Metadata = {
  title: `${EVENT.title} — Free Live Event | Mindy`,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: { title: EVENT.title, description: DESCRIPTION, url: URL, siteName: 'Mindy', type: 'website' },
  twitter: { card: 'summary_large_image', title: EVENT.title, description: DESCRIPTION },
};

// The registrant count is re-read at most every 5 minutes.
export const revalidate = 300;

/**
 * Conversion pass 4 (owner, 2026-11-19): rebuilt on Alex Hormozi's landing-page rules.
 *   Above the fold: an outcome headline, a subheadline that adds the context (the event), a proof
 *   image of the exact thing they'll use, one reason to register, and the form (unchanged).
 *   Below the fold: three objection answers, most common first, one line of credibility, one button.
 *   Then legal. Everything else (stats band, logo strip, agenda, reasons grid, FAQ) was cut: the
 *   filter is "does it raise the opt-in rate of qualified leads?".
 * The registrant count is real (GHL) and is left out when it can't be read or is under 50.
 * Credits are stated as credits, never as dollars.
 */
const HEADLINE = 'Find federal contracts you can win, in minutes instead of hours.';
/** Problem first (Hormozi's page: "you think you have a hundred problems; you usually have one"). */
const SUBHEAD =
  'Most small businesses think government contracting has a hundred problems. It usually has one: finding the contracts that fit you. Eric Coffie shows you how, live and free, with Mindy doing the heavy lifting.';

/**
 * Vimeo id of the short hero video (plays muted; Vimeo shows its own unmute control). Until the
 * owner sends one, the hero shows the map image instead.
 */
const HERO_VIMEO_ID: string | null = null;

/** Biggest objections first. */
const OBJECTIONS = [
  ['“I can’t make it live.”', 'Register anyway. The replay comes to your inbox. The free credits are for people who join live.'],
  ['“I’m new to government contracting.”', 'It’s built for first-timers. You don’t need to be registered in SAM.gov yet, and you can ask questions live.'],
  ['“Is this a sales pitch?”', 'It’s free with no credit card. You leave with a short list of contracts to go after and 1,000 credits to run Mindy on your own business.'],
] as const;

async function registeredCount(): Promise<string | null> {
  const regs = await countContactsByTag(EVENT.ghlTag).catch(() => null);
  return regs !== null && regs >= 50 ? `${Math.floor(regs / 10) * 10}+` : null;
}

export default async function LazyContractorsBlueprintPage() {
  const registered = await registeredCount();
  return (
    <main className="lcb">
      <style dangerouslySetInnerHTML={{ __html: LCB_CSS }} />

      {/* Top bar: real facts only (date, live-only, the real count when ≥50). Never a made-up "sold out". */}
      <div className="lcb-bar">
        Free · Live only · {EVENT.shortDate} at 11:00 AM ET{registered ? ` · ${registered} already registered` : ''}
      </div>

      {/* Above the fold (Hormozi's page): kicker, big centered headline, problem-first line, video, ONE button. */}
      <section className="lcb-hero">
        <div className="lcb-wrap lcb-hero-col">
          <p className="lcb-kicker">{EVENT.title} · Free live training</p>
          <h1 className="lcb-title">{HEADLINE}</h1>
          <p className="lcb-sub">{SUBHEAD}</p>
          <div className="lcb-media">
            {HERO_VIMEO_ID ? (
              <iframe
                src={`https://player.vimeo.com/video/${HERO_VIMEO_ID}?autoplay=1&muted=1&loop=1&playsinline=1&title=0&byline=0&portrait=0`}
                title={`${EVENT.title} preview`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- static 37 KB WebP, fixed aspect
              <img src="/events/lcb-hero-map.webp" width={800} height={800} alt="Mindy's opportunity map: every open federal opportunity as a pin, filtered by industry" />
            )}
          </div>
          <SeatDialog label="Save My Free Seat →" />
          <p className="lcb-why">Takes 30 seconds. Join live and get <strong>{CREDITS} free Mindy credits</strong>.</p>
          <div className="lcb-cd-wrap"><Countdown /></div>
        </div>
      </section>

      {/* Below the fold: three objections, one line of credibility, one button. */}
      <section className="lcb-sec">
        <div className="lcb-wrap lcb-narrow">
          <h2 className="lcb-h2">Before you ask</h2>
          <ul className="lcb-obj">
            {OBJECTIONS.map(([q, a]) => (
              <li key={q}><strong>{q}</strong><p>{a}</p></li>
            ))}
          </ul>
          <p className="lcb-host-line">Hosted by <strong>Eric Coffie</strong>, founder of GovCon Giants, who has spent 8 years teaching small businesses to win federal contracts.</p>
          <div className="lcb-center"><a className="lcb-cta" href="#register">Save My Free Seat →</a></div>
        </div>
      </section>

      <footer className="lcb-legal">
        <div className="lcb-wrap">
          <p>© 2026 Mindy · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
          <p>By registering you agree to receive emails about this event from Mindy. You can unsubscribe at any time. Text reminders are sent only if you check the box. Results shown in the training are examples and are not a guarantee of contract awards.</p>
        </div>
      </footer>
    </main>
  );
}

const LCB_CSS = `
.lcb{--lcb-gold:var(--mp-warn-line);--lcb-soft:rgba(255,255,255,.82);font-family:var(--mp-font-sans);color:var(--mp-ink);background:var(--mp-surface)}
.lcb *{box-sizing:border-box}
.lcb-wrap{max-width:1160px;margin:0 auto;padding-left:max(24px, env(safe-area-inset-left, 0px));padding-right:max(24px, env(safe-area-inset-right, 0px))}
.lcb-hero{background:var(--mp-navy);color:#fff;padding:36px 0 56px}
.lcb-bar{background:var(--mp-navy);color:#fff;text-align:center;padding:10px 16px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.lcb-hero-col{max-width:880px;text-align:center}
.lcb-kicker{margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--lcb-gold)}
.lcb-title{margin:0;font-family:var(--mp-font-sans);font-weight:700;font-size:clamp(30px,4.4vw,52px);line-height:1.06;letter-spacing:-.01em;text-transform:uppercase;text-wrap:balance;color:#fff}
.lcb-sub{margin:18px auto 0;font-size:clamp(17px,1.8vw,20px);line-height:1.55;color:var(--lcb-soft);max-width:720px;text-wrap:pretty}
.lcb-media{margin:24px auto 0;max-width:min(480px,100%);aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:var(--mp-navy);box-shadow:0 20px 50px rgba(5,15,40,.45)}
.lcb-media img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.lcb-media iframe{display:block;width:100%;height:100%;border:0}
.lcb-why strong{color:var(--lcb-gold)}
.lcb-hero-col .lcb-cd>div{justify-content:center}
.lcb-dialog{position:fixed;inset:0;margin:auto;height:fit-content;width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:0;border:0;border-radius:18px;background:#fff;color:var(--mp-ink);box-shadow:0 24px 60px rgba(5,15,40,.45)}
.lcb-dialog::backdrop{background:rgba(5,15,40,.7)}
.lcb-dialog .mp-panel{border:0;box-shadow:none;padding:28px 24px 24px}
.lcb-dialog-x{position:absolute;top:10px;right:10px;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:10px;background:transparent;color:var(--mp-muted);cursor:pointer;z-index:1}
.lcb-dialog-x:hover{background:var(--mp-hair)}
.lcb-step-meta{display:grid;gap:6px;padding-right:40px}
.lcb-steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.lcb-steps li{font-size:12px;font-weight:600;color:var(--mp-muted);padding-top:8px;border-top:4px solid var(--mp-hair)}
.lcb-steps li.on{color:var(--mp-ink);border-top-color:var(--lcb-gold)}
.lcb-step-q{margin:0;font-family:var(--mp-font-serif);font-weight:700;font-size:24px;line-height:1.2}
.lcb-cta--hero{display:flex;width:100%;max-width:560px;margin:20px auto 0;border:0;cursor:pointer;font-size:clamp(18px,2.4vw,24px);font-weight:700;letter-spacing:.02em;text-transform:uppercase;padding:20px 24px;border-radius:14px}
.lcb-why{margin:12px 0 0;font-size:14px;color:var(--lcb-soft)}
.lcb-cd-wrap{margin-top:18px}
.lcb-cd-wrap .lcb-cd>p.mp-meta{color:var(--lcb-soft)}
.lcb-cd-wrap .lcb-cd b{color:var(--mp-ink)}
.lcb-sec{padding:64px 0}
.lcb-narrow{max-width:720px}
.lcb-h2{margin:0 0 20px;font-family:var(--mp-font-serif);font-weight:700;font-size:clamp(26px,3vw,34px);line-height:1.15;color:var(--mp-ink)}
.lcb-obj{list-style:none;margin:0;padding:0;display:grid;gap:18px}
.lcb-obj li{padding:18px 20px;border:1px solid var(--mp-hair);border-radius:14px}
.lcb-obj strong{display:block;font-size:17px;color:var(--mp-ink)}
.lcb-obj p{margin:6px 0 0;font-size:16px;line-height:1.55;color:var(--mp-body)}
.lcb-host-line{margin:24px 0 0;font-size:15px;line-height:1.55;color:var(--mp-muted)}
.lcb-center{text-align:center}
.lcb-cta{display:inline-flex;align-items:center;justify-content:center;margin-top:24px;padding:15px 30px;border-radius:12px;background:var(--lcb-gold);color:var(--mp-ink);font-weight:700;font-size:16px;text-decoration:none}
.lcb-cta:hover{background:var(--mp-warn-bg)}
.lcb-cta:focus-visible{outline:3px solid var(--mp-navy);outline-offset:3px}
.lcb-legal{border-top:1px solid var(--mp-hair);padding:24px 0 32px}
.lcb-legal p{margin:0 0 6px;font-size:12.5px;line-height:1.5;color:var(--mp-muted);max-width:820px}
.lcb-legal a{color:var(--mp-muted)}
@media (max-width:620px){
  .lcb-wrap{padding-left:max(16px, env(safe-area-inset-left, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px))}
  .lcb-hero{padding:32px 0 44px}
  .lcb-sec{padding:48px 0}
  .lcb-cta{width:100%}
}
`;
