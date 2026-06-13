'use client';
import { useState, useEffect, useCallback } from 'react';
import type { AppPanel } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

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

const WORK_PANELS: Array<{ panel: AppPanel; label: string; desc: string }> = [
  { panel: 'target-list', label: 'Target agencies', desc: 'Who they should pursue' },
  { panel: 'pipeline', label: 'Pipeline', desc: 'Opps they are tracking' },
  { panel: 'research', label: 'Market research', desc: 'Find new opportunities' },
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
  const [coachAccess, setCoachAccess] = useState<{
    allowed: boolean;
    reason?: string;
    upgradeRequired?: string | null;
  } | null>(null);
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
      setCoachAccess(d.coachAccess || null);
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

  const goApp = (panel?: AppPanel) => {
    window.location.href = panel && panel !== 'dashboard' ? `/app?panel=${panel}` : '/app';
  };

  const switchTo = (c: Client, thenPanel?: AppPanel) => {
    try { localStorage.setItem(ACTIVE_KEY, c.workspaceId); } catch { /* */ }
    if (thenPanel) {
      goApp(thenPanel);
      return;
    }
    goApp();
  };

  const clearActive = () => {
    try { localStorage.removeItem(ACTIVE_KEY); } catch { /* */ }
    goApp();
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
        const wsId = d?.client?.workspaceId;
        if (wsId) {
          try { localStorage.setItem(ACTIVE_KEY, wsId); } catch { /* */ }
          window.location.href = '/app';
        }
      }
    } catch { /* */ }
    setAdding(false);
  };

  const profileStats = (c: Client) => {
    const p = c.profile;
    const targets = c.stats?.targets ?? 0;
    const pipeline = c.stats?.pipeline ?? 0;
    if (!p || (p.naicsCount === 0 && p.keywordCount === 0)) {
      return { empty: true, line: 'No market profile — paste capability text when adding' };
    }
    return {
      empty: false,
      line: `${p.naicsCount} NAICS · ${p.keywordCount} keywords · ${targets} agencies · ${pipeline} pursuits`,
      keywords: p.keywords?.slice(0, 6) || [],
      states: p.states || [],
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-slate-400 text-sm">
        Loading clients…
      </div>
    );
  }

  if (!isCoach) {
    if (coachAccess && !coachAccess.allowed) {
      return (
        <div className="mx-auto max-w-2xl p-6 md:p-8">
          <h1 className="text-2xl font-bold text-white">My Clients</h1>
          <p className="mt-2 text-slate-400 text-sm leading-relaxed">
            Manage multiple client businesses — each with its own pipeline, target agencies, and market research.
            This capability is included with <span className="text-blue-300 font-medium">Mindy Teams</span> ($499/mo).
          </p>
          <div className="mt-6 rounded-xl border border-blue-500/30 bg-blue-950/30 p-5">
            <p className="text-sm text-slate-300">
              Solopreneur covers one business. If you consult for multiple clients, upgrade to Teams for up to 10 client workspaces per seat.
            </p>
            <a
              href="/market-intelligence#teams"
              className="mt-4 inline-flex h-10 items-center rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Upgrade to Teams →
            </a>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-2xl p-6 md:p-8">
        <h1 className="text-2xl font-bold text-white">Manage multiple clients</h1>
        <p className="mt-2 text-slate-400 text-sm leading-relaxed">
          Each client gets their own pipeline, target agencies, and market research.
          Add one below to get started.
        </p>
        <AddClientCard
          newName={newName} setNewName={setNewName}
          capabilityText={capabilityText} setCapabilityText={setCapabilityText}
          adding={adding} onAdd={addClient} seededNote={seededNote}
        />
      </div>
    );
  }

  const activeClient = clients.find(c => c.workspaceId === activeWs);

  return (
    <div className="mx-auto max-w-5xl p-6 md:p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white">{org?.tabLabel || 'My Clients'}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {activeClient
            ? <>You are managing <span className="text-emerald-300 font-medium">{activeClient.businessName}</span>. Use the tabs below or the sidebar — everything scopes to them.</>
            : 'Select a client to open their workspace. Pipeline, target agencies, and research all switch to that business.'}
        </p>
      </header>

      <div className="space-y-4">
        {clients.map(c => {
          const isActive = activeWs === c.workspaceId;
          const stats = profileStats(c);
          return (
            <article
              key={c.id}
              className={`rounded-xl border p-5 transition-colors ${
                isActive
                  ? 'border-emerald-500/50 bg-emerald-500/5 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]'
                  : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
              }`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-white truncate">{c.businessName}</h2>
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                        Active
                      </span>
                    )}
                  </div>
                  <p className={`mt-1 text-sm ${stats.empty ? 'text-amber-400/90' : 'text-slate-400'}`}>
                    {stats.line}
                  </p>
                  {!stats.empty && stats.keywords && stats.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {stats.keywords.map(kw => (
                        <span key={kw} className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {!isActive ? (
                    <button
                      type="button"
                      onClick={() => switchTo(c)}
                      className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white"
                    >
                      Work as {c.businessName.split(' ')[0]}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={clearActive}
                      className="h-9 px-4 rounded-lg border border-slate-700 text-sm text-slate-400 hover:text-white"
                    >
                      Exit to my account
                    </button>
                  )}
                </div>
              </div>

              {isActive && (
                <div className="mt-4 pt-4 border-t border-slate-800/80">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">
                    Their workspace
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {WORK_PANELS.map(({ panel, label, desc }) => (
                      <button
                        key={panel}
                        type="button"
                        onClick={() => switchTo(c, panel)}
                        className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 text-left hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors"
                      >
                        <div className="text-sm font-medium text-white">{label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-8">
        <AddClientCard
          newName={newName} setNewName={setNewName}
          capabilityText={capabilityText} setCapabilityText={setCapabilityText}
          adding={adding} onAdd={addClient} seededNote={seededNote}
          compactTitle="Add another client"
        />
      </div>

      {(orgTab.deadlines.length > 0 || orgTab.changes.length > 0 || orgTab.news.length > 0) && (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {orgTab.deadlines.length > 0 && (
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Upcoming deadlines</h3>
              <div className="space-y-2">
                {orgTab.deadlines.slice(0, 8).map(d => {
                  const days = Math.ceil((new Date(d.response_deadline).getTime() - Date.now()) / 86400000);
                  return (
                    <div key={d.id} className="flex justify-between gap-2 text-sm">
                      <span className="text-slate-300 truncate"><span className="text-slate-500">{d.client}</span> · {d.title}</span>
                      <span className={`shrink-0 text-xs font-medium ${days <= 3 ? 'text-red-400' : days <= 7 ? 'text-amber-400' : 'text-slate-500'}`}>
                        {days <= 0 ? 'due' : `${days}d`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {orgTab.news.length > 0 && (
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <h3 className="text-sm font-semibold text-white mb-3">{org?.name || 'Org'} news</h3>
              <div className="space-y-2">
                {orgTab.news.map(n => (
                  <div key={n.id} className="text-sm text-slate-300">{n.pinned ? '📌 ' : ''}{n.title}</div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function AddClientCard({
  newName, setNewName, capabilityText, setCapabilityText, adding, onAdd, seededNote, compactTitle,
}: {
  newName: string;
  setNewName: (v: string) => void;
  capabilityText: string;
  setCapabilityText: (v: string) => void;
  adding: boolean;
  onAdd: () => void;
  seededNote: string | null;
  compactTitle?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h3 className="text-sm font-semibold text-white">{compactTitle || 'Add a client'}</h3>
      <p className="mt-1 text-xs text-slate-500 mb-4">
        Paste their capability statement to auto-extract NAICS, keywords, and target agencies.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Business name"
          className="h-10 flex-1 px-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-purple-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={adding || !newName.trim()}
          className="h-10 px-5 shrink-0 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg"
        >
          {adding ? 'Adding…' : 'Add client'}
        </button>
      </div>
      <textarea
        value={capabilityText}
        onChange={e => setCapabilityText(e.target.value)}
        placeholder="Capability statement or website text (optional but recommended)"
        rows={3}
        className="w-full mt-3 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none resize-none"
      />
      {seededNote && <p className="text-xs text-emerald-300 mt-2">{seededNote}</p>}
    </div>
  );
}
