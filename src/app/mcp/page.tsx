'use client';

/**
 * getmindy.ai/mcp — the Mindy MCP developer console (Higgsfield-style redesign).
 *
 * Structure: bold hero → per-client connect card (tabs rewrite the steps for
 * Claude Desktop / Claude Code / Cursor / any client) → connection key → credits →
 * pricing → usage.
 *
 * Identity is server-verified: on load we ask /api/mcp/session who the signed
 * MI token proves we are, and render THAT account — never the stale plaintext
 * `mi_beta_email`, which used to show the wrong account's zero balance. No valid
 * session → the sign-in gate.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { authedFetch, getMIApiHeaders } from '@/components/app/authHeaders';

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

type ClientId = 'claude-desktop' | 'claude-code' | 'cursor' | 'other';
const CLIENTS: { id: ClientId; name: string }[] = [
  { id: 'claude-desktop', name: 'Claude Desktop' },
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'other', name: 'Other agent' },
];

const codeTag = (t: string) => <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[12px] text-slate-300">{t}</code>;

/** The connect instructions for a client — all real methods for the same hosted URL. */
function connectFor(client: ClientId, key: string) {
  const json = `{
  "mcpServers": {
    "mindy": {
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer ${key}" }
    }
  }
}`;
  switch (client) {
    case 'claude-code':
      return {
        lead: <>Claude Code speaks remote MCP natively — one command in your terminal. Swap in your connection key.</>,
        code: `claude mcp add --transport http mindy ${MCP_URL} \\\n  --header "Authorization: Bearer ${key}"`,
        steps: [
          'Create a connection key below and copy it.',
          <>Run the command below in your terminal (paste your key in place of {codeTag('mcp_live_YOUR_KEY')}).</>,
          <>In any project, ask: <span className="text-slate-300">“Use Mindy to find open SAM drone contracts.”</span></>,
        ],
      };
    case 'cursor':
      return {
        lead: <>Add Mindy to Cursor&apos;s MCP config, then turn it on in Settings.</>,
        code: json,
        steps: [
          'Create a connection key below and copy it.',
          <>Paste the block below into {codeTag('~/.cursor/mcp.json')} (create the file if it&apos;s not there).</>,
          <>Cursor → Settings → MCP → enable <span className="text-slate-300">mindy</span>, then ask Cursor to use it.</>,
        ],
      };
    case 'other':
      return {
        lead: <>Mindy works with any MCP-compatible agent — Windsurf, Cline, or your own. Point it at the endpoint with a Bearer header.</>,
        code: json,
        steps: [
          'Create a connection key below and copy it.',
          <>Add the server block below to your client&apos;s MCP config, with {codeTag('Authorization: Bearer <your key>')}.</>,
          'Restart the client and call any Mindy tool from your agent.',
        ],
      };
    default: // claude-desktop
      return {
        lead: <>Add Mindy as a custom MCP server in Claude Desktop&apos;s config file.</>,
        code: json,
        steps: [
          'Create a connection key below and copy it.',
          <>Claude Desktop → Settings → Developer → <span className="text-slate-300">Edit Config</span>, and paste the block below into {codeTag('claude_desktop_config.json')}.</>,
          <>Fully quit &amp; reopen Claude Desktop, then ask: <span className="text-slate-300">“Use Mindy to find open SAM drone contracts.”</span></>,
        ],
      };
  }
}

/** Friendly names for translating a credit balance into real usage. */
const TOOL_LABELS: Record<string, string> = {
  search_sam_opportunities: 'SAM opportunity searches',
  get_incumbent_financials: 'incumbent financial reads',
  find_capable_contractors: '“who can win this” scans',
  get_winning_playbook: 'win playbooks',
  get_contractor_profile: 'contractor deep-dives',
};

/** "≈ 250 SAM searches · 125 financial reads · 31 win scans" from the LIVE tool costs. */
function valueLine(credits: number, tools: Tool[]): string {
  const picks = ['search_sam_opportunities', 'get_incumbent_financials', 'find_capable_contractors'];
  const parts = picks
    .map((name) => {
      const t = tools.find((x) => x.name === name);
      if (!t || t.credits <= 0) return null;
      return `${Math.floor(credits / t.credits).toLocaleString()} ${TOOL_LABELS[name]}`;
    })
    .filter(Boolean) as string[];
  return parts.length ? parts.join(' · ') : `${credits.toLocaleString()} tool calls`;
}

export default function McpConsole() {
  const [authState, setAuthState] = useState<'loading' | 'in' | 'out'>('loading');
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
  const [client, setClient] = useState<ClientId>('claude-desktop');

  // Identity: ask the server who our signed token proves we are. Never trust
  // the client-side email for the account we render.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('topup') === 'success') setJustPurchased(true);
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

  function switchAccount() {
    try {
      localStorage.removeItem('mi_beta_auth_token');
      localStorage.removeItem('mi_beta_2fa_token');
      localStorage.removeItem('mi_beta_email');
    } catch { /* ignore */ }
    window.location.href = '/app';
  }

  const activeKeys = useMemo(() => keys.filter((k) => !k.revoked_at), [keys]);
  const keyForSnippet = newKey || 'mcp_live_YOUR_KEY';
  const conn = useMemo(() => connectFor(client, keyForSnippet), [client, keyForSnippet]);

  // ---- Sign-in gate ----------------------------------------------------------
  if (authState !== 'in') {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#0a0f1e] px-6 text-slate-100 [color-scheme:dark]">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-400 text-lg font-bold text-[#0a0f1e]">M</div>
          <h1 className="text-2xl font-semibold tracking-tight">Mindy MCP</h1>
          <p className="mt-2 text-sm text-slate-400">Federal contracting intelligence for any AI agent.</p>
          {authState === 'loading' ? (
            <p className="mt-6 text-sm text-slate-500">Checking your session…</p>
          ) : (
            <>
              <a href="/app" className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">
                Sign in to Mindy
              </a>
              <p className="mt-3 text-[12px] text-slate-500">Your first connection key comes with 25 free credits.</p>
            </>
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

        {/* Hero */}
        <section className="mt-8 text-center">
          <div className="mb-6 flex items-center justify-center -space-x-2">
            {[
              { t: '✳', c: 'from-orange-400/80 to-rose-400/80' },
              { t: '⌘', c: 'from-slate-300/80 to-slate-500/80' },
            ].map((x, i) => (
              <div key={i} className={`grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${x.c} text-base font-semibold text-[#0a0f1e] ring-4 ring-[#0a0f1e]`}>{x.t}</div>
            ))}
            <div className="z-10 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-400 text-xl font-bold text-[#0a0f1e] ring-4 ring-[#0a0f1e]">M</div>
            {[
              { t: '⌨', c: 'from-emerald-300/80 to-teal-500/80' },
              { t: '❖', c: 'from-sky-300/80 to-indigo-400/80' },
            ].map((x, i) => (
              <div key={i} className={`grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${x.c} text-base font-semibold text-[#0a0f1e] ring-4 ring-[#0a0f1e]`}>{x.t}</div>
            ))}
          </div>
          <h2 className="mx-auto max-w-2xl text-balance text-3xl font-bold uppercase leading-[1.05] tracking-tight sm:text-4xl">
            Mindy MCP for any AI agent
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-slate-400 sm:text-[15px]">
            SAM opportunities, incumbent financials, GSA pricing, and win playbooks — piped straight into Claude, Cursor, or your own agent.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3.5 py-1.5 text-[13px] text-emerald-200">
            <span aria-hidden>🎁</span> Your first connection key includes 25 free credits
          </div>
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

          {/* Snippet */}
          <p className="mt-4 text-sm text-slate-400">{conn.lead}</p>
          <div className="relative mt-2">
            <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#070b16] p-3.5 font-mono text-[12px] leading-relaxed text-slate-300">{conn.code}</pre>
            <button onClick={() => copy(conn.code, 'snippet')} className="absolute right-2.5 top-2.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">{copied === 'snippet' ? 'Copied' : 'Copy'}</button>
          </div>
          <p className="mt-2 text-[12px] text-slate-500">Replace <code className="font-mono text-slate-400">mcp_live_YOUR_KEY</code> with your connection key from below (shown once when you create it).</p>
        </section>

        {/* Connection key */}
        <Panel eyebrow="Connection key" title="Your connection key">
          <p className="-mt-1 mb-4 text-[13px] leading-relaxed text-slate-400">
            This is how your AI agent proves the requests are yours. Create one, paste it into the config above, and each call draws from your credit balance. It&apos;s shown once at creation — store it somewhere safe.
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
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Claude Desktop)" className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#070b16] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none" />
            <button onClick={createKey} disabled={busy} className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-[#06120c] hover:bg-emerald-400 disabled:opacity-50">{busy ? 'Creating…' : 'Create key'}</button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-slate-500">No connection key yet. Create one to get started — your first key comes with 25 free credits.</p>
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
                <div className="mb-3 mt-2 flex-1 text-[12px] leading-relaxed text-slate-400">
                  <span className="text-slate-500">≈ </span>{valueLine(p.credits, tools).split(' · ').map((part, i) => (
                    <span key={i} className="block">{part}</span>
                  ))}
                </div>
                {p.checkoutUrl ? (
                  <a href={`${p.checkoutUrl}?client_reference_id=${encodeURIComponent(email || '')}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-emerald-500 py-1.5 text-sm font-medium text-[#06120c] hover:bg-emerald-400">Buy</a>
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
