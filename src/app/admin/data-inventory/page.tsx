'use client';

/**
 * Mindy Data Core — ADMIN TRUTH SURFACE.
 *
 * Renders /api/admin/data-inventory grouped by what each dataset IS (owned source
 * corpus · derived intelligence · static/manual · derived index · live passthrough),
 * with stored-vs-served counts, freshness and customer surface on every row.
 *
 * The headline is the UNIQUE UNDERLYING SOURCE RECORD total. Derived records, index
 * representations and passthrough capabilities are shown beside it, never added to it.
 * (The previous "moat, quantified" pies summed all of them — including SAM rows twice.)
 */

import { useCallback, useState } from 'react';

type Kind = 'source_corpus' | 'derived_intelligence' | 'derived_index' | 'static_manual' | 'passthrough';
type FreshnessState = 'CURRENT' | 'STALE' | 'UNREACHABLE' | 'STATIC' | 'MANUAL' | 'PASSTHROUGH' | 'UNKNOWN';
type SurfaceState = 'customer_readable' | 'internal_only' | 'withheld' | 'passthrough';

interface CountPart { label: string; count: number | null; note?: string }
interface ScheduleTruth {
  job: string; cron: string | null; enabled: boolean | null;
  lastScheduledRun: { at: string; status: string | null; httpStatus: number | null } | null;
  lastManualRefresh: string | null; nextScheduled: string | null; recurrence: string;
}
interface InstanceFreshness {
  sourceKey: string; state: FreshnessState; sourceState: string | null; interventionState: string | null;
  heldPopulation: number | null; lastDataAdvance: string | null;
}
interface Dataset {
  key: string; label: string; kind: Kind; stored: number | null; unit: string;
  served?: { count: number | null; label: string; excluded: CountPart[] };
  breakdown?: CountPart[];
  uniqueContribution: number | null; uniqueNote?: string;
  freshness: { state: FreshnessState; asOf: string | null; basis: string; detail?: string; schedules?: ScheduleTruth[]; instances?: InstanceFreshness[] };
  surface: { state: SurfaceState; tools: string[]; app?: string[]; note?: string };
  upstreams: string[]; provenance: string;
  proseAttributions?: Array<{ label: string; claims: number; livingRecords: number | null }>;
  note?: string;
}
interface InventoryData {
  generatedAt: string;
  datasets: Dataset[];
  totals: {
    uniqueSourceRecords: number; unmeasuredSources: string[]; derivedRecords: number;
    staticRecords: number; indexedRepresentations: number; passthroughCapabilities: number;
  };
  upstreams: {
    persisted: string[]; forecastIssuers: string[]; passthroughOnly: string[]; internal: string[];
    total: number; definition: string; names: Record<string, string>; registeredFeeds: number;
  };
  registryDebt: Array<{ where: string; claimed: number; measured: number }>;
  violations: string[];
  provenanceLimits: Record<string, number | null>;
}

const SECTIONS: Array<{ kind: Kind; title: string; blurb: string }> = [
  { kind: 'source_corpus', title: 'Owned source corpora', blurb: 'Records held from an upstream publisher. The only rows in the headline total.' },
  { kind: 'derived_intelligence', title: 'Derived / curated intelligence', blurb: 'Built from the corpora above. Real records of a different type — not additional underlying records.' },
  { kind: 'static_manual', title: 'Static / manual data', blurb: 'Hand-authored or bundled files. No producer, no clock.' },
  { kind: 'derived_index', title: 'Derived index / representation', blurb: 'Representations of records already counted (vectors, chunks). Never a record count.' },
  { kind: 'passthrough', title: 'Live passthrough', blurb: 'Fetched live per call. Customer capabilities — contribute no persisted records.' },
];

const FRESH_STYLE: Record<FreshnessState, string> = {
  CURRENT: 'bg-emerald-500/15 text-emerald-300',
  STALE: 'bg-amber-500/15 text-amber-300',
  UNREACHABLE: 'bg-red-500/15 text-red-300',
  STATIC: 'bg-slate-500/20 text-slate-300',
  MANUAL: 'bg-sky-500/15 text-sky-300',
  PASSTHROUGH: 'bg-violet-500/15 text-violet-300',
  UNKNOWN: 'bg-orange-500/15 text-orange-300',
};
const SURFACE_META: Record<SurfaceState, { label: string; cls: string }> = {
  customer_readable: { label: 'Customer-readable', cls: 'bg-emerald-500/10 text-emerald-300' },
  internal_only: { label: 'Internal only', cls: 'bg-slate-500/20 text-slate-300' },
  withheld: { label: 'Withheld', cls: 'bg-red-500/15 text-red-300' },
  passthrough: { label: 'Customer passthrough', cls: 'bg-violet-500/15 text-violet-300' },
};

const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString() : 'unmeasured');
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—');
const when = (s: string | null | undefined) => (s ? `${s.slice(0, 10)} ${s.slice(11, 16)}Z` : '—');

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
      setData(await res.json());
      setAuthed(true);
    } catch {
      setError('Failed to load');
    }
    setLoading(false);
  }, [password]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-ground-deep flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-xl border border-surface bg-ground p-6">
          <h1 className="text-lg font-bold text-white mb-1">Mindy Data Core</h1>
          <p className="text-xs text-muted mb-4">Admin password required.</p>
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Admin password"
            className="w-full rounded-lg bg-surface border border-hairline px-3 py-2 text-sm text-white mb-3"
          />
          <button onClick={load} disabled={loading} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {loading ? 'Loading…' : 'Open'}
          </button>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  if (!data) return <div className="min-h-screen bg-ground-deep p-6 text-muted">Loading…</div>;
  const t = data.totals;
  const u = data.upstreams;
  // The award-transaction warehouse is a legitimate owned corpus but ~98% of the headline
  // by count. Show the headline WITH its composition so neither number is read alone.
  const warehouse = data.datasets.find((d) => d.key === 'bq_awards')?.uniqueContribution ?? null;
  const headlineSub = t.unmeasuredSources.length
    ? `floor — unmeasured: ${t.unmeasuredSources.join(', ')}`
    : warehouse != null
      ? `incl. ${fmt(warehouse)} award transactions · ${fmt(t.uniqueSourceRecords - warehouse)} in all other corpora`
      : 'owned source corpora only';

  return (
    <div className="min-h-screen bg-ground-deep p-4 md:p-6 text-slate-200">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between gap-4 mb-2">
          <div>
            <h1 className="text-2xl font-bold text-white">Mindy Data Core</h1>
            <p className="text-sm text-muted">What Mindy holds today — measured live, grouped by what each dataset is.</p>
          </div>
          <button onClick={load} disabled={loading} className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-ink-soft hover:bg-surface disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Re-measure'}
          </button>
        </div>

        {data.violations.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-300">
            <b>Inventory invariant violations:</b> {data.violations.join(' · ')}
          </div>
        )}

        {/* Headline */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-2">
          <Stat
            label="Unique underlying source records"
            value={fmt(t.uniqueSourceRecords)}
            sub={headlineSub}
            cls="text-white" big
          />
          <Stat label="Derived intelligence records" value={fmt(t.derivedRecords)} sub="built from the sources — not added" cls="text-amber-300" />
          <Stat label="Static / manual records" value={fmt(t.staticRecords)} sub="hand-authored files — not added" cls="text-slate-300" />
          <Stat label="Indexed representations" value={fmt(t.indexedRepresentations)} sub="vectors + chunks of counted records" cls="text-sky-300" />
          <Stat label="Upstream publishers" value={String(u.total)} sub={`${u.persisted.length} feeds + ${u.forecastIssuers.length} forecast issuers`} cls="text-emerald-300" />
          <Stat label="Live passthrough" value={String(t.passthroughCapabilities)} sub="capabilities · 0 persisted records" cls="text-violet-300" />
        </div>
        <p className="text-[11px] text-faint mb-6">
          Unique within each corpus. Corpora are distinct stores and are not deduplicated against each other where they share an upstream
          (e.g. recompete contracts vs. the contractor population&apos;s award history; Grants.gov in both grants and the research slice).
        </p>

        {SECTIONS.map((s) => {
          const rows = data.datasets.filter((d) => d.kind === s.kind);
          if (!rows.length) return null;
          return (
            <section key={s.kind} className="mb-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white">{s.title}</h2>
              <p className="text-xs text-muted mb-2">{s.blurb}</p>
              <div className="rounded-xl border border-surface bg-ground overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead className="bg-surface/60 text-muted text-[11px] uppercase">
                    <tr>
                      <th className="text-left px-3 py-2 w-[34%]">Dataset</th>
                      <th className="text-right px-3 py-2">Stored</th>
                      <th className="text-right px-3 py-2">{s.kind === 'source_corpus' ? 'Served · headline' : 'Served'}</th>
                      <th className="text-left px-3 py-2">Freshness</th>
                      <th className="text-left px-3 py-2">Customer surface</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => <Row key={d.key} d={d} names={u.names} />)}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        {/* Upstreams */}
        <section className="mb-6 rounded-xl border border-surface bg-ground p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white mb-1">Upstream publishers — {u.total}</h2>
          <p className="text-xs text-muted mb-3">{u.definition}</p>
          <div className="grid md:grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-faint mb-1">Persisted feeds ({u.persisted.length})</div>
              <ul className="space-y-0.5">{u.persisted.map((k) => <li key={k}>· {u.names[k] ?? k}</li>)}</ul>
              <div className="text-faint mt-3 mb-1">Forecast issuing agencies with held rows ({u.forecastIssuers.length})</div>
              <div>{u.forecastIssuers.join(' · ')}</div>
            </div>
            <div>
              <div className="text-faint mb-1">Passthrough only — not persisted, not in the count ({u.passthroughOnly.length})</div>
              <ul className="space-y-0.5">{u.passthroughOnly.map((k) => <li key={k}>· {u.names[k] ?? k}</li>)}</ul>
              <div className="text-faint mt-3 mb-1">Internal corpora — ours, not an upstream ({u.internal.length})</div>
              <ul className="space-y-0.5">{u.internal.map((k) => <li key={k}>· {u.names[k] ?? k}</li>)}</ul>
              <div className="text-faint mt-3">Control plane registers {u.registeredFeeds} feed instances (data_source_instances).</div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-faint">
            Held source documents by type — IG reports: {fmt(data.provenanceLimits.igSourceDocuments)} · CRS reports: {fmt(data.provenanceLimits.crsSourceDocuments)} ·
            budget justifications: {fmt(data.provenanceLimits.budgetJustificationDocuments)} · strategic plans: {fmt(data.provenanceLimits.strategicPlanDocuments)}.
            These appear only as prose attributions inside curated claims.
          </p>
        </section>

        {/* Registry debt */}
        <section className="mb-6 rounded-xl border border-amber-500/30 bg-ground p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300 mb-1">Registry debt — {data.registryDebt.length}</h2>
          <p className="text-xs text-muted mb-2">Control-plane counts that disagree (&gt;1%) with what this page just measured. The page uses the measurement, never the registry figure.</p>
          {data.registryDebt.length === 0 ? <p className="text-xs text-faint">None.</p> : (
            <table className="w-full text-xs">
              <thead className="text-faint"><tr><th className="text-left py-1">Registry field</th><th className="text-right">Claims</th><th className="text-right">Measured</th></tr></thead>
              <tbody>
                {data.registryDebt.map((r) => (
                  <tr key={r.where} className="border-t border-surface">
                    <td className="py-1 font-mono text-[11px]">{r.where}</td>
                    <td className="text-right font-mono">{fmt(r.claimed)}</td>
                    <td className="text-right font-mono text-emerald-300">{fmt(r.measured)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="mt-2 text-[11px] text-slate-600">Measured {new Date(data.generatedAt).toLocaleString()} · /api/admin/data-inventory</p>
      </div>
    </div>
  );
}

function Row({ d, names }: { d: Dataset; names: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(d.breakdown?.length || d.served?.excluded.length || d.proseAttributions?.length
    || d.freshness.schedules?.length || d.freshness.instances?.length);
  const f = d.freshness;
  return (
    <>
      <tr className="border-t border-surface align-top">
        <td className="px-3 py-2">
          <div className="text-white font-medium">{d.label}</div>
          <div className="text-[11px] text-faint mt-0.5">{d.provenance}</div>
          {d.note && <div className="text-[11px] text-amber-300/80 mt-0.5">{d.note}</div>}
          {d.upstreams.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {d.upstreams.map((k) => <span key={k} className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-ink-soft">{(names[k] ?? k).split(' — ')[0]}</span>)}
            </div>
          )}
          {hasDetail && (
            <button onClick={() => setOpen((o) => !o)} className="mt-1 text-[11px] text-sky-300 hover:underline">
              {open ? 'Hide detail' : 'Show detail'}
            </button>
          )}
        </td>
        <td className="px-3 py-2 text-right font-mono text-emerald-300 whitespace-nowrap">
          {d.kind === 'passthrough' ? <span className="text-violet-300">not persisted</span> : fmt(d.stored)}
          <div className="text-[10px] text-faint font-sans">{d.kind === 'passthrough' ? '' : d.unit}</div>
        </td>
        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
          {d.served ? (
            <>
              <span className="text-white">{fmt(d.served.count)}</span>
              <div className="text-[10px] text-faint font-sans max-w-[180px] ml-auto whitespace-normal">{d.served.label}</div>
            </>
          ) : <span className="text-faint">—</span>}
          {d.kind === 'source_corpus' && (
            <div className="mt-1 text-[10px] font-sans text-emerald-400/80 whitespace-normal max-w-[180px] ml-auto">
              headline +{fmt(d.uniqueContribution)}{d.uniqueNote ? ` — ${d.uniqueNote}` : ''}
            </div>
          )}
          {d.kind !== 'source_corpus' && d.uniqueNote && (
            <div className="mt-1 text-[10px] font-sans text-faint whitespace-normal max-w-[180px] ml-auto">{d.uniqueNote}</div>
          )}
        </td>
        <td className="px-3 py-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${FRESH_STYLE[f.state]}`}>{f.state}</span>
          {f.state !== 'PASSTHROUGH' && <div className="text-[11px] text-ink-soft mt-1">as of {f.asOf ? day(f.asOf) : 'unknown'}</div>}
          {f.detail && <div className="text-[10px] text-faint mt-0.5 max-w-[240px]">{f.detail}</div>}
          <div className="text-[10px] text-slate-600 mt-0.5 max-w-[240px]" title={f.basis}>{f.basis}</div>
        </td>
        <td className="px-3 py-2">
          <span className={`rounded px-2 py-0.5 text-[11px] ${SURFACE_META[d.surface.state].cls}`}>{SURFACE_META[d.surface.state].label}</span>
          {d.surface.tools.length > 0 && <div className="mt-1 font-mono text-[10px] text-ink-soft">{d.surface.tools.join(' · ')}</div>}
          {d.surface.app?.length ? <div className="mt-0.5 text-[10px] text-faint">{d.surface.app.join(' · ')}</div> : null}
          {d.surface.note && <div className="mt-0.5 text-[10px] text-faint max-w-[220px]">{d.surface.note}</div>}
        </td>
      </tr>
      {open && hasDetail && (
        <tr className="bg-surface/20">
          <td colSpan={5} className="px-3 py-3">
            <div className="grid md:grid-cols-2 gap-4 text-xs">
              {d.breakdown?.length ? <Parts title="Breakdown" parts={d.breakdown} /> : null}
              {d.served?.excluded.length ? <Parts title="Stored but not served" parts={d.served.excluded} /> : null}
              {d.proseAttributions?.length ? (
                <div>
                  <div className="text-faint mb-1">Prose attributions inside these claims (not held sources)</div>
                  <table className="w-full">
                    <thead className="text-faint text-[10px]"><tr><th className="text-left">Named in prose</th><th className="text-right">Claims</th><th className="text-right">Held source documents of that type</th></tr></thead>
                    <tbody>
                      {d.proseAttributions.map((a) => (
                        <tr key={a.label}><td>{a.label}</td><td className="text-right font-mono">{a.claims.toLocaleString()}</td>
                          <td className={`text-right font-mono ${a.livingRecords === 0 ? 'text-red-300' : ''}`}>{fmt(a.livingRecords)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {f.schedules?.length ? (
                <div>
                  <div className="text-faint mb-1">Collectors</div>
                  {f.schedules.map((s) => (
                    <div key={s.job} className="mb-1.5">
                      <span className="font-mono text-ink-soft">{s.job}</span> <span className="text-faint">{s.cron ?? 'no cron row'}{s.enabled === false ? ' · DISABLED' : ''}</span>
                      <div className="text-[11px] text-faint">
                        last scheduled run: {s.lastScheduledRun ? `${when(s.lastScheduledRun.at)} (${s.lastScheduledRun.status ?? '?'}${s.lastScheduledRun.httpStatus != null ? `, HTTP ${s.lastScheduledRun.httpStatus}` : ', HTTP status unrecorded'})` : 'none in the last 21 days'}
                        {s.lastManualRefresh && <> · last manual refresh: {when(s.lastManualRefresh)}</>}
                        {s.nextScheduled && <> · next scheduled: {when(s.nextScheduled)}</>}
                        {' · recurrence: '}<b className={s.recurrence === 'proven' ? 'text-emerald-300' : 'text-amber-300'}>{s.recurrence.replace(/_/g, ' ')}</b>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {f.instances?.length ? (
                <div>
                  <div className="text-faint mb-1">Registered feeds</div>
                  {f.instances.map((i) => (
                    <div key={i.sourceKey} className="flex gap-2 items-baseline">
                      <span className={`rounded px-1.5 text-[10px] ${FRESH_STYLE[i.state]}`}>{i.state}</span>
                      <span className="font-mono text-[11px]">{i.sourceKey}</span>
                      <span className="text-faint text-[10px]">{i.sourceState}{i.interventionState && i.interventionState !== 'none_required' ? ` · ${i.interventionState}` : ''} · held {fmt(i.heldPopulation)} · advanced {day(i.lastDataAdvance)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Parts({ title, parts }: { title: string; parts: Array<{ label: string; count: number | null; note?: string }> }) {
  return (
    <div>
      <div className="text-faint mb-1">{title}</div>
      <table className="w-full">
        <tbody>
          {parts.map((p) => (
            <tr key={p.label}>
              <td className="pr-2">{p.label}{p.note && <span className="text-faint"> — {p.note}</span>}</td>
              <td className="text-right font-mono">{fmt(p.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub, cls, big }: { label: string; value: string; sub?: string; cls: string; big?: boolean }) {
  return (
    <div className={`rounded-xl border ${big ? 'border-emerald-500/40 col-span-2 md:col-span-1' : 'border-surface'} bg-ground p-3`}>
      <div className={`${big ? 'text-2xl' : 'text-xl'} font-bold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[11px] text-ink-soft mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-faint mt-0.5">{sub}</div>}
    </div>
  );
}
