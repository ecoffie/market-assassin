'use client';

/**
 * PipelinePreviewFree — Treatment A ("data behind glass") for My Pursuits.
 *
 * A free user has tracked opportunities (user_pipeline rows). Enterprise SaaS
 * (HubSpot/Salesforce) never walls someone off from their OWN data — they show
 * it read-only and gate the ACTIONS. So instead of the old blank upgrade modal,
 * a free user clicking "My Pursuits" lands here: their tracked list, read-only,
 * with an "Upgrade to manage" bar. Managing stages, drafts, contacts, documents
 * is what Pro adds.
 *
 * Reads GET /api/pipeline (no tier gate on read) — the SAME rows the AlertsPanel
 * tracked-list teaser reads. No writes. All fields are real user_pipeline columns.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import LockedPreview from './LockedPreview';

interface Props {
  email: string;
  tier: AppTier;
}

type Pursuit = {
  id?: string;
  notice_id?: string;
  title?: string;
  agency?: string;
  stage?: string;
  response_deadline?: string;
  notice_type?: string | null;
  set_aside?: string | null;
  external_url?: string;
};

const STAGE_LABEL: Record<string, string> = {
  tracking: 'Tracking',
  pursuing: 'Pursuing',
  bidding: 'Bidding',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
  no_bid: 'No-bid',
};

function dueLabel(iso?: string): { text: string; tone: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { text: 'Closed', tone: 'text-faint' };
  if (days === 0) return { text: 'Due today', tone: 'text-red-400' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'text-red-400' };
  if (days <= 7) return { text: `Due in ${days} days`, tone: 'text-amber-400' };
  return { text: `Due in ${days} days`, tone: 'text-muted' };
}

export default function PipelinePreviewFree({ email }: Props) {
  const [pursuits, setPursuits] = useState<Pursuit[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!email) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/pipeline?email=${encodeURIComponent(email)}`, {
        headers: getMIApiHeaders(email),
      });
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json().catch(() => null);
      const rows: Pursuit[] = data?.opportunities || (Array.isArray(data) ? data : []);
      if (Array.isArray(rows)) setPursuits(rows);
    } catch { /* read-only preview — never block */ } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => { void load(); }, [load]);

  return (
    <LockedPreview
      featureId="pipeline"
      title="My Pursuits"
      subtitle="Everything you're tracking. Upgrade to Pro to move stages, draft responses, and pull contacts + documents."
      ctaLabel="Upgrade to manage"
    >
      {loading ? (
        <div className="text-sm text-faint">Loading your tracked opportunities…</div>
      ) : pursuits.length === 0 ? (
        <div className="rounded-xl border border-surface bg-ground/60 p-6 text-center">
          <p className="text-sm text-ink-soft">You haven&rsquo;t tracked anything yet.</p>
          <p className="mt-1 text-xs text-faint">
            Click <span className="text-emerald-300">Track</span> on any opportunity in your Source Feed or Market Dashboard — it&rsquo;ll show up here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-surface bg-ground/60 overflow-hidden">
          <div className="border-b border-surface px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-faint">
            {pursuits.length} tracked
          </div>
          <ul className="divide-y divide-slate-800">
            {pursuits.map((p, i) => {
              const due = dueLabel(p.response_deadline);
              const badge = p.notice_type || p.set_aside || null;
              return (
                <li key={p.id || p.notice_id || i} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-200">{p.title || p.notice_id || 'Tracked opportunity'}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        {p.agency && <span className="truncate text-faint">{p.agency}</span>}
                        {p.stage && (
                          <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-ink-soft">
                            {STAGE_LABEL[p.stage] || p.stage}
                          </span>
                        )}
                        {badge && (
                          <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[11px] text-purple-300">{badge}</span>
                        )}
                        {due && <span className={`${due.tone} font-medium`}>{due.text}</span>}
                      </div>
                    </div>
                    {p.external_url && (
                      <a
                        href={p.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-xs text-purple-400 hover:text-purple-300"
                      >
                        SAM.gov →
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </LockedPreview>
  );
}
