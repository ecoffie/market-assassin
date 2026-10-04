'use client';

/**
 * Create a Mindy connection key for an automation (Lindy / Zapier / Make / n8n).
 *
 * The key is issued with the `briefings:read` scope: it reads only the owner's own
 * briefings through /api/lindy/*, is refused by the MCP edge, earns no credits, and is
 * shown exactly once. Identity is the signed-in session (/api/mcp/session), never a
 * typed or remembered email.
 */
import { useCallback, useEffect, useState } from 'react';
import { getMIApiHeaders } from '@/components/app/authHeaders';

export default function ConnectionKeyCard() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/mcp/session', { headers: getMIApiHeaders() })
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => null) }))
      .then(({ ok, j }) => {
        if (ok && j?.email) { setEmail(j.email); setState('in'); } else setState('out');
      })
      .catch(() => setState('out'));
  }, []);

  const create = useCallback(async () => {
    if (!email) return;
    setBusy(true); setError(null); setKey(null);
    try {
      const headers = getMIApiHeaders(email);
      headers.set('Content-Type', 'application/json');
      const res = await fetch(`/api/mcp/keys?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ purpose: 'briefings', label: 'Lindy / automation connection' }),
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success && j.key) setKey(j.key);
      else setError(res.status === 401 ? 'Your session expired. Sign in again, then create the key.' : 'Could not create the key. Try again.');
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }, [email]);

  const copy = useCallback(async () => {
    if (!key) return;
    try { await navigator.clipboard.writeText(key); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* manual copy */ }
  }, [key]);

  if (state === 'loading') {
    return <p className="text-gray-400 text-sm">Checking your sign-in…</p>;
  }

  if (state === 'out') {
    return (
      <div>
        <p className="text-gray-300 mb-3">Sign in to Mindy to create a connection key for your account.</p>
        <a href="/app" className="inline-block bg-amber-500 hover:bg-amber-400 text-gray-950 font-semibold px-4 py-2 rounded">
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div>
      <p className="text-gray-300 mb-3">
        Signed in as <span className="text-white">{email}</span>. The key reads only your own briefings. It
        cannot use Mindy tools or credits, and you can revoke it any time in{' '}
        <a href="/mcp/account?section=keys" className="text-amber-400 underline">your account</a>.
      </p>
      {!key && (
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-gray-950 font-semibold px-4 py-2 rounded"
        >
          {busy ? 'Creating…' : 'Create connection key'}
        </button>
      )}
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      {key && (
        <div className="mt-2">
          <p className="text-amber-300 text-sm mb-2">Copy it now. It is shown only once.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm break-all">{key}</code>
            <button type="button" onClick={copy} className="border border-gray-700 hover:border-gray-500 px-3 py-2 rounded text-sm">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
