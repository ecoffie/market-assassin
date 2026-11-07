'use client';

import { useEffect, useState } from 'react';
import { Button, ButtonLink } from '@/components/public-site/ui';
import { getMIApiHeaders, storedMIEmail } from '@/components/app/authHeaders';

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

  async function claim() {
    setStatus('sending');
    setError('');
    setNeedsSignIn(false);
    try {
      const res = await fetch('/api/events/lazy-contractors-blueprint/claim', {
        method: 'POST',
        headers: getMIApiHeaders(signedInAs, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({}),
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

  return (
    <div className="mp-panel" style={{ display: 'grid', gap: 14 }}>
      <p className="mp-meta">Signed in as <strong>{signedInAs}</strong></p>
      {error && <p className="mp-meta" role="alert" style={{ color: 'var(--mp-crit)' }}>{error}</p>}
      <Button type="button" onClick={claim} disabled={status === 'sending'}>
        {status === 'sending' ? 'Adding your credits…' : `Claim ${credits} credits`}
      </Button>
      {needsSignIn && <a className="mp-link" href={SIGN_IN_HREF}>Sign in with a different email</a>}
      <p className="mp-meta">One claim per registered email.</p>
    </div>
  );
}
