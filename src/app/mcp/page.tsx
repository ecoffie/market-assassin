'use client';

/**
 * getmindy.ai/mcp — the Mindy MCP connect page (Higgsfield-style).
 *
 * ONE experience for everyone: bold hero → per-client keyless connect card →
 * "What you can do with credits" example grid (2 cols) → link to /mcp/pricing.
 * Per-tool pricing lives on /mcp/pricing; balance, usage, billing and API-key
 * management live in the ACCOUNT area (/mcp/account) — not here.
 *
 * Identity is server-verified: on load we ask /api/mcp/session who the signed MI
 * token proves we are. Signed-in visitors get a balance chip in the nav that links
 * to their account; everyone else gets the sign-in CTA. The marketing content is
 * shared.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getMIApiHeaders } from '@/components/app/authHeaders';
import { Catalog, MCP_URL, McpNav, AppCluster, EXAMPLES, exampleCost } from './catalog-ui';

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
 * sign in through the browser — no API key.
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
  const [balance, setBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [client, setClient] = useState<ClientId>('claude-desktop');
  // Public catalog (tool costs + trial size) for the example grid + hero copy.
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  // Identity: ask the server who our signed token proves we are. Never trust the
  // client-side email for the account we render. A signed-in visitor also gets their
  // balance (for the nav chip); the full usage/billing view lives at /mcp/account.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    fetch('/api/mcp/catalog')
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCatalog({ tools: j.tools || [], packages: j.packages || [], subscriptionPlans: j.subscriptionPlans || [], signupCredits: j.signupCredits ?? 100, proMonthlyCredits: j.proMonthlyCredits ?? 1000 }); })
      .catch(() => { /* falls back to static copy */ });
    (async () => {
      try {
        const res = await fetch('/api/mcp/session', { headers: getMIApiHeaders() });
        const j = await res.json().catch(() => null);
        if (res.ok && j?.email) {
          try { localStorage.setItem('mi_beta_email', j.email); } catch { /* ignore */ }
          setEmail(j.email);
          setAuthState('in');
          // Light balance pull for the nav chip only.
          fetch('/api/mcp/account', { headers: getMIApiHeaders() })
            .then((r) => r.json()).then((a) => { if (a?.success) setBalance(a.balance ?? 0); })
            .catch(() => { /* chip just omits the number */ });
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

  const conn = useMemo(() => connectFor(client), [client]);
  const trial = catalog?.signupCredits ?? 100;
  const displayTools = catalog?.tools ?? []; // catalog tool costs power the example prices

  // ---- Shared: keyless connect card (client tabs rewrite the steps) ----------
  const connectCard = (
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
      <p className="mt-3 text-[12px] text-slate-500">🔑 No API key needed — you sign in through your browser. Headless / CI? Grab a key in <Link href="/mcp/account?section=keys" className="text-slate-400 underline underline-offset-2 hover:text-slate-300">Account → API keys</Link>.</p>
    </section>
  );

  // ---- Shared: "What you can do with credits" — 2 columns, room for text -----
  const examplesSection = displayTools.length > 0 && (
    <section className="mt-16">
      <h2 className="text-center text-[13px] font-medium uppercase tracking-widest text-slate-500">What you can do with credits</h2>
      <p className="mx-auto mt-2 max-w-lg text-center text-[13px] text-slate-400">Each call is priced on its own — chain a few and you&apos;ve run a real BD task. Watch each one in action:</p>
      <div className="mx-auto mt-8 grid max-w-4xl grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2">
        {EXAMPLES.map((ex) => {
          const cost = exampleCost(displayTools, ex.tools);
          return (
            <div key={ex.title}>
              <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl border border-white/10 bg-[#070b16]">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-slate-300 ring-1 ring-white/10">
                  <span className="ml-0.5 text-xl">▶</span>
                </div>
                <span className="absolute left-2.5 top-2.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-300">{cost} cr</span>
                <span className="absolute bottom-2.5 right-2.5 text-[10px] uppercase tracking-wide text-slate-600">demo soon</span>
              </div>
              <div className="mt-3">
                <div className="text-[15px] font-semibold text-slate-100">{ex.title}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-slate-400">{ex.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mx-auto mt-10 text-center text-[13px] text-slate-500">
        See the full cost breakdown on the <Link href="/mcp/pricing" className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200">pricing page →</Link>
      </p>
    </section>
  );

  const signedIn = authState === 'in';

  return (
    <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
        <McpNav active="connect" signedIn={signedIn} balance={signedIn ? balance : undefined} />

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
          {signedIn ? (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link href="/mcp/account" className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">
                {typeof balance === 'number' ? `${balance.toLocaleString()} credits · Your account` : 'Your account'}
              </Link>
              <Link href="/mcp/pricing" className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5">See pricing</Link>
            </div>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <a href="/app" className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">Sign in to connect</a>
                <Link href="/mcp/pricing" className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5">See pricing</Link>
              </div>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3.5 py-1.5 text-[13px] text-emerald-200">
                <span aria-hidden>🎁</span> {trial} free credits on your first connect — no card required
              </div>
            </>
          )}
          {authState === 'loading' && <p className="mt-3 text-[12px] text-slate-500">Checking your session…</p>}
        </section>

        {connectCard}
        {examplesSection}

        {signedIn && (
          <footer className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-5 text-[12px] text-slate-500">
            <span>Signed in as <span className="text-slate-400">{email}</span> · <Link href="/mcp/account?section=settings" className="underline underline-offset-2 hover:text-slate-300">Account settings</Link></span>
            <span>endpoint <code className="font-mono text-slate-400">{MCP_URL}</code></span>
          </footer>
        )}
      </div>
    </main>
  );
}
