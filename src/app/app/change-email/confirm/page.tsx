'use client';

/**
 * /app/change-email/confirm?token=… — the verify-click landing page.
 *
 * Posts the token to /api/app/change-email/confirm, which runs the actual
 * re-key. On success we swap the stored MI session to the NEW email so the user
 * stays signed in, then send them into the app. Old email keeps working until
 * this completes, so a failed/expired link is safe.
 */

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

type Status = 'working' | 'success' | 'error';

function ConfirmInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') || '';
  const [status, setStatus] = useState<Status>('working');
  const [message, setMessage] = useState('Confirming your new email…');
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setStatus('error');
        setMessage('This link is missing its confirmation token. Please use the link from your email.');
        return;
      }
      try {
        const res = await fetch('/api/app/change-email/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data?.success) {
          // Swap the stored session to the new email so we stay signed in.
          try {
            if (data.sessionToken) localStorage.setItem('mi_beta_auth_token', data.sessionToken);
            if (data.newEmail) localStorage.setItem('mi_beta_email', data.newEmail);
            localStorage.setItem('mi_beta_authenticated_at', new Date().toISOString());
          } catch { /* storage may be blocked; the redirect still works via re-auth */ }
          setNewEmail(data.newEmail || '');
          setStatus('success');
          setMessage(data.alreadyDone
            ? 'This change was already confirmed. You are all set.'
            : 'Your email has been updated. Signing you in…');
          setTimeout(() => router.push('/app'), 1800);
        } else if (data?.collision) {
          setStatus('error');
          setMessage(data.error || 'That email now has an account. Please contact support to merge them.');
        } else {
          setStatus('error');
          setMessage(data?.error || 'We could not complete the change. Your current email still works — try requesting the change again.');
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
          setMessage('Something went wrong. Your current email still works — please try again.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, router]);

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1120', padding: 24 }}>
      <div style={{ maxWidth: 440, width: '100%', background: '#111827', border: '1px solid #1f2937', borderRadius: 16, padding: 32, color: '#e5e7eb', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>
          {status === 'working' ? '⏳' : status === 'success' ? '✅' : '⚠️'}
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px', color: '#fff' }}>
          {status === 'success' ? 'Email updated' : status === 'error' ? 'Couldn’t confirm' : 'Confirming…'}
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0, color: '#9ca3af' }}>{message}</p>
        {status === 'success' && newEmail && (
          <p style={{ fontSize: 14, marginTop: 12, color: '#fff' }}>You’ll sign in with <strong>{newEmail}</strong> from now on.</p>
        )}
        {status === 'error' && (
          <a href="/app" style={{ display: 'inline-block', marginTop: 18, color: '#a78bfa', textDecoration: 'none', fontWeight: 600 }}>Return to Mindy →</a>
        )}
      </div>
    </div>
  );
}

export default function ChangeEmailConfirmPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#0b1120' }} />}>
      <ConfirmInner />
    </Suspense>
  );
}
