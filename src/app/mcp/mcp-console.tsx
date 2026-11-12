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
import MemberProof from '@/components/public-site/MemberProof';
import Link from 'next/link';
import { getMIApiHeaders } from '@/components/app/authHeaders';
import { Catalog, MCP_URL, EXAMPLES, exampleCost } from './catalog-ui';
import { McpPublicNav } from './public-ui';
import { Container } from '@/components/public-site/ui';

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
          <>Claude Code opens a browser → <span className="text-(--mp-body)">sign in with Mindy → Allow</span>.</>,
          <>Ask: <span className="text-(--mp-body)">“Use Mindy to find open SAM drone contracts.”</span></>,
        ],
      };
    case 'cursor':
      return {
        lead: <>Add Mindy as an MCP server in Cursor — it signs you in in the browser.</>,
        steps: [
          <>Copy the link above.</>,
          <>Cursor → Settings → MCP → <span className="text-(--mp-body)">Add new server</span> → paste the URL.</>,
          <>Click <span className="text-(--mp-body)">Connect</span> → sign in with Mindy → Allow.</>,
        ],
      };
    case 'other':
      return {
        lead: <>Any MCP client with connector support — Windsurf, Cline, or your own.</>,
        steps: [
          <>Copy the link above.</>,
          <>Add it as a remote / custom MCP server in your client.</>,
          <>Connect → sign in with Mindy → Allow.</>,
        ],
      };
    default: // claude-desktop
      return {
        lead: <>Add a connector, sign in, done — no key to paste.</>,
        steps: [
          <>Copy the link above.</>,
          <>Claude Desktop → Settings → Connectors → <span className="text-(--mp-body)">Add custom connector</span> → paste the URL.</>,
          <>Click <span className="text-(--mp-body)">Connect</span> → sign in with Mindy → Allow. Then ask Claude to use Mindy.</>,
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
  // Public catalog (tool costs) for the example grid.
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  // Identity: ask the server who our signed token proves we are. Never trust the
  // client-side email for the account we render. A signed-in visitor also gets their
  // balance (for the nav chip); the full usage/billing view lives at /mcp/account.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // ⚠️ proMonthlyCredits falls back to 0, never a literal: the old `?? 1000` was the
    // same drift already fixed in mcp/tools/page.tsx (production now grants 1,500).
    // 0 reads as "not loaded"; render sites guard on `> 0`. signupCredits keeps its
    // 100 because THAT value is rendered and matches SIGNUP_CREDITS.
    fetch('/api/mcp/catalog')
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCatalog({ tools: j.tools || [], packages: j.packages || [], subscriptionPlans: j.subscriptionPlans || [], signupCredits: j.signupCredits ?? 100, proMonthlyCredits: j.proMonthlyCredits ?? 0 }); })
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
  const displayTools = catalog?.tools ?? []; // catalog tool costs power the example prices

  // ---- Shared: keyless connect card (client tabs rewrite the steps) ----------
  const connectCard = (
    <section id="connect" className="mx-auto mt-24 max-w-5xl scroll-mt-24">
      <h2 className="text-balance text-center font-(family-name:--mp-font-serif) text-[34px] font-normal leading-[1.15] tracking-[-0.015em] sm:text-[46px]">Connect in under a minute</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-[17px] text-(--mp-body)">Pick your AI. You add one link, sign in, and Mindy is ready. No key to paste.</p>

      <div className="mt-8 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Your AI">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={client === c.id}
            onClick={() => setClient(c.id)}
            className={`rounded-full border px-5 py-2.5 text-[15px] font-medium transition ${client === c.id ? 'border-(--mp-navy) bg-(--mp-surface) text-(--mp-navy) shadow-[0_0_0_1px_var(--mp-navy)]' : 'border-transparent text-(--mp-body) hover:text-(--mp-navy)'}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-3xl border border-(--mp-line) bg-(--mp-surface) p-5 shadow-[0_24px_60px_rgba(27,58,107,0.10)] sm:p-8">
        {/* Endpoint URL */}
        <div className="flex items-center gap-3 rounded-2xl border border-(--mp-line) bg-(--mp-wash) px-4 py-3">
          <span className="hidden text-[12px] font-semibold uppercase tracking-[0.08em] text-(--mp-navy) sm:inline">Link</span>
          <code className="min-w-0 flex-1 truncate font-(family-name:--mp-font-mono) text-[15px] text-(--mp-ink)">{MCP_URL}</code>
          <button onClick={() => copy(MCP_URL, 'url')} className="shrink-0 rounded-full bg-(--mp-navy) px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-(--mp-navy-hover)">{copied === 'url' ? 'Copied' : 'Copy'}</button>
        </div>

        {/* Steps */}
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {conn.steps.map((st, i) => (
            <li key={i} className="flex items-start gap-3 rounded-2xl border border-(--mp-line) bg-(--mp-surface) p-4 text-[15px] leading-relaxed text-(--mp-body)">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-(--mp-navy) text-[13px] font-bold text-white">{i + 1}</span>
              <span>{st}</span>
            </li>
          ))}
        </ol>

        {/* Lead + optional command (Claude Code) */}
        <p className="mt-5 text-[15px] text-(--mp-body)">{conn.lead}</p>
        {conn.code && (
          <div className="relative mt-3">
            <pre className="overflow-x-auto rounded-2xl border border-(--mp-line) bg-(--mp-wash) p-4 pr-24 font-(family-name:--mp-font-mono) text-[13px] leading-relaxed text-(--mp-ink)">{conn.code}</pre>
            <button onClick={() => copy(conn.code!, 'snippet')} className="absolute right-3 top-3 rounded-full border border-(--mp-line) bg-(--mp-surface) px-3 py-1 text-[12px] font-semibold text-(--mp-navy) hover:border-(--mp-navy)">{copied === 'snippet' ? 'Copied' : 'Copy'}</button>
          </div>
        )}
        <Link
          href="/mcp/setup"
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-(--mp-navy-wash) px-5 py-4 transition hover:bg-(--mp-wash)"
        >
          <span className="text-[15px] text-(--mp-body)">
            <span className="font-semibold text-(--mp-navy)">Not sure where those menus are?</span>{' '}
            Every click, with screenshots, for Claude and ChatGPT.
          </span>
          <span className="shrink-0 text-[15px] font-semibold text-(--mp-navy)">Open the guide →</span>
        </Link>
        <p className="mt-4 text-[13px] text-(--mp-muted)">No API key needed: you sign in through your browser. Running it headless or in CI? Get a key in <Link href="/app?panel=settings&section=credits&tab=keys" className="underline underline-offset-2 hover:text-(--mp-body)">Account → API keys</Link>.</p>
      </div>
    </section>
  );

  // ---- Shared: "What you can do with credits" -------------------------------
  const examplesSection = displayTools.length > 0 && (
    <section className="mx-auto mt-24 max-w-5xl">
      <h2 className="text-balance text-center font-(family-name:--mp-font-serif) text-[34px] font-normal leading-[1.15] tracking-[-0.015em] sm:text-[46px]">What you can ask</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-[17px] text-(--mp-body)">Each answer costs a few credits. Chain a few and you&apos;ve done a real BD task.</p>
      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {EXAMPLES.map((ex) => {
          const cost = exampleCost(displayTools, ex.tools);
          return (
            <div key={ex.title} className="rounded-3xl border border-(--mp-line) bg-(--mp-surface) p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="text-[19px] font-semibold leading-snug text-(--mp-ink)">{ex.title}</div>
                <span className="shrink-0 rounded-full bg-(--mp-navy-wash) px-3 py-1 text-[12px] font-semibold tabular-nums text-(--mp-navy)">{cost} credits</span>
              </div>
              <div className="mt-2 text-[15px] leading-relaxed text-(--mp-body)">{ex.desc}</div>
              {/* The actual call chain — names come from EXAMPLES, priced off the live catalog. */}
              <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-(--mp-line) pt-4">
                {ex.tools.map((t, i) => (
                  <span key={`${t}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-(--mp-muted)">→</span>}
                    <code className="rounded-md bg-(--mp-wash) px-2 py-0.5 font-(family-name:--mp-font-mono) text-[12px] text-(--mp-body)">{t}</code>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mx-auto mt-10 text-center text-[15px] text-(--mp-body)">
        {displayTools.length > 0 ? `${displayTools.length} tools` : 'Every tool'} across finding work, competitors,
        pricing, agencies, contacts and proposals.{' '}
        <Link href="/mcp/tools" className="font-semibold text-(--mp-navy) underline underline-offset-2 hover:text-(--mp-navy-hover)">See every tool →</Link>
      </p>
      {/*
        The repo link. github.com/getmindy/mindy-mcp sets its homepage to this page; this points
        back. rel="noopener" only, never noreferrer: the referrer is the attribution.
      */}
      <p className="mx-auto mt-2 text-center text-[15px] text-(--mp-body)">
        Docs, quickstarts and example agents are on{' '}
        <a href="https://github.com/getmindy/mindy-mcp" target="_blank" rel="noopener" className="font-semibold text-(--mp-navy) underline underline-offset-2 hover:text-(--mp-navy-hover)">GitHub →</a>
      </p>
    </section>
  );

  const signedIn = authState === 'in';

  const pill = 'inline-flex items-center justify-center rounded-full px-7 py-3.5 text-[17px] font-semibold transition';
  const primary = `${pill} bg-(--mp-navy) text-white shadow-[0_10px_24px_rgba(27,58,107,0.28)] hover:-translate-y-0.5 hover:bg-(--mp-navy-hover)`;
  const ghost = `${pill} border border-(--mp-line) bg-(--mp-surface) text-(--mp-ink) hover:-translate-y-0.5 hover:border-(--mp-navy) hover:text-(--mp-navy)`;
  const connectHref = '/app?intent=mcp&next=%2Fmcp';

  return (
    <main className="min-h-dvh bg-(--mp-surface) text-(--mp-ink)">
      <div className="py-4">
        <Container width="wide">
          <McpPublicNav active="connect" signedIn={signedIn} balance={signedIn ? balance : undefined} />
        </Container>
      </div>

      {/* Hero — split like the homepage: words left, an example right */}
      <section className="bg-(--mp-navy-wash)/60">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-20">
          <div>
            <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-(--mp-navy)">Mindy in your AI</p>
            <h1 className="mt-4 text-balance text-[44px] font-bold leading-[1.04] tracking-[-0.03em] sm:text-[60px]">Federal contract data, right inside your AI.</h1>
            <p className="mt-5 max-w-xl text-[19px] leading-relaxed text-(--mp-body)">
              Ask Claude, ChatGPT or Cursor about open bids, incumbents, pricing and buyers. Mindy answers with real federal data, not guesses.
            </p>
            <MemberProof align="left" />
            {signedIn ? (
              <div className="mt-8 flex flex-wrap gap-3.5">
                <Link href="/app?panel=settings&section=credits" className={primary}>
                  {typeof balance === 'number' ? `${balance.toLocaleString()} credits · Your account` : 'Your account'}
                </Link>
                <a href="#connect" className={ghost}>How to connect</a>
              </div>
            ) : (
              <>
                <div className="mt-8 flex flex-wrap gap-3.5">
                  <Link href="/pricing" className={primary}>Start 14-day free trial</Link>
                  <Link href="/mcp/pricing" className={ghost}>See pricing</Link>
                </div>
                <p className="mt-4 text-[15px] text-(--mp-muted)">14-day free trial · Already have an account? <a href={connectHref} className="underline underline-offset-2 hover:text-(--mp-body)">Sign in to connect</a></p>
              </>
            )}
            {authState === 'loading' && <p className="mt-3 text-[13px] text-(--mp-muted)">Checking your session…</p>}
          </div>

          {/* Example conversation. Illustrative, labelled as an example. */}
          <div className="rounded-3xl border border-(--mp-line) bg-(--mp-surface) p-5 shadow-[0_24px_60px_rgba(27,58,107,0.14)] sm:p-6" aria-label="Example conversation">
            <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.08em] text-(--mp-muted)">
              <span>Example</span><span>Your AI + Mindy</span>
            </div>
            <div className="mt-4 ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-(--mp-navy) px-4 py-3 text-[15px] leading-snug text-white">
              Find roofing work at the VA in Texas.
            </div>
            <div className="mt-4 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- brand mark, same file as the site header */}
              <img src="/brand/mindy-logo-icon.png" alt="" className="mt-0.5 h-7 w-7 shrink-0" />
              <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-(--mp-body)">
                <p>Here&apos;s what&apos;s open now and what&apos;s coming back:</p>
                <div className="mt-3 space-y-2.5">
                  {[
                    ['Open now', 'Roof replacement, medical center', 'Due in 14 days'],
                    ['Coming back', 'Roofing maintenance contract', 'Ends in 7 months'],
                  ].map(([tag, title, when]) => (
                    <div key={title} className="rounded-2xl border border-(--mp-line) px-4 py-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-(--mp-navy)">{tag}</div>
                      <div className="mt-1 text-[15px] font-semibold text-(--mp-ink)">{title}</div>
                      <div className="text-[13px] text-(--mp-muted)">{when}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Works with */}
      <section className="mx-auto max-w-6xl px-4 py-10 text-center sm:px-6">
        <p className="text-[15px] font-medium text-(--mp-body)">Works with the AI you already use</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2.5">
          {['Claude', 'ChatGPT', 'Claude Code', 'Cursor', 'Copilot', 'Windsurf'].map((n) => (
            <span key={n} className="rounded-full border border-(--mp-line) bg-(--mp-surface) px-4 py-2 text-[15px] font-semibold text-(--mp-ink)">{n}</span>
          ))}
        </div>
      </section>

      <div className="px-4 sm:px-6">
        {connectCard}
        {examplesSection}
      </div>

      {/* Closing band, like the homepage */}
      <section className="mt-24 bg-(--mp-navy) px-4 py-20 text-center text-white sm:px-6">
        <h2 className="mx-auto max-w-3xl text-balance text-[34px] font-bold leading-tight tracking-[-0.02em] sm:text-[44px]">Ask your AI about federal contracts today.</h2>
        <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-white/85">Start a 14-day free trial of Pro or Team, then connect Mindy to your AI.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3.5">
          <a href={signedIn ? '#connect' : '/pricing'} className={`${pill} bg-(--mp-surface) text-(--mp-navy) hover:-translate-y-0.5`}>{signedIn ? 'How to connect' : 'Start 14-day free trial'}</a>
          <Link href="/mcp/pricing" className={`${pill} border border-white/50 text-white hover:-translate-y-0.5 hover:border-white`}>See pricing</Link>
        </div>
      </section>

      {signedIn && (
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-[13px] text-(--mp-muted) sm:px-6">
          <span>Signed in as {email} · <Link href="/app?panel=settings" className="underline underline-offset-2 hover:text-(--mp-body)">Account settings</Link></span>
          <span>Link <code className="font-(family-name:--mp-font-mono)">{MCP_URL}</code></span>
        </div>
      )}
    </main>
  );
}
