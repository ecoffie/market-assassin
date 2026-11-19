'use client';

import { useEffect, useState } from 'react';
import { Container } from '@/components/public-site/ui';
import { SUPPORT_INBOX_DEFAULT, SUPPORT_TOPICS } from '@/lib/support/support-topics';

type Status = 'idle' | 'sending' | 'sent' | 'error';

const FIELD_LABEL: Record<string, string> = { email: 'your email', topic: 'what it is about', message: 'how we can help' };
const MAIL = SUPPORT_INBOX_DEFAULT;

export default function SupportForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [bad, setBad] = useState<string[]>([]);
  const [email, setEmail] = useState('');

  useEffect(() => {
    try {
      const em = localStorage.getItem('mi_beta_email');
      if (em && em.includes('@')) setEmail(em);
    } catch { /* storage blocked: leave empty */ }
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    setStatus('sending');
    setBad([]);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, page: document.referrer ? new URL(document.referrer).pathname : '/support' }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.success) { setStatus('sent'); return; }
      setBad(Array.isArray(j.errors) ? j.errors : []);
      setMessage(j.message || `Something went wrong. Please email ${MAIL}.`);
      setStatus('error');
    } catch {
      setMessage(`Something went wrong. Please email ${MAIL}.`);
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
          <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-(--mp-navy)">Get help</p>
          <h1 className="mt-4 text-balance text-[42px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[54px]">How can we help?</h1>
          <p className="mt-5 max-w-lg text-[19px] leading-relaxed text-(--mp-body)">A real person on the Mindy team reads every message. We usually reply within one business day.</p>
          <ul className="mt-8 space-y-4 text-[17px] text-(--mp-body)">
            {['Something not working? Tell us what you clicked and what you saw.', 'Questions about billing, credits or your account', 'Ideas for what Mindy should do next'].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-(--mp-navy) text-[13px] font-bold text-white">✓</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-[15px] text-(--mp-muted)">Prefer email? <a href={`mailto:${MAIL}`} className="font-semibold text-(--mp-navy) underline underline-offset-2">{MAIL}</a></p>
        </div>

        <div className="rounded-3xl border border-(--mp-line) bg-(--mp-surface) p-6 shadow-[0_24px_60px_rgba(27,58,107,0.14)] sm:p-8">
          {status === 'sent' ? (
            <div className="py-10 text-center" role="status">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-(--mp-navy) text-[26px] text-white">✓</div>
              <h2 className="mt-5 font-(family-name:--mp-font-serif) text-[30px] font-normal leading-tight">Thanks, we got it.</h2>
              <p className="mx-auto mt-3 max-w-sm text-[17px] text-(--mp-body)">A member of the Mindy team will reply to your email soon.</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className={label}>Your email<input name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input('email')} /></label>
                <label className={label}>Name <span className="font-normal text-(--mp-muted)">(optional)</span><input name="name" autoComplete="name" className={input('name')} /></label>
              </div>
              <label className={`${label} mt-5`}>What is it about?
                <select name="topic" required defaultValue="" className={input('topic')}>
                  <option value="" disabled>Choose one</option>
                  {SUPPORT_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className={`${label} mt-5`}>How can we help?
                <textarea name="message" rows={6} required placeholder="Tell us what happened or what you are trying to do." className={input('message')} />
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
