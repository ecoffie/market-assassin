'use client';

/**
 * Mindy Data Core — ADMIN TRUTH SURFACE.
 *
 * Viewport 1: KPI strip · owned-corpus composition · platform health
 * Viewport 2: customer coverage · intelligence stack · freshness wall
 * Viewport 3: stored → served · award warehouse · attention items · registry debt
 * Then:       the Observation Moat (what Mindy remembers about how the market changed)
 * Last:       the per-dataset drill-down tables (the table view behind every chart)
 *
 * Headline hierarchy, by GRAIN: owned source records (primary) · + award transactions
 * (secondary, a different grain) · = persisted source rows. Nothing is called "unique":
 * datasets are summed per store, not deduplicated against each other. Derived records,
 * index representations, static files, passthrough and observation history are shown
 * beside it, never added. Each chart component opens with the question it answers
 * (see ./charts.tsx).
 */

import { useCallback, useState } from 'react';
import type { Dataset, InventoryData, Kind, SurfaceState } from './types';
import {
  TipProvider, OwnedCompositionChart, PlatformHealthChart, CustomerCoverageChart, TransformationStack,
  FreshnessWall, StoredServedChart, AwardWarehouseCard, AttentionItems, MoatModel, ObservationPipeline,
  CompoundingObservationChart, ChangeTypesChart, LeaderboardMovementChart, LatestChangesFeed,
  IntelligenceChangesCard, CompetitionHealthCard, STATE_META, fmt, compact, day,
} from './charts';

const SECTIONS: Array<{ kind: Kind; title: string; blurb: string }> = [
  { kind: 'source_corpus', title: 'Owned source corpora', blurb: 'Held from an upstream publisher. The only rows in the source totals — record-grain rows count as owned records, the award warehouse counts separately as transactions.' },
  { kind: 'derived_intelligence', title: 'Derived / curated intelligence', blurb: 'Built from the corpora above. Real records of a different type — not additional underlying records.' },
  { kind: 'static_manual', title: 'Static / manual data', blurb: 'Hand-authored or bundled files. No producer, no clock.' },
  { kind: 'derived_index', title: 'Derived index / representation', blurb: 'Representations of records already counted (vectors, chunks). Never a record count.' },
  { kind: 'passthrough', title: 'Live passthrough', blurb: 'Fetched live per call. Customer capabilities — contribute no persisted records.' },
];

const SURFACE_LABEL: Record<SurfaceState, string> = {
  customer_readable: 'Customer-readable', internal_only: 'Internal only', withheld: 'Withheld', passthrough: 'Customer passthrough',
};
const when = (s: string | null | undefined) => (s ? `${s.slice(0, 10)} ${s.slice(11, 16)}Z` : '—');

export default function DataInventoryPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<InventoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

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

  /** Drill-through: open a dataset's detail row and bring it into view. */
  const jump = useCallback((key: string) => {
    setOpenKey(key);
    requestAnimationFrame(() => document.getElementById(`ds-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, []);

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
  const now = new Date(data.generatedAt);
  const warehouse = data.datasets.find((d) => d.grain === 'transaction');
  const attentionCount = data.datasets.filter((d) => STATE_META[d.freshness.state].attention).length;
  const floorNote = t.unmeasuredSources.length ? ` · floor — unmeasured: ${t.unmeasuredSources.join(', ')}` : '';

  return (
    <TipProvider>
      <div className={`min-h-screen bg-ground-deep p-4 md:p-6 text-slate-200 ${loading ? 'opacity-70' : ''}`}>
        <div className="max-w-[1400px] mx-auto space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Mindy Data Core</h1>
              <p className="text-sm text-muted">What Mindy holds, derives and remembers — measured live {when(data.generatedAt)}.</p>
            </div>
            <button onClick={load} disabled={loading} className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-ink-soft hover:bg-surface disabled:opacity-50">
              {loading ? 'Re-measuring…' : 'Re-measure'}
            </button>
          </div>

          {data.violations.length > 0 && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-300">
              <b>Inventory invariant violations:</b> {data.violations.join(' · ')}
            </div>
          )}

          {/* ── VIEWPORT 1 · KPI strip — "How big is Data Core?" ── */}
          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
            <div className="rounded-xl border border-emerald-500/40 bg-ground p-4">
              <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-emerald-300">Owned source records</div>
                  <div className="text-3xl font-bold text-white">{fmt(t.ownedSourceRecords)}</div>
                  <div className="text-[11px] text-faint">record-grain source datasets, summed per dataset{floorNote}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-sky-300">+ Award transactions</div>
                  <div className="text-2xl font-bold text-sky-200">+ {fmt(t.transactionRows)}</div>
                  <div className="text-[11px] text-faint">transaction grain{warehouse ? ` · through ${day(warehouse.freshness.asOf)}` : ''}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-soft">= Persisted source rows</div>
                  <div className="text-2xl font-bold text-ink-soft">{fmt(t.persistedSourceRows)}</div>
                  <div className="text-[11px] text-faint">mixed grain · not deduplicated across datasets</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Kpi label="Derived intelligence" value={compact(t.derivedRecords)} sub="records, not in source totals" />
              <Kpi label="Semantic / indexed" value={compact(t.indexedRepresentations)} sub="representations" />
              <Kpi label="Static / manual" value={compact(t.staticRecords)} sub="hand-authored records" />
              <Kpi label="Live passthrough" value={String(t.passthroughCapabilities)} sub="capabilities · 0 rows" />
              <Kpi label="Upstream publishers" value={String(u.total)} sub={`${u.persisted.length} feeds + ${u.forecastIssuers.length} issuers`} />
              <Kpi label="Need attention" value={String(attentionCount)} sub="unhealthy datasets" warn={attentionCount > 0} />
            </div>
          </div>

          {/* ── VIEWPORT 1 · composition + health ── */}
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7"><OwnedCompositionChart datasets={data.datasets} onJump={jump} /></div>
            <div className="lg:col-span-5"><PlatformHealthChart datasets={data.datasets} onJump={jump} /></div>
          </div>

          {/* ── VIEWPORT 2 · coverage + transformation + freshness ── */}
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-4"><CustomerCoverageChart datasets={data.datasets} /></div>
            <div className="lg:col-span-8"><TransformationStack datasets={data.datasets} onJump={jump} /></div>
          </div>
          <FreshnessWall datasets={data.datasets} onJump={jump} now={now} />

          {/* ── VIEWPORT 3 · stored → served + warehouse + attention ── */}
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5"><StoredServedChart datasets={data.datasets} /></div>
            <div className="lg:col-span-4"><AwardWarehouseCard d={warehouse} /></div>
            <div className="lg:col-span-3"><AttentionItems data={data} onJump={jump} /></div>
          </div>
          <RegistryDebt data={data} />

          {/* ── OBSERVATION MOAT ── */}
          <section className="space-y-4 rounded-2xl border border-sky-500/20 bg-ground-deep p-4">
            <div>
              <h2 className="text-lg font-bold text-white">Mindy Observation Moat</h2>
              <p className="text-sm text-muted">Public data shows what is true now. Mindy keeps a record of what changed, from the day it started watching.</p>
            </div>
            <MoatModel data={data} />
            <ObservationPipeline data={data} />
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="lg:col-span-8"><CompoundingObservationChart o={data.observation} /></div>
              <div className="lg:col-span-4"><ChangeTypesChart o={data.observation} /></div>
            </div>
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="lg:col-span-6"><LeaderboardMovementChart o={data.observation} /></div>
              <div className="lg:col-span-6"><LatestChangesFeed o={data.observation} now={now} /></div>
            </div>
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4"><IntelligenceChangesCard o={data.observation} /></div>
              <div className="lg:col-span-8"><CompetitionHealthCard /></div>
            </div>
          </section>

          {/* ── Drill-down: the table view behind every chart ── */}
          <div className="pt-2">
            <h2 className="text-lg font-bold text-white">Dataset detail</h2>
            <p className="text-xs text-muted">Every value in the charts above, per dataset. Chart items link here.</p>
          </div>
          {SECTIONS.map((s) => {
            const rows = data.datasets.filter((d) => d.kind === s.kind);
            if (!rows.length) return null;
            return (
              <section key={s.kind}>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-white">{s.title}</h3>
                <p className="text-xs text-muted mb-2">{s.blurb}</p>
                <div className="rounded-xl border border-surface bg-ground overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead className="bg-surface/60 text-muted text-[11px] uppercase">
                      <tr>
                        <th className="text-left px-3 py-2 w-[34%]">Dataset</th>
                        <th className="text-right px-3 py-2">Stored</th>
                        <th className="text-right px-3 py-2">{s.kind === 'source_corpus' ? 'Served · counts toward' : 'Served'}</th>
                        <th className="text-left px-3 py-2">Freshness</th>
                        <th className="text-left px-3 py-2">Customer surface</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => <Row key={d.key} d={d} names={u.names} open={openKey === d.key} onToggle={() => setOpenKey(openKey === d.key ? null : d.key)} />)}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          <section className="rounded-xl border border-surface bg-ground p-4">
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

          <p className="text-[11px] text-slate-600">Measured {new Date(data.generatedAt).toLocaleString()} · /api/admin/data-inventory</p>
        </div>
      </div>
    </TipProvider>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border ${warn ? 'border-amber-500/40' : 'border-surface'} bg-ground p-2.5`}>
      <div className={`text-lg font-bold ${warn ? 'text-amber-300' : 'text-white'}`}>{value}</div>
      <div className="text-[11px] text-ink-soft leading-tight">{label}</div>
      <div className="text-[10px] text-faint leading-tight">{sub}</div>
    </div>
  );
}

function RegistryDebt({ data }: { data: InventoryData }) {
  return (
    <section className="rounded-xl border border-amber-500/30 bg-ground p-4">
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
  );
}

function Row({ d, names, open, onToggle }: { d: Dataset; names: Record<string, string>; open: boolean; onToggle: () => void }) {
  const hasDetail = !!(d.breakdown?.length || d.served?.excluded.length || d.proseAttributions?.length
    || d.freshness.schedules?.length || d.freshness.instances?.length);
  const f = d.freshness;
  return (
    <>
      <tr id={`ds-${d.key}`} className={`border-t border-surface align-top scroll-mt-24 ${open ? 'bg-surface/20' : ''}`}>
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
            <button onClick={onToggle} className="mt-1 text-[11px] text-sky-300 hover:underline">
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
              {d.grain === 'transaction' ? 'award transactions' : 'owned records'} +{fmt(d.headlineContribution)}{d.headlineNote ? ` — ${d.headlineNote}` : ''}
            </div>
          )}
          {d.kind !== 'source_corpus' && d.headlineNote && (
            <div className="mt-1 text-[10px] font-sans text-faint whitespace-normal max-w-[180px] ml-auto">{d.headlineNote}</div>
          )}
        </td>
        <td className="px-3 py-2">
          <span className="rounded px-2 py-0.5 text-[11px] font-semibold text-ink-soft" style={{ background: `${STATE_META[f.state].color}22` }}>{f.state}</span>
          {f.state !== 'PASSTHROUGH' && <div className="text-[11px] text-ink-soft mt-1">as of {f.asOf ? day(f.asOf) : 'unknown'}</div>}
          {f.detail && <div className="text-[10px] text-faint mt-0.5 max-w-[240px]">{f.detail}</div>}
          <div className="text-[10px] text-slate-600 mt-0.5 max-w-[240px]" title={f.basis}>{f.basis}</div>
        </td>
        <td className="px-3 py-2">
          <span className="rounded bg-surface px-2 py-0.5 text-[11px] text-ink-soft">{SURFACE_LABEL[d.surface.state]}</span>
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
                        last scheduled run: {s.lastScheduledRun ? `${when(s.lastScheduledRun.at)} (${s.lastScheduledRun.status ?? '?'}${s.lastScheduledRun.httpStatus != null ? `, HTTP ${s.lastScheduledRun.httpStatus}` : ', HTTP status unrecorded'})` : 'none recorded'}
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
                      <span className="rounded px-1.5 text-[10px] text-ink-soft" style={{ background: `${STATE_META[i.state].color}22` }}>{i.state}</span>
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

