'use client';

/**
 * Last hop of native-app OAuth (see /app/auth/callback `finish`). This page opens in the
 * SYSTEM browser, not the app. It hands the session back to the Mindy app via the custom
 * scheme; the app's NativeBridge closes the browser and loads `to` + the token fragment
 * inside the WebView, where the Supabase client picks the session up as usual.
 */
import { useEffect } from 'react';
import { nativeReturnUrl } from '@/lib/native/platform';

function returnToApp() {
  const to = new URLSearchParams(window.location.search).get('to');
  window.location.href = nativeReturnUrl(to || '/app', window.location.hash);
}

export default function NativeReturnPage() {
  useEffect(() => { returnToApp(); }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold text-white mb-2">Signed in</h1>
        <p className="text-slate-300 mb-6">Returning you to the Mindy app…</p>
        <button
          type="button"
          onClick={returnToApp}
          className="inline-block rounded-lg bg-white px-6 py-3 font-semibold text-blue-900"
        >
          Open Mindy
        </button>
      </div>
    </main>
  );
}
