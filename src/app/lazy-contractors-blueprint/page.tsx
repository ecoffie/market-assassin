import type { Metadata } from 'next';
import LogoMarquee from '@/components/public-site/LogoMarquee';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import { countContactsByTag } from '@/lib/ghl/event-registration';
import { readMemberProof } from '@/lib/admin/member-wins-snapshot';
import { proofCount, proofDollars } from '@/lib/admin/member-proof-format';
import RegistrationForm from './RegistrationForm';
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

// The registrant count and member numbers are re-read at most every 5 minutes.
export const revalidate = 300;

/**
 * Conversion pass 3 (2026-11-13), laid out like a big online-conference page (Marketo's): a dark
 * hero with the title, date and form; a band of big numbers; the data sources; what you'll learn
 * and the host; reasons to attend; FAQ; a final button. Every number is real: the registrant count
 * from GHL, member numbers from the member-wins snapshot, credits from the event config. A number
 * we can't read is left out, never shown as 0. Credits are stated as credits, never as dollars.
 */
const PITCH =
  'Win federal contracts without the busywork. Eric Coffie shows you, live, how small businesses find the right government contracts in minutes, with Mindy doing the heavy lifting.';

const AGENDA = [
  ['Find contracts that fit your business', 'without searching SAM.gov for hours.'],
  ['Tell a contract you can win from one you can’t', 'before you spend a week on a proposal.'],
  ['See what an agency already spends and who holds the contract now', 'so you know who to call.'],
  ['Watch Mindy do it live on real businesses', 'bring your NAICS code and you might see yours.'],
] as const;

const REASONS = [
  { icon: 'screen', title: 'Live demo', body: 'Watch Mindy find real contracts for real small businesses, start to finish.' },
  { icon: 'gift', title: `${CREDITS} free credits`, body: 'Every live attendee gets free Mindy credits to run it on their own business.' },
  { icon: 'chat', title: 'Ask Eric anything', body: 'Bring your questions about finding, bidding and winning federal work.' },
  { icon: 'check', title: 'Leave with a plan', body: 'Know which contracts to go after next and who to talk to.' },
] as const;

const FAQS = [
  ['Is it really free?', 'Yes. No credit card, nothing to buy to attend.'],
  ['How long is it?', 'About 2 hours, from 11:00 AM to 1:00 PM ET, with time for questions.'],
  ['Will there be a replay?', `Registrants get the replay by email. The ${CREDITS} free Mindy credits are for people who attend live.`],
  ['Do I need to be registered in SAM.gov?', 'No. It helps to know your NAICS code (the code for what your business does), but you can come without it.'],
  ['How do I join?', 'Your personal join link comes by email as soon as you register, and again before we go live.'],
] as const;

type Stat = { value: string; label: string };

/** Real numbers only; each one is dropped if its source can't be read. */
async function stats(): Promise<{ list: Stat[]; registered: string | null }> {
  const [regs, proof] = await Promise.all([
    countContactsByTag(EVENT.ghlTag).catch(() => null),
    readMemberProof().catch(() => null),
  ]);
  const registered = regs !== null && regs >= 50 ? `${Math.floor(regs / 10) * 10}+` : null;
  const list: Stat[] = [];
  if (registered) list.push({ value: registered, label: 'Contractors registered' });
  if (proof && proof.members > 0) list.push({ value: proofCount(proof.members), label: 'Contractors use Mindy' });
  if (proof && proof.lifetimeDollars > 0) list.push({ value: proofDollars(proof.lifetimeDollars), label: 'In federal contracts won by Mindy members' });
  list.push({ value: CREDITS, label: 'Free credits for live attendees' });
  return { list, registered };
}

function Icon({ name }: { name: (typeof REASONS)[number]['icon'] }) {
  const p = {
    screen: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4M7 12l3-3 2 2 4-4" /></>,
    gift: <><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M3 12h18M12 8v13M12 8c-2-4-6-4-6-1.5S9 8 12 8c3 0 6-1 6-1.5S14 4 12 8" /></>,
    chat: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12h5" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>,
  }[name];
  return <svg viewBox="0 0 24 24" aria-hidden="true">{p}</svg>;
}

export default async function LazyContractorsBlueprintPage() {
  const { list, registered } = await stats();
  return (
    <main className="lcb">
      <style dangerouslySetInnerHTML={{ __html: LCB_CSS }} />

      {/* Hero: title, date and the form, all above the fold. */}
      <section className="lcb-hero">
        <div className="lcb-wrap lcb-hero-grid">
          <div className="lcb-hero-copy">
            <p className="lcb-kicker">Mindy presents · Free live event</p>
            <h1 className="lcb-title">{EVENT.title}</h1>
            <p className="lcb-sub lcb-wide">{PITCH}</p>
            <p className="lcb-date">{EVENT.dateLabel}</p>
            <p className="lcb-tz">11:00 AM ET · 10:00 AM CT · 9:00 AM MT · 8:00 AM PT · Live online</p>
            <p className="lcb-bonus">Show up live and get <strong>{CREDITS} free Mindy credits</strong>.</p>
            <div className="lcb-cd-wrap lcb-wide"><Countdown /></div>
          </div>
          <RegistrationForm />
          {/* Phones: the pitch and countdown come after the form so the form stays near the top. */}
          <div className="lcb-hero-copy lcb-narrow-only">
            <p className="lcb-sub">{PITCH}</p>
            <div className="lcb-cd-wrap"><Countdown /></div>
          </div>
        </div>
      </section>

      {/* Big numbers. */}
      <section className="lcb-stats">
        <div className="lcb-wrap">
          <ul className="lcb-stat-row">
            {list.map((s) => (
              <li key={s.label}><b>{s.value}</b><span>{s.label}</span></li>
            ))}
          </ul>
          <p className="lcb-stats-line">
            {registered ? `Join ${registered} contractors learning the easiest way to win federal contracts.` : 'Learn the easiest way to win federal contracts.'}
          </p>
          <p className="lcb-stats-note">Can&apos;t make it live? Register anyway and we&apos;ll email you the replay.</p>
          <a className="lcb-cta" href="#register">Save My Free Seat</a>
        </div>
      </section>

      <div className="lcb-wrap"><LogoMarquee title="Mindy is built on the official federal record" /></div>

      {/* What you'll learn + the host. */}
      <section className="lcb-sec">
        <div className="lcb-wrap lcb-two">
          <div>
            <h2 className="lcb-h2">What you&apos;ll learn</h2>
            <ol className="lcb-agenda">
              {AGENDA.map(([b, rest], i) => (
                <li key={b}><span className="lcb-n">{i + 1}</span><p><strong>{b}</strong>, {rest}</p></li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="lcb-h2">Your host</h2>
            <div className="lcb-host">
              <span className="lcb-avatar" aria-hidden="true">EC</span>
              <div>
                <p className="lcb-host-name">Eric Coffie</p>
                <p className="lcb-host-role">Founder of GovCon Giants and Mindy · Host of The GovCon Giants Podcast</p>
              </div>
            </div>
            <p className="lcb-p">
              Eric has spent 8 years teaching small businesses how to win federal contracts. The big
              contractors have whole teams hunting for deals every day. Mindy gives a small business the
              same reach, and on {`${EVENT.shortDate} he’ll`} show you how it works, step by step.
            </p>
            <h3 className="lcb-h3">This is for you if</h3>
            <ul className="lcb-ticks">
              <li>You run a small business and want your first federal contract</li>
              <li>You&apos;ve bid before but spend too long hunting for the right ones</li>
              <li>You&apos;re registered in SAM.gov, or about to be</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Reasons to attend. */}
      <section className="lcb-reasons">
        <div className="lcb-wrap">
          <h2 className="lcb-h2 lcb-center">Top reasons to attend</h2>
          <ul className="lcb-reason-grid">
            {REASONS.map((r) => (
              <li key={r.title}><span className="lcb-ic"><Icon name={r.icon} /></span><h3>{r.title}</h3><p>{r.body}</p></li>
            ))}
          </ul>
          <div className="lcb-center"><a className="lcb-cta" href="#register">Save My Free Seat</a></div>
        </div>
      </section>

      {/* FAQ + final button. */}
      <section className="lcb-sec">
        <div className="lcb-wrap lcb-narrow">
          <h2 className="lcb-h2">Questions</h2>
          <div className="lcb-faq">
            {FAQS.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
          <div className="lcb-final">
            <p className="lcb-final-h">{EVENT.dateLabel} · 11:00 AM ET</p>
            <a className="lcb-cta" href="#register">Save My Free Seat</a>
            <p className="lcb-final-note">Free. No credit card. Takes 10 seconds.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

const LCB_CSS = `
.lcb{--lcb-deep:var(--mp-navy-hover);--lcb-gold:var(--mp-warn-line);--lcb-soft:rgba(255,255,255,.82);font-family:var(--mp-font-sans);color:var(--mp-ink);background:var(--mp-surface)}
.lcb *{box-sizing:border-box}
.lcb-wrap{max-width:1160px;margin:0 auto;padding-left:max(24px, env(safe-area-inset-left, 0px));padding-right:max(24px, env(safe-area-inset-right, 0px))}
.lcb-hero{background:var(--mp-navy);color:#fff;padding:64px 0 72px;scroll-margin-top:0}
.lcb-hero-grid{display:grid;gap:36px;align-items:start}
@media (min-width:900px){.lcb-hero-grid{grid-template-columns:minmax(0,1fr) minmax(0,420px);gap:56px}}
.lcb-hero-copy{min-width:0}
.lcb-kicker{margin:0 0 14px;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--mp-warn-line)}
.lcb-title{margin:0;font-family:var(--mp-font-serif);font-weight:700;font-size:clamp(38px,5.4vw,64px);line-height:1.04;letter-spacing:-.02em;text-wrap:balance;color:#fff}
.lcb-sub{margin:18px 0 0;font-size:clamp(17px,1.8vw,20px);line-height:1.5;color:var(--lcb-soft);max-width:600px}
.lcb-date{margin:26px 0 0;font-size:15px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.lcb-tz{margin:6px 0 0;font-size:15px;color:var(--lcb-soft)}
.lcb-bonus{margin:18px 0 0;font-size:17px;color:#fff}
.lcb-bonus strong{color:var(--lcb-gold)}
.lcb-cd-wrap .lcb-cd>p.mp-meta{color:var(--lcb-soft)}
.lcb-cd-wrap .lcb-cd b{color:var(--mp-ink)}
@media (min-width:900px){.lcb-narrow-only{display:none}.lcb-hero-grid>.lcb-hero-copy:first-child{grid-row:1 / span 2}}
@media (max-width:899px){.lcb-wide{display:none}.lcb-narrow-only .lcb-sub{margin-top:0}}
.lcb-hero .mp-panel{background:#fff;color:var(--mp-ink);border-radius:18px;box-shadow:0 24px 60px rgba(5,15,40,.45);border:0;scroll-margin-top:24px}
.lcb-stats{background:var(--lcb-deep);color:#fff;padding:56px 0 64px;text-align:center}
.lcb-stat-row{list-style:none;margin:0;padding:0;display:grid;gap:28px;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))}
.lcb-stat-row b{display:block;font-family:var(--mp-font-serif);font-weight:700;font-size:clamp(40px,5vw,60px);line-height:1;letter-spacing:-.02em}
.lcb-stat-row span{display:block;margin:10px auto 0;max-width:220px;font-size:17px;line-height:1.35;color:var(--lcb-soft)}
.lcb-stats-line{margin:40px auto 0;max-width:680px;font-size:clamp(18px,2vw,22px);line-height:1.45}
.lcb-stats-note{margin:10px 0 0;font-size:15px;color:var(--lcb-soft)}
.lcb-cta{display:inline-flex;align-items:center;justify-content:center;margin-top:24px;padding:15px 30px;border-radius:12px;background:var(--lcb-gold);color:var(--mp-ink);font-weight:700;font-size:16px;text-decoration:none;transition:transform .15s ease,background .15s ease}
.lcb-cta:hover{background:var(--mp-warn-bg);transform:translateY(-1px)}
.lcb-cta:focus-visible{outline:3px solid var(--mp-navy);outline-offset:3px}
.lcb-sec{padding:72px 0}
.lcb-two{display:grid;gap:48px}
@media (min-width:900px){.lcb-two{grid-template-columns:1fr 1fr;gap:72px}}
.lcb-two>div{min-width:0}
.lcb-h2{margin:0 0 22px;font-family:var(--mp-font-serif);font-weight:700;font-size:clamp(26px,3vw,36px);line-height:1.15;color:var(--mp-ink)}
.lcb-h3{margin:28px 0 12px;font-size:17px;font-weight:700;color:var(--mp-ink)}
.lcb-center{text-align:center}
.lcb-agenda{list-style:none;margin:0;padding:0;display:grid;gap:18px}
.lcb-agenda li{display:flex;gap:14px;align-items:flex-start}
.lcb-agenda p{margin:0;font-size:17px;line-height:1.5;color:var(--mp-body)}
.lcb-agenda strong{color:var(--mp-ink)}
.lcb-n{flex:none;width:32px;height:32px;border-radius:50%;background:var(--mp-navy);color:#fff;display:grid;place-items:center;font-weight:700;font-size:15px}
.lcb-host{display:flex;gap:16px;align-items:center}
.lcb-avatar{flex:none;width:72px;height:72px;border-radius:50%;background:var(--mp-navy);color:#fff;display:grid;place-items:center;font:700 22px var(--mp-font-sans)}
.lcb-host-name{margin:0;font-size:20px;font-weight:700}
.lcb-host-role{margin:4px 0 0;font-size:14px;color:var(--mp-muted)}
.lcb-p{margin:18px 0 0;font-size:16px;line-height:1.6;color:var(--mp-body)}
.lcb-ticks{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.lcb-ticks li{position:relative;padding-left:28px;font-size:16px;line-height:1.5;color:var(--mp-body)}
.lcb-ticks li::before{content:"✓";position:absolute;left:0;top:2px;width:20px;height:20px;border-radius:50%;background:var(--mp-ok-bg);color:var(--mp-ok);font-size:12px;font-weight:700;display:grid;place-items:center}
.lcb-reasons{background:var(--mp-navy);color:#fff;padding:72px 0}
.lcb-reasons .lcb-h2{color:#fff}
.lcb-reasons .lcb-cta:focus-visible{outline-color:#fff}
.lcb-reason-grid{list-style:none;margin:16px 0 8px;padding:0;display:grid;gap:28px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));text-align:center}
.lcb-ic{display:inline-grid;place-items:center;width:72px;height:72px;border-radius:18px;border:1.5px solid rgba(255,255,255,.35)}
.lcb-ic svg{width:36px;height:36px;fill:none;stroke:#fff;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.lcb-reason-grid h3{margin:16px 0 0;font-size:19px;font-weight:700}
.lcb-reason-grid p{margin:8px auto 0;max-width:240px;font-size:15px;line-height:1.5;color:var(--lcb-soft)}
.lcb-narrow{max-width:760px}
.lcb-faq{display:grid;border-top:1px solid var(--mp-hair)}
.lcb-faq details{border-bottom:1px solid var(--mp-hair);padding:16px 0}
.lcb-faq summary{cursor:pointer;font-size:17px;font-weight:600;color:var(--mp-ink)}
.lcb-faq p{margin:8px 0 0;font-size:16px;line-height:1.55;color:var(--mp-body)}
.lcb-final{margin-top:40px;padding:32px;border-radius:20px;background:var(--mp-navy);color:#fff;display:grid;gap:4px;justify-items:center;text-align:center}
.lcb-final .lcb-cta:focus-visible{outline-color:#fff}
.lcb-final-h{margin:0;font-size:20px;font-weight:700}
.lcb-final-note{margin:12px 0 0;font-size:14px;color:var(--lcb-soft)}
.lcb .lm{margin:56px 0 0}
@media (max-width:620px){
  .lcb-wrap{padding-left:max(16px, env(safe-area-inset-left, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px))}
  .lcb-hero{padding:36px 0 48px}
  .lcb-sec,.lcb-reasons{padding:56px 0}
  .lcb-cta{width:100%}
}
@media (prefers-reduced-motion: reduce){.lcb-cta{transition:none}}
`;
