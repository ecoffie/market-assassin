'use client';

/**
 * MyTargetListPanel — Slice 3C of the Target Market Research roadmap.
 *
 * Where users see and manage the offices they saved from Market
 * Research. Each row shows status / priority / notes / signal counts
 * (pain points, open opps, upcoming events). Status changes flip
 * inline; notes inline-edit; Remove drops the row with an Undo toast.
 *
 * Outreach log per target (Slice 3D) will hang off a row-expand or
 * a per-target detail page — left as a follow-up.
 */
import { useState, useEffect, useCallback } from 'react';
import { Search, Target, Sparkles, Handshake, MapPin, Star, Lightbulb, AlertTriangle, Mic, FileText, Laptop, Ticket, Calendar, type LucideIcon } from 'lucide-react';
import type { AppTier, AppPanel } from '../UnifiedSidebar';
import { authedFetch } from '../authHeaders';
import { getActiveWorkspace, getActiveWorkspaceName } from '../activeWorkspace';
import { useToast } from '../Toast';
import { useAppTracker } from '../track';
import SaveContactButton from '../contacts/SaveContactButton';
import { normalizeOfficeName } from '@/lib/gov-contacts/office-name';

interface TargetRow {
  id: string;
  user_email: string;
  agency_name: string;
  sub_agency_name: string | null;
  office_code: string | null;
  office_name: string;
  location: string | null;
  set_aside_spending: number;
  contract_count: number;
  sat_ratio: number;
  pain_point_count: number;
  open_opp_count: number;
  upcoming_event_count: number;
  status: 'targeting' | 'contacted' | 'qualified' | 'passed' | 'won';
  priority: 'low' | 'medium' | 'high' | 'critical';
  notes: string | null;
  // Provenance (roadmap Slice 5b) — the NAICS/PSC search that surfaced
  // this office. Comma-joined; null for targets saved before the
  // provenance migration or when the user searched without that code.
  source_naics: string | null;
  source_psc: string | null;
  added_at: string;
  updated_at: string;
}

// Slice 4 — one upcoming event from /api/app/target-events. Sources
// are sam_events (dated, SAM.gov special-notice extraction), static
// event series (AFCEA, SAME, etc. — ongoing, not dated), and major
// annual conferences (typical_month only). The 3 source types
// surface distinct UI cues so the user knows which is which.
interface TargetEvent {
  source: 'sam' | 'ai' | 'static_series' | 'static_conference';
  title: string;
  event_type: string;
  event_date: string | null;
  location: string | null;
  url: string | null;
  description: string | null;
  matched_agency: string;
  confidence?: number | null;  // AI-discovered events only (Slice 5)
}

const STATUS_OPTIONS: Array<{ id: TargetRow['status']; label: string; color: string }> = [
  { id: 'targeting', label: 'Targeting', color: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
  { id: 'contacted', label: 'Contacted', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  { id: 'qualified', label: 'Qualified', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  { id: 'passed', label: 'Passed', color: 'bg-slate-600/20 text-slate-400 border-slate-700' },
  { id: 'won', label: 'Won', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
];

function statusColor(status: TargetRow['status']): string {
  return STATUS_OPTIONS.find(s => s.id === status)?.color || STATUS_OPTIONS[0].color;
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export default function MyTargetListPanel({
  email,
  tier,
  onPanelChange,
}: {
  email: string | null;
  tier: AppTier;
  onPanelChange?: (panel: AppPanel, context?: Record<string, unknown>) => void;
}) {
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TargetRow['status'] | 'all'>('all');
  // Slice 3D — which target row is expanded to show its outreach
  // log. Only one expanded at a time keeps the UI focused.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which target's CONTACTS (Decision Makers) are expanded inline (Eric: fold
  // Relationships into Target List — target the people from the agency card).
  const [contactsId, setContactsId] = useState<string | null>(null); // unified Contacts panel (Directory|Saved)
  // Slice 4 — Event Radar. Map of target_id → upcoming events. One
  // fetch covers every target (the endpoint loops server-side so the
  // client makes a single round trip regardless of list size).
  const [eventsByTarget, setEventsByTarget] = useState<Record<string, TargetEvent[]>>({});
  // Slice 5 — AI event discovery. Tracks which target is mid-discovery
  // (spinner on its button) so the user gets feedback during the
  // ~3-5s Serper + Groq round trip.
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  // Track which targets have events expanded vs collapsed. Distinct
  // from expandedId (outreach log) so users can have both views open
  // on the same card at the same time. Scheduled events (industry
  // days, webinars, conferences) and sources sought / market research
  // notices are independent toggles per Eric — different BD actions,
  // different cadence, user wants to see them separately.
  const [scheduledExpandedId, setScheduledExpandedId] = useState<string | null>(null);
  const [sourcesSoughtExpandedId, setSourcesSoughtExpandedId] = useState<string | null>(null);
  // Pain points drill-down. Lazy-fetched per target on first click,
  // cached so the second click is instant. Keyed by target.id.
  const [painExpandedId, setPainExpandedId] = useState<string | null>(null);
  const [painByTarget, setPainByTarget] = useState<Record<string, { painPoints: string[]; priorities: string[]; loading: boolean; error?: string }>>({});
  // Add-agency search — lets users add a target directly from this panel
  // instead of having to go to Market Research, search, and use a drawer.
  const [agencyQuery, setAgencyQuery] = useState('');
  const [agencyResults, setAgencyResults] = useState<Array<{ name: string; parent?: string }>>([]);
  const [searchingAgencies, setSearchingAgencies] = useState(false);
  const [addingAgency, setAddingAgency] = useState<string | null>(null);
  // "Set up my Mindy" (Auto): one click seeds the empty list from the market
  // scan. Add-only on the server, so it's safe to offer right here.
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const { showToast } = useToast();
  const track = useAppTracker(email);

  // Coach Mode: name the CLIENT in empty-state copy/CTA so "Set up my Mindy /
  // your market" doesn't read as the coach's own setup. Resolved once on mount
  // (localStorage is sync + client-only). Falls back to "this client" when the
  // name wasn't stashed (e.g. arrived via a bookmarked client URL).
  const [coachClient] = useState<{ isClient: boolean; name: string } | null>(() => {
    if (typeof window === 'undefined' || !getActiveWorkspace()) return null;
    return { isClient: true, name: getActiveWorkspaceName() || 'this client' };
  });

  const runAutoSetup = useCallback(async () => {
    if (!email || autoRunning) return;
    setAutoRunning(true); setAutoError(null);
    try {
      const res = await authedFetch('/api/app/auto-setup', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        showToast({ message: `Added ${d.added} ${d.added === 1 ? 'agency' : 'agencies'} to ${coachClient ? `${coachClient.name}'s` : 'your'} Target List${d.skipped ? ` (${d.skipped} already there)` : ''}`, variant: 'success' });
        await loadTargets();
      } else if (d.needsProfile) {
        setAutoError('Add NAICS codes or keywords to your profile first.');
      } else if (d.upgrade_required) {
        setAutoError(d.message || 'Saved target lists are a Mindy Pro feature.');
      } else {
        setAutoError(d.error || 'Could not set up your list. Try again.');
      }
    } catch {
      setAutoError('Something went wrong. Try again.');
    } finally {
      setAutoRunning(false);
    }
  // loadTargets is declared just below; referenced lazily so order is fine.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, autoRunning]);

  const loadTargets = useCallback(async () => {
    if (!email) {
      setLoading(false);
      return;
    }
    try {
      const res = await authedFetch(`/api/app/target-list?email=${encodeURIComponent(email)}`, email);
      const data = await res.json();
      if (!data?.success) {
        setError(data?.error || 'Failed to load your target list');
        return;
      }
      setTargets(data.targets || []);
      setError(null);
    } catch (err) {
      console.error('[MyTargetList] load failed:', err);
      setError('Network error loading your target list');
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  // Search agencies to add directly from this panel.
  const searchAgencies = useCallback(async (q: string) => {
    const query = q.trim();
    if (query.length < 2) { setAgencyResults([]); return; }
    setSearchingAgencies(true);
    try {
      const res = await fetch(`/api/agency-hierarchy?search=${encodeURIComponent(query)}&limit=8`);
      const data = await res.json().catch(() => null);
      const results = Array.isArray(data?.results) ? data.results : [];
      setAgencyResults(results.map((r: { name?: string; parent?: string }) => ({
        name: r.name || '', parent: r.parent,
      })).filter((r: { name: string }) => r.name));
    } catch {
      setAgencyResults([]);
    } finally {
      setSearchingAgencies(false);
    }
  }, []);

  // Debounce the search as the user types.
  useEffect(() => {
    const t = setTimeout(() => searchAgencies(agencyQuery), 300);
    return () => clearTimeout(t);
  }, [agencyQuery, searchAgencies]);

  // Add a searched agency to the target list. Agency-level target
  // (office_name = agency name) — the user can refine to a specific
  // office later from Market Research.
  const addAgencyTarget = useCallback(async (name: string, parent?: string) => {
    if (!email || addingAgency) return;
    setAddingAgency(name);
    try {
      const res = await authedFetch('/api/app/target-list', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: email,
          agency_name: parent || name,
          sub_agency_name: parent ? name : null,
          office_name: name,
          added_from: 'target_list_search',
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 402) {
        showToast({ message: data?.message || 'Target lists are a Mindy Pro feature', variant: 'info' });
      } else if (res.status === 409 || data?.already_saved) {
        showToast({ message: `${name} is already on your list`, variant: 'info' });
      } else if (!res.ok || !data?.success) {
        showToast({ message: data?.error || 'Could not add agency', variant: 'error' });
      } else {
        showToast({ message: `Added ${name} to your target list`, variant: 'success' });
        setAgencyQuery('');
        setAgencyResults([]);
        loadTargets();
      }
    } catch {
      showToast({ message: 'Network error — could not add', variant: 'error' });
    } finally {
      setAddingAgency(null);
    }
  }, [email, addingAgency, showToast, loadTargets]);

  // Slice 4 — load all target events in a single call after the
  // target list itself is ready. Fires whenever targets change so
  // newly-added offices get their events. Fail-soft: a network
  // hiccup just leaves eventsByTarget empty.
  useEffect(() => {
    if (!email || targets.length === 0) return;
    let cancelled = false;
    authedFetch(`/api/app/target-events?email=${encodeURIComponent(email)}`, email)
      .then(r => r.json())
      .then(data => {
        if (cancelled || !data?.success) return;
        setEventsByTarget(data.events_by_target || {});
      })
      .catch(err => console.warn('[MyTargetList] events load failed:', err));
    return () => { cancelled = true; };
  // targets.length (not targets) so we don't re-fetch on every
  // status / notes update — only when the list actually grows or
  // shrinks. The endpoint reads from saved targets anyway, so this
  // is the right granularity.
  }, [email, targets.length]);

  // Slice 5 — AI event discovery. Fires the open-web search agent for
  // one target's agency, merges the discovered events into that
  // target's list, and tells the user what happened. Throttled
  // server-side (7-day TTL per agency) so repeat clicks are cheap.
  const discoverEvents = useCallback(async (target: TargetRow) => {
    if (!email || discoveringId) return;
    setDiscoveringId(target.id);
    try {
      const res = await authedFetch('/api/app/discover-events', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, target_id: target.id }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 402 && data?.upgrade_required) {
        showToast({ message: data.message || 'AI event discovery is a Mindy Pro feature', variant: 'info' });
        return;
      }
      if (!res.ok || !data?.success) {
        showToast({ message: data?.error || 'Could not search for events', variant: 'error' });
        return;
      }

      const found = (data.events || []) as TargetEvent[];
      if (found.length > 0) {
        // Merge into this target's events, de-duping by title so a
        // re-run doesn't double-list. AI events sit alongside SAM +
        // static ones; the filters (scheduled / sources-sought) and
        // the card badges handle display.
        setEventsByTarget(prev => {
          const existing = prev[target.id] || [];
          const seen = new Set(existing.map(e => e.title.toLowerCase()));
          const merged = [...existing];
          for (const ev of found) {
            if (!seen.has(ev.title.toLowerCase())) {
              seen.add(ev.title.toLowerCase());
              merged.push(ev);
            }
          }
          return { ...prev, [target.id]: merged };
        });
        // Auto-open the scheduled panel so the new events are visible.
        setScheduledExpandedId(target.id);
        showToast({
          message: data.cached
            ? `Showing ${found.length} event${found.length === 1 ? '' : 's'} Mindy found earlier`
            : `Mindy found ${found.length} event${found.length === 1 ? '' : 's'} — verify dates before relying on them`,
          variant: 'success',
        });
      } else {
        showToast({ message: 'No new events found on the web for this agency right now', variant: 'info' });
      }
    } catch (err) {
      console.error('[MyTargetList] discover events failed:', err);
      showToast({ message: 'Network error searching for events', variant: 'error' });
    } finally {
      setDiscoveringId(null);
    }
  }, [email, discoveringId, showToast]);

  // PATCH a single target field. Optimistic update with rollback.
  const updateTarget = useCallback(async (id: string, changes: Partial<TargetRow>) => {
    if (!email) return;
    const original = targets.find(t => t.id === id);
    if (!original) return;

    setTargets(prev => prev.map(t => t.id === id ? { ...t, ...changes } : t));

    try {
      const res = await authedFetch('/api/app/target-list', email, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, user_email: email, ...changes }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        // Roll back
        setTargets(prev => prev.map(t => t.id === id ? original : t));
        showToast({ message: data?.error || 'Could not update', variant: 'error' });
        return;
      }
      if (changes.status) {
        track('tool_use', 'pipeline', {
          action: 'target_list_status_change',
          opportunity_id: id, // Generic event field — using for target_id here
          to_stage: String(changes.status),
        });
      }
    } catch (err) {
      console.error('[MyTargetList] update failed:', err);
      setTargets(prev => prev.map(t => t.id === id ? original : t));
      showToast({ message: 'Network error — change not saved', variant: 'error' });
    }
  }, [email, targets, showToast, track]);

  // Toggle the pain points panel for a target. Lazy-fetches on first
  // open and caches result so subsequent toggles are instant. Tries
  // sub_agency first (more specific) then falls back to parent.
  const togglePainExpanded = useCallback(async (target: TargetRow) => {
    setPainExpandedId((prev) => (prev === target.id ? null : target.id));

    // Already cached (or in-flight) — no fetch needed
    if (painByTarget[target.id]) return;

    // Mark loading
    setPainByTarget((prev) => ({
      ...prev,
      [target.id]: { painPoints: [], priorities: [], loading: true },
    }));

    const queryName = target.sub_agency_name || target.agency_name;
    try {
      const res = await fetch(`/api/pain-points?agency=${encodeURIComponent(queryName)}`);
      const json = await res.json();
      setPainByTarget((prev) => ({
        ...prev,
        [target.id]: {
          painPoints: Array.isArray(json.painPoints) ? json.painPoints : [],
          priorities: Array.isArray(json.priorities) ? json.priorities : [],
          loading: false,
        },
      }));
    } catch (err) {
      console.warn('[MyTargetList] pain points fetch failed:', err);
      setPainByTarget((prev) => ({
        ...prev,
        [target.id]: { painPoints: [], priorities: [], loading: false, error: 'Failed to load' },
      }));
    }
  }, [painByTarget]);

  const removeTarget = useCallback(async (id: string) => {
    if (!email) return;
    const original = targets.find(t => t.id === id);
    if (!original) return;

    // Optimistic drop
    setTargets(prev => prev.filter(t => t.id !== id));

    try {
      const res = await authedFetch('/api/app/target-list', email, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, user_email: email }),
      });
      if (!res.ok) {
        // Restore on failure.
        setTargets(prev => [...prev, original].sort(
          (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime()
        ));
        const data = await res.json().catch(() => null);
        showToast({ message: data?.error || 'Could not remove', variant: 'error' });
        return;
      }
      showToast({
        message: `Removed ${original.office_name}`,
        variant: 'info',
        action: {
          // Restore by re-posting the captured row. Server will assign
          // a new id (the UNIQUE constraint is on email+office_name,
          // not on the id, so the same office is recoverable).
          label: 'Undo',
          onClick: async () => {
            try {
              // Strip id + user_email from the captured row — the POST
              // will assign a new id and we set user_email explicitly
              // below (TS complains if we let the spread overwrite).
              const { id: _omitId, user_email: _omitEmail, ...rest } = original;
              void _omitId; void _omitEmail;
              const restore = await authedFetch('/api/app/target-list', email, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...rest, user_email: email }),
              });
              const r = await restore.json();
              if (r?.success) {
                loadTargets();
              }
            } catch (err) {
              console.warn('[MyTargetList] undo restore failed:', err);
            }
          },
        },
      });
    } catch (err) {
      console.error('[MyTargetList] remove failed:', err);
      setTargets(prev => [...prev, original]);
      showToast({ message: 'Network error — could not remove', variant: 'error' });
    }
  }, [email, targets, showToast, loadTargets]);

  // Filter view based on the chip row.
  const visibleTargets = statusFilter === 'all'
    ? targets
    : targets.filter(t => t.status === statusFilter);

  // Tier gate. Free users see an upgrade pitch. They can still see
  // anything they saved earlier (which the server returned), but the
  // big visual is "Pro feature."
  const isFree = tier === 'free';

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        {/* Keep the real header visible so the page doesn't look blank/broken
            while loading (Eric: "add the moving thing so users know it's
            loading"). */}
        <div>
          <h1 className="text-2xl font-bold text-white">My Target List</h1>
          <div className="flex items-center gap-2 mt-2 text-sm text-slate-400">
            <span className="inline-block w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            Loading your target list…
          </div>
        </div>
        {/* Pulsing skeleton rows that mirror the real target cards, so the
            structure is visible and it clearly reads as "working." */}
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border border-slate-800 rounded-lg p-4 bg-slate-900/40 animate-pulse">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 bg-slate-800 rounded" />
                  <div className="h-3 w-1/2 bg-slate-800/70 rounded" />
                </div>
                <div className="h-8 w-20 bg-slate-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">My Target List</h1>
        <p className="text-sm text-slate-400 mt-1">
          Agencies and offices you&apos;re working for multi-month BD outreach.
        </p>
      </div>

      {/* Add-agency search — add a target right here, no need to detour
          through Market Research. Type an agency name → click to add. */}
      {!isFree && (
        <div className="relative">
          <div data-tour="target-add" className="flex items-center gap-2 bg-slate-900/60 border border-slate-800 rounded-lg p-3">
            <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={2} />
            <input
              type="text"
              value={agencyQuery}
              onChange={(e) => setAgencyQuery(e.target.value)}
              placeholder="Add an agency — type a name (e.g. Air Force, VA, FEMA, NASA)"
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
            />
            {searchingAgencies && <span className="text-xs text-slate-500">searching…</span>}
          </div>
          {agencyResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 shadow-xl max-h-72 overflow-y-auto">
              {agencyResults.map((r, i) => (
                <button
                  key={`${r.name}-${i}`}
                  type="button"
                  onClick={() => addAgencyTarget(r.name, r.parent)}
                  disabled={addingAgency === r.name}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-800 border-b border-slate-800/60 last:border-0 flex items-center justify-between gap-3 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-white truncate">{r.name}</span>
                    {r.parent && r.parent !== r.name && (
                      <span className="block text-xs text-slate-500 truncate">{r.parent}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-emerald-400">
                    {addingAgency === r.name ? 'adding…' : '+ Add'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {isFree && targets.length === 0 && (
        <div className="bg-gradient-to-br from-purple-900/40 to-purple-800/20 border border-purple-500/40 rounded-lg p-5">
          <h3 className="inline-flex items-center gap-2 text-lg font-bold text-white mb-2"><Target className="h-5 w-5 shrink-0" strokeWidth={2} /> Target lists are a Mindy Pro feature</h3>
          <p className="text-sm text-slate-300 mb-3">
            Save offices from Market Research, track status from Targeting → Contacted → Qualified,
            and (soon) log every email, call, and event you attend toward each target.
          </p>
          <a
            href="/market-intelligence"
            className="inline-block px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold"
          >
            Upgrade to Mindy Pro
          </a>
        </div>
      )}

      {targets.length === 0 && !isFree && !error && (
        <div className="rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-slate-900/40 p-8 text-center">
          <p className="text-lg font-semibold text-white">
            {coachClient
              ? `Want Mindy to set up ${coachClient.name}'s target list?`
              : 'Want Mindy to set this up for you?'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
            {coachClient
              ? `We'll add the agencies buying in ${coachClient.name}'s market — each with its sources sought, events, and contacts attached. You can fine-tune anything after.`
              : "We'll add the agencies buying in your market — each with its sources sought, events, and contacts attached. You can fine-tune anything after."}
          </p>
          {autoError && <p className="mt-2 text-xs text-red-300">{autoError}</p>}
          <button
            onClick={runAutoSetup}
            disabled={autoRunning}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {!autoRunning && <Sparkles className="h-4 w-4 shrink-0" strokeWidth={2} />}
            {autoRunning
              ? 'Setting up…'
              : coachClient
                ? `Set up ${coachClient.name}'s Mindy`
                : 'Set up my Mindy'}
          </button>
          <p className="mt-4 text-xs text-slate-500">
            Or build it yourself — use the <span className="text-emerald-400">search box above</span> to add an agency,
            or open <span className="text-purple-300">Market Research</span> for a specific office.
          </p>
        </div>
      )}

      {targets.length > 0 && (
        <>
          {/* Stat strip + status filter chips */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatTile label="Total" value={targets.length} onClick={() => setStatusFilter('all')} active={statusFilter === 'all'} />
            {STATUS_OPTIONS.map(opt => (
              <StatTile
                key={opt.id}
                label={opt.label}
                value={targets.filter(t => t.status === opt.id).length}
                onClick={() => setStatusFilter(opt.id)}
                active={statusFilter === opt.id}
              />
            ))}
          </div>

          {/* The list. Each row is a card so we can grow them into
              detail panels in Slice 3D when outreach logs ship. */}
          <div className="space-y-3">
            {visibleTargets.length === 0 ? (
              <p className="text-sm text-slate-500 italic text-center py-6">
                No targets with status &quot;{statusFilter}&quot;.
              </p>
            ) : (
              visibleTargets.map(t => (
                <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 hover:border-slate-700 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-semibold text-white truncate">{normalizeOfficeName(t.office_name, { mode: 'clean' })}</h3>
                        {t.office_code && (
                          <span className="text-[10px] font-mono text-slate-500">{t.office_code}</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mb-2">
                        {t.sub_agency_name || t.agency_name}
                        {t.location && <> · {t.location}</>}
                      </p>

                      {/* Signal pills */}
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-400">
                          {fmtMoney(t.set_aside_spending)} spend
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {t.contract_count} contracts
                        </span>
                        <span
                          className="px-2 py-0.5 rounded bg-slate-800 text-slate-300"
                          title={
                            (t.sat_ratio || 0) > 0
                              ? `${Math.round(t.sat_ratio * 100)}% of this office's sampled contracts are under the $350K Simplified Acquisition Threshold — easier-entry territory.`
                              : 'No small-dollar contracts (<$350K) appeared in our USAspending sample. Our pipeline pulls awards sorted by amount + date, which skews toward larger contracts. True small-contract count requires the SAM Contract Data API (pending approval).'
                          }
                        >
                          {(t.sat_ratio || 0) > 0 ? `${Math.round(t.sat_ratio * 100)}% SAT` : 'SAT —'}
                        </span>
                        {t.pain_point_count > 0 && (
                          <button
                            type="button"
                            onClick={() => togglePainExpanded(t)}
                            className={`px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 transition-colors cursor-pointer ${painExpandedId === t.id ? 'ring-1 ring-amber-400/50' : ''}`}
                            title="Click to see the documented pain points + priorities for this agency"
                          >
                            {t.pain_point_count} pain pts {painExpandedId === t.id ? '▼' : '▸'}
                          </button>
                        )}
                        {t.open_opp_count > 0 && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300">
                            {t.open_opp_count} open opps
                          </span>
                        )}
                        {t.upcoming_event_count > 0 && (
                          <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300">
                            {t.upcoming_event_count} events
                          </span>
                        )}
                        {/* Provenance (roadmap Slice 5b) — which code
                            surfaced this office. PSC shown first since
                            it's the more precise classifier. */}
                        {t.source_psc && (
                          <span
                            className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-300"
                            title="The PSC code you were searching when you saved this office. PSC is a tighter match than NAICS for what an office actually buys."
                          >
                            from PSC {t.source_psc}
                          </span>
                        )}
                        {t.source_naics && !t.source_psc && (
                          <span
                            className="px-2 py-0.5 rounded bg-slate-700/40 text-slate-300"
                            title="The NAICS code you were searching when you saved this office."
                          >
                            from NAICS {t.source_naics}
                          </span>
                        )}
                      </div>

                      {/* Notes — inline editable */}
                      <div className="mt-3">
                        <NotesEditor
                          value={t.notes || ''}
                          onSave={(value) => updateTarget(t.id, { notes: value || null })}
                        />
                      </div>

                      {/* Three independent toggles: scheduled events
                          (industry days etc.), sources sought (RFI /
                          market research notices), outreach log. Each
                          opens its own panel below; multiple can be
                          open at once. */}
                      <div className="mt-3 flex flex-wrap gap-3">
                        {(() => {
                          const evs = eventsByTarget[t.id] || [];
                          const scheduled = evs.filter(isScheduledEvent);
                          const sourcesSought = evs.filter(isSourcesSoughtEvent);
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() => setScheduledExpandedId(scheduledExpandedId === t.id ? null : t.id)}
                                disabled={scheduled.length === 0}
                                className={`text-xs transition-colors ${
                                  scheduled.length === 0
                                    ? 'text-slate-600 cursor-default'
                                    : 'text-purple-300 hover:text-purple-200'
                                }`}
                              >
                                {scheduled.length === 0
                                  ? '◌ No scheduled events'
                                  : scheduledExpandedId === t.id
                                    ? `▼ Hide ${scheduled.length} scheduled ${scheduled.length === 1 ? 'event' : 'events'}`
                                    : `▸ Show ${scheduled.length} scheduled ${scheduled.length === 1 ? 'event' : 'events'}`}
                              </button>
                              <button
                                type="button"
                                onClick={() => setSourcesSoughtExpandedId(sourcesSoughtExpandedId === t.id ? null : t.id)}
                                disabled={sourcesSought.length === 0}
                                className={`text-xs transition-colors ${
                                  sourcesSought.length === 0
                                    ? 'text-slate-600 cursor-default'
                                    : 'text-amber-300 hover:text-amber-200'
                                }`}
                              >
                                {sourcesSought.length === 0
                                  ? '◌ No sources sought'
                                  : sourcesSoughtExpandedId === t.id
                                    ? `▼ Hide ${sourcesSought.length} sources sought`
                                    : `▸ Show ${sourcesSought.length} sources sought`}
                              </button>
                            </>
                          );
                        })()}

                        {/* Contacts — ONE button opens a unified Contacts panel
                            with a Directory | Saved toggle inside (merged from the
                            old "Find gov contacts" + "Saved contacts" buttons,
                            which read as overlapping). */}
                        <button
                          type="button"
                          onClick={() => setContactsId(contactsId === t.id ? null : t.id)}
                          className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                        >
                          {contactsId === t.id ? '▼ Hide contacts' : '▸ Contacts'}
                        </button>
                        {/* Slice 3D — toggle for the outreach log. Click
                            to expand the activity timeline + log-new
                            form inline beneath the card. */}
                        <button
                          type="button"
                          onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          {expandedId === t.id ? '▼ Hide outreach log' : '▸ Show outreach log'}
                        </button>
                      </div>
                    </div>

                    {/* Right rail: status dropdown + remove */}
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <select
                        value={t.status}
                        onChange={(e) => updateTarget(t.id, { status: e.target.value as TargetRow['status'] })}
                        className={`text-xs px-2 py-1 rounded border outline-none cursor-pointer ${statusColor(t.status)}`}
                      >
                        {STATUS_OPTIONS.map(opt => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeTarget(t.id)}
                        className="text-[10px] text-slate-500 hover:text-red-400 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Two independent event panels, each tied to its
                      own toggle button above. Both can be open at
                      once. Data is pre-fetched in batch via
                      /api/app/target-events. */}
                  {scheduledExpandedId === t.id && (
                    <div className="mt-4 pt-4 border-t border-slate-800">
                      <EventSection
                        title="Scheduled Events"
                        subtitle="Industry days, webinars, conferences — show up and meet people"
                        accent="purple"
                        events={(eventsByTarget[t.id] || []).filter(isScheduledEvent)}
                      />
                      {/* Slice 5 — AI event discovery. Searches the open
                          web for events this agency is running that
                          aren't in SAM.gov or our static catalog. */}
                      <div className="mt-3 flex items-center gap-3 flex-wrap">
                        {/* Target List drives Relationships (Eric: from a target
                            agency, see its buyers/OSBP/partners). Opens the
                            Relationships panel pre-scoped to this agency. */}
                        {onPanelChange && (
                          <button
                            type="button"
                            onClick={() => onPanelChange('contacts', { agency: t.agency_name })}
                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200 transition-colors"
                            title={`See gov buyers, OSBP contacts, and teaming partners at ${t.agency_name}`}
                          >
                            <Handshake className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> Relationships at this agency →
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => discoverEvents(t)}
                          disabled={discoveringId === t.id}
                          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 hover:text-sky-200 transition-colors disabled:opacity-60 disabled:cursor-wait"
                          title="Mindy searches the open web for industry days, conferences, and matchmaking events this agency is running."
                        >
                          {discoveringId === t.id ? (
                            <>
                              <span className="inline-block w-3 h-3 border-2 border-sky-300/40 border-t-sky-300 rounded-full animate-spin" />
                              Mindy is searching…
                            </>
                          ) : (
                            <><Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> Find more events with Mindy</>
                          )}
                        </button>
                        <span className="text-[10px] text-slate-600">
                          Searches the open web — verify dates before relying on them.
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-600 italic mt-3">
                        Sources: SAM.gov Special Notices (dated) + curated industry
                        catalog (recurring series, annual conferences) + Mindy AI web search.
                      </p>
                    </div>
                  )}
                  {sourcesSoughtExpandedId === t.id && (
                    <div className="mt-4 pt-4 border-t border-slate-800">
                      <EventSection
                        title="Sources Sought & Market Research"
                        subtitle="Response-deadline notices — early signal of upcoming buys"
                        accent="amber"
                        events={(eventsByTarget[t.id] || []).filter(isSourcesSoughtEvent)}
                      />
                      <p className="text-[10px] text-slate-600 italic mt-3">
                        Sources: SAM.gov Sources Sought + RFI notices from sam_events table.
                      </p>
                    </div>
                  )}

                  {/* Pain points + priorities list, lazy-fetched on
                      first expand via togglePainExpanded. Shows the
                      actual documented issues, not just the count. */}
                  {painExpandedId === t.id && (
                    <PainPointsList data={painByTarget[t.id]} agencyName={t.sub_agency_name || t.agency_name} />
                  )}

                  {/* Slice 3D — outreach timeline + log-new form,
                      revealed when the row is expanded. Lazy: the
                      OutreachLog component only fetches when mounted,
                      so collapsed rows don't trigger API calls. */}
                  {/* Unified contacts panel (Directory + Saved in one, toggled). */}
                  {contactsId === t.id && email && (
                    <TargetContacts
                      agency={t.agency_name}
                      subAgency={t.sub_agency_name}
                      office={t.office_name}
                      officeCode={t.office_code}
                      email={email}
                    />
                  )}
                  {expandedId === t.id && email && (
                    <OutreachLog
                      targetId={t.id}
                      targetName={t.office_name}
                      email={email}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  onClick,
  active,
}: {
  label: string;
  value: number;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-colors ${
        active
          ? 'border-emerald-500/50 bg-emerald-500/5'
          : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </button>
  );
}

// Inline editor — click "Add note" or the existing note to edit.
// Saves on blur. Lightweight because the panel itself owns the
// optimistic update + rollback through `onSave`.
function NotesEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left text-xs text-slate-400 hover:text-slate-200 italic"
      >
        {value || 'Add note…'}
      </button>
    );
  }

  return (
    <textarea
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onSave(draft);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      rows={2}
      className="w-full text-xs bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-200 outline-none focus:border-emerald-500/50"
      placeholder="Notes (Esc to cancel, blur to save)"
    />
  );
}

// ---------------------------------------------------------------------
// Event display helpers + EventSection — Slice 4
// ---------------------------------------------------------------------
//
// Renders inline lists of events matched to a target's agency. Data
// is pre-fetched in batch via /api/app/target-events. Events are
// split into TWO independent panels per Eric (2026-05-24): scheduled
// events (industry days etc., purple) and sources sought / RFIs
// (amber), each with its own toggle button in the parent row.
//
// Source types render with distinct cues so the user knows whether
// they're looking at a confirmed date (sam_events) or a recurring
// series / annual conference that they should bookmark the calendar
// for.

const EVENT_TYPE_ICONS: Record<string, LucideIcon> = {
  industry_day: Mic,
  rfi: FileText,
  forecast: Sparkles,
  webinar: Laptop,
  conference: Ticket,
  event_series: Calendar,
  event: MapPin,
  other: MapPin,
};

function formatEventDate(iso: string | null): string {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const base = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (diffDays < 0) return `${base} (past)`;
  if (diffDays === 0) return `${base} · TODAY`;
  if (diffDays === 1) return `${base} · tomorrow`;
  if (diffDays <= 30) return `${base} · ${diffDays}d`;
  return base;
}

// Event-type buckets. RFI/forecast notices live in sam_events too
// (extract-sam-events classifies 'sources sought' / 'rfi' under the
// 'rfi' event_type) but they're a different BD action from showing
// up at an industry day — so we split them into independent toggle
// buttons + panels per Eric's note: "I like sources sought and
// market research, but I also want actual industry day and
// conference events."
const RFI_EVENT_TYPES = new Set(['rfi', 'forecast']);
// Some Sources Sought / RFI notices reach sam_events with a GENERIC event_type
// (not 'rfi'), so they leaked into the Scheduled Events bucket — Eric saw RFIs and
// "SOURCES SOUGHT / CRFI" notices listed as events (Jun 26). Belt-and-suspenders:
// also classify by the title. Real events (industry day / conference / webinar /
// symposium) win even if the title also says "RFI".
const SS_TITLE_RE = /\b(sources?\s+sought|request for information|\brfi\b|\bcrfi\b|market research|market survey|presolicitation)\b/i;
const EVENT_TITLE_RE = /\b(industry day|conference|webinar|symposium|expo|summit|forum|matchmaking|pre[- ]?proposal|pre[- ]?bid|networking|workshop|town hall|outreach event)\b/i;
function isSourcesSoughtEvent(e: TargetEvent): boolean {
  if (EVENT_TITLE_RE.test(e.title || '')) return false; // a real event, keep it scheduled
  return RFI_EVENT_TYPES.has(e.event_type) || SS_TITLE_RE.test(e.title || '');
}
function isScheduledEvent(e: TargetEvent): boolean {
  return !isSourcesSoughtEvent(e);
}

function EventSection({
  title,
  subtitle,
  accent,
  events,
}: {
  title: string;
  subtitle: string;
  accent: 'purple' | 'amber';
  events: TargetEvent[];
}) {
  const headerColor = accent === 'purple' ? 'text-purple-300' : 'text-amber-300';
  return (
    <div>
      <div className="mb-2">
        <h4 className={`text-xs font-bold uppercase tracking-wider ${headerColor}`}>
          {title}
          <span className="ml-2 text-slate-500 font-normal normal-case">({events.length})</span>
        </h4>
        <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      <ul className="space-y-2">
        {events.map((ev, idx) => {
          const EventIcon = EVENT_TYPE_ICONS[ev.event_type] || EVENT_TYPE_ICONS.other;
          const sourceLabel = ev.source === 'sam'
            ? 'SAM.gov'
            : ev.source === 'ai'
              ? '✨ Mindy found'
              : ev.source === 'static_conference'
                ? 'Annual conference'
                : 'Event series';
          const sourceColor = ev.source === 'sam'
            ? 'text-emerald-400'
            : ev.source === 'ai'
              ? 'text-sky-300'
              : ev.source === 'static_conference'
                ? 'text-amber-300'
                : 'text-purple-300';
          // Slice 5 — AI events get an explicit "verify" cue. Low
          // confidence (<0.6) gets a stronger amber warning.
          const showVerify = ev.source === 'ai';
          const lowConfidence = ev.source === 'ai' && typeof ev.confidence === 'number' && ev.confidence < 0.6;
          return (
            <li
              key={`${ev.source}-${ev.title}-${idx}`}
              className="bg-slate-950/40 border border-slate-800 rounded-lg p-3"
            >
              <div className="flex items-start gap-3">
                <EventIcon className="h-5 w-5 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${sourceColor}`}>
                      {sourceLabel}
                    </span>
                    {ev.event_date && (
                      <span className="text-[10px] text-slate-400">{formatEventDate(ev.event_date)}</span>
                    )}
                    {!ev.event_date && (
                      <span className="text-[10px] text-slate-500 italic">recurring</span>
                    )}
                    {ev.matched_agency && (
                      <span className="text-[10px] text-slate-500">
                        matched: <span className="text-slate-400">{ev.matched_agency}</span>
                      </span>
                    )}
                    {showVerify && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          lowConfidence
                            ? 'bg-amber-500/15 text-amber-300'
                            : 'bg-sky-500/10 text-sky-300'
                        }`}
                        title="Found by Mindy via open-web search. Confirm the date and details on the official site before you commit."
                      >
                        {lowConfidence ? '⚠ verify date' : 'verify date'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-slate-200 mb-1">{ev.title}</p>
                  {ev.location && (
                    <p className="inline-flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3 w-3 shrink-0" strokeWidth={2} /> {ev.location}</p>
                  )}
                  {ev.description && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{ev.description}</p>
                  )}
                  {ev.url && (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-emerald-400 hover:text-emerald-300 underline"
                    >
                      Register / Details ↗
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------
// PainPointsList — drill-down panel for the "X pain pts" badge
// ---------------------------------------------------------------------
// Shows the actual documented pain points + priorities for an agency.
// Data comes from /api/pain-points which reads from the curated
// src/data/agency-pain-points.json + agency_intelligence Supabase table
// (GAO high-risk reports, agency strategic plans, budget docs).
// Use case: BD person clicks "22 pain pts" → reads the actual issues
// → cites them in capability statement / Sources Sought response.
function PainPointsList({
  data,
  agencyName,
}: {
  data?: { painPoints: string[]; priorities: string[]; loading: boolean; error?: string };
  agencyName: string;
}) {
  if (!data || data.loading) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-800">
        <p className="text-xs text-amber-400/70 italic animate-pulse">Loading pain points for {agencyName}…</p>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-800">
        <p className="text-xs text-red-400 italic">Could not load pain points: {data.error}</p>
      </div>
    );
  }

  const { painPoints, priorities } = data;
  if (painPoints.length === 0 && priorities.length === 0) {
    return (
      <div className="mt-4 pt-4 border-t border-slate-800">
        <p className="text-xs text-slate-500 italic">
          No documented pain points or priorities for {agencyName} yet. Our intel database is growing — check back as GAO and budget cycles release.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-slate-800 space-y-4">
      {painPoints.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
            Documented Pain Points
            <span className="ml-2 text-slate-500 font-normal normal-case">({painPoints.length})</span>
          </h4>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Stated problems & unmet needs. Cite these in your capability statement and Sources Sought responses.
          </p>
          <ul className="mt-2 space-y-1.5">
            {painPoints.map((pp, i) => (
              <li key={i} className="flex gap-2 text-xs text-slate-300">
                <span className="text-amber-400/60 shrink-0">▸</span>
                <span className="leading-snug">{pp}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {priorities.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-purple-300">
            Agency Priorities
            <span className="ml-2 text-slate-500 font-normal normal-case">({priorities.length})</span>
          </h4>
          <p className="text-[10px] text-slate-500 mt-0.5">
            What this agency says it wants to fund next. Align your pitch with these themes.
          </p>
          <ul className="mt-2 space-y-1.5">
            {priorities.map((p, i) => (
              <li key={i} className="flex gap-2 text-xs text-slate-300">
                <span className="text-purple-300/60 shrink-0">▸</span>
                <span className="leading-snug">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-slate-600 italic">
        Sources: GAO high-risk reports, agency strategic plans, budget justification docs, congressional testimony. Curated in our intelligence database.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// OutreachLog — Slice 3D
// ---------------------------------------------------------------------
//
// Inline activity timeline + "Log activity" form, revealed when a
// target card is expanded. Self-contained: owns its own fetch, form
// state, and optimistic updates. Mounting it kicks off the GET; we
// don't pre-fetch for collapsed cards.
//
// Activity types map to common federal BD touchpoints. The vocabulary
// rule applies: "email / call / event / rfi / meeting / note" — plain
// language, not SaaS sales-team jargon.

interface OutreachActivity {
  id: string;
  target_id: string;
  user_email: string;
  activity_type: 'email' | 'call' | 'event' | 'rfi' | 'meeting' | 'note';
  contact_name: string | null;
  contact_role: string | null;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  follow_up_date: string | null;
  created_at: string;
}

const ACTIVITY_TYPES: Array<{ id: OutreachActivity['activity_type']; label: string; icon: string }> = [
  { id: 'email',   label: 'Email',   icon: '✉️' },
  { id: 'call',    label: 'Call',    icon: '📞' },
  { id: 'event',   label: 'Event',   icon: '🎤' },
  { id: 'meeting', label: 'Meeting', icon: '🤝' },
  { id: 'rfi',     label: 'RFI',     icon: '📄' },
  { id: 'note',    label: 'Note',    icon: '📝' },
];

const OUTCOME_OPTIONS: Array<{ id: string; label: string; color: string }> = [
  { id: 'replied',      label: 'Replied',       color: 'text-emerald-300' },
  { id: 'meeting_set',  label: 'Meeting set',   color: 'text-emerald-400' },
  { id: 'no_response',  label: 'No response',   color: 'text-slate-500' },
  { id: 'pass',         label: 'Passed',        color: 'text-slate-400' },
  { id: 'success',      label: 'Success',       color: 'text-emerald-400' },
];

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return d.toLocaleDateString();
}

// TargetContacts — Decision Makers for a target agency, inline (Eric: fold
// Relationships into Target List). Pulls federal_contacts for the agency; each
// contact has call/email actions so you reach out + log + move on, one window.
interface TargetContact {
  id: string;
  contact_fullname: string;
  contact_title?: string | null;
  role?: string | null;
  role_category?: string | null;
  pocLabel?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  derivedOffice?: string | null;
  sub_tier?: string | null;
}
// Cache contacts per agency so re-expanding is INSTANT (Eric: "why does it have
// to load?"). The directory doesn't change mid-session.
const _contactsCache = new Map<string, TargetContact[]>();

// Junk filters: SAM POC data has placeholder phones (0000000000) + a useless
// "Primary Contact" title. Suppress them so the UI is clean.
const isJunkPhone = (p?: string | null) => !p || /^0+$/.test(p.replace(/\D/g, ''));
const isJunkTitle = (t?: string | null) => !t || /^(primary|secondary)\s*(contact)?$/i.test(t.trim());

const PREVIEW_COUNT = 8; // curated preview size; rest behind search (SaaS pattern)
function TargetContacts({ agency, subAgency, office, officeCode, email }: { agency: string; subAgency?: string | null; office?: string | null; officeCode?: string | null; email: string }) {
  // Key + query by the MOST SPECIFIC identity the target has. Passing only the
  // broad agency made every DoD/Interior card match the parent department and
  // return the globally-newest contacts — i.e. the SAME wrong people on every
  // card. sub_agency_name + office_name narrow to the actual office the user saved.
  const subA = (subAgency || '').trim();
  // Don't pass the office when it's just a copy of the agency name (targets are
  // often saved with office_name = agency name) — that over-narrows to zero.
  const off = (office || '').trim();
  const officeParam = off && off.toLowerCase() !== agency.toLowerCase() && off.toLowerCase() !== subA.toLowerCase() ? off : '';
  // A real 6-char DoDAAC (letter + 5 alnum) lets the API narrow contacts by the
  // solicitation-number prefix — the reliable way to surface the office's OWN
  // POCs (e.g. USACE district @usace.army.mil) instead of the parent dept, since
  // the SAM POC `office` column is almost always NULL and can't be filtered on.
  const dodaac = (officeCode || '').trim().toUpperCase();
  const validDodaac = /^[A-Z][A-Z0-9]{5}$/.test(dodaac) ? dodaac : '';
  const cacheKey = `${email}:${agency}:${subA}:${officeParam}:${validDodaac}`;
  const [contacts, setContacts] = useState<TargetContact[]>(() => _contactsCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(() => !_contactsCache.has(cacheKey));
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  // True when we asked for a sub-agency but SAM only had parent-department POCs,
  // so the card shows the parent dept (labeled, not silently wrong).
  const [parentFallback, setParentFallback] = useState(false);
  // Merged Directory | Saved view (was two separate buttons). 'directory' = SAM
  // gov POCs to find; 'saved' = the people you've pinned for this agency.
  const [tab, setTab] = useState<'directory' | 'saved'>('directory');

  useEffect(() => {
    if (tab !== 'directory') return; // directory data only loads on the directory tab
    if (_contactsCache.has(cacheKey)) { setContacts(_contactsCache.get(cacheKey)!); setLoading(false); return; }
    let active = true;
    setLoading(true);
    // Pull a generous set we can search client-side (a card preview + filter).
    const p = new URLSearchParams({ email, agency, limit: '250' });
    if (subA) p.set('subAgency', subA);
    if (officeParam) p.set('office', officeParam);
    if (validDodaac) p.set('dodaac', validDodaac);
    authedFetch(`/api/app/federal-contacts?${p.toString()}`, email)
      .then(r => r.json())
      .then(d => {
        const list: TargetContact[] = d?.contacts || d?.results || [];
        _contactsCache.set(cacheKey, list);
        if (active) { setContacts(list); setTotal(d?.total || list.length); setParentFallback(Boolean(d?.narrowedToParent)); }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, agency, subA, officeParam, validDodaac, email, cacheKey]);

  // Format the name "Last, First" → "First Last".
  const fmtName = (n: string) => /,/.test(n) ? n.split(',').reverse().map(s => s.trim()).join(' ') : n;

  // Directory | Saved tab header — shared across both views.
  const tabHeader = (
    <div className="flex items-center gap-1 mb-2.5 border-b border-slate-700/50 pb-2">
      <button
        type="button"
        onClick={() => setTab('directory')}
        className={`text-xs font-semibold px-2 py-1 rounded transition-colors ${tab === 'directory' ? 'bg-purple-500/20 text-purple-200' : 'text-slate-400 hover:text-slate-200'}`}
      >
        Directory
      </button>
      <button
        type="button"
        onClick={() => setTab('saved')}
        className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded transition-colors ${tab === 'saved' ? 'bg-amber-500/20 text-amber-200' : 'text-slate-400 hover:text-slate-200'}`}
      >
        <Star className="h-3 w-3 shrink-0" strokeWidth={2} /> Saved
      </button>
      <span className="ml-auto text-[10px] text-slate-500">
        {tab === 'directory' ? 'gov POCs from SAM' : 'contacts you’ve pinned'}
      </span>
    </div>
  );

  // SAVED tab → the user's pinned contacts for this agency.
  if (tab === 'saved') {
    return (
      <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/[0.04] p-3">
        {tabHeader}
        <SavedContacts agency={agency} email={email} />
      </div>
    );
  }

  if (loading) return (
    <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/[0.04] p-3">
      {tabHeader}
      <div className="text-xs text-slate-500">Loading contacts…</div>
    </div>
  );
  if (contacts.length === 0) return (
    <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/[0.04] p-3">
      {tabHeader}
      <div className="text-xs text-slate-500">No SAM contacts found for this agency yet.</div>
    </div>
  );

  return (
    <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/[0.04] p-3">
      {tabHeader}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-purple-300">Gov contacts at {subA || agency}</span>
        <span className="text-[10px] text-slate-500">{contacts.length} contacts · from SAM notices</span>
      </div>
      {parentFallback && subA && (
        <div className="mb-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-1 text-[11px] text-amber-200">
          Showing <b>{agency}</b> contacts — SAM doesn’t have {subA}-specific POCs yet (their emails use the department-wide domain).
        </div>
      )}

      {/* Mindy insight: WHO to seek out (Eric — the roles to ask for even when
          they're not named in SAM data: KO, OSBP, program, end user, engineer).
          Grounds the user on the right people to build relationships with. */}
      <div className="mb-2.5 rounded-md bg-purple-500/[0.06] border border-purple-500/15 p-2">
        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-200/90 mb-1"><Lightbulb className="h-3 w-3 shrink-0" strokeWidth={2} /> Mindy: the 5 people to find</div>
        <ul className="text-[10px] text-slate-400 space-y-0.5">
          <li><span className="text-slate-300">Contracting Officer (KO)</span> — signs the award; your formal channel.</li>
          <li><span className="text-slate-300">Small Business Specialist / OSBP</span> — ask the agency directly; gets you on the set-aside radar.</li>
          <li><span className="text-slate-300">Program Manager / COR</span> — owns the requirement; shape it before the RFP.</li>
          <li><span className="text-slate-300">End user</span> — who actually uses what’s bought; reveals the real need.</li>
          <li><span className="text-slate-300">Technical lead / Engineer</span> — defines the specs you’ll be evaluated on.</li>
        </ul>
        <p className="text-[9px] text-slate-500 mt-1">SAM only names the people below (mostly contracting). For OSBP/program, call the agency’s small-business office and ask.</p>
      </div>

      {/* OSBP / Small-Business office first (separate source). Then a curated
          PREVIEW of contracting POCs + a search box to filter the full set —
          the proven pattern (old Relationships was search-first; SaaS shows a
          preview + search, not a 350-name wall). */}
      {(() => {
        const osbp = contacts.filter(c => c.role === 'OSBP' || c.role_category === 'small_business');
        const rest = contacts.filter(c => !(c.role === 'OSBP' || c.role_category === 'small_business'));
        const q = search.trim().toLowerCase();
        const filtered = q
          ? rest.filter(c => `${c.contact_fullname} ${c.contact_title || ''} ${c.contact_email || ''} ${c.derivedOffice || ''}`.toLowerCase().includes(q))
          : rest.slice(0, PREVIEW_COUNT);
        const renderContact = (c: TargetContact, accent = false) => {
          const office = c.derivedOffice || c.sub_tier;
          return (
            <div key={c.id} className="text-xs leading-tight">
              <div className="flex items-start justify-between gap-2">
                <span className={`font-medium ${accent ? 'text-amber-200' : 'text-slate-200'}`}>
                  {fmtName(c.contact_fullname)}
                  {accent && <span className="ml-1.5 text-[9px] uppercase tracking-wide text-amber-300/80">Small Business / OSBP</span>}
                </span>
                {/* One unified save action (#40) → pins this person under the agency. */}
                <SaveContactButton
                  email={email}
                  size="xs"
                  contact={{
                    full_name: fmtName(c.contact_fullname),
                    title: isJunkTitle(c.contact_title) ? null : c.contact_title,
                    email: c.contact_email || null,
                    phone: isJunkPhone(c.contact_phone) ? null : c.contact_phone,
                    organization: office || null,
                    agency,
                    source: accent ? 'osbp' : 'decision_makers',
                  }}
                />
              </div>
              {!isJunkTitle(c.contact_title) && <div className="text-[10px] text-slate-500">{c.contact_title}</div>}
              {office && <div className="text-[10px] text-slate-600">{office}</div>}
              {c.contact_email && <div className="text-[11px] text-purple-300/80 select-all break-all">{c.contact_email}</div>}
              {!isJunkPhone(c.contact_phone) && <div className="text-[11px] text-emerald-300/80 select-all">{c.contact_phone}</div>}
            </div>
          );
        };
        return (
          <>
            {osbp.length > 0 && (
              <div className="mb-2.5 rounded-md border border-amber-500/20 bg-amber-500/[0.05] p-2">
                <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300/90 mb-1"><Handshake className="h-3 w-3 shrink-0" strokeWidth={2} /> Small Business / OSBP — start here for set-asides</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">{osbp.map(c => renderContact(c, true))}</div>
              </div>
            )}
            {/* Search the agency's full contact set (find a specific person). */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[10px] text-slate-500">Contracting POCs on this agency’s solicitations:</p>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`🔍 Search ${rest.length}…`}
                className="w-36 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] text-white outline-none focus:border-purple-500"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">{filtered.map(c => renderContact(c))}</div>
            {!q && rest.length > PREVIEW_COUNT && (
              <p className="text-[10px] text-slate-500 mt-2">
                Showing {PREVIEW_COUNT} of {total > rest.length ? total : rest.length}. Search above to find anyone — or use <span className="text-purple-300">Decision Makers</span> to browse all agencies.
              </p>
            )}
            {q && filtered.length === 0 && <p className="text-[10px] text-slate-500 mt-1">No match for “{search}”.</p>}
          </>
        );
      })()}
    </div>
  );
}

// My Contacts (#40): the people the user has SAVED for this agency, from any
// surface (Decision Makers, task-order primes, OSBP, SBLOs). Reads the existing
// contact CRM (GET /api/app/relationships?mode=saved&agency=).
interface SavedContactRow {
  id: string;
  full_name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  source?: string | null;
}
function SavedContacts({ agency, email }: { agency: string; email: string }) {
  const [rows, setRows] = useState<SavedContactRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ email, mode: 'saved', agency });
    authedFetch(`/api/app/relationships?${p.toString()}`, email)
      .then(r => r.json())
      .then(d => setRows(((d?.contacts || d?.saved || d?.results || []) as SavedContactRow[])))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [agency, email]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300"><Star className="h-3 w-3 shrink-0" strokeWidth={2} /> Saved contacts at {agency}</span>
        <span className="text-[10px] text-slate-500">{rows.length} saved</span>
      </div>
      {loading ? (
        <div className="text-[11px] text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-slate-500">No saved contacts yet. On the <span className="text-purple-300">Directory</span> tab (or Decision Makers / task orders), hit <span className="text-purple-300">+ Save contact</span> to pin people here.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {rows.map(c => (
            <div key={c.id} className="text-xs leading-tight">
              <div className="text-slate-200 font-medium">{c.full_name}</div>
              {c.title && <div className="text-[10px] text-slate-500">{c.title}</div>}
              {c.organization && <div className="text-[10px] text-slate-600">{c.organization}</div>}
              {c.email && <div className="text-[11px] text-purple-300/80 select-all break-all">{c.email}</div>}
              {c.phone && <div className="text-[11px] text-emerald-300/80 select-all">{c.phone}</div>}
              {c.source && <div className="text-[9px] text-slate-600 uppercase tracking-wide">via {c.source.replace(/_/g, ' ')}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutreachLog({
  targetId,
  targetName,
  email,
}: {
  targetId: string;
  targetName: string;
  email: string;
}) {
  const [activities, setActivities] = useState<OutreachActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const { showToast } = useToast();
  const track = useAppTracker(email);

  // Form state — kept local so collapsing the row reset it cleanly.
  const [formType, setFormType] = useState<OutreachActivity['activity_type']>('email');
  const [formContact, setFormContact] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formOutcome, setFormOutcome] = useState('');
  const [formFollowUp, setFormFollowUp] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authedFetch(`/api/app/target-outreach?target_id=${encodeURIComponent(targetId)}&email=${encodeURIComponent(email)}`, email)
      .then(r => r.json())
      .then(data => {
        if (cancelled || !data?.success) return;
        setActivities(data.activities || []);
      })
      .catch(err => console.warn('[OutreachLog] load failed:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [targetId, email]);

  const resetForm = () => {
    setFormContact('');
    setFormRole('');
    setFormSubject('');
    setFormBody('');
    setFormOutcome('');
    setFormFollowUp('');
  };

  const submitActivity = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await authedFetch('/api/app/target-outreach', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_id: targetId,
          user_email: email,
          activity_type: formType,
          contact_name: formContact || null,
          contact_role: formRole || null,
          subject: formSubject || null,
          body: formBody || null,
          outcome: formOutcome || null,
          follow_up_date: formFollowUp || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        showToast({ message: data?.error || 'Could not log activity', variant: 'error' });
        return;
      }
      // Prepend the new activity to the timeline + close the form.
      setActivities(prev => [data.activity, ...prev]);
      resetForm();
      setShowForm(false);
      // Activation signal — logging outreach is a high-intent BD
      // action, exactly the kind of behavior the Launch Command
      // Center activation queues should see.
      track('tool_use', 'pipeline', {
        action: 'outreach_logged',
        opportunity_id: targetId,
      });
      showToast({ message: `Logged ${formType} for ${targetName}`, variant: 'success' });
    } catch (err) {
      console.error('[OutreachLog] submit failed:', err);
      showToast({ message: 'Network error — could not log activity', variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteActivity = async (id: string) => {
    const original = activities.find(a => a.id === id);
    if (!original) return;
    setActivities(prev => prev.filter(a => a.id !== id));
    try {
      const res = await authedFetch('/api/app/target-outreach', email, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, user_email: email }),
      });
      if (!res.ok) {
        setActivities(prev => [original, ...prev]);
        showToast({ message: 'Could not delete activity', variant: 'error' });
      }
    } catch (err) {
      console.error('[OutreachLog] delete failed:', err);
      setActivities(prev => [original, ...prev]);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-800">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Outreach Log
          {activities.length > 0 && (
            <span className="ml-2 text-slate-500 font-normal normal-case">
              ({activities.length} {activities.length === 1 ? 'entry' : 'entries'})
            </span>
          )}
        </h4>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
          >
            + Log Activity
          </button>
        )}
      </div>

      {/* The form — only renders when toggled on. Fields are
          all optional except activity_type. Submit clears + collapses. */}
      {showForm && (
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4 mb-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Type</span>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as OutreachActivity['activity_type'])}
                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
              >
                {ACTIVITY_TYPES.map(at => (
                  <option key={at.id} value={at.id}>{at.icon} {at.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Outcome</span>
              <select
                value={formOutcome}
                onChange={(e) => setFormOutcome(e.target.value)}
                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="">— None yet —</option>
                {OUTCOME_OPTIONS.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Contact Name</span>
              <input
                type="text"
                value={formContact}
                onChange={(e) => setFormContact(e.target.value)}
                placeholder="Lt Col Smith"
                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Contact Role</span>
              <input
                type="text"
                value={formRole}
                onChange={(e) => setFormRole(e.target.value)}
                placeholder="OSBP / Contracting Officer / SBA Liaison"
                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Subject</span>
              <input
                type="text"
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                placeholder="Intro email re: AFRL cybersecurity recompete"
                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Notes</span>
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={2}
                placeholder="Mentioned upcoming SBIR Phase II, asked about teaming requirements"
                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Follow-up Date</span>
              <input
                type="date"
                value={formFollowUp}
                onChange={(e) => setFormFollowUp(e.target.value)}
                className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={submitActivity}
              disabled={submitting}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-xs font-semibold"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); resetForm(); }}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <p className="text-xs text-slate-500 italic">Loading outreach...</p>
      ) : activities.length === 0 ? (
        <p className="text-xs text-slate-500 italic">
          No outreach logged yet. Use &quot;+ Log Activity&quot; to record your first touchpoint.
        </p>
      ) : (
        <ul className="space-y-2">
          {activities.map(a => {
            const typeMeta = ACTIVITY_TYPES.find(t => t.id === a.activity_type);
            const outcomeMeta = OUTCOME_OPTIONS.find(o => o.id === a.outcome);
            return (
              <li
                key={a.id}
                className="bg-slate-950/40 border border-slate-800 rounded-lg p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 text-xs">
                      <span>{typeMeta?.icon}</span>
                      <span className="font-semibold text-slate-200">{typeMeta?.label}</span>
                      {a.contact_name && (
                        <span className="text-slate-400">
                          · {a.contact_name}
                          {a.contact_role && <span className="text-slate-500"> ({a.contact_role})</span>}
                        </span>
                      )}
                      <span className="text-slate-600 ml-auto">{fmtRelative(a.created_at)}</span>
                    </div>
                    {a.subject && (
                      <p className="text-xs text-slate-300 font-medium">{a.subject}</p>
                    )}
                    {a.body && (
                      <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{a.body}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-[10px]">
                      {outcomeMeta && (
                        <span className={`font-semibold ${outcomeMeta.color}`}>
                          → {outcomeMeta.label}
                        </span>
                      )}
                      {a.follow_up_date && (
                        <span className="text-amber-300">
                          ⏰ Follow up {new Date(a.follow_up_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteActivity(a.id)}
                    className="text-[10px] text-slate-600 hover:text-red-400 transition-colors shrink-0"
                    title="Delete entry"
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
