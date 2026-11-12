'use client';

/**
 * Last onboarding screen (growth plan items 03, 05, 10):
 *   1. "Which best describes you?" — tags the signup by type (src/lib/mindy/signup-type.ts).
 *   2. Invite a teaming partner — the existing two-sided referral (src/lib/mcp/referrals.ts):
 *      when the partner signs up and completes a verified sign-in, BOTH sides earn credits.
 *   3. Optional 15-minute setup call, shown only when NEXT_PUBLIC_SETUP_CALL_URL is set.
 * Nothing here may block finishing onboarding: every request failure just moves on.
 */
import { useEffect, useRef, useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';
import { SIGNUP_TYPES, type SignupTypeId } from '@/lib/mindy/signup-type';

type Referral = { link: string; reward: number };
const SETUP_CALL_URL = process.env.NEXT_PUBLIC_SETUP_CALL_URL || '';

export default function InvitePartnerStep({
  onDone, track,
}: { onDone: () => void; track?: (meta: Record<string, unknown>) => void }) {
  const [phase, setPhase] = useState<'type' | 'invite'>('type');
  const [ref, setRef] = useState<Referral | null>(null);
  const [refFailed, setRefFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/mcp/referral', { headers: getMIApiHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live) return;
        if (j?.success && j.link) setRef({ link: j.link, reward: j.reward ?? 100 });
        else setRefFailed(true);
      })
      .catch(() => { if (live) setRefFailed(true); });
    return () => { live = false; };
  }, []);

  // No referral link and no setup call → nothing left to show after the type question.
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    if (phase === 'invite' && refFailed && !SETUP_CALL_URL) done.current();
  }, [phase, refFailed]);

  function pickType(id: SignupTypeId | null) {
    if (id) {
      const headers = getMIApiHeaders();
      headers.set('Content-Type', 'application/json');
      fetch('/api/app/signup-type', { method: 'POST', headers, body: JSON.stringify({ signupType: id }) }).catch(() => {});
    }
    track?.({ phase: 'signup_type', signup_type: id ?? 'skipped' });
    setPhase('invite');
  }

  if (phase === 'type') {
    return (
      <main className="min-h-screen bg-ground-deep px-4 py-16 text-white">
        <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-8">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-emerald-300">One last question</p>
          <h1 className="mt-3 text-2xl font-bold">Which best describes you?</h1>
          <div className="mt-6 grid gap-2">
            {SIGNUP_TYPES.map((t) => (
              <button
                key={t.id} type="button" onClick={() => pickType(t.id)}
                className="rounded-lg border border-white/15 px-4 py-3 text-left text-[15px] text-ink hover:border-emerald-400 hover:bg-white/[0.04]"
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => pickType(null)} className="mt-4 text-sm text-muted hover:text-ink">Skip</button>
        </div>
      </main>
    );
  }

  if (!ref && !refFailed) {
    return <main className="flex min-h-screen items-center justify-center bg-ground-deep text-muted">Finishing setup…</main>;
  }

  const mailto = ref
    ? `mailto:?subject=${encodeURIComponent('Try Mindy with me — free federal contract alerts')}&body=${encodeURIComponent(
      `I'm using Mindy to find federal contracts. It's free to start, and if you sign up with my link we both get ${ref.reward} credits:\n\n${ref.link}`,
    )}`
    : '';

  return (
    <main className="min-h-screen bg-ground-deep px-4 py-16 text-white">
      <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-8">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-emerald-300">You&apos;re all set</p>
        {ref && (
          <>
            <h1 className="mt-3 text-2xl font-bold">Invite a teaming partner</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              Know a sub, a prime or a coworker chasing federal work? Send them your link. When they sign up,
              you <b className="text-ink">both</b> get {ref.reward} free credits.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly value={ref.link} onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-ground px-3 py-2 font-mono text-[12.5px] text-ink"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(ref.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
                  track?.({ phase: 'invite', method: 'copy' });
                }}
                className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
              >
                {copied ? '✓ Copied' : 'Copy link'}
              </button>
            </div>
            <a
              href={mailto} onClick={() => track?.({ phase: 'invite', method: 'email' })}
              className="mt-3 inline-block text-sm font-semibold text-emerald-300 hover:text-emerald-200"
            >
              Email it to a partner →
            </a>
          </>
        )}
        {SETUP_CALL_URL && (
          <div className={ref ? 'mt-8 rounded-xl border border-white/10 p-5' : 'mt-3'}>
            <h2 className="text-lg font-bold">Want help getting set up?</h2>
            <p className="mt-1 text-[14px] text-muted">Book a free 15-minute call. We&apos;ll find your first opportunity together.</p>
            <a
              href={SETUP_CALL_URL} target="_blank" rel="noreferrer"
              onClick={() => track?.({ phase: 'setup_call', method: 'book' })}
              className="mt-3 inline-block rounded-lg border border-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-400/10"
            >
              Book a setup call
            </a>
          </div>
        )}
        <div className="mt-8 border-t border-white/10 pt-6">
          <button
            type="button"
            onClick={() => { track?.({ phase: 'invite', method: 'continue' }); onDone(); }}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Continue to my opportunities
          </button>
        </div>
      </div>
    </main>
  );
}
