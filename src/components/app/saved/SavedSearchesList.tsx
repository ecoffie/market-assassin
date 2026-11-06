'use client';
/**
 * "Saved searches" — the user's Opportunity Map saved searches (`saved_searches`), inside /app.
 *
 * List: GET /api/app/saved-searches?email= (requireMIAuthSession — verified token, not a claimed
 * email). New-match counts: the same route's ?badge=1, which runs the shared applyMapFilters engine
 * the alert cron uses. The badge reports 0 both for "nothing new" and for a search that was never
 * baselined or whose query failed, so only a POSITIVE count is shown; 0 / absent shows nothing.
 * A failed badge call never hides the list.
 */
import { useCallback, useEffect, useState } from 'react';
import { Bell, MapPin, Search } from 'lucide-react';
import { authedFetch } from '../authHeaders';
import { mapHomeLink } from '@/lib/maps/map-links';
import { toSavedSearchItems, type SavedSearchItem } from './saved-map-items';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: SavedSearchItem[] };

export default function SavedSearchesList({ email }: { email: string | null }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!email) {
      setState({ status: 'error', message: 'Sign in to see your saved searches.' });
      return;
    }
    setState({ status: 'loading' });
    const q = encodeURIComponent(email);
    try {
      const [listRes, badge] = await Promise.all([
        authedFetch(`/api/app/saved-searches?email=${q}`, email),
        authedFetch(`/api/app/saved-searches?badge=1&email=${q}`, email)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      const list = await listRes.json().catch(() => null);
      if (!listRes.ok || !list || list.success !== true) {
        setState({
          status: 'error',
          message: (list && typeof list.error === 'string' && list.error) || `Could not load saved searches (HTTP ${listRes.status}).`,
        });
        return;
      }
      setState({ status: 'ready', items: toSavedSearchItems(list.searches, badge?.success ? badge.perSearch : undefined) });
    } catch {
      setState({ status: 'error', message: 'Could not load saved searches (network error).' });
    }
  }, [email]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Saved searches</h2>
          <p className="text-xs text-muted mt-0.5">Searches you saved on the Opportunity Map. Open one to run it again.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3 py-1.5 bg-surface hover:bg-input text-muted text-sm rounded-lg transition-colors"
          aria-label="Refresh saved searches"
        >
          ↻
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="space-y-2 animate-pulse" aria-label="Loading saved searches">
          {[1, 2].map((i) => <div key={i} className="h-14 rounded-lg bg-surface" />)}
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
          <p className="text-sm text-ink-soft">No saved searches yet. On the map, set your filters and choose “Save search”.</p>
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
          {state.items.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} />
                  <span className="truncate text-sm font-medium text-white" title={s.name}>{s.name}</span>
                  {s.newCount != null && s.newCount > 0 && (
                    <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
                      {s.newCount.toLocaleString()} new
                    </span>
                  )}
                  {s.alertsOn && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-faint" title="Email alerts are on">
                      <Bell className="h-3 w-3" strokeWidth={2} /> alerts on
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-faint truncate">
                  {[s.modeLabel, s.summary || 'No filters'].filter(Boolean).join(' · ')}
                </div>
              </div>
              {s.mapHref && (
                <a
                  href={s.mapHref}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-surface px-3 py-1.5 text-xs text-ink-soft hover:bg-input"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> Open on the map
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
