'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, ButtonLink, Field, Input, Select, Textarea } from '@/components/public-site/ui';
import { getMIApiHeaders, storedMIEmail } from '@/components/app/authHeaders';
import { LCB_CLAIM_QUESTIONS as Q } from '@/lib/events/lazy-contractors-blueprint';

type State = 'before' | 'open' | 'after';

const SIGN_IN_HREF = `/app?next=${encodeURIComponent('/lazy-contractors-blueprint/claim')}`;

export default function ClaimForm({ initialState, credits }: { initialState: State; credits: number }) {
  // Read the browser's Mindy session after mount (localStorage), so server and client render the same first frame.
  const [signedInAs, setSignedInAs] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [result, setResult] = useState<{ alreadyClaimed: boolean; balance: number; email: string } | null>(null);

  useEffect(() => { setSignedInAs(storedMIEmail()); }, []);

  if (initialState === 'before') {
    return (
      <div className="mp-panel">
        <p className="mp-label">Opens during the live event</p>
        <p className="mp-standfirst" style={{ marginTop: 10 }}>Come back on Saturday, November 28 at 11:00 AM ET, when we go live.</p>
      </div>
    );
  }
  if (initialState === 'after') {
    return (
      <div className="mp-panel">
        <p className="mp-label">The live event has ended</p>
        <p className="mp-standfirst" style={{ marginTop: 10 }}>This bonus was for live attendees only.</p>
      </div>
    );
  }

  async function claim(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setStatus('sending');
    setError('');
    setNeedsSignIn(false);
    try {
      const res = await fetch('/api/events/lazy-contractors-blueprint/claim', {
        method: 'POST',
        headers: getMIApiHeaders(signedInAs, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: fd.get('name'), company: fd.get('company'), sells: fd.get('sells'),
          years: fd.get('years'), revenue: fd.get('revenue'), sam: fd.get('sam'),
          certifications: fd.getAll('certifications'), bids: fd.get('bids'),
          challenge: fd.get('challenge'), stage: fd.get('stage'), call: fd.get('call'),
          website: fd.get('website'),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setNeedsSignIn(!!data.signIn || !!data.notRegistered);
        setError(data.error || 'Something went wrong. Please try again.');
        setStatus('idle');
        return;
      }
      setResult({ alreadyClaimed: !!data.alreadyClaimed, balance: Number(data.balance) || 0, email: data.email || signedInAs || '' });
      setStatus('done');
    } catch {
      setError('Network error. Please try again.');
      setStatus('idle');
    }
  }

  if (status === 'done' && result) {
    return (
      <div className="mp-panel" role="status" style={{ display: 'grid', gap: 12 }}>
        <p className="mp-eyebrow mp-eyebrow--accent">{result.alreadyClaimed ? 'Already claimed' : 'Done'}</p>
        <h2 className="mp-title">
          {result.alreadyClaimed ? `You already claimed your ${credits} credits.` : `${credits} credits added to your account.`}
        </h2>
        <p className="mp-standfirst">Your Mindy balance is now {result.balance.toLocaleString('en-US')} credits ({result.email}).</p>
        <div><ButtonLink href="/mcp/account">See my credits</ButtonLink></div>
      </div>
    );
  }

  if (signedInAs === undefined) {
    return <div className="mp-panel"><p className="mp-meta">Checking your sign-in…</p></div>;
  }

  if (!signedInAs) {
    return (
      <div className="mp-panel" style={{ display: 'grid', gap: 14 }}>
        <p className="mp-label">Sign in to claim</p>
        <p className="mp-standfirst">Sign in to Mindy (or create your free account) with the email you registered with. You&apos;ll come right back here.</p>
        <div><ButtonLink href={SIGN_IN_HREF}>Sign in to claim {credits} credits</ButtonLink></div>
      </div>
    );
  }

  const choose = (name: string, label: string, options: readonly string[], required = false) => (
    <Field label={label} htmlFor={`claim-${name}`}>
      <Select id={`claim-${name}`} name={name} defaultValue="" required={required}>
        <option value="" disabled>Choose one</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    </Field>
  );

  return (
    <form className="mp-panel" onSubmit={claim} style={{ display: 'grid', gap: 18 }}>
      <p className="mp-label">A few questions, then your {credits} credits</p>
      <Field label="Email" htmlFor="claim-email" help="From your Mindy account. The credits go here.">
        <Input id="claim-email" name="email" type="email" value={signedInAs} readOnly />
      </Field>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Field label="Your name" htmlFor="claim-name">
          <Input id="claim-name" name="name" autoComplete="name" required maxLength={120} />
        </Field>
        <Field label="Company name" htmlFor="claim-company">
          <Input id="claim-company" name="company" autoComplete="organization" maxLength={160} />
        </Field>
      </div>
      <Field label="What does your business sell?" htmlFor="claim-sells" help="e.g. janitorial services, IT support, roofing">
        <Textarea id="claim-sells" name="sells" rows={2} required maxLength={300} />
      </Field>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {choose('years', 'How long have you been in business?', Q.years, true)}
        {choose('revenue', 'Annual revenue', Q.revenue)}
      </div>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {choose('sam', 'Registered in SAM.gov?', Q.sam)}
        {choose('bids', 'Federal bids submitted so far', Q.bids, true)}
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <legend className="mp-field-label" style={{ marginBottom: 8 }}>Certifications (choose all that apply)</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
          {Q.certifications.map((c) => (
            <label key={c} className="mp-meta" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" name="certifications" value={c} /> {c}
            </label>
          ))}
        </div>
      </fieldset>
      {choose('challenge', 'What is your biggest challenge with government contracts?', Q.challenge)}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        <legend className="mp-field-label" style={{ marginBottom: 8 }}>Which of these sounds most like you right now?</legend>
        {Q.stage.map((o) => (
          <label key={o.value} className="mp-meta" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 1.5 }}>
            <input type="radio" name="stage" value={o.value} style={{ marginTop: 4 }} /> <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
      {choose('call', 'Would you like a free call with our team?', Q.call)}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
      {error && <p className="mp-meta" role="alert" style={{ color: 'var(--mp-crit)' }}>{error}</p>}
      <Button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Adding your credits…' : `Claim ${credits} credits`}
      </Button>
      {needsSignIn && <a className="mp-link" href={SIGN_IN_HREF}>Sign in with a different email</a>}
      <p className="mp-meta">One claim per registered email.</p>
    </form>
  );
}
