'use client';

/**
 * Event Action Plan landing: what the template contains, a sign-up form, then the download.
 * A returning visitor who already signed up (localStorage) sees the download straight away.
 */
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { EVENT_PLAN_TEMPLATE_URL } from '@/lib/events/event-action-plan';

const STORE_KEY = 'mindy_event_plan_signup';

function readAttribution(): unknown {
  try {
    const raw = localStorage.getItem('gca_attribution');
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

const INSIDE: ReadonlyArray<[string, string]> = [
  ['Critical deadlines', 'Registration cutoffs, pre-event sessions you must attend to get 1:1s, and the certification check to do now.'],
  ['Your 30-second pitch', 'A fill-in script that ends with a question, so the buyer starts talking.'],
  ['What you sell and who buys it', 'Each service line with its NAICS and PSC codes, matched to the buyers at the event.'],
  ['Before you arrive', 'What to register for, which sessions to watch and how to book roundtables and 1:1s.'],
  ['Day-by-day plan', 'Every session ranked by priority, with what to do and the exact questions to ask.'],
  ['What not to do', 'The mistakes that cost small businesses credibility on the floor.'],
  ['Open items checklist', 'Certifications, SAM codes, partners, bonding and past performance to sort out first.'],
  ['Follow-up tracker', 'Who you met, their email and the next step, sent within 48 hours.'],
];

const STEPS: ReadonlyArray<[string, string]> = [
  ['Download the template', 'An editable Word document. Every company and event detail is a [bracket] you replace.'],
  ['Fill it from the agenda', 'Use the event agenda and opportunity list. Mindy shows the forecasts, open bids and buyers for your codes.'],
  ['Print it and bring it', 'Keep it to a few pages. Rank every session so you know where to be.'],
];

const CSS = `
.ep-hero{background:var(--mp-navy-wash);border-bottom:1px solid var(--mp-line)}
.ep-in{max-width:1040px;margin:0 auto}
.ep-hero .ep-in{padding:40px 0 48px;display:grid;gap:32px;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);align-items:start}
@media (max-width:860px){.ep-hero .ep-in{grid-template-columns:1fr;padding:28px 0 36px}}
.ep-copy{display:grid;gap:14px;min-width:0}
.ep-kicker{font:700 11px var(--mp-font-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--mp-navy);margin:0}
.ep-h1{font:700 clamp(2.1rem,5vw,3.3rem)/1.05 var(--mp-font-sans);letter-spacing:-.03em;color:var(--mp-ink);margin:0;text-wrap:balance}
.ep-lede{font:400 18px/1.55 var(--mp-font-sans);color:var(--mp-body);margin:0;max-width:52ch}
.ep-points{list-style:none;margin:4px 0 0;padding:0;display:grid;gap:8px}
.ep-points li{display:flex;gap:10px;font:500 15px/1.5 var(--mp-font-sans);color:var(--mp-body)}
.ep-points li::before{content:"✓";color:var(--mp-ok);font-weight:700}
.ep-card{background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:14px;padding:24px;display:grid;gap:14px;min-width:0}
.ep-card h2{font:700 22px/1.2 var(--mp-font-sans);color:var(--mp-ink);margin:0}
.ep-field{display:grid;gap:6px}
.ep-field label{font:600 13px var(--mp-font-sans);color:var(--mp-ink)}
.ep-field input{font:400 15px var(--mp-font-sans);color:var(--mp-ink);background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:10px;padding:11px 12px;width:100%;box-sizing:border-box}
.ep-field input:focus-visible{outline:2px solid var(--mp-navy);outline-offset:1px}
.ep-row{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.ep-btn{display:inline-flex;align-items:center;justify-content:center;padding:13px 22px;border-radius:999px;border:1px solid var(--mp-navy);background:var(--mp-navy);color:var(--mp-surface);font:600 15px var(--mp-font-sans);text-decoration:none;cursor:pointer}
.ep-btn:hover{background:var(--mp-navy-hover)}
.ep-btn[disabled]{opacity:.6;cursor:default}
.ep-btn--ghost{background:var(--mp-surface);color:var(--mp-navy)}
.ep-btn--ghost:hover{background:var(--mp-navy-wash)}
.ep-meta{font:400 13px/1.5 var(--mp-font-sans);color:var(--mp-muted);margin:0}
.ep-err{font:500 14px var(--mp-font-sans);color:var(--mp-crit);margin:0}
.ep-done{display:grid;gap:12px}
.ep-body .ep-in{padding:48px 0 72px;display:grid;gap:48px}
.ep-h2{font:700 clamp(1.5rem,3.2vw,2rem)/1.15 var(--mp-font-sans);letter-spacing:-.02em;color:var(--mp-ink);margin:6px 0 0;text-wrap:balance}
.ep-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));margin-top:18px}
.ep-item{background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:12px;padding:16px;display:grid;gap:6px;align-content:start}
.ep-item b{font:700 15px var(--mp-font-sans);color:var(--mp-ink)}
.ep-item span{font:400 14px/1.5 var(--mp-font-sans);color:var(--mp-body)}
.ep-steps{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.ep-steps li{display:flex;gap:14px;align-items:flex-start;background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:12px;padding:16px}
.ep-num{width:34px;height:34px;border-radius:50%;background:var(--mp-navy);color:var(--mp-surface);font:700 13px var(--mp-font-sans);display:flex;align-items:center;justify-content:center;flex:none;font-variant-numeric:tabular-nums}
.ep-steps div b{display:block;font:700 15px var(--mp-font-sans);color:var(--mp-ink)}
.ep-steps div span{font:400 14px/1.5 var(--mp-font-sans);color:var(--mp-body)}
.ep-sample{background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:12px;margin-top:18px;overflow:hidden}
.ep-sample-row{display:grid;grid-template-columns:110px 170px minmax(0,1fr);gap:14px;padding:14px 16px;border-top:1px solid var(--mp-hair);font:400 14px/1.5 var(--mp-font-sans);color:var(--mp-body)}
.ep-sample-row:first-child{border-top:0;background:var(--mp-navy);color:var(--mp-surface);font-weight:600}
.ep-sample-row b{color:var(--mp-ink)}
.ep-pri{display:inline-block;margin-top:4px;font:700 10px var(--mp-font-sans);letter-spacing:.06em;padding:2px 8px;border-radius:999px;background:var(--mp-navy-wash);color:var(--mp-navy)}
.ep-ask{display:block;margin-top:6px;font-style:italic;color:var(--mp-ink)}
@media (max-width:640px){.ep-sample-row{grid-template-columns:1fr;gap:4px}}
.ep-close{background:var(--mp-navy);color:var(--mp-surface);border-radius:16px;padding:30px 28px;display:grid;gap:10px;justify-items:start}
.ep-close h2{font:700 clamp(1.4rem,3.2vw,1.9rem)/1.2 var(--mp-font-sans);margin:0;color:var(--mp-surface);text-wrap:balance}
.ep-close p{font:400 16px/1.55 var(--mp-font-sans);margin:0;max-width:58ch;color:var(--mp-navy-wash)}
.ep-close .ep-btn{background:var(--mp-surface);color:var(--mp-navy);border-color:var(--mp-surface)}
`;

export default function EventPlanLanding() {
  const [unlocked, setUnlocked] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as { firstName?: string } | null;
      if (s) { setUnlocked(true); setFirstName(s.firstName || ''); }
    } catch { /* storage unavailable */ }
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/event-action-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: fd.get('firstName'),
          lastName: fd.get('lastName'),
          email: fd.get('email'),
          eventName: fd.get('eventName'),
          website: fd.get('website'),
          attribution: readAttribution(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      const name = String(fd.get('firstName') || '').trim();
      setFirstName(name);
      setUnlocked(true);
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ firstName: name })); } catch { /* ignore */ }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <section className="ep-hero">
        <div className="mp-container">
          <div className="ep-in">
            <div className="ep-copy">
              <p className="ep-kicker">Free template · industry days &amp; matchmaking events</p>
              <h1 className="ep-h1">Walk into your next government event with a plan</h1>
              <p className="ep-lede">
                The action plan we build for clients before industry days and matchmaking events: what to register for,
                who to meet, what to ask, and what not to do. Download it free and make it yours.
              </p>
              <ul className="ep-points">
                <li>Every session ranked by priority</li>
                <li>Questions to ask each buyer, written out</li>
                <li>Editable Word document you can print</li>
              </ul>
            </div>

            <div className="ep-card" id="get-template">
              {unlocked ? (
                <div className="ep-done">
                  <h2>{firstName ? `Here’s your template, ${firstName}` : 'Here’s your template'}</h2>
                  <p className="ep-meta">Open it in Word or Google Docs, replace every [bracket], then print it for the event.</p>
                  <a className="ep-btn" href={EVENT_PLAN_TEMPLATE_URL} download>Download the template (.docx)</a>
                  <Link className="ep-btn ep-btn--ghost" href="/opportunity-map">Find the buyers for your plan in Mindy</Link>
                </div>
              ) : (
                <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
                  <h2>Get the free template</h2>
                  <div className="ep-row">
                    <div className="ep-field"><label htmlFor="ep-first">First name</label><input id="ep-first" name="firstName" autoComplete="given-name" required maxLength={80} /></div>
                    <div className="ep-field"><label htmlFor="ep-last">Last name</label><input id="ep-last" name="lastName" autoComplete="family-name" maxLength={80} /></div>
                  </div>
                  <div className="ep-field"><label htmlFor="ep-email">Email</label><input id="ep-email" name="email" type="email" autoComplete="email" required maxLength={254} /></div>
                  <div className="ep-field"><label htmlFor="ep-event">Which event are you preparing for? (optional)</label><input id="ep-event" name="eventName" maxLength={120} placeholder="e.g. an industry day or matchmaking event" /></div>
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                    style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
                  {error && <p className="ep-err" role="alert">{error}</p>}
                  <button className="ep-btn" type="submit" disabled={sending}>{sending ? 'Saving…' : 'Get the template'}</button>
                  <p className="ep-meta">
                    Free. We’ll send you event tips now and then. We never sell your information. See our{' '}
                    <Link href="/privacy">Privacy Policy</Link>.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="ep-body">
        <div className="mp-container">
          <div className="ep-in">
            <section aria-labelledby="ep-inside">
              <p className="ep-kicker">What’s inside</p>
              <h2 className="ep-h2" id="ep-inside">Everything you need on one plan</h2>
              <div className="ep-grid">
                {INSIDE.map(([t, b]) => (
                  <div key={t} className="ep-item"><b>{t}</b><span>{b}</span></div>
                ))}
              </div>
            </section>

            <section aria-labelledby="ep-sample">
              <p className="ep-kicker">A look inside</p>
              <h2 className="ep-h2" id="ep-sample">Each session gets a priority, a job and the questions to ask</h2>
              <div className="ep-sample" role="table" aria-label="Sample rows from the day-by-day plan">
                <div className="ep-sample-row" role="row"><span role="columnheader">Time</span><span role="columnheader">Session</span><span role="columnheader">What to do</span></div>
                <div className="ep-sample-row" role="row">
                  <span role="cell">0630</span>
                  <span role="cell"><b>On-site scheduling desk</b><br /><span className="ep-pri">PRIORITY 2</span></span>
                  <span role="cell">The highest-value 15 minutes of your morning. Fill your empty 1:1 slots.<span className="ep-ask">“We need 1:1s with [buyer] and [buyer]. Who is in the system?”</span></span>
                </div>
                <div className="ep-sample-row" role="row">
                  <span role="cell">0900 – 1145</span>
                  <span role="cell"><b>Key leader roundtable</b><br /><span className="ep-pri">PRIORITY 1</span></span>
                  <span role="cell">Your most important conversation of the week. Leave with the name of the contracting lead for your region.<span className="ep-ask">“Which offices have [your work] coming next fiscal year, and who in contracting runs it?”</span></span>
                </div>
                <div className="ep-sample-row" role="row">
                  <span role="cell">1200 – 1300</span>
                  <span role="cell"><b>Lunch</b></span>
                  <span role="cell">Sit with prime contractors, not other small businesses.</span>
                </div>
              </div>
            </section>

            <section aria-labelledby="ep-how">
              <p className="ep-kicker">How to use it</p>
              <h2 className="ep-h2" id="ep-how">Three steps before the event</h2>
              <ol className="ep-steps">
                {STEPS.map(([t, b], i) => (
                  <li key={t}><span className="ep-num">{String(i + 1).padStart(2, '0')}</span><div><b>{t}</b><span>{b}</span></div></li>
                ))}
              </ol>
            </section>

            <section className="ep-close">
              <h2>Know which buyers to meet before you get there</h2>
              <p>
                Mindy shows the forecasts, open bids and expiring contracts for your industry codes, so the “who buys it” part of
                your plan takes minutes instead of days.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <a className="ep-btn" href={unlocked ? EVENT_PLAN_TEMPLATE_URL : '#get-template'} {...(unlocked ? { download: true } : {})}>
                  {unlocked ? 'Download the template' : 'Get the free template'}
                </a>
                <Link className="ep-btn ep-btn--ghost" href="/roadmap" style={{ background: 'transparent', color: 'var(--mp-surface)', borderColor: 'var(--mp-surface)' }}>
                  See the 2027 Roadmap
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
