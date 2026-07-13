'use client';

/**
 * /oauth/authorize — the consent screen an MCP client (Claude Desktop, Cursor)
 * opens in the browser during the keyless connect flow.
 *
 * Identity is the user's EXISTING Mindy session (localStorage MI token) — no new
 * login system. If signed in → one-click Allow. If not → we point them at /app to
 * sign in (new tab) and poll for the session to appear (localStorage is shared
 * across same-origin tabs), then show consent. Allow → POST the approve API →
 * follow the returned redirect back to the client with ?code=…&state=…. Deny →
 * redirect with error=access_denied.
 */
import { useCallback, useEffect, useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';

interface AuthzParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
  resource: string;
}

function readParams(): AuthzParams {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  return {
    client_id: q.get('client_id') || '',
    redirect_uri: q.get('redirect_uri') || '',
    response_type: q.get('response_type') || 'code',
    code_challenge: q.get('code_challenge') || '',
    code_challenge_method: q.get('code_challenge_method') || 'S256',
    scope: q.get('scope') || 'mcp',
    state: q.get('state') || '',
    resource: q.get('resource') || '',
  };
}

export default function AuthorizePage() {
  const [stage, setStage] = useState<'loading' | 'signin' | 'consent' | 'working' | 'error'>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [params, setParams] = useState<AuthzParams | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = readParams();
    setParams(p);
    if (!p.client_id || !p.redirect_uri || !p.code_challenge) {
      setError('This authorization link is missing required parameters.');
      setStage('error');
      return;
    }
    const e = localStorage.getItem('mi_beta_email');
    if (e) {
      setEmail(e);
      setStage('consent');
    } else {
      setStage('signin');
    }
  }, []);

  // While on the sign-in step, poll for the session appearing in another tab.
  useEffect(() => {
    if (stage !== 'signin') return;
    const id = setInterval(() => {
      const e = localStorage.getItem('mi_beta_email');
      if (e) {
        setEmail(e);
        setStage('consent');
      }
    }, 1500);
    return () => clearInterval(id);
  }, [stage]);

  const deny = useCallback(() => {
    if (!params) return;
    const url = new URL(params.redirect_uri);
    url.searchParams.set('error', 'access_denied');
    if (params.state) url.searchParams.set('state', params.state);
    window.location.href = url.toString();
  }, [params]);

  const allow = useCallback(async () => {
    if (!params || !email) return;
    setStage('working');
    try {
      const res = await fetch('/api/oauth/authorize/approve', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email, ...params }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.redirect) {
        window.location.href = j.redirect;
      } else {
        setError(j?.error_description || j?.error || 'Could not complete authorization.');
        setStage('error');
      }
    } catch {
      setError('Network error completing authorization.');
      setStage('error');
    }
  }, [params, email]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#0a0f1e] px-6 text-slate-100 [color-scheme:dark]">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-400 text-lg font-bold text-[#0a0f1e]">M</div>

        {stage === 'loading' && <p className="text-sm text-slate-400">Loading…</p>}

        {stage === 'signin' && (
          <>
            <h1 className="text-xl font-semibold">Sign in to continue</h1>
            <p className="mt-2 text-sm text-slate-400">
              Sign in to your Mindy account to connect{params?.client_id ? ' this app' : ''}. This tab will continue automatically once you&apos;re signed in.
            </p>
            <a
              href="/app"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400"
            >
              Sign in to Mindy ↗
            </a>
            <p className="mt-3 text-[12px] text-slate-500">Waiting for sign-in…</p>
          </>
        )}

        {stage === 'consent' && (
          <>
            <h1 className="text-xl font-semibold">Connect to Mindy?</h1>
            <p className="mt-2 text-sm text-slate-400">
              Allow this app to connect to your Mindy account? It can search SAM, pull playbooks, financials &amp; pricing, and{' '}
              <strong className="text-slate-300">spend your credits</strong> on your behalf.
            </p>
            <p className="mt-3 text-[12px] text-slate-500">Signed in as <span className="text-slate-300">{email}</span></p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={deny} className="rounded-xl border border-white/[0.12] px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/[0.04]">Deny</button>
              <button onClick={allow} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">Allow</button>
            </div>
          </>
        )}

        {stage === 'working' && <p className="text-sm text-slate-400">Connecting…</p>}

        {stage === 'error' && (
          <>
            <h1 className="text-lg font-semibold text-rose-300">Authorization failed</h1>
            <p className="mt-2 text-sm text-slate-400">{error}</p>
          </>
        )}
      </div>
    </main>
  );
}
