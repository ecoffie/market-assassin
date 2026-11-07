'use client';

import { useState } from 'react';
import { Container } from '@/components/public-site/ui';
import { INTERESTS, TEAM_SIZES } from '@/lib/sales/contact-sales';

type Status = 'idle' | 'sending' | 'sent' | 'error';

const FIELD_LABEL: Record<string, string> = {
  name: 'your name', email: 'a work email', company: 'your company', teamSize: 'team size', interest: 'what you are interested in', message: 'what you need',
};

export default function ContactSalesForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [bad, setBad] = useState<string[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    setStatus('sending');
    setBad([]);
    try {
      const res = await fetch('/api/contact-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, page: document.referrer ? new URL(document.referrer).pathname : '', offer: new URLSearchParams(location.search).get('offer') || '' }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.success) { setStatus('sent'); return; }
      setBad(Array.isArray(j.errors) ? j.errors : []);
      setMessage(j.message || 'Something went wrong. Please email hello@getmindy.ai.');
      setStatus('error');
    } catch {
      setMessage('Something went wrong. Please email hello@getmindy.ai.');
      setStatus('error');
    }
  }

  const input = (name: string) =>
    `mt-2 w-full rounded-xl border-[1.5px] bg-(--mp-surface) px-4 py-3 text-[16px] text-(--mp-ink) outline-none transition focus:border-(--mp-navy) focus:shadow-[0_0_0_3px_rgba(27,58,107,0.15)] ${bad.includes(name) ? 'border-(--mp-warn)' : 'border-(--mp-line)'}`;
  const label = 'block text-[14px] font-semibold text-(--mp-ink)';

  return (
    <main className="bg-(--mp-navy-wash)/60 py-14 lg:py-20">
      <Container width="wide" className="grid items-start gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-(--mp-navy)">Contact sales</p>
          <h1 className="mt-4 text-balance text-[42px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[54px]">Let&apos;s find the right plan for your team.</h1>
          <p className="mt-5 max-w-lg text-[19px] leading-relaxed text-(--mp-body)">Tell us a little about what you do. Someone from the Mindy team will get back to you, usually within one business day.</p>
          <ul className="mt-8 space-y-4 text-[17px] text-(--mp-body)">
            {[
              'Team plans with a shared pipeline and pooled credits',
              'Enterprise and API access for your own tools and AI',
              'Help for agencies, consultants and primes',
            ].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-(--mp-navy) text-[13px] font-bold text-white">✓</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-[15px] text-(--mp-muted)">Prefer email? <a href="mailto:hello@getmindy.ai" className="font-semibold text-(--mp-navy) underline underline-offset-2">hello@getmindy.ai</a></p>
        </div>

        <div className="rounded-3xl border border-(--mp-line) bg-(--mp-surface) p-6 shadow-[0_24px_60px_rgba(27,58,107,0.14)] sm:p-8">
          {status === 'sent' ? (
            <div className="py-10 text-center" role="status">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-(--mp-navy) text-[26px] text-white">✓</div>
              <h2 className="mt-5 font-(family-name:--mp-font-serif) text-[30px] font-normal leading-tight">Thanks, we got it.</h2>
              <p className="mx-auto mt-3 max-w-sm text-[17px] text-(--mp-body)">Your request went to the Mindy team. We&apos;ll reply to your email soon.</p>
              <a href="/opportunity-map" className="mt-8 inline-flex rounded-full bg-(--mp-navy) px-7 py-3.5 text-[17px] font-semibold text-white hover:bg-(--mp-navy-hover)">Explore the map</a>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className={label}>Name<input name="name" autoComplete="name" required className={input('name')} /></label>
                <label className={label}>Work email<input name="email" type="email" autoComplete="email" required className={input('email')} /></label>
                <label className={label}>Company<input name="company" autoComplete="organization" required className={input('company')} /></label>
                <label className={label}>Phone <span className="font-normal text-(--mp-muted)">(optional)</span><input name="phone" type="tel" autoComplete="tel" className={input('phone')} /></label>
                <label className={label}>Team size
                  <select name="teamSize" required defaultValue="" className={input('teamSize')}>
                    <option value="" disabled>Choose one</option>
                    {TEAM_SIZES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label className={label}>Interested in
                  <select name="interest" required defaultValue="" className={input('interest')}>
                    <option value="" disabled>Choose one</option>
                    {INTERESTS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </div>
              <label className={`${label} mt-5`}>What do you need?
                <textarea name="message" rows={5} required placeholder="What kind of work you go after, how many people would use Mindy, and anything you want to ask." className={input('message')} />
              </label>
              {/* Honeypot for bots — hidden from people and screen readers. */}
              <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
              {status === 'error' && (
                <p className="mt-4 rounded-xl bg-(--mp-wash) px-4 py-3 text-[15px] text-(--mp-warn)" role="alert">
                  {message}{bad.length > 0 && ` Missing: ${bad.map((f) => FIELD_LABEL[f] || f).join(', ')}.`}
                </p>
              )}
              <button type="submit" disabled={status === 'sending'} className="mt-6 w-full rounded-full bg-(--mp-navy) px-7 py-4 text-[17px] font-semibold text-white transition hover:bg-(--mp-navy-hover) disabled:opacity-60">
                {status === 'sending' ? 'Sending…' : 'Send to the Mindy team'}
              </button>
              <p className="mt-3 text-center text-[13px] text-(--mp-muted)">We only use this to reply to you.</p>
            </form>
          )}
        </div>
      </Container>
    </main>
  );
}
