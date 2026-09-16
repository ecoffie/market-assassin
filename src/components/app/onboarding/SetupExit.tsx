'use client';

/**
 * Visible exit on every profile-setup step. Requires an existing MI session to
 * stamp the deferral — a 401 does not create one. Navigation still follows the
 * original destination (Maps, connector authorize, or /welcome).
 */
import { useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';

export function SetupExit({
  email,
  className = 'text-sm font-medium text-slate-300 underline underline-offset-4 hover:text-white',
}: {
  email?: string | null;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function exitSetup() {
    if (busy) return;
    setBusy(true);
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    let path = '/opportunity-map';
    try {
      const res = await fetch('/api/app/setup-deferral', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email: email || undefined,
          next: params.get('next'),
          intent: params.get('intent'),
          purchaseNext: params.get('purchase_next'),
        }),
      });
      const j = await res.json().catch(() => null);
      if (typeof j?.path === 'string' && j.path.startsWith('/')) path = j.path;
    } catch {
      /* destination fallback stays Maps — no session is minted here */
    }
    window.location.href = path;
  }

  return (
    <button type="button" onClick={exitSetup} disabled={busy} className={className}>
      {busy ? 'Leaving setup…' : 'Skip for now · Exit setup'}
    </button>
  );
}
