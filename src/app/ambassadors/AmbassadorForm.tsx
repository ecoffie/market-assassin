'use client';

/** The Mindy Ambassadors application form → POST /api/ambassadors/apply. */
import { useState } from 'react';
import { AUDIENCE_SIZES } from '@/lib/ambassadors/constants';

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; already: boolean } | { kind: 'error'; message: string };

const LABELS: Record<string, string> = {
  name: 'Your name',
  email: 'Email',
  role: 'What you do',
  linkedinUrl: 'LinkedIn profile',
  websiteUrl: 'Website',
  audienceSize: 'How many people you reach',
  audience: 'Who you reach',
  why: 'Why you want to be an ambassador',
  promotePlan: 'How you would share Mindy',
};

const input = 'mt-1.5 block w-full rounded-lg border border-(--mp-line) bg-(--mp-surface) px-3.5 py-2.5 text-[16px] text-(--mp-ink) outline-none focus:border-(--mp-navy)';
const bad = 'border-(--mp-crit)';

export default function AmbassadorForm() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [errors, setErrors] = useState<string[]>([]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
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
          {status.already ? 'You are already a Mindy Ambassador.' : 'Application received. Thank you!'}
        </p>
        <p className="mt-2 mb-0 text-[16px] text-(--mp-body)">
          {status.already ? 'Your account already has unlimited Mindy. Email admin@getmindy.ai if anything looks wrong.' : 'We sent a confirmation to your email and will reply with a decision after we review it.'}
        </p>
      </div>
    );
  }

  const field = (name: string) => (errors.includes(name) ? `${input} ${bad}` : input);
  const label = (name: string, optional = false) => (
    <span className="text-[15px] font-semibold text-(--mp-ink)">
      {LABELS[name]}{optional && <span className="font-normal text-(--mp-muted)"> (optional)</span>}
    </span>
  );

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label>{label('name')}<input name="name" autoComplete="name" required className={field('name')} /></label>
        <label>{label('email')}<input name="email" type="email" autoComplete="email" required className={field('email')} /></label>
        <label>{label('role')}<input name="role" required placeholder="e.g. APEX advisor, GovCon coach" className={field('role')} /></label>
        <label><span className="text-[15px] font-semibold text-(--mp-ink)">Company <span className="font-normal text-(--mp-muted)">(optional)</span></span><input name="company" autoComplete="organization" className={input} /></label>
        <label>{label('linkedinUrl', true)}<input name="linkedinUrl" placeholder="linkedin.com/in/…" className={field('linkedinUrl')} /></label>
        <label>{label('websiteUrl', true)}<input name="websiteUrl" placeholder="yourcompany.com" className={field('websiteUrl')} /></label>
      </div>
      <label>
        {label('audienceSize')}
        <select name="audienceSize" required defaultValue="" className={field('audienceSize')}>
          <option value="" disabled>Choose one</option>
          {AUDIENCE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>{label('audience')}<textarea name="audience" rows={3} required placeholder="e.g. 3,000 small contractors in my LinkedIn network and a monthly workshop for 40 veteran-owned firms" className={field('audience')} /></label>
      <label>{label('why')}<textarea name="why" rows={3} required className={field('why')} /></label>
      <label>{label('promotePlan')}<textarea name="promotePlan" rows={3} required placeholder="e.g. a LinkedIn post a month, demos in my workshops, my newsletter" className={field('promotePlan')} /></label>
      {/* Honeypot: hidden from people, filled by bots. */}
      <input name="website2" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-px w-px opacity-0" />
      {status.kind === 'error' && (
        <p role="alert" className="m-0 rounded-lg bg-(--mp-warn-bg) px-4 py-3 text-[15px] text-(--mp-ink)">
          {status.message}{errors.length > 0 && <> Check: {errors.map((e) => LABELS[e] || e).join(', ')}.</>}
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
