'use client';

import { useState, type FormEvent } from 'react';
import { Button, ButtonLink, Field, Input } from '@/components/public-site/ui';

type State = 'before' | 'open' | 'after';

export default function ClaimForm({ initialState, credits }: { initialState: State; credits: number }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ alreadyClaimed: boolean; balance: number; email: string } | null>(null);

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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') || '');
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/events/lazy-contractors-blueprint/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website: fd.get('website') }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || 'Something went wrong. Please try again.');
        setStatus('idle');
        return;
      }
      setResult({ alreadyClaimed: !!data.alreadyClaimed, balance: Number(data.balance) || 0, email });
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
          {result.alreadyClaimed ? `You already claimed your ${credits} credits.` : `${credits} credits added.`}
        </h2>
        <p className="mp-standfirst">
          Your Mindy balance is now {result.balance.toLocaleString('en-US')} credits. Sign in to Mindy with {result.email} to use them.
        </p>
        <div><ButtonLink href="/mcp">Open Mindy</ButtonLink></div>
      </div>
    );
  }

  return (
    <form className="mp-panel" onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
      <Field label="The email you registered with" htmlFor="claim-email">
        <Input id="claim-email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
      {error && <p className="mp-meta" role="alert" style={{ color: 'var(--mp-crit)' }}>{error}</p>}
      <Button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Adding your credits…' : `Claim ${credits} credits`}
      </Button>
      <p className="mp-meta">One claim per registered email.</p>
    </form>
  );
}
