'use client';
import { useState, useEffect, useCallback } from 'react';
import { getMIApiHeaders } from '../authHeaders';

/**
 * Coach Mode / Org Tab (PRD-coach-mode-apex). For a coach (APEX counselor) OR a
 * solo consultant managing multiple entities: list your client businesses,
 * switch the active one (sets x-active-workspace so the whole app operates as
 * that client), and see the cross-client "Org Tab" — deadlines, amendment
 * alerts, and org news across all your clients.
 */
interface Client { id: string; workspaceId: string; businessName: string; primaryEmail?: string }
interface OrgTab {
  deadlines: Array<{ id: string; title: string; response_deadline: string; client: string; stage: string }>;
  changes: Array<{ pursuit_id: string; summary: string; change_type: string }>;
  news: Array<{ id: string; title: string; body?: string; pinned?: boolean; created_at: string }>;
}

const ACTIVE_KEY = 'mindy_active_workspace';

export default function CoachPanel({ email }: { email: string | null }) {
  const [loading, setLoading] = useState(true);
  const [isCoach, setIsCoach] = useState(false);
  const [org, setOrg] = useState<{ name: string; tabLabel: string } | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [orgTab, setOrgTab] = useState<OrgTab>({ deadlines: [], changes: [], news: [] });
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [capabilityText, setCapabilityText] = useState('');   // paste capability/website → seed profile
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
    // The app reads x-active-workspace from this on its next requests; a reload
    // guarantees every panel picks up the active client.
    window.location.reload();
  };
  const clearActive = () => {
    try { localStorage.removeItem(ACTIVE_KEY); } catch { /* */ }
    setActiveWs(''); window.location.reload();
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
        // Tell the user what Mindy extracted, so they trust the seeded profile.
        if (d?.seeded) {
          const s = d.seeded;
          const parts = [
            s.naics?.length ? `${s.naics.length} NAICS` : '',
            s.keywords?.length ? `${s.keywords.length} keywords` : '',
            s.states?.length ? s.states.join('/') : '',
          ].filter(Boolean);
          setSeededNote(parts.length ? `✓ Seeded ${name}'s profile from the text — ${parts.join(' · ')}. Alerts will start flowing.` : `Added ${name}.`);
        }
        setNewName(''); setCapabilityText('');
        await load();
      }
    } catch { /* */ }
    setAdding(false);
  };

  if (loading) return <div className="p-6 text-slate-400 text-sm">Loading…</div>;

  if (!isCoach) {
    // Solo-consultant entry point: not yet a coach → offer to turn it on.
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-2xl font-bold text-white">Manage Multiple Clients</h1>
        <p className="text-slate-400 mt-2">
          Consultant or counselor managing several businesses? Turn on multi-client mode to set up a separate Mindy profile (pipeline, vault, proposals) for each entity you manage — and switch between them in one click.
        </p>
        <div className="mt-5 rounded-xl border border-purple-500/30 bg-purple-950/20 p-5">
          <p className="text-sm text-slate-300 mb-3">Add your first client to get started:</p>
          <div className="flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Client business name" className="flex-1 h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-purple-500 focus:outline-none" />
            <button onClick={addClient} disabled={adding || !newName.trim()} className="h-10 px-5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg">
              {adding ? 'Adding…' : 'Add client'}
            </button>
          </div>
          {/* Paste capability statement / website (Eric: "paste their info →
              extract keywords + NAICS/PSC + location → so I track them + get
              their alerts"). Optional — but seeds the profile so alerts flow
              from day one instead of an empty workspace. */}
          <textarea
            value={capabilityText}
            onChange={e => setCapabilityText(e.target.value)}
            placeholder="Optional — paste their capability statement or website text. Mindy extracts the NAICS/PSC, keywords, and location so this client's alerts start immediately. (e.g. 'Professional staffing in or around Puerto Rico…')"
            rows={3}
            className="w-full mt-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none resize-y"
          />
          {seededNote && <p className="text-[12px] text-emerald-300 mt-2">{seededNote}</p>}
          <p className="text-[11px] text-slate-500 mt-2">Each client gets its own isolated workspace. You can switch anytime.</p>
        </div>
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
      <p className="text-slate-400 text-sm mb-5">
        {activeClient ? <>Working as <b className="text-emerald-400">{activeClient.businessName}</b> · <button onClick={clearActive} className="text-purple-400 hover:text-purple-300 underline">exit to your own account</button></> : 'Pick a client to work as them, or review everything across your clients below.'}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        {/* Clients list + switcher */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Your clients ({clients.length})</h3>
          </div>
          <div className="space-y-1.5 mb-3">
            {clients.map(c => (
              <button key={c.id} onClick={() => switchTo(c)} className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${activeWs === c.workspaceId ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}>
                <div className="text-sm font-medium text-white">{c.businessName}</div>
                {activeWs === c.workspaceId && <div className="text-[11px] text-emerald-400 mt-0.5">● Active</div>}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Add a client…" className="flex-1 h-9 px-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs focus:border-purple-500 focus:outline-none" />
            <button onClick={addClient} disabled={adding || !newName.trim()} className="h-9 px-3 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-xs font-medium rounded-lg">+ Add</button>
          </div>
          {/* Paste capability text → seed the new client's NAICS/keywords/location (#63). */}
          <textarea
            value={capabilityText}
            onChange={e => setCapabilityText(e.target.value)}
            placeholder="Optional: paste their capability statement / website text — Mindy seeds the NAICS, keywords + location so their alerts start immediately."
            rows={2}
            className="w-full mt-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs placeholder-slate-500 focus:border-purple-500 focus:outline-none resize-y"
          />
          {seededNote && <p className="text-[11px] text-emerald-300 mt-1">{seededNote}</p>}
        </div>

        {/* Org Tab feed */}
        <div className="space-y-5">
          {/* Deadlines */}
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

          {/* Amendment alerts */}
          {orgTab.changes.length > 0 && (
            <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <h3 className="text-sm font-semibold text-amber-300 mb-3">⚠️ Recent changes on your clients&apos; pursuits</h3>
              <div className="space-y-1">
                {orgTab.changes.slice(0, 10).map((c, i) => <div key={i} className="text-sm text-amber-200/90">• {c.summary}</div>)}
              </div>
            </section>
          )}

          {/* Org news */}
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
