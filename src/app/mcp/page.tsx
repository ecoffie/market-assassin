'use client';

/**
 * getmindy.ai/mcp — the Mindy MCP developer console (Higgsfield-style redesign).
 *
 * Structure: bold hero → per-client connect card (tabs rewrite the KEYLESS steps
 * for Claude Desktop / Claude Code / Cursor / any client — copy URL, add connector,
 * sign in through the browser via OAuth) → credits → pricing → usage → a collapsed
 * "Advanced — API keys for headless / CI" section (the old key flow, demoted).
 *
 * Identity is server-verified: on load we ask /api/mcp/session who the signed
 * MI token proves we are, and render THAT account — never the stale plaintext
 * `mi_beta_email`, which used to show the wrong account's zero balance. No valid
 * session → the sign-in gate.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { authedFetch, getMIApiHeaders } from '@/components/app/authHeaders';
import { Tool, Catalog, MCP_URL, McpNav, AppCluster, EXAMPLES, exampleCost } from './catalog-ui';

interface KeyRow {
  id: string;
  key_prefix: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
interface Call { tool_name: string; status: string; credits_charged: number; created_at: string }

const shortDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null);

type ClientId = 'claude-desktop' | 'claude-code' | 'cursor' | 'other';
const CLIENTS: { id: ClientId; name: string }[] = [
  { id: 'claude-desktop', name: 'Claude Desktop' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'other', name: 'Other agent' },
];

interface ConnectInfo { lead: React.ReactNode; code?: string; steps: React.ReactNode[] }

/**
 * Keyless connect instructions per client. You add the endpoint as a connector and
 * sign in through the browser — no API key. (Headless/CI uses a key; see Advanced.)
 */
function connectFor(client: ClientId): ConnectInfo {
  switch (client) {
    case 'claude-code':
      return {
        lead: <>Claude Code does the sign-in for you — one command, no key.</>,
        code: `claude mcp add --transport http mindy ${MCP_URL}`,
        steps: [
          <>Run the command below in your terminal.</>,
          <>Claude Code opens a browser → <span className="text-slate-300">sign in with Mindy → Allow</span>.</>,
          <>Ask: <span className="text-slate-300">“Use Mindy to find open SAM drone contracts.”</span></>,
        ],
      };
    case 'cursor':
      return {
        lead: <>Add Mindy as an MCP server in Cursor — it signs you in in the browser.</>,
        steps: [
          <>Copy the endpoint URL above.</>,
          <>Cursor → Settings → MCP → <span className="text-slate-300">Add new server</span> → paste the URL.</>,
          <>Click <span className="text-slate-300">Connect</span> → sign in with Mindy → Allow.</>,
        ],
      };
    case 'other':
      return {
        lead: <>Any MCP client with connector support — Windsurf, Cline, or your own.</>,
        steps: [
          <>Copy the endpoint URL above.</>,
          <>Add it as a remote / custom MCP server in your client.</>,
          <>Connect → sign in with Mindy → Allow.</>,
        ],
      };
    default: // claude-desktop
      return {
        lead: <>Add a connector, sign in, done — no key to paste.</>,
        steps: [
          <>Copy the endpoint URL above.</>,
          <>Claude Desktop → Settings → Connectors → <span className="text-slate-300">Add custom connector</span> → paste the URL.</>,
          <>Click <span className="text-slate-300">Connect</span> → sign in with Mindy → Allow. Then ask Claude to use Mindy.</>,
        ],
      };
  }
}

export default function McpConsole() {
  const [authState, setAuthState] = useState<'loading' | 'in' | 'out'>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [justPurchased, setJustPurchased] = useState(false);
  const [client, setClient] = useState<ClientId>('claude-desktop');
  // Public catalog (tools + packs + trial size) for the LOGGED-OUT pricing page.
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  // Identity: ask the server who our signed token proves we are. Never trust
  // the client-side email for the account we render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('topup') === 'success') setJustPurchased(true);
    // Public catalog powers the logged-out pricing page — real tool costs + packs,
    // data behind glass rather than a blank sign-in wall. No auth, cached at the edge.
    fetch('/api/mcp/catalog')
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCatalog({ tools: j.tools || [], packages: j.packages || [], subscriptionPlans: j.subscriptionPlans || [], signupCredits: j.signupCredits ?? 100, proMonthlyCredits: j.proMonthlyCredits ?? 1000 }); })
      .catch(() => { /* pricing falls back to static copy */ });
    (async () => {
      try {
        const res = await fetch('/api/mcp/session', { headers: getMIApiHeaders() });
        const j = await res.json().catch(() => null);
        if (res.ok && j?.email) {
          try { localStorage.setItem('mi_beta_email', j.email); } catch { /* ignore */ }
          setEmail(j.email);
          setAuthState('in');
        } else {
          setAuthState('out');
        }
      } catch {
        setAuthState('out');
      }
    })();
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

  function switchAccount() {
    try {
      localStorage.removeItem('mi_beta_auth_token');
      localStorage.removeItem('mi_beta_2fa_token');
      localStorage.removeItem('mi_beta_email');
    } catch { /* ignore */ }
    window.location.href = '/app';
  }

  const keyForSnippet = newKey || 'mcp_live_YOUR_KEY';
  const advancedSnippet = `{
  "mcpServers": {
    "mindy": {
      "url": "${MCP_URL}",
      "headers": { "X-Mindy-API-Key": "${keyForSnippet}" }
    }
  }
}`;
  const conn = useMemo(() => connectFor(client), [client]);

  // ---- Logged-out CONNECT / landing page (keyless-first) ---------------------
  // App-icon cluster → hero → client-tab connect card. Pricing lives on its own
  // page (/mcp/pricing). Connect is KEYLESS: sign in through the browser (OAuth),
  // no key to copy. Keys are the headless/CI fallback only.
  if (authState !== 'in') {
    const trial = catalog?.signupCredits ?? 100;
    const tools = catalog?.tools ?? [];

    return (
      <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
        <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
          <McpNav active="connect" />

          {/* Hero */}
          <section className="mt-12 text-center">
            <div className="mb-7"><AppCluster /></div>
            <h1 className="mx-auto max-w-2xl text-balance text-3xl font-bold uppercase leading-[1.05] tracking-tight sm:text-5xl">Mindy MCP for any AI agent</h1>
            <p className="mx-auto mt-4 max-w-xl text-balance text-sm text-slate-400 sm:text-[15px]">
              SAM opportunities, incumbent financials, GSA pricing, and win playbooks — piped straight into your agent. Connect keyless in under a minute.
            </p>
            <p className="mx-auto mt-3 text-[12px] text-slate-500">
              Plug into <span className="text-slate-400">Claude · Claude Code · ChatGPT · Cursor · Copilot</span> — any MCP client.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <a href="/app" className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">Sign in to connect</a>
              <Link href="/mcp/pricing" className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5">See pricing</Link>
            </div>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3.5 py-1.5 text-[13px] text-emerald-200">
              <span aria-hidden>🎁</span> {trial} free credits on your first connect — no card required
            </div>
            {authState === 'loading' && <p className="mt-3 text-[12px] text-slate-500">Checking your session…</p>}
          </section>

          {/* Connect card — client tabs rewrite the steps */}
          <section className="mt-12 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Connect</p>
                <h2 className="mt-0.5 text-[15px] font-semibold text-slate-100">Plug Mindy into your AI agent</h2>
              </div>
              <div className="inline-flex rounded-full border border-white/[0.08] bg-[#070b16] p-1">
                {CLIENTS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setClient(c.id)}
                    className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${client === c.id ? 'bg-emerald-500 text-[#06120c]' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Endpoint URL */}
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#070b16] px-3 py-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-500">Endpoint</span>
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-emerald-300">{MCP_URL}</code>
              <button onClick={() => copy(MCP_URL, 'url')} className="shrink-0 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">{copied === 'url' ? 'Copied' : 'Copy'}</button>
            </div>

            {/* Steps */}
            <ol className="mt-4 grid gap-2 sm:grid-cols-3">
              {conn.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 text-[13px] text-slate-300">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-slate-300">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>

            {/* Lead + optional command (Claude Code) */}
            <p className="mt-4 text-sm text-slate-400">{conn.lead}</p>
            {conn.code && (
              <div className="relative mt-2">
                <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#070b16] p-3.5 font-mono text-[12px] leading-relaxed text-slate-300">{conn.code}</pre>
                <button onClick={() => copy(conn.code!, 'snippet')} className="absolute right-2.5 top-2.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">{copied === 'snippet' ? 'Copied' : 'Copy'}</button>
              </div>
            )}
            <p className="mt-3 text-[12px] text-slate-500">🔑 No API key needed — you sign in through your browser. Running headless or in CI? Sign in once to mint a key.</p>
          </section>

          {/* See it in action — demo videos of real BD tasks */}
          {tools.length > 0 && (
            <section className="mt-16">
              <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">What you can do with credits</h2>
              <p className="mx-auto mt-2 max-w-lg text-center text-[13px] text-slate-400">Each call is priced on its own — chain a few and you&apos;ve run a real BD task. Watch each one in action:</p>
              <div className="mx-auto mt-6 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {EXAMPLES.map((ex) => {
                  const cost = exampleCost(tools, ex.tools);
                  return (
                    <div key={ex.title} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
                      {/* Placeholder demo — swap the div for a <video>/<iframe> when clips exist */}
                      <div className="relative grid aspect-video place-items-center border-b border-white/10 bg-[#070b16]">
                        <div className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-slate-300 ring-1 ring-white/10">
                          <span className="ml-0.5 text-lg">▶</span>
                        </div>
                        <span className="absolute left-2 top-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-300">{cost} cr</span>
                        <span className="absolute bottom-2 right-2 text-[10px] uppercase tracking-wide text-slate-600">demo soon</span>
                      </div>
                      <div className="p-4">
                        <div className="text-[14px] font-semibold text-slate-100">{ex.title}</div>
                        <div className="mt-1 text-[12px] leading-relaxed text-slate-400">{ex.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mx-auto mt-6 text-center text-[13px] text-slate-500">
                See the full cost breakdown on the <Link href="/mcp/pricing" className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200">pricing page →</Link>
              </p>
            </section>
          )}
        </div>
      </main>
    );
  }

  // ---- Console ---------------------------------------------------------------
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

        {/* Hero — same AppCluster identity as the landing */}
        <section className="mt-10 text-center">
          <div className="mb-6"><AppCluster /></div>
          <h2 className="mx-auto max-w-2xl text-balance text-3xl font-bold uppercase leading-[1.05] tracking-tight sm:text-4xl">
            Mindy MCP for any AI agent
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-slate-400 sm:text-[15px]">
            SAM opportunities, incumbent financials, GSA pricing, and win playbooks — piped straight into Claude, Cursor, or your own agent.
          </p>
        </section>

        {justPurchased && (
          <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            <span>Payment received — credits added. Your balance is now <strong className="tabular-nums">{balance ?? '…'}</strong>.</span>
            <button onClick={() => setJustPurchased(false)} className="text-emerald-400/60 hover:text-emerald-300">Dismiss</button>
          </div>
        )}
        {error && <div className="mt-6 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

        {/* Connect card — client tabs rewrite the steps */}
        <section className="mt-8 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Connect</p>
              <h2 className="mt-0.5 text-[15px] font-semibold text-slate-100">Plug Mindy into your AI agent</h2>
            </div>
            <div className="inline-flex rounded-full border border-white/[0.08] bg-[#070b16] p-1">
              {CLIENTS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setClient(c.id)}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${client === c.id ? 'bg-emerald-500 text-[#06120c]' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Endpoint URL */}
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#070b16] px-3 py-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Endpoint</span>
            <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-emerald-300">{MCP_URL}</code>
            <button onClick={() => copy(MCP_URL, 'url')} className="shrink-0 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">{copied === 'url' ? 'Copied' : 'Copy'}</button>
          </div>

          {/* Steps */}
          <ol className="mt-4 grid gap-2 sm:grid-cols-3">
            {conn.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5 text-[13px] text-slate-300">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-slate-300">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>

          {/* Lead + optional command (Claude Code) */}
          <p className="mt-4 text-sm text-slate-400">{conn.lead}</p>
          {conn.code && (
            <div className="relative mt-2">
              <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#070b16] p-3.5 font-mono text-[12px] leading-relaxed text-slate-300">{conn.code}</pre>
              <button onClick={() => copy(conn.code!, 'snippet')} className="absolute right-2.5 top-2.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">{copied === 'snippet' ? 'Copied' : 'Copy'}</button>
            </div>
          )}
          <p className="mt-3 text-[12px] text-slate-500">🔑 No API key needed — you sign in through your browser. Running headless or in CI? Use a key under <span className="text-slate-400">Advanced</span> below.</p>
        </section>

        {/* What you can do with credits — same demo grid as the landing */}
        {tools.length > 0 && (
          <section className="mt-8">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">What you can do with credits</p>
            <h2 className="mt-0.5 text-[15px] font-semibold text-slate-100">Each call is priced on its own</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {EXAMPLES.map((ex) => {
                const cost = exampleCost(tools, ex.tools);
                return (
                  <div key={ex.title} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
                    <div className="relative grid aspect-video place-items-center border-b border-white/10 bg-[#070b16]">
                      <div className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-slate-300 ring-1 ring-white/10">
                        <span className="ml-0.5 text-lg">▶</span>
                      </div>
                      <span className="absolute left-2 top-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-300">{cost} cr</span>
                      <span className="absolute bottom-2 right-2 text-[10px] uppercase tracking-wide text-slate-600">demo soon</span>
                    </div>
                    <div className="p-4">
                      <div className="text-[14px] font-semibold text-slate-100">{ex.title}</div>
                      <div className="mt-1 text-[12px] leading-relaxed text-slate-400">{ex.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Plans — subscription credits (compact; the full monthly/annual toggle lives on /mcp/pricing) */}
        {(catalog?.subscriptionPlans?.length ?? 0) > 0 && (
          <Panel eyebrow="Plans" title="Add credits with a plan">
            <div className="grid gap-3 sm:grid-cols-2">
              {catalog!.subscriptionPlans.map((p) => (
                <div key={p.id} className={`flex flex-col rounded-xl border p-4 ${p.id === 'plus' ? 'border-emerald-400/40 bg-emerald-400/[0.05]' : 'border-white/[0.08] bg-[#070b16]'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold uppercase tracking-wide text-emerald-300">{p.label}</span>
                    <span className="text-[11px] tabular-nums text-slate-500">{p.creditsPerMonth.toLocaleString()} cr/mo</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="font-mono text-3xl font-bold tabular-nums">${p.annual.usdPerMonth}</span>
                    <span className="text-[12px] text-slate-400">/mo · billed annually</span>
                  </div>
                  <div className="mt-0.5 flex-1 text-[12px] text-slate-500">or ${p.monthly.usd}/mo month-to-month</div>
                  <div className="mt-3 flex gap-2">
                    <a href={`${p.annual.checkoutUrl}?client_reference_id=${encodeURIComponent(email || '')}`} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg bg-emerald-500 py-1.5 text-center text-sm font-medium text-[#06120c] hover:bg-emerald-400">Get {p.label}</a>
                    <a href={`${p.monthly.checkoutUrl}?client_reference_id=${encodeURIComponent(email || '')}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/15 px-3 py-1.5 text-center text-sm font-medium text-slate-200 hover:bg-white/5">Monthly</a>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-slate-500">Compare plans and toggle monthly/annual on the <Link href="/mcp/pricing" className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200">full pricing page →</Link> · Pro subscribers get a monthly allowance automatically.</p>
          </Panel>
        )}

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

        {/* Advanced — API keys for headless / CI (browser sign-in can't run) */}
        <details className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 py-4">
          <summary className="cursor-pointer select-none text-[13px] font-medium text-slate-300 marker:text-slate-600 hover:text-slate-100">
            Advanced — API keys for headless / CI
          </summary>
          <div className="mt-4 border-t border-white/[0.06] pt-4">
            <p className="mb-4 text-[13px] leading-relaxed text-slate-400">
              Most people never need this. If your agent runs where a browser sign-in can&apos;t happen — a CI job, a server, a scripted pipeline — create a long-lived API key instead. Paste it into your MCP config as a header. It draws from the same credit balance and is shown once at creation, so store it somewhere safe.
            </p>
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
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. CI pipeline)" className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#070b16] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none" />
              <button onClick={createKey} disabled={busy} className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-[#06120c] hover:bg-emerald-400 disabled:opacity-50">{busy ? 'Creating…' : 'Create key'}</button>
            </div>
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-slate-500">No API key yet. You only need one for headless / CI use.</p>
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
            <p className="mb-2 mt-5 text-[12px] font-medium uppercase tracking-wide text-slate-500">mcp.json</p>
            <div className="relative">
              <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#070b16] p-3.5 font-mono text-[12px] leading-relaxed text-slate-300">{advancedSnippet}</pre>
              <button onClick={() => copy(advancedSnippet, 'json')} className="absolute right-2.5 top-2.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">{copied === 'json' ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
        </details>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-5 text-[12px] text-slate-500">
          <span>Signed in as <span className="text-slate-400">{email}</span> · <button onClick={switchAccount} className="underline underline-offset-2 hover:text-slate-300">Switch account</button></span>
          <span>endpoint <code className="font-mono text-slate-400">{MCP_URL}</code></span>
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
