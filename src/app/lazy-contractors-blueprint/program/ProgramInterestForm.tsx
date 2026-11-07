'use client';

import { useState, type FormEvent } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/public-site/ui';

export default function ProgramInterestForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/events/lazy-contractors-blueprint/program-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(fd.entries())),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || 'Something went wrong. Please try again.');
        setStatus('idle');
        return;
      }
      setStatus('done');
    } catch {
      setError('Network error. Please try again.');
      setStatus('idle');
    }
  }

  if (status === 'done') {
    return (
      <div className="mp-panel" role="status">
        <p className="mp-eyebrow mp-eyebrow--accent">Got it</p>
        <h2 className="mp-title" style={{ marginTop: 10 }}>Thanks. We&apos;ll be in touch.</h2>
        <p className="mp-standfirst" style={{ marginTop: 12 }}>
          Someone from our team will reach out about the program before it starts in January.
        </p>
      </div>
    );
  }

  return (
    <form className="mp-panel" onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
      <p className="mp-label">Tell us about you</p>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="First name" htmlFor="pi-first">
          <Input id="pi-first" name="firstName" autoComplete="given-name" required maxLength={80} />
        </Field>
        <Field label="Last name" htmlFor="pi-last">
          <Input id="pi-last" name="lastName" autoComplete="family-name" maxLength={80} />
        </Field>
      </div>
      <Field label="Email (the one you used for Mindy)" htmlFor="pi-email">
        <Input id="pi-email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </Field>
      <Field label="Phone" htmlFor="pi-phone">
        <Input id="pi-phone" name="phone" type="tel" autoComplete="tel" maxLength={30} />
      </Field>
      <Field label="What does your business sell?" htmlFor="pi-sells">
        <Textarea id="pi-sells" name="sells" rows={2} maxLength={300} />
      </Field>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Registered in SAM.gov?" htmlFor="pi-sam">
          <Select id="pi-sam" name="sam" defaultValue="">
            <option value="" disabled>Choose one</option>
            <option>Yes</option>
            <option>No</option>
            <option>Not sure</option>
          </Select>
        </Field>
        <Field label="Federal bids submitted so far" htmlFor="pi-bids">
          <Select id="pi-bids" name="bids" defaultValue="">
            <option value="" disabled>Choose one</option>
            <option>Never</option>
            <option>1-2</option>
            <option>3 or more</option>
          </Select>
        </Field>
      </div>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="Could you start in January?" htmlFor="pi-ready">
          <Select id="pi-ready" name="ready" defaultValue="" required>
            <option value="" disabled>Choose one</option>
            <option>Yes</option>
            <option>Maybe</option>
            <option>Not yet</option>
          </Select>
        </Field>
        <Field label="Want a quick call with our team?" htmlFor="pi-call">
          <Select id="pi-call" name="call" defaultValue="">
            <option value="" disabled>Choose one</option>
            <option>Yes</option>
            <option>No</option>
          </Select>
        </Field>
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
      {error && (
        <p className="mp-meta" role="alert" style={{ color: 'var(--mp-crit)' }}>{error}</p>
      )}
      <Button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : "I'm interested"}
      </Button>
    </form>
  );
}
