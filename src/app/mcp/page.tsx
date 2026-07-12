'use client';

/**
 * getmindy.ai/mcp — the Mindy MCP developer console (Phase 1 Slice 5, redesigned).
 *
 * Mint/revoke API keys, see credit balance + usage, copy the mcp.json snippet, buy
 * credits. Lives on the getmindy.ai host (mcp.getmindy.ai rewrites /mcp to the
 * transport, so no route collision). Auth via authedFetch (2FA-gated); email from
 * localStorage like every /app surface.
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
interface Pkg { id: string; credits: number; usd: number; label: string; checkoutUrl?: string }
interface Call { tool_name: string; status: string; credits_charged: number; created_at: string }

const MCP_URL = 'https://mcp.getmindy.ai/mcp';
const shortDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);

export default function McpConsole() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [justPurchased, setJustPurchased] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setEmail(localStorage.getItem('mi_beta_email'));
    if (new URLSearchParams(window.location.search).get('topup') === 'success') setJustPurchased(true);
  }, []);

  const copy = useCallback((text: string, tag: string) => {
    navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1600);
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

  useEffect(() => { if (email) load(email); }, [email, load]);

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
      if (r?.key) { setNewKey(r.key); setLabel(''); await load(email); }
      else setError(r?.error || 'Could not create key');
    } finally { setBusy(false); }
  }

  async function revokeKey(id: string) {
    if (!email || !confirm('Revoke this key? Any agent using it stops working immediately.')) return;
    await authedFetch(`/api/mcp/keys?id=${encodeURIComponent(id)}&email=${encodeURIComponent(email)}`, email, { method: 'DELETE' });
    await load(email);
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const mcpJson = `{
  "mcpServers": {
    "mindy": {
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer ${newKey || (activeKeys[0] ? activeKeys[0].key_prefix + '…' : 'mcp_live_YOUR_KEY')}" }
    }
  }
}`;

  const step = (n: number, done: boolean) => (
    <span
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ${
        done ? 'bg-emerald-400 text-[#06120c]' : 'bg-white/10 text-slate-300 ring-1 ring-white/10'
      }`}
    >
      {done ? '✓' : n}
    </span>
  );

  if (!email) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#0a0f1e] px-6 text-slate-100">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-400 text-lg font-bold text-[#0a0f1e]">M</div>
          <h1 className="text-xl font-semibold">Mindy MCP</h1>
          <p className="mt-2 text-sm text-slate-400">
            <a href="/app" className="text-emerald-400 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-300">Sign in</a>{' '}
            to manage your API keys and credits.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-emerald-400 text-sm font-bold text-[#0a0f1e]">M</div>
            <div>
              <h1 className="text-[15px] font-semibold leading-tight">Mindy MCP</h1>
              <p className="text-xs text-slate-400">Federal contracting intel for any AI agent</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5">
            <span className="text-lg font-semibold tabular-nums text-emerald-300">{balance ?? '—'}</span>
            <span className="text-[11px] uppercase tracking-wide text-emerald-400/70">credits</span>
          </div>
        </header>

        {justPurchased && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            <span>Payment received — credits added. Your balance is now <strong className="tabular-nums">{balance ?? '…'}</strong>.</span>
            <button onClick={() => setJustPurchased(false)} className="text-emerald-400/60 hover:text-emerald-300">Dismiss</button>
          </div>
        )}
        {error && <div className="mt-5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

        {/* Quickstart — a real 3-step sequence */}
        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 text-sm">
            {step(1, activeKeys.length > 0)}<span className="text-slate-300">Create an API key</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 text-sm">
            {step(2, (balance ?? 0) > 0)}<span className="text-slate-300">Add credits</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 text-sm">
            {step(3, false)}<span className="text-slate-300">Connect your agent</span>
          </div>
        </section>

        {/* Connect snippet */}
        <Panel eyebrow="Connect" title="Point your agent at Mindy">
          <p className="text-sm text-slate-400">Drop this into your MCP client&apos;s <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[12px] text-slate-300">mcp.json</code> (Claude Desktop, Cursor, or your own agent).</p>
          <div className="relative mt-3">
            <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#070b16] p-3.5 font-mono text-[12px] leading-relaxed text-slate-300">{mcpJson}</pre>
            <button onClick={() => copy(mcpJson, 'snippet')} className="absolute right-2.5 top-2.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">{copied === 'snippet' ? 'Copied' : 'Copy'}</button>
          </div>
        </Panel>

        {/* API keys */}
        <Panel eyebrow="API keys" title="Your keys">
          {newKey && (
            <div className="mb-4 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.07] p-3">
              <p className="mb-1.5 text-[13px] font-medium text-emerald-200">Copy your key now — it won&apos;t be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-[#070b16] px-2 py-1.5 font-mono text-[12px] text-emerald-300">{newKey}</code>
                <button onClick={() => copy(newKey, 'newkey')} className="shrink-0 rounded-md bg-emerald-500 px-2.5 py-1.5 text-[12px] font-medium text-[#06120c] hover:bg-emerald-400">{copied === 'newkey' ? 'Copied' : 'Copy'}</button>
              </div>
            </div>
          )}
          <div className="mb-4 flex gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Claude Desktop)" className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#070b16] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none" />
            <button onClick={createKey} disabled={busy} className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-[#06120c] hover:bg-emerald-400 disabled:opacity-50">{busy ? 'Creating…' : 'Create key'}</button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-slate-500">No keys yet. Create one to get started — your first key comes with free credits.</p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-[13px] text-slate-200">{k.key_prefix}…</code>
                      {k.label && <span className="truncate text-slate-500">{k.label}</span>}
                      {k.revoked_at ? <Chip tone="rose">revoked</Chip> : <Chip tone="emerald">active</Chip>}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">{k.last_used_at ? `last used ${shortDate(k.last_used_at)}` : 'never used'} · created {shortDate(k.created_at)}</div>
                  </div>
                  {!k.revoked_at && <button onClick={() => revokeKey(k.id)} className="shrink-0 text-[12px] text-slate-400 hover:text-rose-400">Revoke</button>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Credits */}
        <Panel eyebrow="Credits" title="Buy credits">
          <div className="grid gap-3 sm:grid-cols-3">
            {packages.map((p) => (
              <div key={p.id} className="flex flex-col rounded-xl border border-white/[0.08] bg-[#070b16] p-4 text-center">
                <div className="text-2xl font-semibold tabular-nums">${p.usd}</div>
                <div className="mt-0.5 text-sm font-medium tabular-nums text-emerald-300">{p.credits.toLocaleString()} credits</div>
                <div className="mb-3 mt-1 flex-1 text-[12px] text-slate-500">{p.label.replace(/^.*—\s*/, '')}</div>
                {p.checkoutUrl ? (
                  <a href={`${p.checkoutUrl}?client_reference_id=${encodeURIComponent(email)}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-emerald-500 py-1.5 text-sm font-medium text-[#06120c] hover:bg-emerald-400">Buy</a>
                ) : (
                  <span className="text-[12px] text-slate-600">Coming soon</span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-slate-500">Credits never expire. Pro subscribers get a monthly credit allowance automatically.</p>
        </Panel>

        {/* Tools & pricing */}
        <Panel eyebrow="Pricing" title="Tools &amp; cost per call">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-white/[0.06]">
                {tools.map((t) => (
                  <tr key={t.name}>
                    <td className="py-2 pr-3"><code className="font-mono text-[13px] text-slate-200">{t.name}</code></td>
                    <td className="py-2 text-right tabular-nums text-slate-400">{t.credits === 0 ? 'free' : `${t.credits} cr`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* Usage */}
        {calls.length > 0 && (
          <Panel eyebrow="Activity" title="Recent usage">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-white/[0.06]">
                  {calls.map((c, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3"><code className="font-mono text-[13px] text-slate-200">{c.tool_name}</code></td>
                      <td className="py-2"><Chip tone={c.status === 'success' ? 'emerald' : c.status === 'failed' ? 'rose' : 'amber'}>{c.status}</Chip></td>
                      <td className="py-2 text-right tabular-nums text-slate-400">{c.credits_charged ? `−${c.credits_charged}` : '—'}</td>
                      <td className="py-2 pl-3 text-right text-[12px] tabular-nums text-slate-500">{new Date(c.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        <footer className="mt-8 border-t border-white/[0.06] pt-5 text-[12px] text-slate-500">
          Need help? <a href="/app" className="text-slate-400 underline underline-offset-2 hover:text-slate-300">Open Mindy</a> · endpoint <code className="font-mono text-slate-400">{MCP_URL}</code>
        </footer>
      </div>
    </main>
  );
}

function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{eyebrow}</p>
      <h2 className="mb-3 mt-0.5 text-[15px] font-semibold text-slate-100">{title}</h2>
      {children}
    </section>
  );
}

function Chip({ tone, children }: { tone: 'emerald' | 'rose' | 'amber'; children: React.ReactNode }) {
  const tones = {
    emerald: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20',
    rose: 'bg-rose-500/10 text-rose-300 ring-rose-500/20',
    amber: 'bg-amber-400/10 text-amber-300 ring-amber-400/20',
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tones[tone]}`}>{children}</span>;
}
