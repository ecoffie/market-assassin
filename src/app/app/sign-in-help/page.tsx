/**
 * SIGN-IN HELP — the dedicated state for an OAuth failure the user cannot fix alone.
 *
 * The important case is `tenant_policy`: the user's OWN organization requires an admin to
 * approve Mindy before anyone there can sign in. That is NOT a generic login failure and
 * must never be rendered as one — the user would retry forever, blame us, and never learn
 * the one action that resolves it.
 *
 * Each state answers three questions: what happened, WHO can fix it, and what to do now.
 * `app_misconfigured` deliberately does NOT tell the org to call their IT admin — that
 * failure is ours, so it routes to our support instead.
 */
'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { OAuthFailureKind } from '@/lib/auth/oauth-failure';

const PROVIDER_LABEL: Record<string, string> = {
  microsoft: 'Microsoft',
  google: 'Google',
  apple: 'Apple',
  unknown: 'your identity provider',
};

function AdminApprovalState({ provider, code }: { provider: string; code: string | null }) {
  const label = PROVIDER_LABEL[provider] ?? PROVIDER_LABEL.unknown;

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">
        Approval needed
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
        Your organization requires admin approval
      </h1>
      <p className="mt-4 text-slate-300">
        {label} blocked the sign-in because an administrator at your organization hasn&apos;t
        approved Mindy yet. This is a policy set by your company, not a problem with your
        account — and you can&apos;t change it yourself.
      </p>

      <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-sm font-semibold text-white">Send this to your IT administrator</h2>
        <ol className="mt-3 space-y-2.5 text-sm text-slate-300">
          <li className="flex gap-3">
            <span className="font-mono text-xs text-amber-300/90">1</span>
            <span>
              Open the <span className="text-white">Microsoft Entra admin center</span> →
              Enterprise applications.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-xs text-amber-300/90">2</span>
            <span>
              Find <span className="text-white">Mindy</span> (or approve the pending request
              under Enterprise applications → Admin consent requests).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-xs text-amber-300/90">3</span>
            <span>
              Grant admin consent for the requested sign-in permissions — Mindy asks only for
              your name, email address and basic profile.
            </span>
          </li>
        </ol>
        <p className="mt-4 border-t border-white/10 pt-3 text-xs text-slate-400">
          Mindy never requests access to mail, files, or calendars.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/app"
          className="rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Try again
        </Link>
        <Link
          href="/app/signup"
          className="rounded-md border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Use a different email instead
        </Link>
      </div>
      <p className="mt-3 text-sm text-slate-400">
        Approval can take a day or two. Signing up with another address gets you started now.
      </p>

      {code ? (
        <p className="mt-8 font-mono text-xs text-slate-500">
          Reference for your admin: {code}
        </p>
      ) : null}
    </>
  );
}

function OurProblemState() {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-rose-300">
        On our side
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
        Something is misconfigured on our end
      </h1>
      <p className="mt-4 text-slate-300">
        Sign-in failed because of a configuration problem in Mindy — not your organization and
        not your account. We&apos;ve logged it. Please don&apos;t ask your IT team to change
        anything; this one is ours to fix.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/app"
          className="rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Try again
        </Link>
        <a
          href="mailto:support@getmindy.ai?subject=Sign-in%20problem"
          className="rounded-md border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Contact support
        </a>
      </div>
    </>
  );
}

function CancelledState() {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
        Sign-in cancelled
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">No harm done</h1>
      <p className="mt-4 text-slate-300">
        The sign-in was cancelled before it finished. Nothing was changed on your account.
      </p>
      <div className="mt-8">
        <Link
          href="/app"
          className="rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Back to sign in
        </Link>
      </div>
    </>
  );
}

function GenericState({ code }: { code: string | null }) {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
        Sign-in failed
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
        We couldn&apos;t complete your sign-in
      </h1>
      <p className="mt-4 text-slate-300">
        Something went wrong on the way back from your identity provider. Trying again usually
        works. If it keeps happening, send us the reference below and we&apos;ll dig in.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/app"
          className="rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Try again
        </Link>
        <a
          href="mailto:support@getmindy.ai?subject=Sign-in%20problem"
          className="rounded-md border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Contact support
        </a>
      </div>
      {code ? (
        <p className="mt-8 font-mono text-xs text-slate-500">Reference: {code}</p>
      ) : null}
    </>
  );
}

function SignInHelpContent() {
  const params = useSearchParams();
  const reason = (params.get('reason') || 'generic') as OAuthFailureKind;
  const provider = params.get('provider') || 'unknown';
  const code = params.get('code');

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <div>
        {reason === 'tenant_policy' ? (
          <AdminApprovalState provider={provider} code={code} />
        ) : reason === 'app_misconfigured' ? (
          <OurProblemState />
        ) : reason === 'user_cancelled' ? (
          <CancelledState />
        ) : (
          <GenericState code={code} />
        )}
      </div>
    </main>
  );
}

export default function SignInHelpPage() {
  return (
    <div className="min-h-dvh bg-slate-950">
      <Suspense fallback={<div className="min-h-dvh bg-slate-950" />}>
        <SignInHelpContent />
      </Suspense>
    </div>
  );
}
