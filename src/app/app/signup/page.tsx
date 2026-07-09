'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import { signInWithGoogle, signInWithMicrosoft } from '@/lib/supabase/auth';
import { capturePartnerRefFromSearchParams, getStoredPartnerRef } from '@/lib/mindy/partner-referral-client';
import { getPartnerReferralByCode } from '@/lib/mindy/partner-referrals';

/**
 * Read the attribution AttributionTracker stored (gca_attribution) so signup can
 * forward it to the server for source counting (YouTube etc.). Best-effort — any
 * failure returns undefined and signup proceeds normally.
 */
function readAttribution(): unknown {
  try {
    const raw = window.localStorage.getItem('gca_attribution');
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export default function MindySignupPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-ground-deep flex items-center justify-center">
        <div className="text-muted">Loading...</div>
      </main>
    }>
      <MindySignupContent />
    </Suspense>
  );
}

function MindySignupContent() {
  const searchParams = useSearchParams();
  const [partnerRef, setPartnerRef] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // True when signup was captured during a DB outage (link delayed, not sent yet).
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState('');
  const [oauthLoading, setOauthLoading] = useState<'google' | 'microsoft' | null>(null);

  useEffect(() => {
    const ref = capturePartnerRefFromSearchParams(searchParams) || getStoredPartnerRef();
    setPartnerRef(ref);
  }, [searchParams]);

  const partnerProgram = getPartnerReferralByCode(partnerRef);

  // Handle email signup (sends verification link)
  async function handleEmailSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!email || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/auth/mindy-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          referralCode: partnerRef || undefined,
          // Forward the attribution AttributionTracker captured (gca_attribution)
          // so the server can record which channel — e.g. YouTube — this signup
          // came from. Best-effort; never blocks signup if storage is unavailable.
          attribution: readAttribution(),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setQueued(data.queued === true);
        setSubmitted(true);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle Google OAuth
  async function handleGoogleSignup() {
    setOauthLoading('google');
    setError('');

    const result = await signInWithGoogle();

    if (!result.success) {
      setError(result.error || 'Failed to connect with Google');
      setOauthLoading(null);
    }
    // If successful, user is redirected to Google
  }

  // Handle Microsoft OAuth
  async function handleMicrosoftSignup() {
    setOauthLoading('microsoft');
    setError('');

    const result = await signInWithMicrosoft();

    if (!result.success) {
      setError(result.error || 'Failed to connect with Microsoft');
      setOauthLoading(null);
    }
    // If successful, user is redirected to Microsoft
  }

  return (
    <main className="min-h-screen bg-ground-deep flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <MindyLogo size={64} className="mx-auto mb-4" />
          </Link>
          <h1 className="text-2xl font-bold text-white">Create your Mindy account</h1>
          <p className="text-muted mt-2">Start getting federal market intelligence</p>
          {partnerProgram && (
            <p className="text-emerald-400 text-sm mt-3 font-medium">
              {partnerProgram.name} partner offer: {partnerProgram.trialDays}-day Mindy Pro trial included
            </p>
          )}
        </div>

        {/* Card */}
        <div className="bg-ground border border-surface rounded-2xl p-8">
          {!submitted ? (
            <>
              {/* OAuth Buttons */}
              <div className="space-y-3 mb-6">
                <button
                  onClick={handleGoogleSignup}
                  disabled={oauthLoading !== null}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 text-gray-800 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {oauthLoading === 'google' ? (
                    <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                  )}
                  Continue with Google
                </button>

                <button
                  onClick={handleMicrosoftSignup}
                  disabled={oauthLoading !== null}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-[#2F2F2F] hover:bg-[#3F3F3F] text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {oauthLoading === 'microsoft' ? (
                    <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 21 21">
                      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                    </svg>
                  )}
                  Continue with Microsoft
                </button>
              </div>

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-hairline"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-ground text-faint">or continue with email</span>
                </div>
              </div>

              {/* Email Form */}
              <form onSubmit={handleEmailSignup} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-ink-soft mb-2">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    className="w-full px-4 py-3 bg-surface border border-hairline rounded-xl text-white placeholder-faint focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>

                {error && (
                  <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || oauthLoading !== null}
                  className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Sending link...' : 'Get Your First Briefing Free'}
                </button>
              </form>

              <p className="text-center text-faint text-xs mt-4">
                Free forever. No credit card required.
              </p>
            </>
          ) : (
            /* Success State */
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              {queued ? (
                <>
                  <h2 className="text-xl font-bold text-white mb-2">You&apos;re on the list</h2>
                  <p className="text-muted mb-4">
                    We saved your spot for <span className="text-white">{email}</span>
                  </p>
                  <p className="text-faint text-sm">
                    We&apos;re finishing setup and will email your link shortly — no need to sign up again. Thanks for your patience.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-white mb-2">Check your inbox</h2>
                  <p className="text-muted mb-4">
                    We sent a verification link to <span className="text-white">{email}</span>
                  </p>
                  <p className="text-faint text-sm">
                    Click the link in the email to set up your password and complete signup.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Sign in link */}
          <div className="mt-6 pt-6 border-t border-surface text-center">
            <p className="text-muted text-sm">
              Already have an account?{' '}
              <Link href="/app" className="text-purple-400 hover:text-purple-300 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>

        {/* Terms */}
        <p className="text-center text-slate-600 text-xs mt-6">
          By signing up, you agree to our{' '}
          <Link href="/terms" className="text-faint hover:text-muted">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-faint hover:text-muted">
            Privacy Policy
          </Link>
        </p>
      </div>
    </main>
  );
}
