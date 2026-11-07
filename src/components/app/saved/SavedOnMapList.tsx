'use client';
/**
 * "Saved on the map" — the user's `user_saved_opportunities` rows, shown inside /app.
 *
 * Reads GET /api/opportunities/save (verified MI session via x-mi-auth-token; a claimed email
 * alone is refused). A failed read renders an ERROR, never "nothing saved".
 */
import { useCallback, useEffect, useState } from 'react';
import { MapPin, Trash2, Plus } from 'lucide-react';
import { authedFetch } from '../authHeaders';
import { mapHomeLink } from '@/lib/maps/map-links';
import {
  pursuitBodyFor,
  toSavedMapItems,
  type SavedMapItem,
  type SavedMapKind,
} from './saved-map-items';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: SavedMapItem[] };

const KIND_CHIP: Record<SavedMapKind, string> = {
  opportunity: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  forecast: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  recompete: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  company: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  buyer: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
};

function fmtDate(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SavedOnMapList({
  email,
  kinds,
  title = 'Saved on the map',
  description,
  allowStartPursuit = false,
  onPursuitCreated,
  emptyText,
}: {
  email: string | null;
  /** Restrict to these kinds (e.g. company + buyer on the Target List). */
  kinds?: readonly SavedMapKind[];
  title?: string;
  description?: string;
  allowStartPursuit?: boolean;
  onPursuitCreated?: () => void;
  emptyText?: string;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const kindsKey = kinds ? kinds.join(',') : '';

  const load = useCallback(async () => {
    if (!email) {
      setState({ status: 'error', message: 'Sign in to see what you saved on the map.' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const res = await authedFetch(`/api/opportunities/save?email=${encodeURIComponent(email)}`, email);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success !== true) {
        setState({
          status: 'error',
          message: (data && typeof data.error === 'string' && data.error) || `Could not load saved items (HTTP ${res.status}).`,
        });
        return;
      }
      const ks = kindsKey ? (kindsKey.split(',') as SavedMapKind[]) : undefined;
      setState({ status: 'ready', items: toSavedMapItems(data.opportunities, ks) });
    } catch {
      setState({ status: 'error', message: 'Could not load saved items (network error).' });
    }
  }, [email, kindsKey]);

  useEffect(() => { load(); }, [load]);

  const remove = async (item: SavedMapItem) => {
    if (!email) return;
    setBusy((b) => ({ ...b, [item.recordId]: 'remove' }));
    setRowMsg((m) => { const n = { ...m }; delete n[item.recordId]; return n; });
    try {
      const res = await authedFetch('/api/opportunities/save', email, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, noticeId: item.recordId }),
      });
      if (!res.ok) {
        setRowMsg((m) => ({ ...m, [item.recordId]: 'Could not remove. Try again.' }));
        return;
      }
      setState((s) => (s.status === 'ready'
        ? { status: 'ready', items: s.items.filter((x) => x.recordId !== item.recordId) }
        : s));
    } catch {
      setRowMsg((m) => ({ ...m, [item.recordId]: 'Could not remove. Try again.' }));
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[item.recordId]; return n; });
    }
  };

  const startPursuit = async (item: SavedMapItem) => {
    if (!email) return;
    setBusy((b) => ({ ...b, [item.recordId]: 'pursuit' }));
    setRowMsg((m) => { const n = { ...m }; delete n[item.recordId]; return n; });
    try {
      const res = await authedFetch('/api/pipeline', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pursuitBodyFor(item, email)),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setRowMsg((m) => ({ ...m, [item.recordId]: 'Added to your pursuits.' }));
        onPursuitCreated?.();
      } else if (res.status === 409) {
        setRowMsg((m) => ({ ...m, [item.recordId]: 'Already in your pursuits.' }));
      } else {
        setRowMsg((m) => ({ ...m, [item.recordId]: (data && typeof data.error === 'string' && data.error) || 'Could not start a pursuit.' }));
      }
    } catch {
      setRowMsg((m) => ({ ...m, [item.recordId]: 'Could not start a pursuit (network error).' }));
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[item.recordId]; return n; });
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3 py-1.5 bg-surface hover:bg-input text-muted text-sm rounded-lg transition-colors"
          aria-label="Refresh saved items"
        >
          ↻
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="space-y-2 animate-pulse" aria-label="Loading saved items">
          {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-surface" />)}
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {state.message}{' '}
          <button type="button" onClick={load} className="underline hover:text-red-200">Retry</button>
        </div>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <div className="rounded-lg border border-hairline bg-surface/40 p-6 text-center">
          <p className="text-sm text-ink-soft">{emptyText || 'Nothing saved on the map yet.'}</p>
          <a
            href={mapHomeLink()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            <MapPin className="h-4 w-4 shrink-0" strokeWidth={2} /> Open the map
          </a>
        </div>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-ground/40">
          {state.items.map((item) => {
            const due = fmtDate(item.deadline);
            const saved = fmtDate(item.savedAt);
            const b = busy[item.recordId];
            return (
              <li key={item.recordId} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${KIND_CHIP[item.kind]}`}>
                      {item.kindLabel}
                    </span>
                    <span className="truncate text-sm font-medium text-white" title={item.title}>{item.title}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-faint truncate">
                    {[item.agency, due ? `Due ${due}` : null, saved ? `Saved ${saved}` : null].filter(Boolean).join(' · ')}
                  </div>
                  {rowMsg[item.recordId] && <div className="mt-1 text-xs text-amber-300">{rowMsg[item.recordId]}</div>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {item.mapHref && (
                    <a
                      href={item.mapHref}
                      className="inline-flex items-center gap-1 rounded-lg bg-surface px-3 py-1.5 text-xs text-ink-soft hover:bg-input"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> Open on the map
                    </a>
                  )}
                  {allowStartPursuit && item.canStartPursuit && (
                    <button
                      type="button"
                      onClick={() => startPursuit(item)}
                      disabled={!!b}
                      className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> {b === 'pursuit' ? 'Adding…' : 'Start pursuit'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    disabled={!!b}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                    aria-label={`Remove ${item.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> {b === 'remove' ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
