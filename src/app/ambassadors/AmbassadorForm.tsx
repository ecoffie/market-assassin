'use client';

/**
 * The Mindy Ambassador Program application → POST /api/ambassadors/apply.
 * It asks for exactly the five things in Section 9 of the program document, plus name, email and
 * the attestation. Validation lives server-side in src/lib/ambassadors/application.ts.
 */
import { useState } from 'react';
import { ATTESTATION } from '@/lib/ambassadors/constants';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; already: boolean } | { kind: 'error'; message: string };

const LABELS: Record<string, string> = {
  name: 'Your name',
  email: 'Email',
  postUrl: '1. A link to where you post',
  company: '2. Company name',
  uei: 'UEI',
  lastEvent: '3. The last event you attended, by name',
  pursuit: '4. One line on the federal pursuit you have in motion right now',
  wantToFind: '5. One line on what you would want to find out that you cannot find out today',
  attested: 'The confirmation',
};

const input = 'mt-1.5 block w-full rounded-lg border border-(--mp-line) bg-(--mp-surface) px-3.5 py-2.5 text-[16px] text-(--mp-ink) outline-none focus:border-(--mp-navy)';
const bad = 'border-(--mp-crit)';

export default function AmbassadorForm() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [errors, setErrors] = useState<string[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: Record<string, unknown> = Object.fromEntries(fd.entries());
    data.attested = fd.get('attested') === 'on';
    setStatus({ kind: 'sending' });
    setErrors([]);
    try {
      const res = await fetch('/api/ambassadors/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.success) {
        setStatus({ kind: 'done', already: !!j.alreadyAmbassador });
        return;
      }
      setErrors(Array.isArray(j.errors) ? j.errors : []);
      setStatus({ kind: 'error', message: j.message || 'Something went wrong. Please try again.' });
    } catch {
      setStatus({ kind: 'error', message: 'We could not reach Mindy. Check your connection and try again.' });
    }
  }

  if (status.kind === 'done') {
    return (
      <div role="status" className="rounded-2xl border border-(--mp-ok-line) bg-(--mp-ok-bg) p-6">
        <p className="m-0 text-[18px] font-semibold text-(--mp-ink)">
          {status.already ? 'You are already a Mindy Ambassador.' : 'Application received. Thank you.'}
        </p>
        <p className="mt-2 mb-0 text-[16px] text-(--mp-body)">
          {status.already
            ? 'Email admin@getmindy.ai if anything about your access looks wrong.'
            : 'We sent a confirmation to your email. We read every application and we answer either way.'}
        </p>
      </div>
    );
  }

  const field = (name: string) => (errors.includes(name) ? `${input} ${bad}` : input);
  const label = (name: string) => <span className="text-[15px] font-semibold text-(--mp-ink)">{LABELS[name]}</span>;

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label>{label('name')}<input name="name" autoComplete="name" required className={field('name')} /></label>
        <label>{label('email')}<input name="email" type="email" autoComplete="email" required className={field('email')} /></label>
      </div>
      <label>
        {label('postUrl')}
        <input name="postUrl" type="url" inputMode="url" required placeholder="linkedin.com/in/… or youtube.com/@…" className={field('postUrl')} />
      </label>
      <div className="grid gap-5 sm:grid-cols-[1fr_14rem]">
        <label>{label('company')}<input name="company" autoComplete="organization" required className={field('company')} /></label>
        <label>
          {label('uei')}
          <input name="uei" required maxLength={14} autoCapitalize="characters" spellCheck={false} placeholder="12 letters and digits" className={`${field('uei')} font-(family-name:--mp-font-mono) uppercase`} />
        </label>
      </div>
      <label>{label('lastEvent')}<input name="lastEvent" required placeholder="e.g. Fort Bragg Small Business Industry Day, March 2026" className={field('lastEvent')} /></label>
      <label>{label('pursuit')}<input name="pursuit" required placeholder="e.g. Sources sought response to Army MICC for grounds maintenance" className={field('pursuit')} /></label>
      <label>{label('wantToFind')}<input name="wantToFind" required className={field('wantToFind')} /></label>
      <label className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${errors.includes('attested') ? 'border-(--mp-crit)' : 'border-(--mp-line)'} bg-(--mp-surface)`}>
        <input name="attested" type="checkbox" required className="mt-1 h-4 w-4 shrink-0" />
        <span className="text-[16px] leading-[1.5] text-(--mp-ink)">{ATTESTATION}</span>
      </label>
      {/* Honeypot: hidden from people, filled by bots. */}
      <input name="website2" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-px w-px opacity-0" />
      {status.kind === 'error' && (
        <p role="alert" className="m-0 rounded-lg bg-(--mp-warn-bg) px-4 py-3 text-[15px] text-(--mp-ink)">
          {status.message}
          {errors.length > 0 && <> Check: {errors.map((e) => (e === 'uei' ? 'UEI (12 letters and digits)' : (LABELS[e] || e).replace(/^\d\. /, ''))).join('; ')}.</>}
        </p>
      )}
      <div>
        <button type="submit" disabled={status.kind === 'sending'} className="inline-flex items-center rounded-xl bg-(--mp-navy) px-6 py-3.5 text-[16px] font-semibold text-(--mp-surface) hover:bg-(--mp-navy-hover) disabled:opacity-60">
          {status.kind === 'sending' ? 'Sending…' : 'Send application'}
        </button>
      </div>
    </form>
  );
}
