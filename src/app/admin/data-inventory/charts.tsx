'use client';

/**
 * Data Core charts. Every component is named for — and opens with — the ONE management
 * question it answers. If a visual stops answering its question better than text, delete it.
 *
 * Color (validated with the dataviz skill's validate_palette.js against the card surface
 * #0f172a, dark mode):
 *   magnitude            one hue, #3987e5 — never a ramp on nominal categories
 *   freshness states     fixed status palette + neutrals, in the validated adjacency order
 *                        CURRENT · MANUAL · STATIC · PASSTHROUGH · UNKNOWN · UNREACHABLE · STALE
 *                        (always icon + label — color is never the only carrier)
 *   customer surface     #3987e5 · #d95926 · #199e70 · #9085e9 (categorical, all checks pass)
 *   leaderboard movement gained #3987e5 · entered #199e70 · stable #64748b (neutral midpoint)
 *                        · exited #9085e9 · declined #e66767
 *   served vs not served #3987e5 · #475569
 * The 65M award-transaction warehouse is NEVER drawn on a scale shared with record-grain data.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  Archive, ArrowLeftRight, ArrowRight, CircleCheck, CircleHelp, CircleX, Clock, ExternalLink,
  EyeOff, Hand, Lock, TrendingDown, TrendingUp, TriangleAlert, Users, Minus, LogIn, LogOut,
} from 'lucide-react';
import type { Dataset, FreshnessState, InventoryData, Observation, SurfaceState } from './types';

// ── Tokens ──────────────────────────────────────────────────────────────────────
export const BLUE = '#3987e5';
const NOT_SERVED = '#475569';

export const STATE_ORDER: FreshnessState[] = ['CURRENT', 'MANUAL', 'STATIC', 'PASSTHROUGH', 'UNKNOWN', 'UNREACHABLE', 'STALE'];
export const STATE_META: Record<FreshnessState, { color: string; label: string; Icon: typeof CircleCheck; attention: boolean; blurb: string }> = {
  CURRENT: { color: '#0ca30c', label: 'Current', Icon: CircleCheck, attention: false, blurb: 'advancing on its clock' },
  MANUAL: { color: '#cbd5e1', label: 'Manual', Icon: Hand, attention: false, blurb: 'refreshed by hand, no schedule' },
  STATIC: { color: '#64748b', label: 'Static', Icon: Archive, attention: false, blurb: 'fixed file or frozen collection' },
  PASSTHROUGH: { color: '#9085e9', label: 'Passthrough', Icon: ArrowLeftRight, attention: false, blurb: 'fetched live — nothing to age' },
  UNKNOWN: { color: '#ec835a', label: 'Unknown', Icon: CircleHelp, attention: true, blurb: 'no clock or cadence to judge it' },
  UNREACHABLE: { color: '#d03b3b', label: 'Unreachable', Icon: CircleX, attention: true, blurb: 'a feed cannot be reached' },
  STALE: { color: '#fab219', label: 'Stale', Icon: Clock, attention: true, blurb: 'behind its expected cadence' },
};
const SEVERITY: FreshnessState[] = ['UNREACHABLE', 'STALE', 'UNKNOWN', 'MANUAL', 'STATIC', 'CURRENT', 'PASSTHROUGH'];

export const SURFACE_ORDER: SurfaceState[] = ['customer_readable', 'internal_only', 'withheld', 'passthrough'];
export const SURFACE_META: Record<SurfaceState, { color: string; label: string; Icon: typeof Users }> = {
  customer_readable: { color: '#3987e5', label: 'Customer-readable', Icon: Users },
  internal_only: { color: '#d95926', label: 'Internal only', Icon: Lock },
  withheld: { color: '#199e70', label: 'Withheld', Icon: EyeOff },
  passthrough: { color: '#9085e9', label: 'Passthrough', Icon: ArrowLeftRight },
};

// ── Format ──────────────────────────────────────────────────────────────────────
export const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString() : 'unmeasured');
export const compact = (n: number | null | undefined) => {
  if (typeof n !== 'number') return 'unmeasured';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
};
export const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—');
export const ageDays = (s: string | null | undefined, now: Date) => {
  if (!s) return null;
  const ms = now.getTime() - new Date(s).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null;
};
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

// ── Tooltip (one shared layer; values lead, labels follow) ──────────────────────
interface Tip { x: number; y: number; title: string; lines: Array<[string, string]> }
const TipCtx = createContext<(t: Tip | null) => void>(() => {});

export function TipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  return (
    <TipCtx.Provider value={setTip}>
      {children}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-xs rounded-lg border border-hairline bg-ground-deep/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 300), top: tip.y + 14 }}
        >
          <div className="mb-1 text-ink-soft">{tip.title}</div>
          {tip.lines.map(([v, l], i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span className="font-semibold text-white">{v}</span>
              <span className="text-muted">{l}</span>
            </div>
          ))}
        </div>
      )}
    </TipCtx.Provider>
  );
}

/** Hover + keyboard-focus tooltip props for a mark. Tooltips enhance; values stay readable without them. */
function useTip() {
  const set = useContext(TipCtx);
  return useCallback((title: string, lines: Array<[string, string]>) => ({
    tabIndex: 0,
    onMouseMove: (e: React.MouseEvent) => set({ x: e.clientX, y: e.clientY, title, lines }),
    onMouseLeave: () => set(null),
    onFocus: (e: React.FocusEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      set({ x: r.left, y: r.bottom, title, lines });
    },
    onBlur: () => set(null),
  }), [set]);
}

// ── Chrome ──────────────────────────────────────────────────────────────────────
export function Panel({ title, question, children, right, className = '' }: {
  title: string; question: string; children: ReactNode; right?: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-xl border border-surface bg-ground p-4 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-[11px] text-muted">{question}</p>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function StateBadge({ state, small }: { state: FreshnessState; small?: boolean }) {
  const m = STATE_META[state];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 ${small ? 'text-[10px]' : 'text-[11px]'} font-semibold text-ink-soft`}
      style={{ background: `${m.color}22` }}>
      <m.Icon aria-hidden size={small ? 11 : 12} color={m.color} />
      {m.label}
    </span>
  );
}

/** A horizontal stacked bar of counts with a 2px surface gap between segments. */
function StackedBar({ parts, height = 14, label }: {
  parts: Array<{ key: string; value: number; color: string; title: string; lines: Array<[string, string]> }>;
  height?: number; label: string;
}) {
  const tip = useTip();
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div role="img" aria-label={label} className="flex w-full gap-[2px]" style={{ height }}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.key} {...tip(p.title, p.lines)}
          className="outline-none transition-opacity first:rounded-l-[4px] last:rounded-r-[4px] hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white"
          style={{ flexGrow: p.value, flexBasis: 0, minWidth: 3, background: p.color }} />
      ))}
      {total === 0 && <div className="h-full w-full rounded bg-surface" />}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SCALE / COMPOSITION — "What data does Mindy actually own?"
// ═════════════════════════════════════════════════════════════════════════════
export function OwnedCompositionChart({ datasets, onJump }: { datasets: Dataset[]; onJump: (k: string) => void }) {
  const tip = useTip();
  const rows = datasets
    .filter((d) => d.kind === 'source_corpus' && d.grain !== 'transaction' && (d.headlineContribution ?? 0) >= 0 && d.headlineContribution !== null)
    .filter((d) => d.headlineContribution !== 0 || d.stored === 0)
    .map((d) => ({ d, v: d.headlineContribution ?? 0 }))
    .sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...rows.map((r) => r.v));
  const warehouse = datasets.find((d) => d.grain === 'transaction');
  return (
    <Panel title="Owned source corpora" question="What data does Mindy actually own? Record-grain corpora, ranked.">
      <div className="space-y-1">
        {rows.map(({ d, v }) => (
          <button key={d.key} type="button" onClick={() => onJump(d.key)}
            className="group grid w-full grid-cols-[minmax(0,11rem)_1fr_4.5rem] items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface/40">
            <span className="truncate text-xs text-ink-soft group-hover:text-white">{d.label}</span>
            <span className="relative h-3 rounded-sm bg-surface/40">
              <span {...tip(d.label, [[fmt(v), d.unit], ...(d.stored !== v ? [[fmt(d.stored), 'stored'] as [string, string]] : [])])}
                className="absolute inset-y-0 left-0 rounded-r-[4px] outline-none"
                style={{ width: v > 0 ? `max(2px, ${(v / max) * 100}%)` : 0, background: BLUE }} />
            </span>
            <span className="text-right font-mono text-xs tabular-nums text-white">{v === 0 ? '0 · empty' : compact(v)}</span>
          </button>
        ))}
      </div>
      {warehouse && (
        <p className="mt-3 border-t border-surface pt-2 text-[11px] text-faint">
          Not on this scale: <span className="text-ink-soft">{compact(warehouse.stored)} award transactions</span> (transaction grain —
          each modification is a row). See the award warehouse panel.
        </p>
      )}
    </Panel>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. HEALTH — "Is Data Core healthy right now?"
// ═════════════════════════════════════════════════════════════════════════════
export function PlatformHealthChart({ datasets, onJump }: { datasets: Dataset[]; onJump: (k: string) => void }) {
  const counts = new Map<FreshnessState, Dataset[]>();
  for (const s of STATE_ORDER) counts.set(s, []);
  for (const d of datasets) counts.get(d.freshness.state)?.push(d);
  const attention = SEVERITY.filter((s) => STATE_META[s].attention).flatMap((s) => counts.get(s) ?? []);
  const current = counts.get('CURRENT')?.length ?? 0;
  const judged = datasets.filter((d) => d.freshness.state !== 'PASSTHROUGH').length;
  return (
    <Panel title="Platform health" question="Is Data Core healthy right now? Datasets by freshness state.">
      <p className="mb-2 text-sm text-white">
        <span className="font-semibold">{current}</span> of {judged} persisted datasets current ·{' '}
        <span className="font-semibold" style={{ color: attention.length ? STATE_META.STALE.color : undefined }}>{attention.length}</span> need attention
      </p>
      <StackedBar label="Datasets by freshness state" height={16} parts={STATE_ORDER.map((s) => ({
        key: s, value: counts.get(s)?.length ?? 0, color: STATE_META[s].color,
        title: STATE_META[s].label, lines: [[String(counts.get(s)?.length ?? 0), `datasets — ${STATE_META[s].blurb}`]],
      }))} />
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        {STATE_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1.5 text-ink-soft">
            {(() => { const I = STATE_META[s].Icon; return <I aria-hidden size={12} color={STATE_META[s].color} />; })()}
            <span>{STATE_META[s].label}</span>
            <span className="ml-auto font-mono text-white">{counts.get(s)?.length ?? 0}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-surface pt-2">
        <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <TriangleAlert aria-hidden size={12} /> Needs attention
        </div>
        {attention.length === 0 ? <p className="text-xs text-faint">Nothing unhealthy.</p> : (
          <ul className="space-y-0.5">
            {attention.map((d) => (
              <li key={d.key}>
                <button type="button" onClick={() => onJump(d.key)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-surface/40">
                  <StateBadge state={d.freshness.state} small />
                  <span className="truncate text-ink-soft">{d.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. CUSTOMER COVERAGE — "How much of our data moat is usable by customers?"
// ═════════════════════════════════════════════════════════════════════════════
export function CustomerCoverageChart({ datasets }: { datasets: Dataset[] }) {
  const byState = (pred: (d: Dataset) => boolean) => SURFACE_ORDER.map((s) => ({
    s, items: datasets.filter((d) => pred(d) && d.surface.state === s),
  }));
  const all = byState(() => true);
  const recordSources = datasets.filter((d) => d.kind === 'source_corpus' && d.grain !== 'transaction');
  const recs = SURFACE_ORDER.filter((s) => s !== 'passthrough').map((s) => ({
    s, v: recordSources.filter((d) => d.surface.state === s).reduce((t, d) => t + (d.headlineContribution ?? 0), 0),
  }));
  const recTotal = recs.reduce((t, r) => t + r.v, 0);
  const readable = recs.find((r) => r.s === 'customer_readable')?.v ?? 0;
  return (
    <Panel title="Customer coverage" question="How much of the data is usable by customers?">
      <div className="mb-1 text-[11px] text-muted">By dataset ({datasets.length})</div>
      <StackedBar label="Datasets by customer surface" parts={all.map(({ s, items }) => ({
        key: s, value: items.length, color: SURFACE_META[s].color, title: SURFACE_META[s].label,
        lines: [[String(items.length), 'datasets'], ...items.slice(0, 6).map((d) => ['·', d.label] as [string, string])],
      }))} />
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        {all.map(({ s, items }) => {
          const I = SURFACE_META[s].Icon;
          return (
            <li key={s} className="flex items-center gap-1.5 text-ink-soft">
              <I aria-hidden size={12} color={SURFACE_META[s].color} /><span>{SURFACE_META[s].label}</span>
              <span className="ml-auto font-mono text-white">{items.length}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 mb-1 text-[11px] text-muted">
        Owned source records (record grain only — the transaction warehouse is excluded, not blended)
      </div>
      <StackedBar label="Owned source records by customer surface" parts={recs.map((r) => ({
        key: r.s, value: r.v, color: SURFACE_META[r.s].color, title: SURFACE_META[r.s].label,
        lines: [[fmt(r.v), 'records'], [`${pct(r.v, recTotal)}%`, 'of owned source records']],
      }))} />
      <p className="mt-2 text-sm text-white">
        <span className="font-semibold">{fmt(readable)}</span>
        <span className="text-ink-soft"> of {fmt(recTotal)} owned source records reach a customer surface</span>
      </p>
      <p className="text-[11px] text-faint">
        Not customer-readable: {recs.filter((r) => r.s !== 'customer_readable').map((r) => `${fmt(r.v)} ${SURFACE_META[r.s].label.toLowerCase()}`).join(' · ')}
      </p>
    </Panel>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. INTELLIGENCE STACK — "What does Mindy do to raw government data?"
// A transformation model, not an additive chart: each derived/index item names its own
// parents; hovering a dataset highlights only what it is actually connected to.
// ═════════════════════════════════════════════════════════════════════════════
export function TransformationStack({ datasets, onJump }: { datasets: Dataset[]; onJump: (k: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(datasets.map((d) => [d.key, d])), [datasets]);
  const related = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    const h = byKey.get(hover);
    for (const p of h?.derivedFrom ?? []) set.add(p);
    for (const d of datasets) if (d.derivedFrom?.includes(hover)) set.add(d.key);
    return set;
  }, [hover, byKey, datasets]);

  const cols: Array<{ title: string; blurb: string; items: Dataset[] }> = [
    { title: 'Source corpora', blurb: 'held from upstream publishers', items: datasets.filter((d) => d.kind === 'source_corpus') },
    { title: 'Derived intelligence', blurb: 'built from specific sources', items: datasets.filter((d) => d.kind === 'derived_intelligence' || d.kind === 'static_manual') },
    { title: 'Semantic / index', blurb: 'representations for retrieval', items: datasets.filter((d) => d.kind === 'derived_index') },
  ];
  const toolsBy = (pred: (d: Dataset) => boolean) => new Set(datasets.filter(pred).flatMap((d) => d.surface.tools));
  const allTools = toolsBy(() => true);

  return (
    <Panel title="Intelligence stack" question="What does Mindy do to raw government data? Hover a dataset to see what it actually feeds or comes from.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.1fr)_auto_minmax(0,0.9fr)_auto_minmax(0,0.8fr)]">
        {cols.map((c, i) => (
          <FragmentCol key={c.title} arrow={i > 0}>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{c.title}</div>
              <div className="mb-1 text-[10px] text-faint">{c.blurb}</div>
              <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">{c.items.map((d) => (
                <StackChip key={d.key} d={d} byKey={byKey} related={related} onJump={onJump} setHover={setHover} />
              ))}</div>
            </div>
          </FragmentCol>
        ))}
        <ArrowRight aria-hidden size={16} className="hidden self-center text-faint md:block" />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Customer surfaces</div>
          <div className="mb-1 text-[10px] text-faint">MCP tools reading these layers</div>
          <div className="space-y-1 text-[11px]">
            {[
              ['Source corpora', toolsBy((d) => d.kind === 'source_corpus')],
              ['Derived + static', toolsBy((d) => d.kind === 'derived_intelligence' || d.kind === 'static_manual')],
              ['Semantic / index', toolsBy((d) => d.kind === 'derived_index')],
              ['Live passthrough', toolsBy((d) => d.kind === 'passthrough')],
            ].map(([label, set]) => (
              <div key={label as string} className="flex justify-between rounded border border-surface px-2 py-1">
                <span className="text-ink-soft">{label as string}</span>
                <span className="font-mono text-white">{(set as Set<string>).size}</span>
              </div>
            ))}
            <div className="flex justify-between px-2 pt-1 text-muted"><span>distinct tools</span><span className="font-mono text-white">{allTools.size}</span></div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-faint">
        Lineage is per dataset. Not every source record flows into every stage, and the index layer is internal enrichment (its vectors are never returned to customers).
      </p>
    </Panel>
  );
}
function StackChip({ d, byKey, related, onJump, setHover }: {
  d: Dataset; byKey: Map<string, Dataset>; related: Set<string> | null;
  onJump: (k: string) => void; setHover: (k: string | null) => void;
}) {
  const dim = related && !related.has(d.key);
  const parents = (d.derivedFrom ?? []).map((k) => byKey.get(k)?.label ?? k);
  return (
    <button type="button" onClick={() => onJump(d.key)}
      onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(d.key)} onBlur={() => setHover(null)}
      className={`w-full rounded border px-2 py-1 text-left transition-opacity ${dim ? 'opacity-25' : ''} ${related?.has(d.key) ? 'border-sky-400/60' : 'border-surface'} hover:bg-surface/40`}>
      <div className="flex items-baseline gap-2">
        <span className="truncate text-[11px] text-white">{d.label}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted">{d.stored == null ? '' : compact(d.stored)}</span>
      </div>
      {d.kind === 'static_manual' && <div className="text-[10px] text-faint">static · hand-authored</div>}
      {parents.length > 0 && <div className="truncate text-[10px] text-faint">from {parents.join(' + ')}</div>}
      {d.derivedFrom && d.derivedFrom.length === 0 && d.kind !== 'static_manual' && <div className="text-[10px] text-faint">from a live API</div>}
    </button>
  );
}

function FragmentCol({ arrow, children }: { arrow: boolean; children: ReactNode }) {
  return (<>{arrow && <ArrowRight aria-hidden size={16} className="hidden self-center text-faint md:block" />}{children}</>);
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. FRESHNESS — "Where is our intelligence aging or broken?"
// A status wall: one tile per dataset, worst first, so unhealthy tiles are spotted without reading.
// ═════════════════════════════════════════════════════════════════════════════
export function FreshnessWall({ datasets, onJump, now }: { datasets: Dataset[]; onJump: (k: string) => void; now: Date }) {
  const tip = useTip();
  const sorted = [...datasets].sort((a, b) => SEVERITY.indexOf(a.freshness.state) - SEVERITY.indexOf(b.freshness.state));
  const unproven = (d: Dataset) => (d.freshness.schedules ?? []).filter((s) =>
    ['failed', 'not_yet_reproven', 'no_terminal_status', 'ran_status_unrecorded'].includes(s.recurrence));
  return (
    <Panel title="Freshness" question="Where is our intelligence aging or broken? Worst first."
      right={<div className="hidden flex-wrap gap-2 md:flex">{STATE_ORDER.map((s) => <StateBadge key={s} state={s} small />)}</div>}>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {sorted.map((d) => {
          const m = STATE_META[d.freshness.state];
          const age = ageDays(d.freshness.asOf, now);
          const un = unproven(d);
          return (
            <button key={d.key} type="button" onClick={() => onJump(d.key)}
              {...tip(d.label, [
                [m.label, m.blurb],
                [d.freshness.asOf ? day(d.freshness.asOf) : 'no clock', 'data as of'],
                ...(d.freshness.detail ? [['', d.freshness.detail.slice(0, 140)] as [string, string]] : []),
                ...un.map((s) => [s.recurrence.replace(/_/g, ' '), s.job] as [string, string]),
              ])}
              className="rounded-md border border-surface bg-ground-deep/40 p-2 text-left outline-none hover:bg-surface/40 focus-visible:ring-2 focus-visible:ring-white"
              style={{ borderTop: `3px solid ${m.color}` }}>
              <div className="flex items-center gap-1 text-[10px] font-semibold text-ink-soft">
                <m.Icon aria-hidden size={11} color={m.color} />{m.label}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-white">{d.label}</div>
              <div className="mt-1 text-[10px] text-faint">
                {d.freshness.state === 'PASSTHROUGH' ? 'live' : age == null ? 'no data clock' : age === 0 ? 'today' : `${age}d ago`}
                {un.length > 0 && <span className="text-amber-300"> · collector {un[0].recurrence.replace(/_/g, ' ')}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. STORED → SERVED — "How much of the corpus actually reaches the customer?"
// ═════════════════════════════════════════════════════════════════════════════
export function StoredServedChart({ datasets }: { datasets: Dataset[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const tip = useTip();
  const rows = ['sam_opps', 'recompetes', 'contacts']
    .map((k) => datasets.find((d) => d.key === k))
    .filter((d): d is Dataset => !!d && !!d.served && d.stored != null && d.served.count != null);
  const TITLES: Record<string, [string, string, string]> = {
    sam_opps: ['SAM.gov notices', 'active / open', 'archived, kept as history'],
    recompetes: ['Expiring contracts', 'served (unflagged)', 'excluded by quality flag'],
    contacts: ['Contacts', 'government buyers', 'vendor POCs + unclassified'],
  };
  return (
    <Panel title="Stored → served" question="How much of each corpus actually reaches the customer — and why the rest does not.">
      <div className="space-y-4">
        {rows.map((d) => {
          const stored = d.stored!, served = d.served!.count!, rest = stored - served;
          const [title, servedLabel, restLabel] = TITLES[d.key];
          return (
            <div key={d.key}>
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-xs text-white">{title}</span>
                <span className="ml-auto text-xs text-ink-soft">
                  <span className="font-semibold text-white">{fmt(served)}</span> of {fmt(stored)} · {pct(served, stored)}%
                </span>
              </div>
              <div className="flex h-3 w-full gap-[2px]">
                <div {...tip(title, [[fmt(served), servedLabel]])} className="rounded-l-[4px] outline-none" style={{ flexGrow: served, flexBasis: 0, background: BLUE }} />
                <div {...tip(title, [[fmt(rest), restLabel]])} className="rounded-r-[4px] outline-none" style={{ flexGrow: rest, flexBasis: 0, background: NOT_SERVED }} />
              </div>
              <div className="mt-1 flex gap-3 text-[10px] text-faint">
                <span><span className="inline-block h-2 w-2 rounded-sm align-middle" style={{ background: BLUE }} /> {servedLabel}</span>
                <span><span className="inline-block h-2 w-2 rounded-sm align-middle" style={{ background: NOT_SERVED }} /> {restLabel}</span>
                {d.served!.excluded.length > 1 && (
                  <button type="button" onClick={() => setOpen(open === d.key ? null : d.key)} className="ml-auto text-sky-300 hover:underline">
                    {open === d.key ? 'Hide reasons' : 'Why excluded'}
                  </button>
                )}
              </div>
              {open === d.key && (
                <ul className="mt-2 space-y-1 rounded border border-surface p-2">
                  {[...d.served!.excluded].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).map((e) => (
                    <li key={e.label} className="grid grid-cols-[minmax(0,1fr)_40%_4rem] items-center gap-2 text-[11px]">
                      <span className="truncate text-ink-soft" title={e.label}>{e.label}</span>
                      <span className="h-2 rounded-sm bg-surface/40">
                        <span className="block h-2 rounded-r-[4px]" style={{ width: `${rest ? ((e.count ?? 0) / rest) * 100 : 0}%`, minWidth: (e.count ?? 0) > 0 ? 2 : 0, background: NOT_SERVED }} />
                      </span>
                      <span className="text-right font-mono text-white">{fmt(e.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. AWARD WAREHOUSE — "How large and fresh is the transaction warehouse?"
// ═════════════════════════════════════════════════════════════════════════════
export function AwardWarehouseCard({ d }: { d: Dataset | undefined }) {
  if (!d) return null;
  const ing = d.freshness.ingest;
  const limit = ing?.staleAfterDays ?? 10;
  const span = limit * 2;
  const lag = ing?.sourceAgeDays ?? null;
  const healthy = ing?.status === 'healthy';
  return (
    <Panel title="Award warehouse" question="How large and fresh is the USASpending transaction warehouse?">
      <div className="text-3xl font-bold text-white">{compact(d.stored)}</div>
      <div className="text-xs text-ink-soft">award transactions · <span className="text-sky-300">transaction grain</span> (each modification is a row — not distinct awards)</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><div className="text-faint">Data through</div><div className="font-semibold text-white">{day(d.freshness.asOf)}</div></div>
        <div><div className="text-faint">Last ingest run</div><div className="font-semibold text-white">{ing?.runAgeDays == null ? 'unknown' : `${ing.runAgeDays}d ago`}</div></div>
        <div>
          <div className="text-faint">Ingest health</div>
          <div className="flex items-center gap-1 font-semibold text-white">
            {healthy ? <CircleCheck aria-hidden size={13} color={STATE_META.CURRENT.color} /> : <TriangleAlert aria-hidden size={13} color={STATE_META.STALE.color} />}
            {ing?.status?.replace(/_/g, ' ') ?? 'unmeasured'}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[10px] text-faint">
          <span>Source lag: <span className="text-white">{lag == null ? 'unknown' : `${lag} days`}</span></span>
          <span>stale after {limit}d</span>
        </div>
        <div className="relative h-3 rounded-sm bg-surface/40">
          {lag != null && <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.min(100, (lag / span) * 100)}%`, background: lag > limit ? STATE_META.STALE.color : BLUE }} />}
          <div aria-hidden className="absolute inset-y-[-3px] w-[2px] bg-ink-soft" style={{ left: `${(limit / span) * 100}%` }} />
        </div>
      </div>
      <p className="mt-3 rounded border border-amber-500/30 bg-amber-950/20 p-2 text-[11px] text-amber-200/90">
        Recency is not completeness. Per-agency monthly cohort completeness is checked separately by
        <code className="mx-1">npm run verify:oracles -- --only freshness</code>and can fail while this reads healthy.
      </p>
    </Panel>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Attention items — "What needs attention, in one list?"
// ═════════════════════════════════════════════════════════════════════════════
export function AttentionItems({ data, onJump }: { data: InventoryData; onJump: (k: string) => void }) {
  const items: Array<{ key: string; kind: string; text: string; target?: string }> = [];
  for (const d of data.datasets) {
    if (STATE_META[d.freshness.state].attention) items.push({ key: `f-${d.key}`, kind: STATE_META[d.freshness.state].label, text: d.label, target: d.key });
    if (d.kind === 'source_corpus' && d.stored === 0) items.push({ key: `e-${d.key}`, kind: 'Empty', text: `${d.label} holds 0 rows`, target: d.key });
    for (const s of d.freshness.schedules ?? []) {
      if (['failed', 'not_yet_reproven', 'no_terminal_status'].includes(s.recurrence)) {
        items.push({ key: `s-${s.job}`, kind: 'Collector', text: `${s.job}: ${s.recurrence.replace(/_/g, ' ')}`, target: d.key });
      }
    }
  }
  if (data.registryDebt.length) items.push({ key: 'debt', kind: 'Registry', text: `${data.registryDebt.length} control-plane counts disagree with measurement` });
  return (
    <Panel title="Attention items" question="What needs attention, in one list?">
      <ul className="max-h-[320px] space-y-1 overflow-y-auto">
        {items.map((it) => (
          <li key={it.key}>
            <button type="button" disabled={!it.target} onClick={() => it.target && onJump(it.target)}
              className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-surface/40 disabled:hover:bg-transparent">
              <span className="w-20 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-amber-300">{it.kind}</span>
              <span className="text-ink-soft">{it.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// OBSERVATION MOAT
// ═════════════════════════════════════════════════════════════════════════════

/** "Three different assets — what does each one measure?" Conceptual; the numbers are never summed. */
export function MoatModel({ data }: { data: InventoryData }) {
  const o = data.observation;
  const t = data.totals;
  const cards: Array<{ title: string; question: string; lines: Array<[string, string]> }> = [
    { title: 'Corpus moat', question: 'What Mindy has accumulated', lines: [
      [fmt(t.ownedSourceRecords), 'owned source records'], [fmt(t.transactionRows), 'award transactions (separate grain)']] },
    { title: 'Interpretation moat', question: 'What Mindy has derived', lines: [
      [fmt(t.derivedRecords), 'derived intelligence records'], [fmt(t.indexedRepresentations), 'semantic / indexed representations']] },
    { title: 'Observation moat', question: 'What Mindy remembers about how the market changed', lines: [
      [fmt(o?.recompeteChanges.total), 'contract changes observed'], [fmt(o?.leaderboards.rows), 'ranking snapshot rows'],
      [fmt(o?.intelligenceChanges?.total ?? null), 'strategic-intelligence changes']] },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {cards.map((c) => (
        <div key={c.title} className="rounded-xl border border-surface bg-ground p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{c.title}</div>
          <div className="mb-2 text-xs text-ink-soft">{c.question}</div>
          {c.lines.map(([v, l]) => (
            <div key={l} className="flex items-baseline gap-2 text-xs">
              <span className="font-semibold text-white">{v}</span><span className="text-faint">{l}</span>
            </div>
          ))}
        </div>
      ))}
      <p className="text-[10px] text-faint md:col-span-3">Three different kinds of asset in different units — deliberately not added together.</p>
    </div>
  );
}

function PipelineBox({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-lg border border-surface bg-ground-deep/40 p-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</div>
      {rows.map(([v, l]) => <div key={l} className="flex items-baseline gap-2 text-xs"><span className="font-semibold text-white">{v}</span><span className="text-ink-soft">{l}</span></div>)}
    </div>
  );
}

/** "Which public sources feed which observations and interpretations?" Explicit edges only. */
export function ObservationPipeline({ data }: { data: InventoryData }) {
  const o = data.observation;
  const ds = (k: string) => data.datasets.find((d) => d.key === k);
  const edges: Array<[string, string, string]> = [
    ['Expiring contracts (USASpending API, hourly)', 'Contract change log', 'each tracked field that moves is logged before the row is overwritten'],
    ['Award transactions → contractor rollups', 'Weekly ranking snapshots', 'point-in-time /top rankings'],
    ['SAM notices + expiring contracts + live USASpending award detail', 'Competition Health', 'computed on demand per agency — not stored'],
    ['GAO reports (daily)', 'Strategic-intelligence changes', 'source-backed pain points, created/updated with their citation'],
  ];
  return (
    <Panel title="Source → observation → interpretation" question="Which public data does Mindy watch, what does it remember, and what does it derive? Only the edges listed exist.">
      <div className="grid items-center gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <PipelineBox title="Public / source data" rows={[
          [compact(ds('bq_awards')?.stored), 'USASpending award transactions'],
          [compact(ds('sam_opps')?.stored), 'SAM.gov notices'],
          [compact(ds('recompetes')?.stored), 'expiring-contract rows'],
          [fmt(ds('gao_living')?.stored), 'GAO reports'],
        ]} />
        <ArrowRight aria-hidden size={16} className="hidden text-faint md:block" />
        <PipelineBox title="Mindy observation" rows={[
          [compact(o?.recompeteChanges.total), 'contract changes (append-only)'],
          [String(o?.leaderboards.snapshotDates?.length ?? 'unmeasured'), 'weekly ranking snapshots'],
          [fmt(o?.intelligenceChanges?.total ?? null), 'strategic-intelligence changes'],
        ]} />
        <ArrowRight aria-hidden size={16} className="hidden text-faint md:block" />
        <PipelineBox title="Mindy interpretation" rows={[
          ['on demand', 'Competition Health scorecard'],
          [fmt(ds('sourced_pain_points')?.stored), 'source-backed pain points (Institute)'],
          ['live', 'customer tools (recompetes, agency intel, rankings)'],
        ]} />
      </div>
      <ul className="mt-3 space-y-1">
        {edges.map(([a, b, how]) => (
          <li key={b} className="grid gap-1 text-[11px] md:grid-cols-[1fr_auto_12rem_1.4fr]">
            <span className="text-ink-soft">{a}</span>
            <ArrowRight aria-hidden size={12} className="hidden self-center text-faint md:block" />
            <span className="text-white">{b}</span>
            <span className="text-faint">{how}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── Compounding observation — "How much market-change history has Mindy accumulated?" ──
export function CompoundingObservationChart({ o }: { o: Observation | undefined }) {
  const series = o?.recompeteChanges.series ?? null;
  const [hi, setHi] = useState<number | null>(null);
  if (!series || series.length < 2) {
    return (
      <Panel title="Compounding observation" question="How much market-change history has Mindy accumulated?">
        <p className="text-xs text-faint">{series ? 'Only one stored day so far.' : 'Series unmeasured.'}</p>
      </Panel>
    );
  }
  const W = 640, H = 200, L = 44, R = 12, T = 12, B = 26;
  const max = Math.max(...series.map((p) => p.total));
  const niceMax = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
  const x = (i: number) => L + (i / (series.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / niceMax) * (H - T - B);
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const area = `${path} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const last = series[series.length - 1];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHi(Math.max(0, Math.min(series.length - 1, Math.round(((px - L) / (W - L - R)) * (series.length - 1)))));
  };
  const h = hi != null ? series[hi] : null;
  const prevH = hi != null && hi > 0 ? series[hi - 1] : null;
  return (
    <Panel title="Compounding observation" question="How much market-change history has Mindy accumulated? Cumulative contract changes observed, as stored daily."
      right={<div className="text-right"><div className="text-xl font-bold text-white">{fmt(last.total)}</div><div className="text-[10px] text-faint">last stored day {last.date}</div>
        {o?.recompeteChanges.total != null && o.recompeteChanges.total !== last.total && <div className="text-[10px] text-faint">live log now {fmt(o.recompeteChanges.total)}</div>}</div>}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none" role="img"
        aria-label={`Cumulative contract changes observed from ${series[0].date} (${fmt(series[0].total)}) to ${last.date} (${fmt(last.total)})`}
        onPointerMove={onMove} onPointerLeave={() => setHi(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(niceMax * f)} y2={y(niceMax * f)} stroke="#1e293b" strokeWidth={1} />
            <text x={L - 6} y={y(niceMax * f) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">{compact(niceMax * f)}</text>
          </g>
        ))}
        <path d={area} fill={BLUE} opacity={0.12} />
        <path d={path} fill="none" stroke={BLUE} strokeWidth={2} strokeLinejoin="round" />
        <text x={L} y={H - 8} fontSize={10} fill="#94a3b8">{series[0].date}</text>
        <text x={W - R} y={H - 8} fontSize={10} fill="#94a3b8" textAnchor="end">{last.date}</text>
        {h && (
          <g>
            <line x1={x(hi!)} x2={x(hi!)} y1={T} y2={H - B} stroke="#cbd5e1" strokeWidth={1} />
            <circle cx={x(hi!)} cy={y(h.total)} r={4} fill={BLUE} stroke="#0f172a" strokeWidth={2} />
            <text x={Math.min(x(hi!) + 6, W - 150)} y={T + 12} fontSize={11} fill="#ffffff">
              {h.date}: {fmt(h.total)}{prevH ? ` (+${fmt(h.total - prevH.total)})` : ''}
            </text>
          </g>
        )}
      </svg>
      <p className="mt-1 text-[10px] text-faint">
        {series.length} stored days, starting {series[0].date} (the first day recorded — no earlier values exist). Each change was captured when it happened; USASpending does not keep this history.
      </p>
    </Panel>
  );
}

// ── What changes — "What kinds of federal-market movement is Mindy detecting?" ──
export function ChangeTypesChart({ o }: { o: Observation | undefined }) {
  const tip = useTip();
  const rows = (o?.recompeteChanges.byField ?? []).filter((r) => r.count != null).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const total = o?.recompeteChanges.total ?? 0;
  const max = Math.max(1, ...rows.map((r) => r.count ?? 0));
  return (
    <Panel title="What changes" question="What kinds of federal-market movement is Mindy detecting?">
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.field}>
            <div className="mb-0.5 flex justify-between text-xs">
              <span className="text-ink-soft">{r.label}</span>
              <span className="font-mono text-white">{fmt(r.count)} <span className="text-faint">· {pct(r.count ?? 0, total)}%</span></span>
            </div>
            <div className="h-3 rounded-sm bg-surface/40">
              <div {...tip(r.label, [[fmt(r.count), 'changes observed'], [`${pct(r.count ?? 0, total)}%`, 'of all observed changes']])}
                className="h-3 rounded-r-[4px] outline-none" style={{ width: `max(2px, ${((r.count ?? 0) / max) * 100}%)`, background: BLUE }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-faint">
        {day(o?.recompeteChanges.firstObserved)} → {day(o?.recompeteChanges.lastObserved)} · {o?.recompeteChanges.basis}
      </p>
    </Panel>
  );
}

// ── Contractor movement — "Can Mindy see competitive position changing over time?" ──
const MOVE_META = {
  gained: { color: '#3987e5', label: 'Moved up', Icon: TrendingUp },
  entered: { color: '#199e70', label: 'Entered list', Icon: LogIn },
  stable: { color: '#64748b', label: 'Unchanged', Icon: Minus },
  exited: { color: '#9085e9', label: 'Left list', Icon: LogOut },
  declined: { color: '#e66767', label: 'Moved down', Icon: TrendingDown },
} as const;
export function LeaderboardMovementChart({ o }: { o: Observation | undefined }) {
  const tip = useTip();
  const lb = o?.leaderboards;
  const weekly = lb?.weekly ?? null;
  const span = lb?.span ?? null;
  const order = ['gained', 'entered', 'exited', 'declined'] as const; // "changed" classes; unchanged goes to the tooltip
  const changed = (c: Record<string, number>) => order.reduce((s, k) => s + c[k], 0);
  const maxChanged = Math.max(1, ...(weekly ?? []).map((w) => changed(w.counts)));
  const H = 96;
  return (
    <Panel title="Contractor movement" question="Can Mindy see competitive position changing over time? Ranking positions compared between stored snapshots.">
      {!weekly || !span ? <p className="text-xs text-faint">Needs two stored snapshots.</p> : (
        <>
          <p className="mb-2 text-xs text-ink-soft">
            {lb!.snapshotDates?.length} stored snapshots · {span.from} → {span.to} · {lb!.listsInLatest} ranking lists · {fmt(lb!.entriesInLatest)} positions per snapshot
          </p>
          <div className="mb-1 text-[11px] text-muted">Positions that changed, per snapshot interval</div>
          <div className="flex items-end gap-1" style={{ height: H }} role="img" aria-label="Ranking positions changed per snapshot interval">
            {weekly.map((w) => {
              const n = changed(w.counts);
              return (
                <div key={w.to} className="flex h-full flex-1 flex-col justify-end outline-none"
                  {...tip(`${w.from} → ${w.to}`, [
                    [fmt(n), 'positions changed'], ...order.map((k) => [fmt(w.counts[k]), MOVE_META[k].label.toLowerCase()] as [string, string]),
                    [fmt(w.counts.stable), 'unchanged'],
                  ])}>
                  {n === 0 ? <div className="h-[2px] rounded bg-surface" /> : order.slice().reverse().map((k) => w.counts[k] > 0 && (
                    <div key={k} className="mt-[2px] first:rounded-t-[4px]" style={{ height: Math.max(2, (w.counts[k] / maxChanged) * (H - 14)), background: MOVE_META[k].color }} />
                  ))}
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-faint"><span>{weekly[0].to}</span><span>{weekly[weekly.length - 1].to}</span></div>
          <p className="mt-1 text-[11px] text-ink-soft">
            {weekly.filter((w) => changed(w.counts) > 0).length} of {weekly.length} snapshot intervals show movement; in the rest every published position was identical.
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
            {order.map((k) => { const I = MOVE_META[k].Icon; return <li key={k} className="flex items-center gap-1"><I aria-hidden size={12} color={MOVE_META[k].color} />{MOVE_META[k].label}</li>; })}
          </ul>
          <div className="mt-3 border-t border-surface pt-2">
            <div className="mb-1 text-[11px] text-muted">Across the whole record ({span.from} → {span.to})</div>
            <StackedBar label="Ranking movement from the first to the latest snapshot" height={12} parts={(['gained', 'entered', 'stable', 'exited', 'declined'] as const).map((k) => ({
              key: k, value: span.counts[k], color: MOVE_META[k].color, title: MOVE_META[k].label, lines: [[fmt(span.counts[k]), 'positions']],
            }))} />
            <div className="mt-1 text-[11px] text-ink-soft">
              {fmt(span.counts.gained)} up · {fmt(span.counts.declined)} down · {fmt(span.counts.entered)} entered · {fmt(span.counts.exited)} left · {fmt(span.counts.stable)} unchanged
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {([['Biggest climbs', span.topGainers], ['Biggest drops', span.topDecliners]] as const).map(([title, list]) => (
                <div key={title}>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</div>
                  {list.length === 0 ? <p className="text-[11px] text-faint">None.</p> : (
                    <ul className="space-y-0.5">
                      {list.map((mv) => (
                        <li key={`${mv.slug}-${mv.uei}`}>
                          <a href={`/top/${mv.slug}`} target="_blank" rel="noreferrer" className="flex items-baseline gap-2 rounded px-1 text-[11px] hover:bg-surface/40">
                            <span className="truncate text-white">{mv.name ?? mv.uei}</span>
                            <span className="ml-auto shrink-0 font-mono text-ink-soft">#{mv.from} → #{mv.to}</span>
                          </a>
                          <div className="truncate px-1 text-[10px] text-faint">{mv.slug}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[10px] text-faint">{lb!.basis}</p>
        </>
      )}
    </Panel>
  );
}

// ── Latest observations — "What did Mindy notice recently?" ──
const money = (v: string | null) => {
  const n = Number(v);
  return v != null && Number.isFinite(n) && v.trim() !== '' ? `$${compact(Math.round(n))}` : (v ?? '—');
};
export function LatestChangesFeed({ o, now }: { o: Observation | undefined; now: Date }) {
  const rows = o?.recompeteChanges.latest ?? [];
  const show = (field: string, v: string | null) => (field === 'potential_total_value' ? money(v) : (v ?? '—'));
  const LABEL: Record<string, string> = { potential_total_value: 'Value', period_of_performance_current_end: 'End date', incumbent_uei: 'Incumbent' };
  return (
    <Panel title="Latest observations" question="What did Mindy notice recently?">
      {rows.length === 0 ? <p className="text-xs text-faint">No changes read.</p> : (
        <ul className="divide-y divide-surface">
          {rows.map((r) => {
            const mins = Math.max(0, Math.round((now.getTime() - new Date(r.observed_at).getTime()) / 60_000));
            const hrs = Math.round(mins / 60);
            return (
              <li key={r.id} className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-2 py-1 text-[11px]">
                <span className="text-faint">{mins < 60 ? `${mins}m ago` : hrs < 48 ? `${hrs}h ago` : day(r.observed_at)}</span>
                <span className="min-w-0">
                  {r.piid ? (
                    <a href={`/contracts/${encodeURIComponent(r.piid)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-sky-300 hover:underline">
                      {r.piid}<ExternalLink aria-hidden size={10} />
                    </a>
                  ) : <span className="font-mono text-ink-soft">{r.contract_id}</span>}
                  <span className="ml-2 text-muted">{LABEL[r.field] ?? r.field}</span>
                </span>
                <span className="whitespace-nowrap font-mono text-ink-soft">
                  {show(r.field, r.old_value)} <ArrowRight aria-hidden size={10} className="inline" /> <span className="text-white">{show(r.field, r.new_value)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ── Strategic intelligence changes — kept apart from procurement movement ──
export function IntelligenceChangesCard({ o }: { o: Observation | undefined }) {
  const ic = o?.intelligenceChanges;
  return (
    <Panel title="Strategic-intelligence changes" question="Is Mindy's GAO-backed intelligence changing as new evidence arrives?">
      {!ic ? <p className="text-xs text-faint">Unmeasured.</p> : (
        <>
          <div className="text-2xl font-bold text-white">{fmt(ic.total)}</div>
          <div className="text-[11px] text-ink-soft">
            changes · {ic.byType.map((t) => `${t.count} ${t.label}`).join(' · ')} · {day(ic.firstChanged)} → {day(ic.lastChanged)}
          </div>
          <ul className="mt-2 space-y-1">
            {ic.latest.map((c, i) => (
              <li key={i} className="text-[11px]">
                <span className="text-muted">{c.agency}</span>
                <div className="line-clamp-2 text-ink-soft">{c.value}</div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-faint">{ic.basis}</p>
        </>
      )}
    </Panel>
  );
}

// ── Competition Health — an on-demand scorecard (no stored history exists) ──
const CH_CAPABILITIES = [
  'Small-business participation (share of active solicitations with a set-aside)',
  'Set-aside mix — open solicitations',
  'Set-aside mix — awarded contracts',
  'Distinct winners and winner concentration (top-3 share of award dollars)',
  'First-time winners among the top winners',
  'Average bidders and single-bid rate (sampled recent awards)',
  'NAICS concentration of active solicitations',
];
export function CompetitionHealthCard() {
  return (
    <Panel title="Competition Health" question="What does Mindy derive about a buyer's competitive market today?"
      right={<a href="/admin/competition-health" className="inline-flex items-center gap-1 rounded-lg border border-hairline px-3 py-1.5 text-xs text-ink-soft hover:bg-surface">Open Competition Health <ExternalLink aria-hidden size={12} /></a>}>
      <div className="mb-2 flex flex-wrap gap-2">
        <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">On-demand scorecard</span>
        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">Historical health snapshots not yet retained</span>
      </div>
      <ul className="grid gap-x-4 gap-y-0.5 text-[11px] text-ink-soft sm:grid-cols-2">
        {CH_CAPABILITIES.map((c) => <li key={c}>· {c}</li>)}
      </ul>
      <p className="mt-3 text-[11px] text-faint">
        Computed per agency when requested, from SAM notices, expiring contracts and live USASpending award detail.
        The competition-depth component uses a 24-hour overwrite cache — one row per scope, replaced on refresh — so it is
        not observation history, and its cache rows are not counted anywhere on this page.
      </p>
    </Panel>
  );
}
