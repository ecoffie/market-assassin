import type { Metadata } from 'next';
import { Container, Section, Eyebrow, Heading, Standfirst, Dateline } from '@/components/public-site/ui';
import MemberProof from '@/components/public-site/MemberProof';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import { countContactsByTag } from '@/lib/ghl/event-registration';
import RegistrationForm from './RegistrationForm';
import Countdown from './Countdown';

const URL = `https://getmindy.ai${EVENT.path}`;
const DESCRIPTION =
  'A free live event with Eric Coffie: how small businesses find and win federal contracts without the busywork, with Mindy doing the heavy lifting. Saturday, November 28, 2026.';

export const metadata: Metadata = {
  title: `${EVENT.title} — Free Live Event | Mindy`,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: { title: EVENT.title, description: DESCRIPTION, url: URL, siteName: 'Mindy', type: 'website' },
  twitter: { card: 'summary_large_image', title: EVENT.title, description: DESCRIPTION },
};

// The registrant count in the proof line is re-read from GHL at most every 5 minutes.
export const revalidate = 300;

/**
 * Conversion pass 2 (2026-11-13), from what high-converting live-event pages share: an outcome
 * headline (not the bonus), the date in several time zones, live social proof (real registrant
 * count, seat limit), a concrete agenda, who it's for, the host, an FAQ for the usual objections,
 * and a second button at the bottom. Every claim on the page is a real number or a fact we hold.
 */
const PITCH =
  'Eric Coffie shows you, live, how small businesses find the right government contracts in minutes instead of hours, with Mindy doing the heavy lifting.';

const AGENDA = [
  ['How to find contracts that fit your business', 'without searching SAM.gov for hours.'],
  ['How to tell a contract you can win from one you can’t', 'before you spend a week on a proposal.'],
  ['How to see what an agency already spends and who holds the contract now', 'so you know who to call.'],
  ['A live look at Mindy doing it on real businesses', 'bring your NAICS code and you might see yours.'],
] as const;

const FOR_YOU = [
  'You run a small business and want your first federal contract',
  'You’ve bid before but spend too much time hunting for the right ones',
  'You’re registered in SAM.gov, or about to be',
] as const;

const FAQS = [
  ['Is it really free?', 'Yes. No credit card, nothing to buy to attend.'],
  ['How long is it?', 'About 2 hours, from 11:00 AM to 1:00 PM ET, with time for questions.'],
  ['Will there be a replay?', 'Registrants get the replay by email. The $50 in Mindy credits is for people who attend live.'],
  ['Do I need to be registered in SAM.gov?', 'No. It helps to know your NAICS code (the code for what your business does), but you can come without it.'],
  ['How do I join?', 'Your personal join link comes by email as soon as you register, and again before we go live.'],
] as const;

/** "280+" from a real count, rounded down to the nearest 10. Null when the count is unknown or small. */
async function registrantLabel(): Promise<string | null> {
  try {
    const n = await countContactsByTag(EVENT.ghlTag);
    return n >= 50 ? `${Math.floor(n / 10) * 10}+` : null;
  } catch {
    return null;
  }
}

export default async function LazyContractorsBlueprintPage() {
  const registered = await registrantLabel();
  return (
    <main>
      <style dangerouslySetInnerHTML={{ __html: LCB_CSS }} />
      <Section>
        <Container>
          <div className="lcb-grid">
            <div>
              <Eyebrow accent>Free live event · {EVENT.title}</Eyebrow>
              <Heading as="h1" variant="display">Win federal contracts without the busywork.</Heading>
              <Standfirst className="lcb-wide" style={{ marginTop: 16 }}>{PITCH}</Standfirst>
              <Dateline style={{ marginTop: 18 }}>{EVENT.dateLabel}</Dateline>
              <p className="lcb-tz">11:00 AM ET · 10:00 AM CT · 9:00 AM MT · 8:00 AM PT · Live online</p>
              <p className="lcb-bonus"><strong>Bonus:</strong> show up live and get $50 in free Mindy credits.</p>
              {registered && (
                <p className="lcb-proof">
                  <strong>{registered} contractors</strong> have saved a seat · {EVENT.zoomCapacity} live seats
                </p>
              )}
              <div className="lcb-wide"><Countdown /></div>
            </div>
            {/* On phones the grid stacks: the short form comes right after the headline block. */}
            <RegistrationForm />
            <div className="lcb-detail">
              {/* Phones: the pitch and countdown sit under the form so the form stays near the top. */}
              <div className="lcb-narrow">
                <Standfirst>{PITCH}</Standfirst>
                <Countdown />
              </div>
              <h2 className="lcb-h2">What you&apos;ll learn</h2>
              <ul className="lcb-list">
                {AGENDA.map(([b, rest]) => (
                  <li key={b}><strong>{b}</strong>, {rest}</li>
                ))}
              </ul>

              <h2 className="lcb-h2">This is for you if</h2>
              <ul className="lcb-list lcb-ticks">
                {FOR_YOU.map((t) => <li key={t}>{t}</li>)}
              </ul>

              <h2 className="lcb-h2">Your host</h2>
              <div className="lcb-host">
                <span className="lcb-avatar" aria-hidden="true">EC</span>
                <div>
                  <p className="lcb-host-name">Eric Coffie</p>
                  <p className="mp-meta" style={{ margin: 0 }}>Founder of GovCon Giants and Mindy · Host of The GovCon Giants Podcast</p>
                  <p className="mp-prose" style={{ marginTop: 10 }}>
                    Eric has spent 8 years teaching small businesses how to win federal contracts. The big
                    contractors have whole teams hunting for deals every day. Mindy is how a small business
                    gets the same reach, and on {`${EVENT.shortDate} he’ll`} show you how it works, step by step.
                  </p>
                </div>
              </div>
              <MemberProof align="left" />

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
                <a className="mp-btn mp-btn--primary" href="#register">Save My Free Seat</a>
                <p className="mp-meta" style={{ margin: 0 }}>Free. No credit card. Takes 10 seconds.</p>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </main>
  );
}

// Desktop: copy left (headline + details), form right and sticky while you read. Phones: one column
// in source order — headline block, FORM, then the details and a second button at the end.
const LCB_CSS = `
.lcb-grid{display:grid;gap:28px 48px;align-items:start}
@media (min-width:900px){
  .lcb-grid{grid-template-columns:minmax(0,1fr) minmax(0,440px)}
  .lcb-grid>:nth-child(2){grid-column:2;grid-row:1 / span 2;position:sticky;top:24px}
  .lcb-grid>:nth-child(3){grid-column:1;grid-row:2}
}
.lcb-narrow{display:grid;gap:4px}
@media (min-width:900px){.lcb-narrow{display:none}}
@media (max-width:899px){.lcb-wide{display:none}}
.lcb-tz{margin:6px 0 0;font:14px/1.5 var(--mp-font-sans);color:var(--mp-muted)}
.lcb-bonus{margin:16px 0 0;font:16px/1.5 var(--mp-font-sans);color:var(--mp-ink)}
.lcb-proof{margin:10px 0 0;font:15px/1.5 var(--mp-font-sans);color:var(--mp-body)}
.lcb-proof strong,.lcb-bonus strong{color:var(--mp-ink);font-weight:700}
.lcb-detail{min-width:0}
.lcb-h2{margin:36px 0 12px;font:700 22px/1.25 var(--mp-font-sans);color:var(--mp-ink)}
.lcb-detail>.lcb-narrow+.lcb-h2,.lcb-detail>.lcb-h2:first-child{margin-top:8px}
@media (max-width:899px){.lcb-detail>.lcb-narrow+.lcb-h2{margin-top:36px}}
.lcb-list{margin:0;padding-left:20px;display:grid;gap:10px;font:16px/1.55 var(--mp-font-sans);color:var(--mp-body)}
.lcb-list strong{color:var(--mp-ink);font-weight:600}
.lcb-ticks{list-style:none;padding-left:0}
.lcb-ticks li{position:relative;padding-left:28px}
.lcb-ticks li::before{content:"✓";position:absolute;left:0;top:1px;width:20px;height:20px;border-radius:50%;background:var(--mp-ok-bg);color:var(--mp-ok);font-size:12px;font-weight:700;display:grid;place-items:center}
.lcb-host{display:flex;gap:16px;align-items:flex-start}
.lcb-avatar{flex:none;width:56px;height:56px;border-radius:50%;background:var(--mp-navy);color:#fff;display:grid;place-items:center;font:700 18px var(--mp-font-sans)}
.lcb-host-name{margin:0;font:700 17px var(--mp-font-sans);color:var(--mp-ink)}
.lcb-faq{display:grid;border-top:1px solid var(--mp-hair)}
.lcb-faq details{border-bottom:1px solid var(--mp-hair);padding:14px 0}
.lcb-faq summary{cursor:pointer;font:600 16px var(--mp-font-sans);color:var(--mp-ink)}
.lcb-faq p{margin:8px 0 0;font:15px/1.55 var(--mp-font-sans);color:var(--mp-body)}
.lcb-final{margin-top:36px;padding:24px;border:1px solid var(--mp-line);border-radius:16px;background:var(--mp-navy-wash);display:grid;gap:12px;justify-items:start}
.lcb-final-h{margin:0;font:700 18px var(--mp-font-sans);color:var(--mp-ink)}
`;
