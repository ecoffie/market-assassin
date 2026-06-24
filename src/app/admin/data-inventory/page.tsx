'use client';

/**
 * Mindy Data Core — admin visual. Pie charts (by dataset + by provenance) over the
 * live /api/admin/data-inventory counts, plus the dataset table + forecast source
 * trace. The internal "here's the moat, quantified" screen.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from 'recharts';

type Provenance = 'exclusive' | 'curated' | 'cache' | 'passthrough';

interface DatasetEntry {
  key: string;
  label: string;
  source: string;
  provenance: Provenance;
  count: number | null;
  note?: string;
}

interface InventoryData {
  name: string;
  generatedAt: string;
  datasets: DatasetEntry[];
  totals: { exclusiveRecords: number; curatedRecords: number; cachedRecords: number; allMeasured: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceTrace?: { forecastsByAgency?: any[] };
}

const DATASET_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444', '#eab308', '#64748b'];
const PROVENANCE_META: Record<Provenance, { label: string; color: string }> = {
  exclusive: { label: 'Exclusive (ours)', color: '#10b981' },
  curated: { label: 'Curated (public + our work)', color: '#f59e0b' },
  cache: { label: 'Cache (public corpus)', color: '#3b82f6' },
  passthrough: { label: 'Passthrough (live API)', color: '#64748b' },
};

const fmt = (n: number) => n.toLocaleString();

export default function DataInventoryPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<InventoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/data-inventory?password=${encodeURIComponent(password)}`, { cache: 'no-store' });
      if (!res.ok) { setError(res.status === 401 ? 'Invalid password' : `HTTP ${res.status}`); setLoading(false); return; }
      const json = await res.json();
      setData(json);
      setAuthed(true);
    } catch {
      setError('Failed to load');
    }
    setLoading(false);
  }, [password]);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h1 className="text-lg font-bold text-white mb-1">Mindy Data Core</h1>
          <p className="text-xs text-slate-400 mb-4">Admin password required.</p>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Admin password"
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white mb-3"
          />
          <button onClick={load} disabled={loading} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {loading ? 'Loading…' : 'Open'}
          </button>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  if (!data) return <div className="min-h-screen bg-slate-950 p-6 text-slate-400">Loading…</div>;

  const measured = data.datasets.filter((d) => typeof d.count === 'number' && (d.count as number) > 0);
  const datasetPie = measured.map((d, i) => ({ name: d.label, value: d.count as number, color: DATASET_COLORS[i % DATASET_COLORS.length] }));
  const provenancePie = (Object.keys(PROVENANCE_META) as Provenance[])
    .map((p) => ({ name: PROVENANCE_META[p].label, value: data.totals[`${p}Records` as keyof typeof data.totals] as number || 0, color: PROVENANCE_META[p].color }))
    .filter((x) => x.value > 0);

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-200">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">🧠 Mindy Data Core</h1>
            <p className="text-sm text-slate-400">The moat, quantified — {fmt(data.totals.allMeasured)} records across {measured.length} datasets.</p>
          </div>
          <button onClick={load} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Refresh</button>
        </div>

        {/* Totals strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Exclusive (ours)" value={fmt(data.totals.exclusiveRecords)} color="text-emerald-400" />
          <Stat label="Curated" value={fmt(data.totals.curatedRecords)} color="text-amber-400" />
          <Stat label="Cached" value={fmt(data.totals.cachedRecords)} color="text-blue-400" />
          <Stat label="All measured" value={fmt(data.totals.allMeasured)} color="text-white" />
        </div>

        {/* Pies */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <ChartCard title="By dataset">
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie data={datasetPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} label={(e) => fmt(e.value)}>
                  {datasetPie.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="By provenance (the moat story)">
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie data={provenancePie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={110} label={(e) => fmt(e.value)}>
                  {provenancePie.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Dataset</th>
                <th className="text-right px-4 py-2">Count</th>
                <th className="text-left px-4 py-2">Provenance</th>
                <th className="text-left px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {data.datasets.map((d) => (
                <tr key={d.key} className="border-t border-slate-800">
                  <td className="px-4 py-2 text-white">{d.label}{d.note && <span className="block text-[11px] text-slate-500">{d.note}</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-300">{typeof d.count === 'number' ? fmt(d.count) : 'live'}</td>
                  <td className="px-4 py-2">
                    <span className="rounded px-2 py-0.5 text-[11px]" style={{ background: PROVENANCE_META[d.provenance].color + '22', color: PROVENANCE_META[d.provenance].color }}>
                      {PROVENANCE_META[d.provenance].label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{d.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[11px] text-slate-600">Generated {new Date(data.generatedAt).toLocaleString()} · live counts via /api/admin/data-inventory</p>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      {children}
    </div>
  );
}
