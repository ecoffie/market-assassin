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
import type { AppTier } from '../UnifiedSidebar';
import { useToast } from '../Toast';
import { useAppTracker } from '../track';

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
  added_at: string;
  updated_at: string;
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
}: {
  email: string | null;
  tier: AppTier;
}) {
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TargetRow['status'] | 'all'>('all');
  const { showToast } = useToast();
  const track = useAppTracker(email);

  const loadTargets = useCallback(async () => {
    if (!email) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/app/target-list?email=${encodeURIComponent(email)}`);
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

  // PATCH a single target field. Optimistic update with rollback.
  const updateTarget = useCallback(async (id: string, changes: Partial<TargetRow>) => {
    if (!email) return;
    const original = targets.find(t => t.id === id);
    if (!original) return;

    setTargets(prev => prev.map(t => t.id === id ? { ...t, ...changes } : t));

    try {
      const res = await fetch('/api/app/target-list', {
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

  const removeTarget = useCallback(async (id: string) => {
    if (!email) return;
    const original = targets.find(t => t.id === id);
    if (!original) return;

    // Optimistic drop
    setTargets(prev => prev.filter(t => t.id !== id));

    try {
      const res = await fetch('/api/app/target-list', {
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
              const restore = await fetch('/api/app/target-list', {
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
      <div className="p-6">
        <p className="text-sm text-slate-400">Loading your target list...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">My Target List</h1>
        <p className="text-sm text-slate-400 mt-1">
          Offices you saved from Market Research. Use this to plan multi-month BD outreach.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {isFree && targets.length === 0 && (
        <div className="bg-gradient-to-br from-purple-900/40 to-purple-800/20 border border-purple-500/40 rounded-lg p-5">
          <h3 className="text-lg font-bold text-white mb-2">🎯 Target lists are a Mindy Pro feature</h3>
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
        <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-8 text-center">
          <p className="text-slate-200 mb-2">Your target list is empty.</p>
          <p className="text-xs text-slate-500">
            Go to <span className="text-emerald-400">Market Research</span> → click any agency row
            → <span className="text-purple-300">+ Add</span> in the drawer.
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
                        <h3 className="text-base font-semibold text-white truncate">{t.office_name}</h3>
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
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {Math.round((t.sat_ratio || 0) * 100)}% SAT
                        </span>
                        {t.pain_point_count > 0 && (
                          <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300">
                            {t.pain_point_count} pain pts
                          </span>
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
                      </div>

                      {/* Notes — inline editable */}
                      <div className="mt-3">
                        <NotesEditor
                          value={t.notes || ''}
                          onSave={(value) => updateTarget(t.id, { notes: value || null })}
                        />
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
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Slice 3D placeholder. Outreach log per target lives here. */}
      {targets.length > 0 && (
        <p className="text-[10px] text-slate-600 italic text-center pt-4">
          Outreach log (email/call/event tracking per target) coming in a future release.
        </p>
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
