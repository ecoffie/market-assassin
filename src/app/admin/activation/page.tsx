'use client';

/**
 * Admin: Activation (activation Phase 1). Read-only view over /api/admin/activation.
 * Value stages are proxies, the early-launch era is a diagnostic baseline, and a null rate reads "no data".
 */
import { FormEvent, Fragment, useState } from 'react';
import type { ActivationReport, Experience, GroupMetrics, Rate } from '@/lib/activation/framework';

const EXPERIENCES: { key: Experience; label: string }[] = [
  { key: 'native_app', label: 'Native app' },
  { key: 'app_and_mcp', label: 'App + MCP' },
  { key: 'mcp_only', label: 'MCP only' },
  { key: 'email_only', label: 'Email only' },
  { key: 'no_activity', label: 'No activity' },
];

type RowDef = { label: string; hint: string; get: (g: GroupMetrics) => Rate | number | null; section?: string };
const ROWS: RowDef[] = [
  { section: 'Registration', label: 'Accounts', hint: 'auth.users created in window', get: (g) => g.accounts },
  { label: 'Ever signed in', hint: '', get: (g) => g.signedIn },
  { section: 'Who is measured', label: 'Too new for 7-day metrics', hint: 'younger than 7×24h; in no 7-day rate yet', get: (g) => g.cohort.immature7d },
  { label: 'Telemetry outage, days 0–7', hint: 'left out of engagement rates (partial, not low)', get: (g) => g.cohort.telemetryGap7d },
  { label: 'Telemetry outage, days 15–30', hint: 'left out of retention', get: (g) => g.cohort.telemetryGap15to30 },
  { section: 'First value (proxy)', label: 'Opened an opportunity ≤7d', hint: 'opening is not proof of relevance', get: (g) => g.firstValue7d },
  { label: 'Meaningful search ≤7d', hint: 'submitted Map search with results > 0; null = not measured yet', get: (g) => g.meaningfulSearch7d },
  { label: 'Successful Ask Mindy ≤7d', hint: 'card or main chat answer; unknown accounts left out', get: (g) => g.askMindy7d },
  { label: '… main chat answer ≤7d', hint: 'complete, not truncated, no failed lookup', get: (g) => g.mainChatAnswer7d },
  { section: 'Accumulated value (proxy)', label: 'Kept work ≤7d', hint: 'tracked, watch, or saved card answer', get: (g) => g.accumulated7d },
  { label: 'Tracked ≥1 ≤7d', hint: '', get: (g) => g.tracked7d },
  { label: 'Tracked ≥3 ≤7d', hint: '', get: (g) => g.tracked3plus7d },
  { label: 'Saved card answer ≤7d', hint: 'null = source not deployed', get: (g) => g.cardAnswer7d },
  { label: 'Ever tracked', hint: '', get: (g) => g.everTracked },
  { label: 'Median hours to first tracked', hint: '', get: (g) => g.medianHoursToFirstTracked },
  { section: 'Return', label: 'Second active day ≤7d', hint: 'NOT value, NOT retention', get: (g) => g.secondDay7d },
  { label: 'Return value (proxy)', hint: 'change on tracked work → came back ≤7d; accounts created after the outage', get: (g) => g.returnValue },
  { label: 'Hypothesis milestone', hint: 'tracked ≥1 + second day, ≤7d', get: (g) => g.milestone },
  { label: 'Active days 15–30', hint: 'only accounts observed 31×24h, outside the outage', get: (g) => g.retained15to30 },
  { label: '… with milestone', hint: '', get: (g) => g.retained15to30Milestone },
  { label: '… without milestone', hint: '', get: (g) => g.retained15to30NoMilestone },
  { section: 'Paid', label: 'Paying on day one', hint: 'not conversions', get: (g) => g.paidAtSignup },
  { label: 'Paid after day one', hint: '', get: (g) => g.paidAfterSignup },
  { section: 'Credits', label: 'Hit the credit wall', hint: 'early-launch MCP behaviour', get: (g) => g.hitCreditWall },
  { label: 'Still active 7d after wall', hint: '', get: (g) => g.activeAfterWall7d },
];

function cell(v: Rate | number | null) {
  if (v === null) return <span className="text-slate-400">no data</span>;
  if (typeof v === 'number') return <span>{v.toLocaleString()}</span>;
  if (v.rate === null) return <span className="text-slate-400">no data</span>;
  return <span>{v.rate}% <span className="text-slate-400 text-xs">({v.n}/{v.of})</span></span>;
}

export default function ActivationPage() {
  const [password, setPassword] = useState('');
  const [days, setDays] = useState(120);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    report: ActivationReport; notes: string[];
    sources: { cardChatAvailable: boolean; mainChatAvailable: boolean; mainChatUntraced: number; searchMeasuredSince: string | null; bulkPipelineRowsSkipped: number };
  } | null>(null);

  async function load(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/activation?password=${encodeURIComponent(password)}&days=${days}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-8">
      <h1 className="text-2xl font-bold">Activation</h1>
      <p className="text-sm text-slate-600 mt-1 max-w-3xl">
        Working hypothesis (not proven): track at least one real opportunity in the first 7 days and return on a second day.
        Value stages are behavioural proxies. Read-only.
      </p>
      <form onSubmit={load} className="mt-4 flex flex-wrap gap-2 items-center">
        <input type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} className="border rounded px-3 py-2 text-sm" />
        <label className="text-sm">Days <input type="number" min={7} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="border rounded px-2 py-2 w-20 ml-1" /></label>
        <button disabled={loading} className="bg-slate-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50">{loading ? 'Loading… (up to a minute)' : 'Load'}</button>
      </form>
      {error && <p className="mt-4 text-red-700 text-sm">{error}</p>}
      {data && (
        <>
          {data.report.baselineNotStarted && (
            <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm max-w-3xl">
              <strong>New baseline not started.</strong> Every account below is early-launch: before Mindy Stabilization Complete.
              Use it as a diagnostic, not as a measure of the redesigned product or a reason to change pricing.
            </div>
          )}
          {(['early_launch', 'stabilized'] as const).map((era) => {
            const e = data.report.byEra[era];
            if (e.all.accounts === 0) return null;
            return (
              <section key={era} className="mt-6 overflow-x-auto">
                <h2 className="font-semibold">{era === 'early_launch' ? 'Early launch (diagnostic baseline)' : 'Stabilized cohort'}</h2>
                <table className="mt-2 text-sm bg-white border min-w-[760px]">
                  <thead><tr className="bg-slate-100">
                    <th className="text-left p-2">Metric</th><th className="text-left p-2">All</th>
                    {EXPERIENCES.map((x) => <th key={x.key} className="text-left p-2">{x.label}</th>)}
                  </tr></thead>
                  <tbody>
                    {ROWS.map((r) => (
                      <Fragment key={r.label}>
                        {r.section && <tr key={`${r.label}-s`}><td colSpan={7} className="pt-3 px-2 text-xs font-semibold uppercase text-slate-500">{r.section}</td></tr>}
                        <tr className="border-t">
                          <td className="p-2">{r.label}{r.hint && <div className="text-xs text-slate-400">{r.hint}</div>}</td>
                          <td className="p-2 font-medium">{cell(r.get(e.all))}</td>
                          {EXPERIENCES.map((x) => <td key={x.key} className="p-2">{cell(r.get(e.byExperience[x.key]))}</td>)}
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
          <ul className="mt-6 text-xs text-slate-600 list-disc pl-5 max-w-3xl">
            {data.notes.map((n) => <li key={n}>{n}</li>)}
            {!data.sources.cardChatAvailable && <li>Card-chat answers: source not deployed yet (shown as no data).</li>}
            {!data.sources.mainChatAvailable && <li>Main Ask Mindy answers: trace not available yet (shown as no data).</li>}
            {data.sources.mainChatUntraced > 0 && <li>{data.sources.mainChatUntraced.toLocaleString()} main-chat answers have no trace (written before it existed): success unknown, not counted.</li>}
            <li>Meaningful search measured since: {data.sources.searchMeasuredSince ?? 'not yet (no Map search with a result count recorded)'}.</li>
            {data.sources.bulkPipelineRowsSkipped > 0 && <li>{data.sources.bulkPipelineRowsSkipped.toLocaleString()} bulk-imported pipeline rows ignored (not user tracking).</li>}
          </ul>
        </>
      )}
    </main>
  );
}
