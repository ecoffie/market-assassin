'use client';

/**
 * getmindy.ai/mcp — the Mindy MCP self-serve dashboard (Phase 1 Slice 5).
 *
 * Generate/revoke API keys, see credit balance + usage, copy the mcp.json snippet, and
 * view the per-tool price table + credit packages. All reads go through /api/mcp/account
 * and /api/mcp/keys (2FA-gated via authedFetch). Lives on the getmindy.ai host — the
 * mcp.getmindy.ai host rewrites /mcp to the transport, so there's no route collision.
 */
import { useCallback, useEffect, useState } from 'react';
import { authedFetch } from '@/components/app/authHeaders';

interface KeyRow {
  id: string;
  key_prefix: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
interface Tool { name: string; description: string; credits: number }
interface Pkg { id: string; credits: number; usd: number; label: string }
interface Call { tool_name: string; status: string; credits_charged: number; created_at: string }

const MCP_URL = 'https://mcp.getmindy.ai/mcp';

export default function McpDashboard() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null); // shown ONCE
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') setEmail(localStorage.getItem('mi_beta_email'));
  }, []);

  const load = useCallback(async (e: string) => {
    setLoading(true);
    setError(null);
    try {
      const [acc, ks] = await Promise.all([
        authedFetch(`/api/mcp/account?email=${encodeURIComponent(e)}`, e).then((r) => r.json()),
        authedFetch(`/api/mcp/keys?email=${encodeURIComponent(e)}`, e).then((r) => r.json()),
      ]);
      if (acc?.success) {
        setBalance(acc.balance);
        setTools(acc.tools || []);
        setPackages(acc.packages || []);
        setCalls(acc.recentCalls || []);
      } else if (acc?.error) setError(acc.error);
      if (ks?.success) setKeys(ks.keys || []);
    } catch {
      setError('Could not load your MCP account. Try signing in again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (email) load(email);
  }, [email, load]);

  async function createKey() {
    if (!email) return;
    setBusy(true);
    setNewKey(null);
    try {
      const r = await authedFetch(`/api/mcp/keys`, email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, label: label.trim() || undefined }),
      }).then((res) => res.json());
      if (r?.key) {
        setNewKey(r.key);
        setLabel('');
        await load(email);
      } else setError(r?.error || 'Could not create key');
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    if (!email || !confirm('Revoke this key? Any agent using it stops working immediately.')) return;
    await authedFetch(`/api/mcp/keys?id=${encodeURIComponent(id)}&email=${encodeURIComponent(email)}`, email, { method: 'DELETE' });
    await load(email);
  }

  const mcpJson = `{
  "mcpServers": {
    "mindy": {
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer ${newKey || 'mcp_live_YOUR_KEY'}" }
    }
  }
}`;

  if (!email) {
    return (
      <main className="min-h-dvh bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Mindy MCP</h1>
          <p className="text-slate-400">Please <a href="/app" className="text-emerald-400 underline">sign in</a> to manage your MCP API keys and credits.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Mindy MCP</h1>
            <p className="text-slate-400 text-sm">Point any MCP agent at Mindy&apos;s GovCon intelligence.</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-emerald-400">{balance ?? '—'}</div>
            <div className="text-xs text-slate-400 uppercase tracking-wide">credits</div>
          </div>
        </header>

        {error && <div className="rounded-lg bg-rose-950/60 border border-rose-800 px-4 py-3 text-rose-200 text-sm">{error}</div>}

        {/* Connect snippet */}
        <section className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <h2 className="font-semibold mb-2">Connect your agent</h2>
          <p className="text-slate-400 text-sm mb-3">Create a key below, then drop this into your client&apos;s <code className="text-slate-300">mcp.json</code>:</p>
          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs overflow-x-auto text-slate-300">{mcpJson}</pre>
          <button onClick={() => navigator.clipboard.writeText(mcpJson)} className="mt-2 text-xs text-emerald-400 hover:underline">Copy snippet</button>
        </section>

        {/* Keys */}
        <section className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <h2 className="font-semibold mb-3">API keys</h2>
          {newKey && (
            <div className="mb-4 rounded-lg bg-emerald-950/50 border border-emerald-800 p-3">
              <p className="text-emerald-200 text-sm font-medium mb-1">Your new key — copy it now, it won&apos;t be shown again:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-slate-950 rounded px-2 py-1 text-xs text-emerald-300 overflow-x-auto">{newKey}</code>
                <button onClick={() => navigator.clipboard.writeText(newKey)} className="text-xs bg-emerald-700 hover:bg-emerald-600 px-2 py-1 rounded">Copy</button>
              </div>
            </div>
          )}
          <div className="flex gap-2 mb-4">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Claude Desktop)" className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm" />
            <button onClick={createKey} disabled={busy} className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium">{busy ? 'Creating…' : 'Create key'}</button>
          </div>
          {loading ? (
            <p className="text-slate-500 text-sm">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="text-slate-500 text-sm">No keys yet. Create one to get started (you get free credits on your first key).</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {keys.map((k) => (
                <li key={k.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <code className="text-slate-300">{k.key_prefix}…</code>
                    {k.label && <span className="text-slate-500 ml-2">{k.label}</span>}
                    {k.revoked_at && <span className="text-rose-400 ml-2 text-xs">revoked</span>}
                    <div className="text-xs text-slate-500">
                      {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'never used'}
                    </div>
                  </div>
                  {!k.revoked_at && <button onClick={() => revokeKey(k.id)} className="text-rose-400 hover:underline text-xs">Revoke</button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Credits / packages */}
        <section className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <h2 className="font-semibold mb-3">Buy credits</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {packages.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-center">
                <div className="text-lg font-bold">${p.usd}</div>
                <div className="text-emerald-400 text-sm">{p.credits.toLocaleString()} credits</div>
                <div className="text-xs text-slate-500 mt-1">{p.label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">Checkout activates once Stripe products are live. Pro subscribers get a monthly credit allowance automatically.</p>
        </section>

        {/* Tool prices */}
        <section className="rounded-xl bg-slate-900 border border-slate-800 p-5">
          <h2 className="font-semibold mb-3">Tools &amp; pricing</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500 text-xs uppercase"><th className="pb-2">Tool</th><th className="pb-2 text-right">Credits</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {tools.map((t) => (
                <tr key={t.name}><td className="py-2"><code className="text-slate-300">{t.name}</code></td><td className="py-2 text-right text-emerald-400">{t.credits}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Recent usage */}
        {calls.length > 0 && (
          <section className="rounded-xl bg-slate-900 border border-slate-800 p-5">
            <h2 className="font-semibold mb-3">Recent usage</h2>
            <ul className="divide-y divide-slate-800 text-sm">
              {calls.map((c, i) => (
                <li key={i} className="py-1.5 flex items-center justify-between">
                  <code className="text-slate-300">{c.tool_name}</code>
                  <span className="text-slate-500 text-xs">{c.status}</span>
                  <span className="text-slate-400">−{c.credits_charged}</span>
                  <span className="text-slate-600 text-xs">{new Date(c.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
