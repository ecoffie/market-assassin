'use client';

/**
 * Personalized roadmap: contact details first, then six questions, then "You are here" with the
 * person's stage, its steps and what comes next. The stage is computed from the answers with the
 * same function the API uses (stageFromAnswers), so the screen and the GHL tag always agree.
 */
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button, Field, Input } from '@/components/public-site/ui';
import NoRefundNote from '@/components/NoRefundNote';
import {
  QUIZ, ROADMAP_STAGES, stageByNumber, stageFromAnswers, stageSteps,
  type QuizAnswers, type StageNumber,
} from '@/lib/course/govcon-roadmap';

const STORE_KEY = 'mindy_govcon_roadmap';

function readAttribution(): unknown {
  try {
    const raw = localStorage.getItem('gca_attribution');
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

const CSS = `
.rm-wrap{max-width:760px;margin:0 auto;padding:40px 0 80px}
.rm-opts{display:grid;gap:10px;margin-top:16px}
.rm-opt{text-align:left;padding:14px 16px;border-radius:12px;border:1.5px solid var(--mp-line);background:var(--mp-surface);font:500 15px var(--mp-font-sans);color:var(--mp-ink);cursor:pointer}
.rm-opt:hover{border-color:var(--mp-navy);background:var(--mp-navy-wash)}
.rm-progress{height:6px;border-radius:999px;background:var(--mp-hair);overflow:hidden;margin-top:14px}
.rm-progress span{display:block;height:100%;background:var(--mp-navy)}
.rm-ladder{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:6px}
.rm-ladder li{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px;border:1px solid var(--mp-hair);background:var(--mp-surface);color:var(--mp-muted)}
.rm-ladder li[data-here="true"]{border:1.5px solid var(--mp-navy);background:var(--mp-navy-wash);color:var(--mp-navy);font-weight:600}
.rm-ladder li[data-done="true"]{color:var(--mp-subtle);text-decoration:line-through}
.rm-steps{margin:10px 0 0;padding-left:22px;display:grid;gap:6px;list-style:disc}
ol.rm-steps{list-style:decimal}
.rm-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.rm-link{display:inline-flex;align-items:center;padding:12px 18px;border-radius:999px;border:1px solid var(--mp-line);background:var(--mp-surface);color:var(--mp-ink);font:600 14px var(--mp-font-sans);text-decoration:none;cursor:pointer}
.rm-link--primary{background:var(--mp-navy);border-color:var(--mp-navy);color:#FFFFFF}
.rm-skip{background:none;border:0;padding:8px;font:500 15px var(--mp-font-sans);color:var(--mp-muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.rm-skip:hover{color:var(--mp-ink)}
@media print{.rm-noprint{display:none !important}.rm-wrap{padding:0}}
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
    <div className="mp-container">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="rm-wrap">
        {step === 'contact' && (
          <>
            <p className="mp-eyebrow mp-eyebrow--accent">Free · takes 1 minute</p>
            <h1 className="mp-display" style={{ marginTop: 10 }}>Get your personalized GovCon roadmap</h1>
            <p className="mp-standfirst" style={{ marginTop: 12 }}>
              Answer six quick questions. We’ll show you which stage you are in and exactly what to do next.
            </p>
            <form className="mp-panel" onSubmit={onContact} style={{ display: 'grid', gap: 16, marginTop: 28 }}>
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
            <p className="mp-eyebrow mp-eyebrow--accent">Question {qi + 1} of {QUIZ.length}</p>
            <div className="rm-progress" aria-hidden="true"><span style={{ width: `${(qi / QUIZ.length) * 100}%` }} /></div>
            <h1 className="mp-title" style={{ marginTop: 24, fontSize: 28 }}>{QUIZ[qi].text}</h1>
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
  );
}

function RoadmapResult({ stage: n, firstName, onRetake }: { stage: StageNumber; firstName: string; onRetake: () => void }) {
  const stage = stageByNumber(n)!;
  const next = stageByNumber(n + 1);
  return (
    <>
      <p className="mp-eyebrow mp-eyebrow--accent">{firstName ? `${firstName}’s` : 'Your'} GovCon roadmap · You are here</p>
      <h1 className="mp-display" style={{ marginTop: 10 }}>Stage {stage.n}: {stage.name}</h1>
      <p className="mp-standfirst" style={{ marginTop: 12 }}>{stage.tagline}</p>

      <ol className="rm-ladder" aria-label="All stages">
        {ROADMAP_STAGES.map((s) => (
          <li key={s.n} data-here={s.n === n} data-done={s.n < n}>
            <span>{s.n}</span><span>{s.name}</span>
            {s.n === n && <span style={{ marginLeft: 'auto', fontSize: 12 }}>You are here</span>}
          </li>
        ))}
      </ol>

      <div className="mp-panel" style={{ marginTop: 24 }}>
        <p className="mp-label">Your job right now</p>
        <p className="mp-prose" style={{ marginTop: 8 }}>{stage.whenYouHit}</p>
        <p className="mp-label" style={{ marginTop: 18 }}>Do these steps, in order</p>
        <ol className="rm-steps mp-prose">{stageSteps(stage).map((s) => <li key={s.id}>{s.title}</li>)}</ol>
        <p className="mp-label" style={{ marginTop: 18 }}>{next ? `You move to Stage ${next.n} (${next.name}) when` : 'You know you have made it when'}</p>
        <ul className="rm-steps mp-prose">{stage.readyWhen.map((r) => <li key={r}>{r}</li>)}</ul>
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
      <p className="mp-eyebrow mp-eyebrow--accent">{firstName ? `You’re in, ${firstName}.` : 'You’re in.'} Before your roadmap…</p>
      <h1 className="mp-display" style={{ marginTop: 10 }}>Want Mindy to do the searching for you?</h1>
      <p className="mp-standfirst" style={{ marginTop: 12 }}>
        The course shows you what to do. Mindy Pro does the hard part every day: it finds the contracts that fit
        your business, tells you who holds them now, and shows you what agencies plan to buy next.
      </p>

      <div className="mp-panel" style={{ marginTop: 28 }}>
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
          Yes, get Mindy Pro for $149/mo
        </a>
        <p className="mp-meta" style={{ marginTop: 8, textAlign: 'center' }}>Cancel anytime.</p>
        <NoRefundNote />
      </div>

      <div style={{ marginTop: 22, textAlign: 'center' }}>
        <button type="button" onClick={onSkip} className="rm-skip">No thanks, take me to the free course →</button>
      </div>
    </>
  );
}
