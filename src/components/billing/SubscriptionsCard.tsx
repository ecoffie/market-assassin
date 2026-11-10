'use client';

/**
 * "Your subscriptions" — every plan the signed-in user is on (Mindy Pro/Team, MCP credits
 * plan), each with a Manage / cancel button that opens Stripe's billing portal on the customer
 * that holds it. Used on the MCP account page and in app Settings → Billing.
 *
 * Unknown is never shown as "none": if Stripe can't be read, the card says so.
 */
import { useCallback, useEffect, useState } from 'react';
import { authedFetch } from '@/components/app/authHeaders';

type Sub = {
  id: string;
  kind: 'mcp' | 'app';
  planName: string;
  status: string;
  amount: number | null;
  interval: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  billedTo: string;
};

type Data = {
  plan: 'free' | 'pro' | 'team' | 'enterprise' | null;
  planLabel: string | null;
  subscriptions: Sub[] | null;
  /** Pro plans only: does this access carry a recurring monthly MCP allowance? */
  monthlyMcpCredits?: 'included' | 'not_included' | 'unknown' | null;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

function statusLabel(s: string) {
  if (s === 'trialing') return 'Trial';
  if (s === 'past_due') return 'Past due';
  if (s === 'unpaid') return 'Unpaid';
  return 'Active';
}

export default function SubscriptionsCard({ email, upgradeHref = '/pricing' }: { email: string | null; upgradeHref?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    let off = false;
    (async () => {
      try {
        const r = await authedFetch(`/api/app/billing/subscriptions?email=${encodeURIComponent(email)}`, email);
        const j = await r.json();
        if (off) return;
        if (r.ok && j?.success) setData({ plan: j.plan, planLabel: j.planLabel, subscriptions: j.subscriptions, monthlyMcpCredits: j.monthlyMcpCredits ?? null });
        else setFailed(true);
      } catch {
        if (!off) setFailed(true);
      }
    })();
    return () => { off = true; };
  }, [email]);

  const manage = useCallback(async (sub: Sub) => {
    if (!email) return;
    setOpening(sub.id);
    setErr(null);
    try {
      const r = await authedFetch('/api/app/billing/portal', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, billedTo: sub.billedTo, returnUrl: window.location.href }),
      });
      const j = await r.json();
      if (j?.success && j.url) { window.location.href = j.url; return; }
      setErr(j?.error || 'Could not open billing.');
    } catch {
      setErr('Could not open billing.');
    } finally {
      setOpening(null);
    }
  }, [email]);

  const subs = data?.subscriptions ?? null;
  const hasPaidPlanWithoutSub = !!data?.plan && data.plan !== 'free' && subs !== null && !subs.some((s) => s.kind === 'app');

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4" data-testid="subscriptions-card">
      <p className="text-[13px] font-semibold text-slate-100">Your subscriptions</p>

      {!data && !failed ? (
        <div className="mt-3 h-14 animate-pulse rounded-lg bg-white/[0.04]" />
      ) : failed ? (
        <p className="mt-2 text-[12px] text-amber-300">Your subscriptions couldn&apos;t load. Refresh the page, or email admin@getmindy.ai.</p>
      ) : (
        <div className="mt-3 space-y-2.5">
          {/* The Mindy plan, however it was granted. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
            <div>
              <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Mindy plan</p>
              <p className="text-[14px] font-semibold text-slate-100">{data?.planLabel ?? 'Unknown'}</p>
              {/* Only when it is ESTABLISHED as absent; 'unknown' renders nothing. */}
              {data?.plan === 'pro' && data.monthlyMcpCredits === 'not_included' && (
                <p className="mt-0.5 text-[12px] text-slate-400" data-testid="monthly-mcp-credits-not-included">
                  Monthly MCP credits: not included with this access.
                </p>
              )}
            </div>
            {data?.plan === 'free' && (
              <a href={upgradeHref} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-400">Upgrade</a>
            )}
          </div>

          {subs === null ? (
            <p className="text-[12px] text-amber-300">We couldn&apos;t check your paid subscriptions right now. Refresh to try again.</p>
          ) : subs.length === 0 ? (
            <p className="text-[12px] text-slate-500">No paid subscriptions. Credit top-ups are one-time and don&apos;t renew.</p>
          ) : (
            subs.map((s) => {
              const date = fmt(s.currentPeriodEnd);
              const price = s.amount != null ? `$${s.amount.toLocaleString()}${s.interval ? `/${s.interval === 'month' ? 'mo' : s.interval === 'year' ? 'yr' : s.interval}` : ''}` : null;
              const ok = s.status === 'active' || s.status === 'trialing';
              return (
                <div key={s.id} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{s.kind === 'mcp' ? 'MCP plan · AI connector credits' : 'Mindy subscription'}</p>
                      <p className="text-[14px] font-semibold text-slate-100">
                        {s.planName}
                        {price && <span className="ml-2 font-normal text-slate-400">{price}</span>}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                        <span className={`rounded-full px-2 py-0.5 font-medium ${ok && !s.cancelAtPeriodEnd ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                          {s.cancelAtPeriodEnd ? 'Cancelling' : statusLabel(s.status)}
                        </span>
                        {date && <span className="text-slate-500">{s.cancelAtPeriodEnd ? `Ends ${date}` : `Renews ${date}`}</span>}
                      </p>
                      {email && s.billedTo !== email.toLowerCase() && (
                        <p className="mt-1 text-[11px] text-slate-500">Billed to {s.billedTo}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => manage(s)}
                      disabled={opening !== null}
                      className="shrink-0 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-white/10 disabled:opacity-60"
                    >
                      {opening === s.id ? 'Opening…' : 'Manage / cancel'}
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {hasPaidPlanWithoutSub && (
            <p className="text-[12px] text-slate-500">
              Your {data?.planLabel} access isn&apos;t a personal subscription here (it comes from a team, bundle or grant), so there&apos;s nothing to cancel.{' '}
              <a href="mailto:admin@getmindy.ai" className="text-emerald-300 underline underline-offset-2">Questions? Contact support</a>
            </p>
          )}
          <p className="text-[11px] text-slate-500">Cancel, change plan, update your card or download invoices on Stripe&apos;s secure page.</p>
          {err && <p className="text-[12px] text-red-300">{err}</p>}
        </div>
      )}
    </div>
  );
}
