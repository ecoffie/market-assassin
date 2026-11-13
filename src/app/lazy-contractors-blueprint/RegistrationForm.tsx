'use client';

/**
 * Mindy Day registration, two steps (2026-11-12 conversion pass):
 *   1. First name + email → seat saved (the short form sits above the fold on phones).
 *   2. Optional: phone + text reminders + two qualifying questions, then share + add to calendar.
 * Someone who types a name and a valid email but leaves without submitting is recorded once as
 * "started" (GHL tag lcb-started-not-registered) so a GHL email workflow can nudge them; the tag is
 * removed when they register. Never texted: no consent was given.
 */
import { useRef, useState, type FormEvent } from 'react';
import { Button, Field, Input, Select } from '@/components/public-site/ui';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';

const API = '/api/events/lazy-contractors-blueprint';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_URL = `https://getmindy.ai${EVENT.path}`;

function readAttribution(): unknown {
  try {
    const raw = localStorage.getItem('gca_attribution');
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Google Calendar link: Nov 28, 11:00 AM–1:00 PM ET (16:00–18:00 UTC). */
const GCAL = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(EVENT.title + ' (live)')}`
  + `&dates=20261128T160000Z/20261128T180000Z&details=${encodeURIComponent(`Free live event with Eric Coffie. Your join link comes by email. Live attendees get ${EVENT.claimCredits.toLocaleString('en-US')} free Mindy credits.\n${PAGE_URL}`)}`;

function icsHref(): string {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mindy//Mindy Day//EN', 'BEGIN:VEVENT',
    'UID:mindy-day-2026-11-28@getmindy.ai', 'DTSTAMP:20261112T000000Z',
    'DTSTART:20261128T160000Z', 'DTEND:20261128T180000Z',
    `SUMMARY:${EVENT.title} (live)`,
    `DESCRIPTION:Free live event with Eric Coffie. Your join link comes by email. ${PAGE_URL}`,
    `URL:${PAGE_URL}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

export default function RegistrationForm() {
  const [step, setStep] = useState<'form' | 'details' | 'done'>('form');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const who = useRef({ firstName: '', email: '' });
  const startedSent = useRef(false);

  function noteStarted(form: HTMLFormElement | null) {
    if (!form || startedSent.current) return;
    const fd = new FormData(form);
    const firstName = String(fd.get('firstName') || '').trim();
    const email = String(fd.get('email') || '').trim();
    if (!firstName || !EMAIL_RE.test(email) || fd.get('website')) return;
    startedSent.current = true;
    fetch(`${API}/started`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ firstName, email, attribution: readAttribution() }),
    }).catch(() => {});
  }

  async function onRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSending(true);
    setError('');
    try {
      const res = await fetch(`${API}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: fd.get('firstName'), email: fd.get('email'), website: fd.get('website'),
          attribution: readAttribution(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { setError(data.error || 'Something went wrong. Please try again.'); return; }
      who.current = { firstName: String(fd.get('firstName') || ''), email: String(fd.get('email') || '') };
      setStep('details');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSending(false);
    }
  }

  async function onDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSending(true);
    setError('');
    try {
      const res = await fetch(`${API}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'details', ...who.current,
          phone: fd.get('phone'), smsConsent: fd.get('smsConsent') === 'on',
          ownsBusiness: fd.get('ownsBusiness'), samRegistered: fd.get('samRegistered'),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) { setError(data.error || 'Something went wrong. Please try again.'); return; }
      setStep('done');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSending(false);
    }
  }

  if (step === 'details') {
    return (
      <form className="mp-panel" onSubmit={onDetails} style={{ display: 'grid', gap: 16 }} role="status">
        <p className="mp-eyebrow mp-eyebrow--accent">You&apos;re in</p>
        <h2 className="mp-title">Your seat is saved.</h2>
        <p className="mp-standfirst">Check your email for the confirmation. Want a text reminder before we go live?</p>
        <Field label="Phone (optional)" htmlFor="lcb-phone">
          <Input id="lcb-phone" name="phone" type="tel" autoComplete="tel" maxLength={30} />
        </Field>
        <label className="mp-meta" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 1.5 }}>
          <input type="checkbox" name="smsConsent" style={{ marginTop: 3 }} />
          <span>Text me event reminders. Message and data rates may apply. Reply STOP to opt out.</span>
        </label>
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Field label="Do you own a business?" htmlFor="lcb-owns">
            <Select id="lcb-owns" name="ownsBusiness" defaultValue="">
              <option value="" disabled>Choose one</option>
              <option value="Yes">Yes</option>
              <option value="Starting one">Starting one</option>
              <option value="No">No</option>
            </Select>
          </Field>
          <Field label="Registered in SAM.gov?" htmlFor="lcb-sam">
            <Select id="lcb-sam" name="samRegistered" defaultValue="">
              <option value="" disabled>Choose one</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
              <option value="Not sure">Not sure</option>
            </Select>
          </Field>
        </div>
        {error && <p className="mp-meta" role="alert" style={{ color: 'var(--mp-crit)' }}>{error}</p>}
        <Button type="submit" disabled={sending}>{sending ? 'Saving…' : 'Save'}</Button>
        <button type="button" className="mp-meta" onClick={() => setStep('done')}
          style={{ background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline', justifySelf: 'center' }}>
          Skip
        </button>
      </form>
    );
  }

  if (step === 'done') {
    const shareText = `I'm going to ${EVENT.title}, a free live event on winning federal contracts with Mindy (${EVENT.shortDate}). Live attendees get ${EVENT.claimCredits.toLocaleString('en-US')} free Mindy credits. Join me:`;
    return (
      <div className="mp-panel" role="status" style={{ display: 'grid', gap: 16 }}>
        <p className="mp-eyebrow mp-eyebrow--accent">You&apos;re all set</p>
        <h2 className="mp-title">See you on {EVENT.shortDate}.</h2>
        <p className="mp-label">Add it to your calendar</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <a className="mp-btn mp-btn--secondary" href={GCAL} target="_blank" rel="noreferrer">Google Calendar</a>
          <a className="mp-btn mp-btn--secondary" href={icsHref()} download="mindy-day.ics">Outlook / Apple</a>
        </div>
        <p className="mp-label" style={{ marginTop: 8 }}>Bring a teaming partner</p>
        <p className="mp-meta" style={{ margin: 0 }}>Know a sub, a prime or a coworker chasing federal work? Send them a seat.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button type="button" className="mp-btn mp-btn--secondary" onClick={() => {
            navigator.clipboard?.writeText(PAGE_URL).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
          }}>{copied ? '✓ Link copied' : 'Copy link'}</button>
          <a className="mp-btn mp-btn--secondary" target="_blank" rel="noreferrer"
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(PAGE_URL)}`}>Share on LinkedIn</a>
          <a className="mp-btn mp-btn--secondary"
            href={`mailto:?subject=${encodeURIComponent(`Join me at ${EVENT.title}`)}&body=${encodeURIComponent(`${shareText}\n\n${PAGE_URL}`)}`}>Email it</a>
        </div>
      </div>
    );
  }

  return (
    <form className="mp-panel" id="register" onSubmit={onRegister} style={{ display: 'grid', gap: 16 }}
      onBlur={(e) => { if ((e.target as HTMLElement).id === 'lcb-email') noteStarted(e.currentTarget); }}>
      <p className="mp-label">Save your free seat</p>
      <Field label="First name" htmlFor="lcb-first">
        <Input id="lcb-first" name="firstName" autoComplete="given-name" required maxLength={80} />
      </Field>
      <Field label="Email" htmlFor="lcb-email">
        <Input id="lcb-email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </Field>
      {/* Honeypot — hidden from people, filled by bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
      {error && <p className="mp-meta" role="alert" style={{ color: 'var(--mp-crit)' }}>{error}</p>}
      <Button type="submit" disabled={sending}>{sending ? 'Saving your seat…' : 'Save My Free Seat'}</Button>
      <p className="mp-meta">Free to attend. No credit card. Your join link comes by email.</p>
    </form>
  );
}
