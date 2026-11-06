'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
      <main className="su"><style dangerouslySetInnerHTML={{ __html: SIGNUP_CSS }} />
        <div className="su-wrap"><div className="su-card"><p className="su-sub">Loading…</p></div></div>
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
  const [oauthLoading, setOauthLoading] = useState<'google' | 'microsoft' | 'apple' | null>(null);

  useEffect(() => {
    const ref = capturePartnerRefFromSearchParams(searchParams) || getStoredPartnerRef();
    setPartnerRef(ref);
  }, [searchParams]);

  // Signup credit grant, from the PUBLIC catalog endpoint (no auth; reads
  // SIGNUP_CREDITS server-side). Fetched so the promise on this page can never
  // drift from the amount actually granted. 0 until loaded → the line simply does
  // not render rather than flashing a possibly-wrong number.
  const [signupCredits, setSignupCredits] = useState(0);
  useEffect(() => {
    fetch('/api/mcp/catalog')
      .then((r) => r.json())
      .then((d) => { if (typeof d?.signupCredits === 'number') setSignupCredits(d.signupCredits); })
      .catch(() => {});
  }, []);

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

  // Apple OAuth disabled until the Apple provider is connected — handler removed;
  // restore it + signInWithApple import + the button when configured.

  const googleIcon = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
  const microsoftIcon = (
    <svg viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
  const spinner = <span className="su-spin" aria-hidden="true" />;

  return (
    <main className="su">
      <style dangerouslySetInnerHTML={{ __html: SIGNUP_CSS }} />
      <header className="su-bar">
        <Link href="/" className="su-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- the brand mark, same file as the site header */}
          <img src="/brand/mindy-logo-icon.png" alt="" />
          <span>Mindy</span>
        </Link>
        <Link href="/app" className="su-bar-link">Sign in</Link>
      </header>

      <div className="su-wrap">
        <div className="su-card">
          {!submitted ? (
            <>
              <h1 className="su-h">Sign up for free</h1>
              <p className="su-sub">No credit card required</p>
              {/* The credit grant is the real hook for a stranger — it is what they get the moment
                  they finish signing up (granted automatically at oauth/token by
                  grantSignupCreditsIfFirst, once per email). A live partner referral shows its trial
                  offer instead; a ref persisted from an old ?ref= visit must not follow the user
                  around. The count is FETCHED from the public /api/mcp/catalog (SIGNUP_CREDITS
                  server-side): this file is 'use client' and importing credits.ts would pull the
                  service-role Supabase client into the browser bundle. */}
              {partnerProgram ? (
                <p className="su-offer">
                  {partnerProgram.name} partner offer: {partnerProgram.trialDays}-day Mindy Pro trial included
                </p>
              ) : signupCredits > 0 ? (
                <p className="su-offer">Includes {signupCredits} free credits to use Mindy in your AI tools</p>
              ) : null}

              <form onSubmit={handleEmailSignup} className="su-form">
                <label htmlFor="email" className="su-label">Enter your email address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  className="su-input"
                />
                <p className="su-terms">
                  By proceeding, I agree to Mindy&apos;s <Link href="/privacy">Privacy Policy</Link> and{' '}
                  <Link href="/terms">Terms of Service</Link>.
                </p>
                {error && <div className="su-error" role="alert">{error}</div>}
                <button type="submit" disabled={!email || isSubmitting || oauthLoading !== null} className="su-primary">
                  {isSubmitting ? 'Sending link…' : 'Continue'}
                </button>
              </form>

              <div className="su-or"><span>Or sign up with</span></div>

              <div className="su-oauth">
                <button type="button" onClick={handleGoogleSignup} disabled={oauthLoading !== null} className="su-sso">
                  {oauthLoading === 'google' ? spinner : googleIcon}
                  Google
                </button>
                <button type="button" onClick={handleMicrosoftSignup} disabled={oauthLoading !== null} className="su-sso">
                  {oauthLoading === 'microsoft' ? spinner : microsoftIcon}
                  Microsoft
                </button>
                {/* Apple sign-in hidden until the Apple OAuth provider is connected. Re-enable the
                    button here + the handler/import once configured. */}
              </div>
            </>
          ) : (
            /* Success state */
            <div className="su-done">
              <div className="su-done-ic">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              {queued ? (
                <>
                  <h1 className="su-h su-h-sm">You&apos;re on the list</h1>
                  <p className="su-sub">We saved your spot for <b>{email}</b></p>
                  <p className="su-fine">We&apos;re finishing setup and will email your link shortly — no need to sign up again. Thanks for your patience.</p>
                </>
              ) : (
                <>
                  <h1 className="su-h su-h-sm">Check your inbox</h1>
                  <p className="su-sub">We sent a verification link to <b>{email}</b></p>
                  <p className="su-fine">Click the link in the email to set up your password and complete signup.</p>
                </>
              )}
            </div>
          )}

          <p className="su-switch">
            Already have an account? <Link href="/app">Sign in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}

/** Homepage look (public-site tokens from PublicShell): light navy-wash canvas, white card, serif heading. */
const SIGNUP_CSS = [
  '.su{min-height:100vh;min-height:100dvh;background:var(--mp-navy-wash);color:var(--mp-ink);font-family:var(--mp-font-sans);-webkit-font-smoothing:antialiased}',
  '.su *{box-sizing:border-box}',
  '.su-bar{display:flex;align-items:center;justify-content:space-between;height:64px;padding:0 max(24px,env(safe-area-inset-right,0px)) 0 max(24px,env(safe-area-inset-left,0px))}',
  '.su-logo{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--mp-ink);font:700 20px var(--mp-font-sans);letter-spacing:-.02em}',
  '.su-logo img{width:28px;height:28px;display:block}',
  '.su-bar-link{font:600 15px var(--mp-font-sans);color:var(--mp-ink);text-decoration:none}',
  '.su-bar-link:hover{color:var(--mp-navy)}',
  '.su-wrap{display:flex;justify-content:center;padding:24px 16px 56px}',
  '.su-card{width:100%;max-width:460px;background:var(--mp-surface);border-radius:24px;padding:40px 32px 28px;box-shadow:0 24px 60px rgba(27,58,107,.14);border:1px solid var(--mp-hair)}',
  '.su-h{margin:0;text-align:center;font-family:var(--mp-font-serif);font-weight:400;font-size:38px;line-height:1.15;letter-spacing:-.015em}',
  '.su-h-sm{font-size:30px}',
  '.su-sub{margin:10px 0 0;text-align:center;font-size:17px;color:var(--mp-body)}',
  '.su-offer{margin:14px auto 0;max-width:340px;text-align:center;font-size:14px;font-weight:600;color:var(--mp-ok);background:var(--mp-ok-bg);border-radius:999px;padding:7px 14px}',
  '.su-form{margin-top:28px}',
  '.su-label{display:block;font-size:16px;font-weight:500;margin-bottom:8px}',
  '.su-input{width:100%;height:52px;padding:0 16px;border:1.5px solid var(--mp-line);border-radius:12px;font:400 17px var(--mp-font-sans);color:var(--mp-ink);background:var(--mp-surface)}',
  '.su-input:focus{outline:none;border-color:var(--mp-navy);box-shadow:0 0 0 3px rgba(27,58,107,.15)}',
  '.su-terms{margin:14px 0 0;font-size:14px;line-height:1.5;color:var(--mp-muted)}',
  '.su-terms a,.su-switch a{color:var(--mp-navy);font-weight:600;text-decoration:none}',
  '.su-terms a:hover,.su-switch a:hover{text-decoration:underline}',
  '.su-error{margin-top:14px;padding:10px 12px;border-radius:10px;background:var(--mp-bad-bg,#fdecea);color:var(--mp-bad,#b4231a);font-size:14px}',
  '.su-primary{margin-top:18px;width:100%;height:52px;border:0;border-radius:12px;background:var(--mp-navy);color:var(--mp-surface);font:700 17px var(--mp-font-sans);cursor:pointer;transition:background .15s}',
  '.su-primary:hover{background:var(--mp-navy-hover)}',
  '.su-primary:disabled{background:var(--mp-wash);color:var(--mp-subtle);cursor:not-allowed}',
  '.su-or{display:flex;align-items:center;gap:14px;margin:26px 0 18px;font-size:15px;color:var(--mp-body)}',
  '.su-or::before,.su-or::after{content:"";flex:1;height:1px;background:var(--mp-hair)}',
  '.su-oauth{display:grid;gap:12px}',
  '.su-sso{display:flex;align-items:center;justify-content:center;gap:12px;height:52px;border:1.5px solid var(--mp-line);border-radius:12px;background:var(--mp-surface);color:var(--mp-ink);font:600 17px var(--mp-font-sans);cursor:pointer;transition:border-color .15s,background .15s}',
  '.su-sso:hover{border-color:var(--mp-navy);background:var(--mp-navy-wash)}',
  '.su-sso:disabled{opacity:.55;cursor:not-allowed}',
  '.su-sso svg{width:22px;height:22px;flex:none}',
  '.su-spin{width:20px;height:20px;border:2px solid var(--mp-line);border-top-color:var(--mp-navy);border-radius:50%;animation:su-spin .8s linear infinite}',
  '@keyframes su-spin{to{transform:rotate(360deg)}}',
  '.su-done{text-align:center;padding:4px 0}',
  '.su-done-ic{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;background:var(--mp-ok-bg);color:var(--mp-ok);display:grid;place-items:center}',
  '.su-done-ic svg{width:30px;height:30px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
  '.su-fine{margin:12px 0 0;font-size:14px;color:var(--mp-muted)}',
  '.su-switch{margin:26px 0 0;padding-top:20px;border-top:1px solid var(--mp-hair);text-align:center;font-size:15px;color:var(--mp-body)}',
  '@media(max-width:620px){.su-bar{padding:0 16px}.su-wrap{padding:8px 12px 40px}.su-card{padding:32px 20px 24px;border-radius:22px}.su-h{font-size:34px}}',
  '@media (prefers-reduced-motion: reduce){.su-spin{animation:none}.su-primary,.su-sso{transition:none}}',
].join('');
