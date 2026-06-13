'use client';
import { useState, useEffect, useCallback } from 'react';
import type { AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

/**
 * Coach Mode / Org Tab (PRD-coach-mode-apex). For a coach (APEX counselor) OR a
 * solo consultant managing multiple entities: list your client businesses,
 * switch the active one (sets x-active-workspace so the whole app operates as
 * that client), and see the cross-client "Org Tab" — deadlines, amendment
 * alerts, and org news across all your clients.
 */
interface ClientProfile {
  naics: string[];
  keywords: string[];
  states: string[];
  naicsCount: number;
  keywordCount: number;
  industry?: string | null;
}
interface Client {
  id: string;
  workspaceId: string;
  businessName: string;
  primaryEmail?: string;
  profile?: ClientProfile | null;
  stats?: { pipeline: number; targets: number };
}
interface OrgTab {
  deadlines: Array<{ id: string; title: string; response_deadline: string; client: string; stage: string }>;
  changes: Array<{ pursuit_id: string; summary: string; change_type: string }>;
  news: Array<{ id: string; title: string; body?: string; pinned?: boolean; created_at: string }>;
}

const ACTIVE_KEY = 'mindy_active_workspace';

const WORK_PANELS: Array<{ panel: AppPanel; label: string }> = [
  { panel: 'pipeline', label: 'Pipeline' },
  { panel: 'target-list', label: 'Target agencies' },
  { panel: 'research', label: 'Market research' },
];

export default function CoachPanel({
  email,
  onPanelChange,
}: {
  email: string | null;
  onPanelChange?: (panel: AppPanel) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [isCoach, setIsCoach] = useState(false);
  const [org, setOrg] = useState<{ name: string; tabLabel: string } | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [orgTab, setOrgTab] = useState<OrgTab>({ deadlines: [], changes: [], news: [] });
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [capabilityText, setCapabilityText] = useState('');
  const [seededNote, setSeededNote] = useState<string | null>(null);
  const [activeWs, setActiveWs] = useState<string>('');
  const headers = useCallback(() => getMIApiHeaders(email), [email]);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/app/coach?email=${encodeURIComponent(email)}`, { headers: headers() });
      const d = await res.json();
      setIsCoach(!!d.isCoach);
      if (d.isCoach) {
        setOrg(d.org || null);
        setClients(d.clients || []);
        setOrgTab(d.orgTab || { deadlines: [], changes: [], news: [] });
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [email, headers]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { setActiveWs(localStorage.getItem(ACTIVE_KEY) || ''); } catch { /* */ } }, []);

  const switchTo = (c: Client) => {
    try { localStorage.setItem(ACTIVE_KEY, c.workspaceId); } catch { /* */ }
    setActiveWs(c.workspaceId);
    window.location.reload();
  };

  const clearActive = () => {
    try { localStorage.removeItem(ACTIVE_KEY); } catch { /* */ }
    setActiveWs('');
    window.location.reload();
  };

  const goWork = (panel: AppPanel, c: Client) => {
    try { localStorage.setItem(ACTIVE_KEY, c.workspaceId); } catch { /* */ }
    if (onPanelChange) {
      onPanelChange(panel);
      return;
    }
    window.location.href = `/app?panel=${panel}`;
  };

  const addClient = async () => {
    const name = newName.trim();
    if (!name || !email) return;
    setAdding(true);
    setSeededNote(null);
    try {
      const res = await fetch('/api/app/coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ email, action: 'add_client', business_name: name, capability_text: capabilityText.trim() || undefined }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        if (d?.seeded) {
          const s = d.seeded;
          const parts = [
            s.naics?.length ? `${s.naics.length} NAICS` : '',
            s.keywords?.length ? `${s.keywords.length} keywords` : '',
            s.agencies ? `${s.agencies} target agencies` : '',
            s.states?.length ? s.states.join('/') : '',
          ].filter(Boolean);
          setSeededNote(parts.length ? `✓ Seeded ${name} — ${parts.join(' · ')}. Click the client, then open Pipeline or Target agencies.` : `Added ${name}. Click them to start working as this client.`);
        } else {
          setSeededNote(`Added ${name}. Click them below, then open Pipeline or Target agencies to start tracking.`);
        }
        setNewName('');
        setCapabilityText('');
        await load();
        // Auto-switch to the new client so the banner + panels open in their workspace.
        const wsId = d?.client?.workspaceId;
        if (wsId) {
          try { localStorage.setItem(ACTIVE_KEY, wsId); } catch { /* */ }
          window.location.reload();
        }
      }
    } catch { /* */ }
    setAdding(false);
  };

  const profileSummary = (c: Client) => {
    const p = c.profile;
    if (!p || (p.naicsCount === 0 && p.keywordCount === 0)) {
      return <span className="text-[11px] text-amber-400/90">No profile yet — re-add with capability text or work as them and set up in Market Research</span>;
    }
    return (
      <span className="text-[11px] text-slate-400">
        {p.naicsCount} NAICS · {p.keywordCount} keywords
        {p.states?.length ? ` · ${p.states.join('/')}` : ''}
        {' · '}{c.stats?.targets ?? 0} agencies · {c.stats?.pipeline ?? 0} pursuits
      </span>
    );
  };

  const addClientForm = (compact?: boolean) => (
    <div className={compact ? '' : 'mt-5 rounded-xl border border-purple-500/30 bg-purple-950/20 p-5'}>
      {!compact && (
        <p className="text-sm text-slate-300 mb-3">Add your first client to get started:</p>
      )}
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Client business name"
          className={`flex-1 ${compact ? 'h-9 text-xs' : 'h-10 text-sm'} px-3 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-purple-500 focus:outline-none`}
        />
        <button
          onClick={addClient}
          disabled={adding || !newName.trim()}
          className={`${compact ? 'h-9 px-3 text-xs' : 'h-10 px-5 text-sm'} bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white font-medium rounded-lg`}
        >
          {adding ? 'Adding…' : compact ? '+ Add' : 'Add client'}
        </button>
      </div>
      <textarea
        value={capabilityText}
        onChange={e => setCapabilityText(e.target.value)}
        placeholder="Optional: paste their capability statement / website text — Mindy seeds the NAICS, keywords + location so their alerts start immediately."
        rows={compact ? 2 : 3}
        className={`w-full mt-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white ${compact ? 'text-xs' : 'text-sm'} placeholder-slate-500 focus:border-purple-500 focus:outline-none resize-y`}
      />
      {seededNote && <p className="text-[12px] text-emerald-300 mt-2">{seededNote}</p>}
      {!compact && (
        <p className="text-[11px] text-slate-500 mt-2">
          <b className="text-slate-400">How it works:</b> click a client → the whole app switches to their pipeline, agencies, and research. Use the green banner at the top to jump to their workspace.
        </p>
      )}
    </div>
  );

  if (loading) return <div className="p-6 text-slate-400 text-sm">Loading…</div>;

  if (!isCoach) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Manage Multiple Clients</h1>
        <p className="text-slate-400 mt-2">
          Consultant or counselor managing several businesses? Each client gets their own Mindy profile — pipeline, target agencies, market research — and you switch between them in one click.
        </p>
        {addClientForm()}
      </div>
    );
  }

  const activeClient = clients.find(c => c.workspaceId === activeWs);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-white">{org?.tabLabel || 'My Clients'}</h1>
        {org && <span className="text-sm text-slate-500">{org.name}</span>}
      </div>

      {!activeClient ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-5 text-sm text-amber-100">
          <b>Step 1:</b> Click a client below to work as them. <b>Step 2:</b> Open <b>Pipeline</b> or <b>Target agencies</b> from the green banner — that is their profile in action.
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 mb-5">
          <p className="text-sm text-emerald-100">
            Working as <b className="text-emerald-300">{activeClient.businessName}</b>
            {' · '}
            <button type="button" onClick={clearActive} className="text-purple-400 hover:text-purple-300 underline">exit to your account</button>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {WORK_PANELS.map(({ panel, label }) => (
              <button
                key={panel}
                type="button"
                onClick={() => goWork(panel, activeClient)}
                className="h-8 px-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
              >
                Open {label}
              </button>
            ))}
          </div>
          <div className="mt-2">{profileSummary(activeClient)}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Your clients ({clients.length})
          </h3>
          <div className="space-y-1.5 mb-3">
            {clients.map(c => (
              <div
                key={c.id}
                className={`rounded-lg border px-3 py-2.5 transition-colors ${activeWs === c.workspaceId ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-800 bg-slate-900'}`}
              >
                <button type="button" onClick={() => switchTo(c)} className="w-full text-left">
                  <div className="text-sm font-medium text-white">{c.businessName}</div>
                  <div className="mt-0.5">{profileSummary(c)}</div>
                  {activeWs === c.workspaceId ? (
                    <div className="text-[11px] text-emerald-400 mt-1">● Active — use Pipeline / Target agencies in sidebar</div>
                  ) : (
                    <div className="text-[11px] text-purple-400 mt-1">Click to work as this client</div>
                  )}
                </button>
              </div>
            ))}
          </div>
          {addClientForm(true)}
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">⏰ Upcoming deadlines — all clients</h3>
            {orgTab.deadlines.length === 0 ? <p className="text-xs text-slate-500">No deadlines in the next 30 days.</p> : (
              <div className="space-y-1.5">
                {orgTab.deadlines.slice(0, 12).map(d => {
                  const days = Math.ceil((new Date(d.response_deadline).getTime() - Date.now()) / 86400000);
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-slate-300 truncate"><b className="text-slate-400">{d.client}</b> · {d.title}</span>
                      <span className={`shrink-0 text-xs font-medium ${days <= 3 ? 'text-red-400' : days <= 7 ? 'text-amber-400' : 'text-slate-500'}`}>{days <= 0 ? 'due' : `${days}d`}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {orgTab.changes.length > 0 && (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <h3 className="text-sm font-semibold text-amber-300 mb-3">⚠️ Recent changes on your clients&apos; pursuits</h3>
              <div className="space-y-1">
                {orgTab.changes.slice(0, 10).map((c, i) => <div key={i} className="text-sm text-amber-200/90">• {c.summary}</div>)}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h3 className="text-sm font-semibold text-white mb-3">📣 {org?.name || 'Org'} news</h3>
            {orgTab.news.length === 0 ? <p className="text-xs text-slate-500">No announcements.</p> : (
              <div className="space-y-2">
                {orgTab.news.map(n => (
                  <div key={n.id} className="text-sm">
                    <div className="text-slate-200 font-medium">{n.pinned ? '📌 ' : ''}{n.title}</div>
                    {n.body && <div className="text-slate-400 text-xs mt-0.5">{n.body}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
