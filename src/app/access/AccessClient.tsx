'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function AccessClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [message, setMessage] = useState('Verifying your secure link...');
  const [error, setError] = useState('');
  const missingToken = !token;

  useEffect(() => {
    if (!token) {
      return;
    }

    const consume = async () => {
      try {
        const response = await fetch('/api/access-links/consume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await response.json();

        if (!data.success) {
          setError(data.error || 'This secure link is invalid or expired.');
          return;
        }

        if (data.destination === 'briefings') {
          localStorage.setItem('briefings_access_email', data.email);
        } else {
          localStorage.setItem('preferences_access_email', data.email);
        }

        setMessage('Secure link verified. Redirecting...');
        window.location.href = data.redirectTo;
      } catch {
        setError('We could not verify this secure link. Please request a new one.');
      }
    };

    void consume();
  }, [token]);

  return (
    <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
      <h1 className="text-2xl font-bold text-white mb-3">Secure Access</h1>
      {missingToken ? (
        <p className="text-red-400">Missing secure link token.</p>
      ) : error ? (
        <p className="text-red-400">{error}</p>
      ) : (
        <p className="text-slate-300">{message}</p>
      )}
    </div>
  );
}
