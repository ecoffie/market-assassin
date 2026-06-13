'use client';

import { useEffect, useState } from 'react';
import type { AppPanel } from './UnifiedSidebar';
import { getMIApiHeaders } from './authHeaders';

const ACTIVE_KEY = 'mindy_active_workspace';

type ActiveClient = {
  businessName: string;
  workspaceId: string;
  profile?: { naicsCount: number; keywordCount: number; states?: string[] } | null;
};

export default function ClientWorkspaceBanner({
  email,
  onPanelChange,
}: {
  email: string | null;
  onPanelChange: (panel: AppPanel) => void;
}) {
  const [client, setClient] = useState<ActiveClient | null>(null);

  useEffect(() => {
    if (!email || typeof window === 'undefined') return;
    const ws = localStorage.getItem(ACTIVE_KEY);
    if (!ws) {
      setClient(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/app/coach?email=${encodeURIComponent(email)}`, {
          headers: getMIApiHeaders(email),
        });
        const d = await res.json();
        if (cancelled || !d.isCoach) return;
        const match = (d.clients || []).find((c: { workspaceId: string }) => c.workspaceId === ws);
        if (match) {
          setClient({
            businessName: match.businessName,
            workspaceId: match.workspaceId,
            profile: match.profile,
          });
        } else {
          setClient({ businessName: 'Client', workspaceId: ws });
        }
      } catch {
        if (!cancelled) setClient({ businessName: 'Client', workspaceId: ws });
      }
    })();

    return () => { cancelled = true; };
  }, [email]);

  if (!client) return null;

  const exit = () => {
    try { localStorage.removeItem(ACTIVE_KEY); } catch { /* */ }
    window.location.reload();
  };

  const prof = client.profile;
  const profLine = prof && (prof.naicsCount > 0 || prof.keywordCount > 0)
    ? `${prof.naicsCount} NAICS · ${prof.keywordCount} keywords${prof.states?.length ? ` · ${prof.states.join('/')}` : ''}`
    : 'No profile seeded yet — paste capability text when adding the client';

  return (
    <div className="border-b border-emerald-500/30 bg-emerald-950/40 px-4 md:px-6 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-emerald-400/80">Working as client</p>
          <p className="text-lg font-semibold text-white truncate">{client.businessName}</p>
          <p className="text-xs text-slate-400 truncate">{profLine}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500 mr-1 hidden sm:inline">Their workspace →</span>
          {([
            ['pipeline', 'Pipeline'],
            ['target-list', 'Target agencies'],
            ['research', 'Market research'],
          ] as const).map(([panel, label]) => (
            <button
              key={panel}
              type="button"
              onClick={() => onPanelChange(panel)}
              className="h-8 px-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPanelChange('coach')}
            className="h-8 px-3 rounded-lg border border-slate-700 text-xs text-slate-400 hover:text-white"
          >
            My Clients
          </button>
          <button
            type="button"
            onClick={exit}
            className="h-8 px-3 rounded-lg text-xs text-purple-400 hover:text-purple-300 underline"
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
