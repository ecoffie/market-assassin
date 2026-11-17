'use client';

/**
 * 2027 Federal Contracting Roadmap, presented by Mindy (rebranded 2026-11-16 to match the
 * 2027 roadmap PDF/web page: navy-wash hero band, numbered navy step cards with checkboxes).
 *
 * Personalized roadmap: contact details first, then six questions, then "You are here" with the
 * person's stage, its steps and what comes next. The stage is computed from the answers with the
 * same function the API uses (stageFromAnswers), so the screen and the GHL tag always agree.
 */
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button, Field, Input } from '@/components/public-site/ui';
import NoRefundNote from '@/components/NoRefundNote';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import {
  QUIZ, ROADMAP_STAGES, stageByNumber, stageFromAnswers, stageSteps,
  type QuizAnswers, type StageNumber,
} from '@/lib/course/govcon-roadmap';

const STORE_KEY = 'mindy_govcon_roadmap';
/** Per-browser checkmarks on the result page's steps, keyed by Action Plan step id. */
const CHECKS_KEY = 'mindy_govcon_roadmap_checks';

function readAttribution(): unknown {
  try {
    const raw = localStorage.getItem('gca_attribution');
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

const CSS = `
.rm-hero{background:var(--mp-navy-wash);border-bottom:1px solid var(--mp-line)}
.rm-hero-in{max-width:760px;margin:0 auto;padding:28px 0 34px;display:grid;gap:14px}
.rm-hero-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.rm-ed{font:600 12px var(--mp-font-sans);color:var(--mp-navy);border:1px solid var(--mp-line);background:var(--mp-surface);padding:5px 12px;border-radius:999px}
.rm-kicker{font:700 11px var(--mp-font-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--mp-navy);margin:6px 0 0}
.rm-h1{font:700 clamp(2.1rem,5.5vw,3.4rem)/1.04 var(--mp-font-sans);letter-spacing:-.03em;color:var(--mp-ink);margin:0;max-width:16ch;text-wrap:balance}
.rm-hero[data-compact="true"] .rm-h1{font-size:clamp(1.5rem,3.5vw,2rem);max-width:none}
.rm-by{display:inline-flex;align-items:center;gap:6px;font:500 15px var(--mp-font-sans);color:var(--mp-navy);margin:0}
.rm-by b{color:var(--mp-ink);font-weight:700}
.rm-lede{font:400 17px/1.5 var(--mp-font-sans);color:var(--mp-body);max-width:52ch;margin:0}
.rm-wrap{max-width:760px;margin:0 auto;padding:32px 0 80px}
.rm-h2{font:700 clamp(1.5rem,3.4vw,2rem)/1.15 var(--mp-font-sans);letter-spacing:-.02em;color:var(--mp-ink);margin:8px 0 0;text-wrap:balance}
.rm-card{background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:14px;padding:24px;box-shadow:0 6px 18px rgba(27,58,107,.06)}
.rm-opts{display:grid;gap:10px;margin-top:16px}
.rm-opt{text-align:left;padding:14px 16px;border-radius:12px;border:1.5px solid var(--mp-line);background:var(--mp-surface);font:600 15px var(--mp-font-sans);color:var(--mp-ink);cursor:pointer}
.rm-opt:hover{border-color:var(--mp-navy);background:var(--mp-navy-wash)}
.rm-progress{height:8px;border-radius:999px;background:var(--mp-hair);overflow:hidden;margin-top:12px}
.rm-progress span{display:block;height:100%;background:var(--mp-navy);transition:width .3s}
.rm-ladder{list-style:none;margin:22px 0 0;padding:0;display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(100px,1fr))}
.rm-ladder li{display:grid;gap:4px;align-content:start;padding:10px 12px;border-radius:12px;border:1px solid var(--mp-line);background:var(--mp-surface);font:600 13px/1.25 var(--mp-font-sans);color:var(--mp-muted)}
.rm-ladder li small{font:700 10px var(--mp-font-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--mp-subtle)}
.rm-ladder li[data-here="true"]{border:1.5px solid var(--mp-navy);background:var(--mp-navy-wash);color:var(--mp-ink)}
.rm-ladder li[data-here="true"] small{color:var(--mp-navy)}
.rm-ladder li[data-done="true"] small::after{content:" ✓";color:var(--mp-ok)}
.rm-here{display:inline-block;justify-self:start;white-space:nowrap;font:700 9px var(--mp-font-sans);letter-spacing:.04em;text-transform:uppercase;background:var(--mp-navy);color:#FFFFFF;padding:3px 8px;border-radius:999px;margin-top:2px}
.rm-label{font:700 11px var(--mp-font-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--mp-navy);margin:26px 0 10px}
.rm-job{font:400 16px/1.6 var(--mp-font-sans);color:var(--mp-body);margin:0}
.rm-steplist{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.rm-step{display:flex;align-items:center;gap:14px;background:var(--mp-surface);border:1px solid var(--mp-line);border-radius:12px;padding:14px 16px;cursor:pointer}
.rm-step input{position:absolute;opacity:0;width:1px;height:1px}
.rm-num{width:36px;height:36px;border-radius:50%;background:var(--mp-navy);color:#FFFFFF;font:700 13px var(--mp-font-sans);display:flex;align-items:center;justify-content:center;flex:none;font-variant-numeric:tabular-nums}
.rm-steptxt{flex:1;min-width:0;font:600 15px/1.4 var(--mp-font-sans);color:var(--mp-ink)}
.rm-box{width:22px;height:22px;border:2px solid var(--mp-line);border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center}
.rm-step input:checked~.rm-box{background:var(--mp-ok);border-color:var(--mp-ok)}
.rm-step input:checked~.rm-box::after{content:"✓";font:700 14px var(--mp-font-sans);color:#FFFFFF}
.rm-step input:checked~.rm-steptxt{color:var(--mp-muted);text-decoration:line-through}
.rm-step input:focus-visible~.rm-box{outline:2px solid var(--mp-navy);outline-offset:2px}
.rm-ready{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.rm-ready li{display:flex;gap:10px;font:500 15px/1.5 var(--mp-font-sans);color:var(--mp-body)}
.rm-ready li::before{content:"→";color:var(--mp-navy);font-weight:700}
.rm-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.rm-link{display:inline-flex;align-items:center;padding:12px 20px;border-radius:999px;border:1px solid var(--mp-line);background:var(--mp-surface);color:var(--mp-ink);font:600 14px var(--mp-font-sans);text-decoration:none;cursor:pointer}
.rm-link--primary{background:var(--mp-navy);border-color:var(--mp-navy);color:#FFFFFF}
.rm-link--primary:hover{background:var(--mp-navy-hover)}
.rm-skip{background:none;border:0;padding:8px;font:500 15px var(--mp-font-sans);color:var(--mp-muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.rm-skip:hover{color:var(--mp-ink)}
@media (prefers-reduced-motion:reduce){.rm-progress span{transition:none}}
@page{margin:0.6in}
@media print{.rm-noprint{display:none !important}.rm-hero{background:none;border:0}.rm-hero-in{padding:0 0 10px}.rm-wrap{padding:0;max-width:none}.rm-h1{font-size:26px}.rm-ladder{margin-top:10px}.rm-ladder li{padding:5px 8px;font-size:11px}.rm-card{box-shadow:none;padding:14px 18px;break-inside:avoid}.rm-step{padding:6px 10px;break-inside:avoid}.rm-num{width:24px;height:24px;font-size:11px}.rm-label{margin:12px 0 6px}}
`;

type Saved = { email: string; firstName: string; stage?: StageNumber; offerSeen?: boolean };

/** Mindy Pro checkout (records purchase attribution, then redirects to the $149/mo Stripe link). */
const PRO_CHECKOUT = '/checkout/mindy-pro-monthly';

export default function RoadmapFlow({ proCredits }: { proCredits: number }) {
  const [step, setStep] = useState<'contact' | 'offer' | 'quiz' | 'result'>('contact');
  const [saved, setSaved] = useState<Saved | null>(null);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [qi, setQi] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Returning visitor: pick up where they left off.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const s = raw ? (JSON.parse(raw) as Saved) : null;
      if (s?.email) {
        setSaved(s);
        setStep(typeof s.stage === 'number' ? 'result' : s.offerSeen ? 'quiz' : 'offer');
      }
    } catch { /* storage unavailable: start fresh */ }
  }, []);

  function remember(s: Saved) {
    setSaved(s);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }

  async function onContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/course/roadmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'signup',
          firstName: fd.get('firstName'),
          lastName: fd.get('lastName'),
          email: fd.get('email'),
          phone: fd.get('phone'),
          smsConsent: fd.get('smsConsent') === 'on',
          website: fd.get('website'),
          attribution: readAttribution(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      remember({ email: String(fd.get('email') || '').trim().toLowerCase(), firstName: String(fd.get('firstName') || '').trim() });
      setStep('offer');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSending(false);
    }
  }

  function answer(value: string) {
    const q = QUIZ[qi];
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    // Stop early once the ladder is decided: a "no" before the win question settles the stage.
    const decided = (q.id === 'sam' || q.id === 'basics' || q.id === 'buyers' || q.id === 'bid' || q.id === 'win') && value !== 'yes';
    if (decided || qi === QUIZ.length - 1) {
      void finish(next);
    } else {
      setQi(qi + 1);
    }
  }

  async function finish(a: QuizAnswers) {
    const stage = stageFromAnswers(a);
    if (saved) remember({ ...saved, stage });
    setStep('result');
    try {
      await fetch('/api/course/roadmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stage', email: saved?.email, answers: a }),
      });
    } catch { /* the roadmap still shows */ }
  }

  function skipOffer() {
    if (saved) remember({ ...saved, offerSeen: true });
    setStep('quiz');
    window.scrollTo(0, 0);
  }

  function retake() {
    setAnswers({});
    setQi(0);
    if (saved) remember({ email: saved.email, firstName: saved.firstName, offerSeen: true });
    setStep('quiz');
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <RoadmapHero
        compact={step === 'quiz' || step === 'offer'}
        kicker={step === 'contact' ? 'Free · takes 1 minute' : step === 'result' ? `${saved?.firstName ? `${saved.firstName}’s` : 'Your'} personalized roadmap` : 'Your personalized roadmap'}
        lede={step === 'contact' ? 'Answer six quick questions. We’ll show you which stage you are in and exactly what to do next.' : undefined}
      />
      <div className="mp-container">
      <div className="rm-wrap">
        {step === 'contact' && (
          <>
            <form className="rm-card" onSubmit={onContact} style={{ display: 'grid', gap: 16 }}>
              <h2 className="rm-h2" style={{ marginTop: 0 }}>Get your personalized roadmap</h2>
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                <Field label="First name" htmlFor="rm-first"><Input id="rm-first" name="firstName" autoComplete="given-name" required maxLength={80} /></Field>
                <Field label="Last name" htmlFor="rm-last"><Input id="rm-last" name="lastName" autoComplete="family-name" maxLength={80} /></Field>
              </div>
              <Field label="Email" htmlFor="rm-email"><Input id="rm-email" name="email" type="email" autoComplete="email" required maxLength={254} /></Field>
              <Field label="Phone" htmlFor="rm-phone"><Input id="rm-phone" name="phone" type="tel" autoComplete="tel" required maxLength={30} /></Field>
              <label className="mp-meta" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 1.5 }}>
                <input type="checkbox" name="smsConsent" style={{ marginTop: 3 }} />
                <span>Text me course updates. Message and data rates may apply. Reply STOP to opt out.</span>
              </label>
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
              {error && <p className="mp-meta" role="alert" style={{ color: 'var(--mp-crit)' }}>{error}</p>}
              <Button type="submit" disabled={sending}>{sending ? 'Saving…' : 'Start my roadmap'}</Button>
              <p className="mp-meta">
                Free. We’ll email you the course. We never sell your information. See our{' '}
                <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms</Link>.
              </p>
            </form>
          </>
        )}

        {step === 'offer' && <ProOffer proCredits={proCredits} firstName={saved?.firstName ?? ''} onSkip={skipOffer} />}

        {step === 'quiz' && (
          <>
            <p className="rm-kicker">Question {qi + 1} of {QUIZ.length}</p>
            <div className="rm-progress" aria-hidden="true"><span style={{ width: `${(qi / QUIZ.length) * 100}%` }} /></div>
            <h2 className="rm-h2" style={{ marginTop: 24 }}>{QUIZ[qi].text}</h2>
            <div className="rm-opts">
              {QUIZ[qi].options.map((o) => (
                <button key={o.value} type="button" className="rm-opt" onClick={() => answer(o.value)}>{o.label}</button>
              ))}
            </div>
            {qi > 0 && (
              <button type="button" className="rm-link" style={{ marginTop: 18 }} onClick={() => setQi(qi - 1)}>← Back</button>
            )}
          </>
        )}

        {step === 'result' && saved && typeof saved.stage === 'number' && (
          <RoadmapResult stage={saved.stage} firstName={saved.firstName} onRetake={retake} />
        )}
      </div>
      </div>
    </>
  );
}

function RoadmapHero({ compact, kicker, lede }: { compact: boolean; kicker: string; lede?: string }) {
  return (
    <section className="rm-hero" data-compact={compact}>
      <div className="mp-container">
        <div className="rm-hero-in">
          <div className="rm-hero-top">
            <p className="rm-kicker" style={{ margin: 0 }}>{kicker}</p>
            <span className="rm-ed">2027 Edition</span>
          </div>
          <h1 className="rm-h1">2027 Federal Contracting Roadmap</h1>
          <p className="rm-by">Presented by <MindyLogo size={20} /><b>Mindy</b></p>
          {lede && <p className="rm-lede">{lede}</p>}
        </div>
      </div>
    </section>
  );
}

function useStepChecks(): [Record<string, boolean>, (id: string, on: boolean) => void] {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setChecks(JSON.parse(localStorage.getItem(CHECKS_KEY) || '{}')); } catch { /* storage unavailable */ }
  }, []);
  function toggle(id: string, on: boolean) {
    setChecks((prev) => {
      const next = { ...prev, [id]: on };
      try { localStorage.setItem(CHECKS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  return [checks, toggle];
}

function RoadmapResult({ stage: n, firstName, onRetake }: { stage: StageNumber; firstName: string; onRetake: () => void }) {
  const stage = stageByNumber(n)!;
  const next = stageByNumber(n + 1);
  const steps = stageSteps(stage);
  const [checks, toggle] = useStepChecks();
  const done = steps.filter((s) => checks[s.id]).length;
  return (
    <>
      <p className="rm-kicker">{firstName ? `${firstName}, you are here` : 'You are here'}</p>
      <h2 className="rm-h2">Stage {stage.n}: {stage.name}</h2>
      <p className="rm-lede" style={{ marginTop: 10 }}>{stage.tagline}</p>

      <ol className="rm-ladder" aria-label="All stages">
        {ROADMAP_STAGES.map((s) => (
          <li key={s.n} data-here={s.n === n} data-done={s.n < n}>
            <small>Stage {s.n}</small>
            <span>{s.name}</span>
            {s.n === n && <span className="rm-here">You are here</span>}
          </li>
        ))}
      </ol>

      <p className="rm-label">Your job right now</p>
      <p className="rm-job">{stage.whenYouHit}</p>

      <p className="rm-label">Do these steps, in order · {done} of {steps.length} done</p>
      <ol className="rm-steplist">
        {steps.map((s, i) => (
          <li key={s.id}>
            <label className="rm-step">
              <span className="rm-num">{String(i + 1).padStart(2, '0')}</span>
              <input type="checkbox" id={`rm-step-${s.id}`} checked={!!checks[s.id]} onChange={(e) => toggle(s.id, e.target.checked)} />
              <span className="rm-steptxt">{s.title}</span>
              <span className="rm-box" aria-hidden="true" />
            </label>
          </li>
        ))}
      </ol>

      <div className="rm-card" style={{ marginTop: 22 }}>
        <p className="rm-label" style={{ marginTop: 0 }}>{next ? `You move to Stage ${next.n} (${next.name}) when` : 'You know you have made it when'}</p>
        <ul className="rm-ready">{stage.readyWhen.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>

      <div className="rm-btns rm-noprint">
        <Link className="rm-link rm-link--primary" href={`/course/${stage.slug}`}>Watch the Stage {stage.n} lesson →</Link>
        <button type="button" className="rm-link" onClick={() => window.print()}>Save as PDF</button>
        <button type="button" className="rm-link" onClick={onRetake}>Retake the quiz</button>
      </div>
    </>
  );
}

const PRO_POINTS: ReadonlyArray<[string, string]> = [
  ['Contracts that fit, every morning', 'AI-matched daily briefings for your business, with unlimited NAICS codes and target agencies.'],
  ['See bids before they post', 'Agency forecasts and recompete alerts 12 months before a contract comes back up.'],
  ['Know who you are up against', 'Who holds the contract now, what they won, and what each agency spends.'],
  ['Track and win your pursuits', 'Your pipeline, contacts and proposal tools in one place.'],
];

function ProOffer({ proCredits, firstName, onSkip }: { proCredits: number; firstName: string; onSkip: () => void }) {
  return (
    <>
      <p className="rm-kicker">{firstName ? `You’re in, ${firstName}.` : 'You’re in.'} Before your roadmap…</p>
      <h2 className="rm-h2">Want Mindy to do the searching for you?</h2>
      <p className="rm-lede" style={{ marginTop: 12 }}>
        The course shows you what to do. Mindy Pro does the hard part every day: it finds the contracts that fit
        your business, tells you who holds them now, and shows you what agencies plan to buy next.
      </p>

      <div className="rm-card" style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <p className="mp-title" style={{ fontSize: 24 }}>Mindy Pro</p>
          <p><span className="mp-display" style={{ fontSize: 40 }}>$149</span><span className="mp-meta"> / month</span></p>
        </div>
        <ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'grid', gap: 14 }}>
          {PRO_POINTS.map(([t, b]) => (
            <li key={t} style={{ display: 'flex', gap: 12 }}>
              <span aria-hidden="true" style={{ color: 'var(--mp-ok)', fontWeight: 700 }}>✓</span>
              <span><b style={{ color: 'var(--mp-ink)' }}>{t}.</b> <span className="mp-prose">{b}</span></span>
            </li>
          ))}
          <li style={{ display: 'flex', gap: 12 }}>
            <span aria-hidden="true" style={{ color: 'var(--mp-ok)', fontWeight: 700 }}>✓</span>
            <span><b style={{ color: 'var(--mp-ink)' }}>{proCredits.toLocaleString()} credits a month.</b> <span className="mp-prose">Use Mindy inside Claude and other AI tools.</span></span>
          </li>
        </ul>
        <a className="rm-link rm-link--primary" href={PRO_CHECKOUT} style={{ marginTop: 24, width: '100%', justifyContent: 'center', fontSize: 16 }}>
          Yes, try Mindy Pro free for 14 days
        </a>
        <p className="mp-meta" style={{ marginTop: 8, textAlign: 'center' }}>$0 today, then $149/mo. Cancel anytime before day 14.</p>
        <NoRefundNote />
      </div>

      <div style={{ marginTop: 22, textAlign: 'center' }}>
        <button type="button" onClick={onSkip} className="rm-skip">No thanks, take me to the free course →</button>
      </div>
    </>
  );
}
