'use client';

/**
 * Admin: Customer health. Read-only view over /api/admin/customer-health.
 * One row per paying customer, most urgent first. This page never contacts anyone.
 */
import { FormEvent, useMemo, useState } from 'react';
import { STATUS_LABEL, STATUS_ORDER, type CustomerHealth, type HealthStatus, type HealthSummary } from '@/lib/customer-health/health';

interface Payload {
  generatedAt: string;
  stripeCacheUpdatedAt: string | null;
  quietDays: number;
  summary: HealthSummary;
  subscriptionsWithoutEmail: number;
  excludedAccounts: number;
  customers: CustomerHealth[];
}

const BADGE: Record<HealthStatus, string> = {
  payment_problem: 'bg-red-100 text-red-800 border-red-200',
  canceling: 'bg-orange-100 text-orange-800 border-orange-200',
  unknown: 'bg-slate-100 text-slate-700 border-slate-300',
  never_used: 'bg-amber-100 text-amber-800 border-amber-200',
  gone_quiet: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  healthy: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

function money(cents: number | null): string {
  if (cents === null) return 'unknown';
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function date(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

export default function CustomerHealthPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [filter, setFilter] = useState<HealthStatus | 'needs_attention' | 'all'>('needs_attention');

  async function load(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/customer-health?password=${encodeURIComponent(password)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || `HTTP ${res.status}`);
      setData(json.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === 'all') return data.customers;
    if (filter === 'needs_attention') return data.customers.filter((c) => c.status !== 'healthy');
    return data.customers.filter((c) => c.status === filter);
  }, [data, filter]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-8">
      <h1 className="text-2xl font-bold">Customer health</h1>
      <p className="text-sm text-slate-600 mt-1 max-w-3xl">
        Every paying customer, most urgent first. Reach out to the top of the list before they leave. Read-only: this page never contacts anyone.
      </p>
      <form onSubmit={load} className="mt-4 flex flex-wrap gap-2 items-center">
        <input type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} className="border rounded px-3 py-2 text-sm" />
        <button disabled={loading} className="bg-slate-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50">{loading ? 'Loading…' : data ? 'Refresh' : 'Load'}</button>
      </form>
      {error && <p className="mt-4 text-red-700 text-sm">{error}</p>}

      {data && (
        <>
          <section className="mt-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <button onClick={() => setFilter('all')} className={`text-left rounded border bg-white p-3 ${filter === 'all' ? 'ring-2 ring-slate-900' : ''}`}>
              <div className="text-xs text-slate-500">Paying customers</div>
              <div className="text-2xl font-bold">{data.summary.customers}</div>
            </button>
            {STATUS_ORDER.map((s) => (
              <button key={s} onClick={() => setFilter(s)} className={`text-left rounded border p-3 ${BADGE[s]} ${filter === s ? 'ring-2 ring-slate-900' : ''}`}>
                <div className="text-xs">{STATUS_LABEL[s]}</div>
                <div className="text-2xl font-bold">{data.summary.byStatus[s]}</div>
              </button>
            ))}
          </section>

          <p className="mt-3 text-sm">
            <strong>Monthly revenue at risk:</strong> {money(data.summary.atRiskMonthlyCents)}
            <span className="text-slate-500"> (customers not marked healthy)</span>
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Showing:</span>
            <button onClick={() => setFilter('needs_attention')} className={`rounded-full border px-3 py-1 ${filter === 'needs_attention' ? 'bg-slate-900 text-white' : 'bg-white'}`}>Needs attention</button>
            <button onClick={() => setFilter('all')} className={`rounded-full border px-3 py-1 ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-white'}`}>Everyone</button>
            <span className="text-slate-500">{rows.length} customer{rows.length === 1 ? '' : 's'}</span>
          </div>

          <section className="mt-3 overflow-x-auto">
            <table className="text-sm bg-white border min-w-[900px] w-full">
              <thead><tr className="bg-slate-100 text-left">
                <th className="p-2">Customer</th>
                <th className="p-2">Status</th>
                <th className="p-2">Why</th>
                <th className="p-2">$/month</th>
                <th className="p-2">Renews / ends</th>
                <th className="p-2">Last active</th>
                <th className="p-2">Customer since</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">Nobody here.</td></tr>}
                {rows.map((c) => (
                  <tr key={c.email} className="border-t align-top">
                    <td className="p-2">
                      {c.name && <div className="font-medium">{c.name}</div>}
                      <a href={`mailto:${c.email}`} className="text-blue-700 underline">{c.email}</a>
                    </td>
                    <td className="p-2"><span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${BADGE[c.status]}`}>{STATUS_LABEL[c.status]}</span></td>
                    <td className="p-2 text-slate-700">{c.reasons.length ? c.reasons.join(' · ') : '—'}</td>
                    <td className="p-2">{money(c.monthlyCents)}</td>
                    <td className="p-2">{date(c.renewsOrEndsAt)}<div className="text-xs text-slate-400">{c.subscriptionStatus.replace('_', ' ')}</div></td>
                    <td className="p-2">
                      {c.status === 'unknown' ? <span className="text-slate-400">unknown</span> : c.lastActivityAt ? (
                        <>{date(c.lastActivityAt)}<div className="text-xs text-slate-400">{c.daysSinceActivity === 0 ? 'today' : `${c.daysSinceActivity}d ago`}</div></>
                      ) : <span className="text-slate-400">never</span>}
                    </td>
                    <td className="p-2">{date(c.customerSince)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <ul className="mt-6 text-xs text-slate-600 list-disc pl-5 max-w-3xl space-y-1">
            <li>Billing is the daily Stripe cache{data.stripeCacheUpdatedAt ? `, last synced ${new Date(data.stripeCacheUpdatedAt).toLocaleString()}` : ' (last sync time unknown)'}. Page built {new Date(data.generatedAt).toLocaleString()}.</li>
            <li>Paying = Stripe status active, trialing, past due or unpaid. Gone quiet = no tracked activity for {data.quietDays}+ days.</li>
            <li>Activity is any event in user_engagement (app, map, email clicks, MCP). Something we do not track does not count.</li>
            <li>Comp, partner, advocate and test accounts are left out ({data.excludedAccounts}).</li>
            {data.subscriptionsWithoutEmail > 0 && <li className="text-red-700">{data.subscriptionsWithoutEmail} paying subscription(s) have no email in the Stripe cache and are not shown.</li>}
          </ul>
        </>
      )}
    </main>
  );
}
