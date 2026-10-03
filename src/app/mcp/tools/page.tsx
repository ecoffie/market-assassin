'use client';

/**
 * getmindy.ai/mcp/tools — the full tool REFERENCE.
 *
 * The split (how every mature API company does this): the landing page sells the
 * JOB with a handful of use-case cards; the reference proves the DEPTH with every
 * endpoint, grouped and priced. Stripe's home page shows ~6 use cases and
 * /docs/api lists all of them; same for Twilio, Plaid, Algolia. Nobody scrolls a
 * 54-row table to decide whether to connect, and nobody integrates from six
 * marketing cards. Two audiences, two pages.
 *
 * This is the developer half. `/mcp` (Connect) stays the contractor-facing pitch
 * and links here.
 *
 * EVERYTHING on this page is read from /api/mcp/catalog at runtime — names,
 * descriptions, credits, tier, and the count in the header. Nothing is hardcoded,
 * so it cannot drift from `listMcpTools()` the way the static docs repeatedly did
 * (2026-07-17: registry 49, artifact 46, changelog 41, whitepaper 40 — four
 * surfaces, four numbers). The only editorial layer is tool-groups.ts, which
 * decides ORDER, never membership: an ungrouped tool still renders, under
 * "Everything else", and fails a unit test so CI catches it.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getMIApiHeaders } from '@/components/app/authHeaders';
import { Catalog, Tool, MCP_URL } from '../catalog-ui';
import { McpPublicNav } from '../public-ui';
import { TOOL_GROUPS, GROUPED_TOOL_NAMES, UNGROUPED_LABEL } from './tool-groups';

/** A group with its tools resolved against the live catalog. */
interface RenderGroup {
  id: string;
  label: string;
  blurb: string;
  tools: Tool[];
}

export default function McpToolsReference() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [enforceTiers, setEnforceTiers] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    fetch('/api/mcp/catalog')
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) { setLoadFailed(true); return; }
        setCatalog({
          tools: j.tools || [],
          packages: j.packages || [],
          subscriptionPlans: j.subscriptionPlans || [],
          // ⚠️ Allowance fallbacks are 0, not invented constants (corrected 2026-09-08).
          // This read `?? 1000` for Pro, which was stale by 4x — production grants 250.
          // Neither value is rendered on this page, so the literal bought nothing and
          // silently guaranteed a wrong number the moment anyone did render one.
          // The catalog is the source of truth; 0 reads as "not loaded" (every render
          // site already guards on `> 0`) rather than asserting an allowance we did
          // not receive. The shared `Catalog` type requires number, so 0 — not null —
          // is the type-safe way to say unknown here.
          signupCredits: j.signupCredits ?? 0,
          proMonthlyCredits: j.proMonthlyCredits ?? 0,
        });
        setEnforceTiers(Boolean(j.enforceTiers));
      })
      .catch(() => setLoadFailed(true));

    (async () => {
      try {
        const res = await fetch('/api/mcp/session', { headers: getMIApiHeaders() });
        const j = await res.json().catch(() => null);
        if (res.ok && j?.email) {
          setSignedIn(true);
          fetch('/api/mcp/account', { headers: getMIApiHeaders() })
            .then((r) => r.json())
            .then((a) => { if (a?.success) setBalance(a.balance ?? 0); })
            .catch(() => { /* chip just omits the number */ });
        }
      } catch { /* logged-out is the default */ }
    })();
  }, []);

  const tools = useMemo(() => catalog?.tools ?? [], [catalog]);

  /** Resolve the editorial groups against whatever the catalog actually returned. */
  const groups: RenderGroup[] = useMemo(() => {
    if (tools.length === 0) return [];
    const byName = new Map(tools.map((t) => [t.name, t]));
    const out: RenderGroup[] = TOOL_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      blurb: g.blurb,
      // Only tools the LIVE catalog knows about — a removed tool disappears here
      // automatically, without anyone editing this page.
      tools: g.tools.map((n) => byName.get(n)).filter((t): t is Tool => Boolean(t)),
    })).filter((g) => g.tools.length > 0);

    // Anything live but ungrouped still gets shown. Never hide a tool.
    const orphans = tools.filter((t) => !GROUPED_TOOL_NAMES.has(t.name));
    if (orphans.length > 0) {
      out.push({
        id: 'other',
        label: UNGROUPED_LABEL,
        blurb: 'Live on the server and not yet filed into a group above.',
        tools: orphans,
      });
    }
    return out;
  }, [tools]);

  /** Free-text filter across name + description. */
  const filtered: RenderGroup[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, tools: g.tools.filter((t) => t.name.includes(q) || t.description.toLowerCase().includes(q)) }))
      .filter((g) => g.tools.length > 0);
  }, [groups, query]);

  const shown = filtered.reduce((n, g) => n + g.tools.length, 0);
  const proCount = tools.filter((t) => t.tier === 'pro').length;
  const freeCount = tools.filter((t) => t.credits === 0).length;

  return (
    <main className="min-h-dvh bg-(--mp-paper) text-(--mp-ink)">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
        <McpPublicNav active="connect" signedIn={signedIn} balance={signedIn ? balance : undefined} />

        {/* Header */}
        <header className="mt-10">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-(--mp-muted)">Reference</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl font-(family-name:--mp-font-serif)">
            {tools.length > 0 ? `${tools.length} tools` : 'Every tool'}, grouped by the job
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-(--mp-muted)">
            Every tool the Mindy MCP server exposes, with its live credit price. Read straight from the
            running catalog — if the server changes, this page changes with it.
          </p>
          <p className="mt-3 text-[13px] text-(--mp-muted)">
            Endpoint <code className="font-(family-name:--mp-font-mono) text-(--mp-muted)">{MCP_URL}</code> ·{' '}
            <Link href="/mcp" className="text-(--mp-navy) underline underline-offset-2 hover:text-(--mp-navy-hover)">Connect</Link>{' '}
            ·{' '}
            <Link href="/mcp/pricing" className="text-(--mp-navy) underline underline-offset-2 hover:text-(--mp-navy-hover)">Pricing</Link>
          </p>
        </header>

        {/* Honesty contract — the thing a developer actually needs to trust */}
        <section className="mt-7 rounded-none border border-(--mp-line) bg-(--mp-surface) p-4 sm:p-5">
          <h2 className="text-[13px] font-semibold text-(--mp-ink)">Two rules that hold for every tool</h2>
          <ul className="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-(--mp-muted)">
            <li>
              <span className="font-(family-name:--mp-font-mono) text-[12.5px] text-(--mp-body)">grounded=false</span> means
              {' '}<span className="text-(--mp-body)">we found nothing</span> — never a fabricated answer. Each tool states
              exactly what it will not invent.
            </li>
            <li>
              <span className="text-(--mp-body)">A failed call costs 0.</span> Credits debit only on success, atomically
              at the database layer.
            </li>
          </ul>
        </section>

        {/* Filter + counts */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tools…"
            aria-label="Filter tools"
            className="min-w-0 flex-1 rounded-[8px] border border-(--mp-line) bg-(--mp-wash) px-3 py-2 text-[13.5px] text-(--mp-ink) placeholder:text-(--mp-muted) focus:border-(--mp-navy) focus:outline-none"
          />
          <span className="text-[12.5px] tabular-nums text-(--mp-muted)">
            {query ? `${shown} of ${tools.length}` : `${tools.length} tools`}
            {freeCount > 0 && <> · {freeCount} free</>}
            {proCount > 0 && <> · {proCount} Pro</>}
          </span>
        </div>

        {/* Loading / failure */}
        {tools.length === 0 && (
          <p className="mt-10 text-[14px] text-(--mp-muted)">
            {loadFailed
              ? 'The live catalog could not be reached. Reload, or see the tool list on the pricing page.'
              : 'Loading the live catalog…'}
          </p>
        )}

        {/* Groups */}
        {filtered.map((g) => (
          <section key={g.id} className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--mp-line) pb-2.5">
              <h2 className="text-[17px] font-semibold tracking-tight text-(--mp-ink)">{g.label}</h2>
              <span className="font-(family-name:--mp-font-mono) text-[11.5px] tabular-nums text-(--mp-muted)">{g.tools.length} tools</span>
              <p className="w-full text-[13px] leading-relaxed text-(--mp-muted)">{g.blurb}</p>
            </div>

            <ul className="divide-y divide-(--mp-line)">
              {g.tools.map((t) => (
                <li key={t.name} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 py-4">
                  <code className="min-w-0 break-words font-(family-name:--mp-font-mono) text-[14px] font-semibold text-(--mp-ink)">{t.name}</code>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {t.tier === 'pro' && (
                      <span
                        className="rounded-[6px] border border-(--mp-warn-line) bg-(--mp-warn-bg) px-2 py-0.5 font-(family-name:--mp-font-mono) text-[11px] font-semibold text-(--mp-warn)"
                        title={enforceTiers ? 'Mindy Pro required' : 'Marked Pro — enforcement is currently off'}
                      >
                        PRO
                      </span>
                    )}
                    <span
                      className={`rounded-[6px] px-2 py-0.5 font-(family-name:--mp-font-mono) text-[11.5px] font-semibold tabular-nums ${
                        t.credits === 0
                          ? 'border border-(--mp-navy) bg-(--mp-navy-wash) text-(--mp-navy)'
                          : 'border border-(--mp-line) bg-(--mp-surface) text-(--mp-body)'
                      }`}
                    >
                      {t.credits === 0 ? 'free' : `${t.credits} cr`}
                    </span>
                  </div>
                  <p className="col-span-2 max-w-[80ch] text-[13.5px] leading-relaxed text-(--mp-muted)">{t.description}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {query && shown === 0 && tools.length > 0 && (
          <p className="mt-10 text-[14px] text-(--mp-muted)">
            No tool matches “{query}”. Clear the filter to see all {tools.length}.
          </p>
        )}

        <footer className="mt-14 border-t border-(--mp-line) pt-5 text-[12.5px] text-(--mp-muted)">
          Prices are credits per successful call.{' '}
          {proCount > 0 && !enforceTiers && (
            <>Pro-marked tools are labelled but not currently enforced — every tool is callable with credits. </>
          )}
          <Link href="/mcp" className="text-(--mp-muted) underline underline-offset-2 hover:text-(--mp-body)">Connect an agent →</Link>
        </footer>
      </div>
    </main>
  );
}
