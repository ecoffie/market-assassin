'use client';

/**
 * getmindy.ai/mcp/account — the signed-in account area (the "settings page").
 *
 * Familiar metered-API console layout (OpenAI Platform / Anthropic Console): a left
 * rail splits WHAT you spent (Usage · Activity) from HOW you pay (Billing) from
 * headless access (API keys) and your account (Settings). /mcp stays purely Connect;
 * the balance + billing that used to sit on the landing page live here.
 *
 * Identity is server-verified via /api/mcp/session (never a client-claimed email).
 * Account/autorecharge reads use the token-only session; key management uses
 * requireUserAuth, so those calls pass the resolved email in the headers.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getMIApiHeaders } from '@/components/app/authHeaders';
import { McpNav, MCP_URL } from '../catalog-ui';
import {
  UsageKpis, UsageOverTime, SpendByTool, ActivityLog,
  type UsageSummary, type McpCall,
} from '../usage-charts';

type Section = 'usage' | 'activity' | 'billing' | 'keys' | 'settings';
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'usage', label: 'Usage', icon: '◧' },
  { id: 'activity', label: 'Activity', icon: '≡' },
  { id: 'billing', label: 'Billing', icon: '◈' },
  { id: 'keys', label: 'API keys', icon: '⚿' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

interface AccountData { balance: number; recentCalls: McpCall[]; usage: UsageSummary | null }
interface AutoRecharge {
  enabled: boolean; thresholdCredits: number; refillPackage: string;
  hasCard: boolean; cardBrand: string | null; cardLast4: string | null;
  paused: boolean; lastRechargeAt: string | null; thresholdMin: number; thresholdMax: number;
}
interface ApiKeyRow { id: string; key_prefix: string; label: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface BillingRow { id: string; date: string; label: string; credits: number; balanceAfter: number; free: boolean }

// Refill packs — must match CREDIT_PACKAGES ids/credits in src/lib/mcp/packages.ts.
const REFILL_PACKS: { id: string; label: string }[] = [
  { id: 'plus', label: '800 credits ($15)' },
  { id: 'scale', label: '2,400 credits ($40)' },
];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function McpAccountPage() {
  const [authState, setAuthState] = useState<'loading' | 'in' | 'out'>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('usage');
  const [copied, setCopied] = useState<string | null>(null);

  const [account, setAccount] = useState<AccountData | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [autoRecharge, setAutoRecharge] = useState<AutoRecharge | null>(null);
  const [arBusy, setArBusy] = useState(false);
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [billing, setBilling] = useState<BillingRow[] | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newKeyLabel, setNewKeyLabel] = useState('');

  const [justSavedCard, setJustSavedCard] = useState(false);
  const [justPurchased, setJustPurchased] = useState(false);

  const refreshAccount = useCallback(async () => {
    setAccountLoading(true);
    try {
      const res = await fetch('/api/mcp/account', { headers: getMIApiHeaders() });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) setAccount({ balance: j.balance ?? 0, recentCalls: j.recentCalls ?? [], usage: j.usage ?? null });
    } catch { /* keep prior */ }
    finally { setAccountLoading(false); }
  }, []);

  const refreshAutoRecharge = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/autorecharge', { headers: getMIApiHeaders() });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) setAutoRecharge(j.settings);
    } catch { /* keep prior */ }
  }, []);

  // NOTE: /api/mcp/keys is guarded by requireUserAuth, which reads the claimed email
  // from ?email= (or the JSON body) — NOT the x-user-email header. So the email goes in
  // the query string; getMIApiHeaders(email) still supplies the token that proves we own it.
  const refreshBilling = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp/billing-history', { headers: getMIApiHeaders() });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) setBilling(j.history ?? []);
    } catch { /* keep prior */ }
  }, []);

  const refreshKeys = useCallback(async (forEmail: string) => {
    try {
      const res = await fetch(`/api/mcp/keys?email=${encodeURIComponent(forEmail)}`, { headers: getMIApiHeaders(forEmail) });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) setKeys(j.keys ?? []);
    } catch { /* keep prior */ }
  }, []);

  // NOTE: getMIApiHeaders() returns a Headers OBJECT — spreading it drops every entry
  // (Headers aren't own-enumerable), which silently strips the auth token. Always
  // mutate it in place for JSON POSTs.
  const startCardSetup = useCallback(async () => {
    setArBusy(true);
    try {
      const headers = getMIApiHeaders();
      headers.set('Content-Type', 'application/json');
      const res = await fetch('/api/mcp/autorecharge', { method: 'POST', headers, body: JSON.stringify({ action: 'setup' }) });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.url) { window.location.href = j.url; return; }
    } catch { /* fall through */ }
    setArBusy(false);
  }, []);

  const patchAutoRecharge = useCallback(async (patch: Record<string, unknown>) => {
    setArBusy(true);
    try {
      const headers = getMIApiHeaders();
      headers.set('Content-Type', 'application/json');
      const res = await fetch('/api/mcp/autorecharge', { method: 'POST', headers, body: JSON.stringify({ action: 'update', ...patch }) });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) setAutoRecharge(j.settings);
    } catch { /* keep prior */ }
    finally { setArBusy(false); }
  }, []);

  const createKey = useCallback(async () => {
    if (!email) return;
    setKeyBusy(true); setNewKey(null);
    try {
      const headers = getMIApiHeaders(email);
      headers.set('Content-Type', 'application/json');
      const res = await fetch(`/api/mcp/keys?email=${encodeURIComponent(email)}`, { method: 'POST', headers, body: JSON.stringify({ label: newKeyLabel.trim() || undefined, email }) });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success && j.key) {
        setNewKey(j.key);
        setNewKeyLabel('');
        await refreshKeys(email);
        void refreshAccount(); // a first key grants signup credits
      }
    } catch { /* leave */ }
    finally { setKeyBusy(false); }
  }, [email, newKeyLabel, refreshKeys, refreshAccount]);

  const revokeKey = useCallback(async (id: string) => {
    if (!email) return;
    if (!window.confirm('Revoke this key? Any agent using it will stop working immediately.')) return;
    setKeyBusy(true);
    try {
      const res = await fetch(`/api/mcp/keys?id=${encodeURIComponent(id)}&email=${encodeURIComponent(email)}`, { method: 'DELETE', headers: getMIApiHeaders(email) });
      if (res.ok) await refreshKeys(email);
    } catch { /* leave */ }
    finally { setKeyBusy(false); }
  }, [email, refreshKeys]);

  const copy = useCallback((text: string, tag: string) => {
    navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1600);
  }, []);

  function switchAccount() {
    try {
      localStorage.removeItem('mi_beta_auth_token');
      localStorage.removeItem('mi_beta_2fa_token');
      localStorage.removeItem('mi_beta_email');
    } catch { /* ignore */ }
    window.location.href = '/app';
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const sec = params.get('section');
    if (sec && SECTIONS.some((s) => s.id === sec)) setSection(sec as Section);
    if (params.get('autorecharge') === 'saved') {
      setJustSavedCard(true);
      setSection('billing');
      setTimeout(() => { void refreshAutoRecharge(); }, 3000);
    }
    if (params.get('topup') === 'success') { setJustPurchased(true); setSection('billing'); }

    (async () => {
      try {
        const res = await fetch('/api/mcp/session', { headers: getMIApiHeaders() });
        const j = await res.json().catch(() => null);
        if (res.ok && j?.email) {
          try { localStorage.setItem('mi_beta_email', j.email); } catch { /* ignore */ }
          setEmail(j.email);
          setAuthState('in');
          void refreshAccount();
          void refreshAutoRecharge();
          void refreshKeys(j.email);
          void refreshBilling();
        } else {
          setAuthState('out');
        }
      } catch {
        setAuthState('out');
      }
    })();
  }, [refreshAccount, refreshAutoRecharge, refreshKeys, refreshBilling]);

  const refillLabel = useMemo(
    () => REFILL_PACKS.find((p) => p.id === autoRecharge?.refillPackage)?.label ?? autoRecharge?.refillPackage,
    [autoRecharge],
  );

  // ---- Logged-out ------------------------------------------------------------
  if (authState !== 'in') {
    return (
      <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
        <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
          <McpNav active="account" />
          <section className="mt-20 text-center">
            <h1 className="text-2xl font-bold">Your Mindy MCP account</h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-slate-400">Sign in to see your balance, usage, billing, and API keys.</p>
            <a href="/app" className="mt-6 inline-flex rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-[#06120c] hover:bg-emerald-400">Sign in</a>
            {authState === 'loading' && <p className="mt-4 text-[12px] text-slate-500">Checking your session…</p>}
          </section>
        </div>
      </main>
    );
  }

  const balance = account?.balance ?? null;
  const usage = account?.usage ?? null;

  // ---- Section bodies --------------------------------------------------------
  const sectionTitle: Record<Section, string> = {
    usage: 'Usage', activity: 'Activity', billing: 'Billing', keys: 'API keys', settings: 'Settings',
  };

  const usageBody = (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-3xl font-bold tabular-nums text-emerald-300">{(balance ?? 0).toLocaleString()}</span>
          <span className="text-sm text-slate-400">credits remaining</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refreshAccount} disabled={accountLoading} className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] text-slate-300 hover:bg-white/10 disabled:opacity-60">{accountLoading ? 'Refreshing…' : 'Refresh'}</button>
          <Link href="/mcp/pricing" className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-semibold text-[#06120c] hover:bg-emerald-400">Top up</Link>
        </div>
      </div>
      {usage && usage.totalCalls > 0 ? (
        <>
          <UsageKpis usage={usage} />
          <div>
            <p className="mb-2 text-[12px] font-medium text-slate-400">Credits per day · last 7 days</p>
            <UsageOverTime byDay={usage.byDay} chartDays={7} />
          </div>
          <div>
            <p className="mb-3 text-[12px] font-medium text-slate-400">Spend by tool</p>
            <SpendByTool byTool={usage.byTool} />
          </div>
          {usage.capped && <p className="text-[11px] text-slate-600">Showing your {usage.windowDays}-day window (most recent 2,000 calls).</p>}
        </>
      ) : (
        <p className="text-[13px] text-slate-500">No tool calls yet. Connect Mindy to your agent and run a tool — your spend shows up here, broken down by tool and by day.</p>
      )}
    </div>
  );

  const activityBody = <ActivityLog calls={account?.recentCalls ?? []} />;

  const billingBody = (
    <div className="space-y-5">
      {/* Balance + top up */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3.5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-2xl font-bold tabular-nums text-emerald-300">{(balance ?? 0).toLocaleString()}</span>
          <span className="text-[13px] text-slate-400">credits remaining</span>
        </div>
        <Link href="/mcp/pricing" className="rounded-lg bg-emerald-500 px-3.5 py-2 text-[13px] font-semibold text-[#06120c] hover:bg-emerald-400">Top up credits</Link>
      </div>

      {/* Plan */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3.5">
        <p className="text-[13px] font-semibold text-slate-100">Plan</p>
        <p className="mt-1 text-[13px] text-slate-400">Pay-as-you-go credits. Go <span className="text-slate-200">MCP Pro</span> for a monthly credit allowance and Pro-only tools. <Link href="/mcp/pricing" className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200">See plans →</Link></p>
      </div>

      {/* Auto-recharge — full controls */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-slate-100">Auto-recharge</p>
            <p className="mt-0.5 text-[12px] text-slate-500">Refill automatically when your balance runs low — no interruptions mid-task.</p>
          </div>
          {autoRecharge?.hasCard && (
            <button
              type="button" onClick={() => patchAutoRecharge({ enabled: !autoRecharge.enabled })} disabled={arBusy}
              role="switch" aria-checked={autoRecharge.enabled} aria-label="Toggle auto-recharge"
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${autoRecharge.enabled ? 'bg-emerald-500' : 'bg-white/15'} disabled:opacity-60`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${autoRecharge.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          )}
        </div>
        {!autoRecharge?.hasCard ? (
          <button type="button" onClick={startCardSetup} disabled={arBusy} className="mt-3 rounded-lg bg-emerald-500 px-3.5 py-2 text-[13px] font-semibold text-[#06120c] hover:bg-emerald-400 disabled:opacity-60">{arBusy ? 'Starting…' : 'Add a card to enable'}</button>
        ) : (
          <>
            {autoRecharge.paused && (
              <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">Paused after a declined charge. Update your card below to resume.</div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 text-[13px] text-slate-300">
              <label className="flex items-center gap-2">
                <span className="text-slate-400">When below</span>
                <select value={autoRecharge.thresholdCredits} onChange={(e) => patchAutoRecharge({ thresholdCredits: Number(e.target.value) })} disabled={arBusy} className="rounded-lg border border-white/10 bg-[#070b16] px-2 py-1.5 text-slate-200 outline-none focus:border-emerald-500/50">
                  {[50, 100, 200].map((n) => <option key={n} value={n}>{n} credits</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-slate-400">refill with</span>
                <select value={autoRecharge.refillPackage} onChange={(e) => patchAutoRecharge({ refillPackage: e.target.value })} disabled={arBusy} className="rounded-lg border border-white/10 bg-[#070b16] px-2 py-1.5 text-slate-200 outline-none focus:border-emerald-500/50">
                  {REFILL_PACKS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            </div>
            <p className="mt-3 text-[12px] text-slate-500">
              {autoRecharge.enabled ? 'On' : 'Off'} · refill {refillLabel} when below {autoRecharge.thresholdCredits}
            </p>
          </>
        )}
      </div>

      {/* Payment method */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3.5">
        <div>
          <p className="text-[13px] font-semibold text-slate-100">Payment method</p>
          <p className="mt-0.5 text-[13px] text-slate-400">{autoRecharge?.hasCard && autoRecharge.cardBrand ? `${autoRecharge.cardBrand} ····${autoRecharge.cardLast4}` : 'No card on file.'}</p>
        </div>
        <button type="button" onClick={startCardSetup} disabled={arBusy} className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] text-slate-300 hover:bg-white/10 disabled:opacity-60">{autoRecharge?.hasCard ? 'Update card' : 'Add card'}</button>
      </div>

      {/* Billing history — every credit addition (top-ups, auto-recharge, Pro, grants). */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
        <p className="text-[13px] font-semibold text-slate-100">Billing history</p>
        {billing === null ? (
          <p className="mt-2 text-[12px] text-slate-500">Loading…</p>
        ) : billing.length === 0 ? (
          <p className="mt-2 text-[12px] text-slate-500">No credits added yet. Top-ups, auto-recharges, and grants show up here as dated receipts.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[360px] text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Description</th>
                  <th className="pb-2 pr-4 text-right font-medium">Credits</th>
                  <th className="pb-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {billing.map((b) => (
                  <tr key={b.id} className="border-t border-white/[0.05]">
                    <td className="py-2 pr-4 tabular-nums text-slate-400">{fmtDate(b.date)}</td>
                    <td className="py-2 pr-4 text-slate-200">
                      {b.label}
                      {b.free && <span className="ml-2 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">free</span>}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-emerald-300">+{b.credits.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums text-slate-500">{b.balanceAfter.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const keysBody = (
    <div className="space-y-4">
      <p className="text-[13px] text-slate-400">
        Keyless sign-in is the default way to connect (see <Link href="/mcp" className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200">Connect</Link>). API keys are for headless / CI use where a browser sign-in isn&apos;t possible.
      </p>

      {newKey && (
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4">
          <p className="text-[12px] font-semibold text-emerald-200">New key — copy it now. You won&apos;t see it again.</p>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-[#070b16] px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-emerald-300">{newKey}</code>
            <button onClick={() => copy(newKey, 'newkey')} className="shrink-0 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">{copied === 'newkey' ? 'Copied' : 'Copy'}</button>
          </div>
          <button onClick={() => setNewKey(null)} className="mt-2 text-[12px] text-slate-500 underline underline-offset-2 hover:text-slate-300">Done</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3">
        <input
          value={newKeyLabel}
          onChange={(e) => setNewKeyLabel(e.target.value)}
          placeholder="Label (optional) — e.g. CI, laptop"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#070b16] px-3 py-1.5 text-[13px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-emerald-500/50"
        />
        <button onClick={createKey} disabled={keyBusy} className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-[13px] font-semibold text-[#06120c] hover:bg-emerald-400 disabled:opacity-60">{keyBusy ? 'Working…' : 'Create key'}</button>
      </div>

      {keys === null ? (
        <p className="text-[13px] text-slate-500">Loading keys…</p>
      ) : keys.filter((k) => !k.revoked_at).length === 0 ? (
        <p className="text-[13px] text-slate-500">No API keys yet. Create one above for headless use — or just connect keyless from the Connect tab.</p>
      ) : (
        <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
          {keys.filter((k) => !k.revoked_at).map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-[13px] text-slate-200">{k.key_prefix}…</code>
                  {k.label && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-slate-400">{k.label}</span>}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">Created {fmtDate(k.created_at)} · Last used {k.last_used_at ? fmtDate(k.last_used_at) : 'never'}</p>
              </div>
              <button onClick={() => revokeKey(k.id)} disabled={keyBusy} className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-60">Revoke</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const settingsBody = (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Signed in as</p>
        <p className="mt-1 text-[14px] text-slate-100">{email}</p>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Endpoint</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-emerald-300">{MCP_URL}</code>
        <button onClick={() => copy(MCP_URL, 'ep')} className="shrink-0 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">{copied === 'ep' ? 'Copied' : 'Copy'}</button>
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3.5">
        <p className="text-[13px] font-semibold text-slate-100">Support</p>
        <p className="mt-0.5 text-[13px] text-slate-400">Questions or higher limits? <a href="mailto:service@govcongiants.com" className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200">service@govcongiants.com</a></p>
      </div>
      <button onClick={switchAccount} className="rounded-lg border border-white/10 px-3.5 py-2 text-[13px] text-slate-300 hover:bg-white/10">Sign out / switch account</button>
    </div>
  );

  const bodies: Record<Section, React.ReactNode> = {
    usage: usageBody, activity: activityBody, billing: billingBody, keys: keysBody, settings: settingsBody,
  };

  return (
    <main className="min-h-dvh bg-[#0a0f1e] text-slate-100 [color-scheme:dark]">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-6">
        <McpNav active="account" signedIn balance={balance} />

        {justPurchased && (
          <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            <span>Payment received — your credits have been added to your account.</span>
            <button onClick={() => setJustPurchased(false)} className="text-emerald-400/60 hover:text-emerald-300">Dismiss</button>
          </div>
        )}
        {justSavedCard && (
          <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
            <span>Card saved — auto-recharge is on. We&apos;ll refill automatically when your balance runs low.</span>
            <button onClick={() => setJustSavedCard(false)} className="text-emerald-400/60 hover:text-emerald-300">Dismiss</button>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-6 md:flex-row md:gap-8">
          {/* Left rail */}
          <aside className="md:w-52 md:shrink-0">
            <nav className="flex gap-1 overflow-x-auto md:flex-col">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] transition ${section === s.id ? 'bg-emerald-400/10 font-semibold text-slate-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.28)]' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}`}
                >
                  <span className="w-4 text-center text-[13px] opacity-85">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <h1 className="mb-5 text-[13px] font-medium uppercase tracking-[0.14em] text-slate-500">{sectionTitle[section]}</h1>
            {bodies[section]}
          </div>
        </div>
      </div>
    </main>
  );
}
