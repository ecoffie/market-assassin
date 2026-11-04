'use client';

import { useState, type FormEvent } from 'react';
import { Button, Field, Input, Select } from '@/components/public-site/ui';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';

function readAttribution(): unknown {
  try {
    const raw = localStorage.getItem('gca_attribution');
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export default function RegistrationForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/events/lazy-contractors-blueprint/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: fd.get('firstName'),
          lastName: fd.get('lastName'),
          email: fd.get('email'),
          phone: fd.get('phone'),
          smsConsent: fd.get('smsConsent') === 'on',
          ownsBusiness: fd.get('ownsBusiness'),
          samRegistered: fd.get('samRegistered'),
          website: fd.get('website'),
          attribution: readAttribution(),
        }),
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
        <p className="mp-eyebrow mp-eyebrow--accent">You&apos;re in</p>
        <h2 className="mp-title" style={{ marginTop: 10 }}>Your seat is saved.</h2>
        <p className="mp-standfirst" style={{ marginTop: 12 }}>
          Check your email for the confirmation. We&apos;ll send your join link before we go live on{' '}
          {EVENT.dateLabel}{EVENT.timeLabel ? ` at ${EVENT.timeLabel}` : ''}. Show up live to get $50 in free Mindy credits.
        </p>
      </div>
    );
  }

  return (
    <form className="mp-panel" onSubmit={onSubmit} noValidate={false} style={{ display: 'grid', gap: 16 }}>
      <p className="mp-label">Save your free seat</p>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Field label="First name" htmlFor="lcb-first">
          <Input id="lcb-first" name="firstName" autoComplete="given-name" required maxLength={80} />
        </Field>
        <Field label="Last name" htmlFor="lcb-last">
          <Input id="lcb-last" name="lastName" autoComplete="family-name" maxLength={80} />
        </Field>
      </div>
      <Field label="Email" htmlFor="lcb-email">
        <Input id="lcb-email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </Field>
      <Field label="Phone (for event reminders)" htmlFor="lcb-phone">
        <Input id="lcb-phone" name="phone" type="tel" autoComplete="tel" maxLength={30} />
      </Field>
      <label className="mp-meta" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 1.5 }}>
        <input type="checkbox" name="smsConsent" style={{ marginTop: 3 }} />
        <span>
          Text me event reminders. Message and data rates may apply. Reply STOP to opt out.
        </span>
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
      {/* Honeypot — hidden from people, filled by bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
      />
      {error && (
        <p className="mp-meta" role="alert" style={{ color: 'var(--mp-crit)' }}>
          {error}
        </p>
      )}
      <Button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Saving your seat…' : 'Save My Free Seat'}
      </Button>
      <p className="mp-meta">Free to attend. No credit card.</p>
    </form>
  );
}
