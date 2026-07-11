'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Pin, CheckCircle2, Circle, Download, FileText } from 'lucide-react';
import type { AppPanel } from '../UnifiedSidebar';
import { authedFetch } from '../authHeaders';
import { setActiveWorkspace, clearActiveWorkspace, getActiveWorkspace } from '../activeWorkspace';

// The current calendar quarter as "YYYY-Qn" — the default for the funder-report export.
function defaultQuarter(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}
// Which milestone keys the counselor can toggle by hand (the 3 manual ones). Auto
// milestones (first_bid/first_award) are derived from pipeline and shown read-only.
const MANUAL_MILESTONE_KEYS = new Set(['sam_registration', 'certification', 'capability_statement']);

interface ClientProfile {
  naics: string[];
  keywords: string[];
  states: string[];
  naicsCount: number;
  keywordCount: number;
  industry?: string | null;
}
interface Milestone {
  key: string;
  label: string;
  achieved: boolean;
  achievedAt: string | null;
  source: 'auto' | 'manual';
  markedBy?: string | null;
}
interface Client {
  id: string;
  workspaceId: string;
  businessName: string;
  primaryEmail?: string;
  profile?: ClientProfile | null;
  stats?: { pipeline: number; targets: number };
  milestones?: Milestone[];
}
interface OrgTab {
  deadlines: Array<{ id: string; title: string; response_deadline: string; client: string; stage: string }>;
  changes: Array<{ pursuit_id: string; summary: string; change_type: string }>;
  news: Array<{ id: string; title: string; body?: string; pinned?: boolean; created_at: string }>;
}

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
  const [role, setRole] = useState<string>('');
  const [reportQuarter, setReportQuarter] = useState<string>(defaultQuarter());
  const [clients, setClients] = useState<Client[]>([]);
  const [orgTab, setOrgTab] = useState<OrgTab>({ deadlines: [], changes: [], news: [] });
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [capabilityText, setCapabilityText] = useState('');
  const [seededNote, setSeededNote] = useState<string | null>(null);
  const [activeWs, setActiveWs] = useState<string>('');
  // Search + pagination (scale)
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number } | null>(null);
  const [listLoading, setListLoading] = useState(false);  // inline spinner (not full-page)
  const didMountRef = useRef(false);
  // Bulk import
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<{ added: number; duplicates: number; failed: number; rejectedForCap: number } | null>(null);

  // `quiet` = a search/pagination refresh: refetch the list WITHOUT flipping the
  // full-page loading state (which blanks the whole panel to "Loading clients…").
  // Only the first mount uses the full-page loader. Search/page updates just show a
  // small inline spinner so the list doesn't flash away on every keystroke.
  // Load a large page so a typical org's whole roster is in memory → search filters
  // INSTANTLY client-side (no per-keystroke round-trip). Server search/pagination is
  // the safety net for orgs bigger than this.
  const PAGE_SIZE = 200;
  const load = useCallback(async (opts?: { search?: string; page?: number; quiet?: boolean }) => {
    if (!email) return;
    if (opts?.quiet) setListLoading(true); else setLoading(true);
    const s = opts?.search ?? '';
    const p = opts?.page ?? 0;
    try {
      const params = new URLSearchParams({ email, page: String(p), pageSize: String(PAGE_SIZE) });
      if (s.trim()) params.set('search', s.trim());
      const res = await authedFetch(`/api/app/coach?${params.toString()}`, email);
      const d = await res.json();
      setCoachAccess(d.coachAccess || null);
      setIsCoach(!!d.isCoach);
      if (d.isCoach) {
        setOrg(d.org || null);
        setRole(d.role || '');
        setClients(d.clients || []);
        setOrgTab(d.orgTab || { deadlines: [], changes: [], news: [] });
        setPagination(d.pagination ? { total: d.pagination.total, totalPages: d.pagination.totalPages } : null);
      }
    } catch { /* ignore */ }
    if (opts?.quiet) setListLoading(false); else setLoading(false);
  }, [email]);

  // Initial load — full-page loader, once.
  useEffect(() => { load({ page: 0 }); }, [load]);
  useEffect(() => { setActiveWs(getActiveWorkspace() || ''); }, []);

  // Search behavior:
  //  - When the whole roster is loaded (total <= PAGE_SIZE), filtering is CLIENT-SIDE
  //    and instant (see visibleClients below) — no server call, no lag.
  //  - Only when the org is bigger than one page do we debounce a SERVER search.
  const serverSearchNeeded = !!pagination && pagination.total > PAGE_SIZE;
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    if (!serverSearchNeeded) return;  // small org → instant client-side filter, skip server
    const t = setTimeout(() => {
      setPage(0);
      load({ search, page: 0, quiet: true });
    }, 250);
    return () => clearTimeout(t);
  }, [search, load, serverSearchNeeded]);

  const goApp = (panel?: AppPanel) => {
    window.location.href = panel && panel !== 'dashboard' ? `/app?panel=${panel}` : '/app';
  };

  const switchTo = (c: Client, thenPanel?: AppPanel) => {
    setActiveWorkspace(c.workspaceId, email, c.businessName);
    if (thenPanel) {
      goApp(thenPanel);
      return;
    }
    goApp();
  };

  const clearActive = () => {
    clearActiveWorkspace();
    goApp();
  };

  // Toggle a MANUAL milestone (SAM / cert / cap statement). Optimistic UI, then persist.
  const [savingMilestone, setSavingMilestone] = useState<string>('');
  const toggleMilestone = async (c: Client, m: Milestone) => {
    if (!email || !MANUAL_MILESTONE_KEYS.has(m.key)) return;
    const next = !m.achieved;
    const tag = `${c.id}:${m.key}`;
    setSavingMilestone(tag);
    // Optimistic update.
    setClients(prev => prev.map(cl => cl.id !== c.id ? cl : {
      ...cl,
      milestones: (cl.milestones || []).map(ms => ms.key !== m.key ? ms : {
        ...ms, achieved: next, achievedAt: next ? new Date().toISOString() : null, markedBy: email,
      }),
    }));
    try {
      const res = await authedFetch('/api/app/coach', email, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action: 'set_milestone', org_client_id: c.id, milestone_key: m.key, achieved: next }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch {
      // Revert on failure.
      setClients(prev => prev.map(cl => cl.id !== c.id ? cl : {
        ...cl,
        milestones: (cl.milestones || []).map(ms => ms.key !== m.key ? ms : { ...ms, achieved: m.achieved, achievedAt: m.achievedAt }),
      }));
    }
    setSavingMilestone('');
  };

  // Download the quarterly funder report (org_admin only) as CSV.
  const [reportBusy, setReportBusy] = useState(false);
  const downloadReport = async () => {
    if (!email) return;
    setReportBusy(true);
    try {
      const res = await authedFetch(`/api/app/coach/report?email=${encodeURIComponent(email)}&quarter=${reportQuarter}&format=csv`, email);
      if (!res.ok) { setReportBusy(false); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `funder-report-${reportQuarter}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    setReportBusy(false);
  };

  const addClient = async () => {
    const name = newName.trim();
    if (!name || !email) return;
    setAdding(true);
    setSeededNote(null);
    try {
      const res = await authedFetch('/api/app/coach', email, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action: 'add_client', business_name: name, capability_text: capabilityText.trim() || undefined }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        const wsId = d?.client?.workspaceId;
        if (wsId) {
          setActiveWorkspace(wsId, email, name);
          // Setting up the client's market profile is the FIRST thing to do.
          // The POST returns `seeded` (the extraction result when a capability
          // statement was pasted). Only treat it as real if it actually produced
          // codes — vague text can return an empty object. If real → land on the
          // dashboard; otherwise send the coach straight to Settings to set up
          // the profile instead of dropping them into an empty, nagging
          // workspace. (Eric, Jun 23.)
          const s = d?.seeded;
          const reallySeeded = !!s && ((s.naics?.length ?? 0) > 0 || (s.keywords?.length ?? 0) > 0);
          window.location.href = reallySeeded ? '/app' : '/app?panel=settings';
        }
      }
    } catch { /* */ }
    setAdding(false);
  };

  // Parse the bulk textarea → rows. One client per line:
  //   Business Name | capability text (optional) | email (optional)
  // Only the name is required; pipes are optional. A leading "#" comments a line.
  const parseBulk = (raw: string) => {
    return raw
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(line => {
        const [name, cap, mail] = line.split('|').map(s => (s || '').trim());
        return { business_name: name, capability_text: cap || undefined, primary_email: mail || undefined };
      })
      .filter(r => r.business_name);
  };

  const runBulkImport = async () => {
    if (!email) return;
    const rows = parseBulk(bulkText);
    if (!rows.length) return;
    setBulkRunning(true);
    setBulkSummary(null);
    setBulkProgress({ done: 0, total: rows.length });

    // Chunk client-side so each request stays well under the function timeout and
    // the coach sees real progress (each row may run an LLM extraction server-side).
    const BATCH = 12;
    const totals = { added: 0, duplicates: 0, failed: 0, rejectedForCap: 0 };
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      try {
        const res = await authedFetch('/api/app/coach', email, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, action: 'bulk_import', clients: batch }),
        });
        const d = await res.json().catch(() => null);
        if (res.ok && d?.summary) {
          totals.added += d.summary.added || 0;
          totals.duplicates += d.summary.duplicates || 0;
          totals.failed += d.summary.failed || 0;
          totals.rejectedForCap += d.summary.rejected_for_cap || 0;
        } else {
          totals.failed += batch.length;
        }
      } catch {
        totals.failed += batch.length;
      }
      setBulkProgress({ done: Math.min(i + BATCH, rows.length), total: rows.length });
    }

    setBulkSummary(totals);
    setBulkRunning(false);
    setBulkText('');
    await load();  // refresh the client list with the newly imported clients
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
      <div className="flex items-center justify-center min-h-[40vh] text-muted text-sm">
        Loading clients…
      </div>
    );
  }

  if (!isCoach) {
    if (coachAccess && !coachAccess.allowed) {
      const coachAddonUrl = process.env.NEXT_PUBLIC_COACH_ADDON_CHECKOUT_URL || '/market-intelligence#coach-addon';
      return (
        <div className="mx-auto max-w-2xl p-6 md:p-8">
          <h1 className="text-2xl font-bold text-white">My Clients</h1>
          <p className="mt-2 text-muted text-sm leading-relaxed">
            Manage other businesses&apos; BD — each client gets its own pipeline, target agencies, and market research.
            Solopreneur covers one business; add Coach Mode to run a book of clients.
          </p>

          {/* Primary: the $99 Coach Mode add-on — the cheapest way into My Clients. */}
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-emerald-300">Coach Mode add-on</span>
              <span className="text-sm text-ink-soft"><span className="font-semibold text-white">$99</span>/mo</span>
            </div>
            <p className="mt-2 text-sm text-ink-soft">
              Adds My Clients to your Pro plan — up to <span className="font-medium text-white">3 client workspaces</span>. Perfect if you consult for a handful of businesses.
            </p>
            <a
              href={coachAddonUrl}
              className="mt-4 inline-flex h-10 items-center rounded-lg bg-emerald-600 px-5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Add Coach Mode →
            </a>
          </div>

          {/* Secondary: Teams, for scale. */}
          <div className="mt-3 rounded-xl border border-hairline bg-ground/40 p-4">
            <p className="text-sm text-muted">
              Running more than 3 clients? <span className="text-slate-200 font-medium">Mindy Teams</span> ($499/mo) includes up to 5 client workspaces plus shared team seats.{' '}
              <a href="/market-intelligence#teams" className="text-blue-300 hover:text-blue-200 underline underline-offset-2">Compare Teams →</a>
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-2xl p-6 md:p-8">
        <h1 className="text-2xl font-bold text-white">Manage multiple clients</h1>
        <p className="mt-2 text-muted text-sm leading-relaxed">
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

  // Client-side filter for the common (small-org) case → instant, no lag. For a
  // big org the server already returned the matching page, so `clients` is already
  // filtered and this is a no-op passthrough.
  const q = search.trim().toLowerCase();
  const visibleClients = (serverSearchNeeded || !q)
    ? clients
    : clients.filter(c => c.businessName.toLowerCase().includes(q));
  const matchCount = serverSearchNeeded ? (pagination?.total ?? 0) : visibleClients.length;

  return (
    <div className="mx-auto max-w-5xl p-6 md:p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white">{org?.tabLabel || 'My Clients'}</h1>
        <p className="mt-1 text-sm text-muted">
          {activeClient
            ? <>You are managing <span className="text-emerald-300 font-medium">{activeClient.businessName}</span>. Use the tabs below or the sidebar — everything scopes to them.</>
            : 'Select a client to open their workspace. Pipeline, target agencies, and research all switch to that business.'}
        </p>
      </header>

      {/* Quarterly funder report — org_admin only. The SBTDC/SBA rollup, one click. */}
      {role === 'org_admin' && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-purple-500/25 bg-purple-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-purple-300" />
            <div>
              <p className="text-sm font-semibold text-white">Quarterly funder report</p>
              <p className="text-xs text-muted">Businesses served, capability milestones, and pipeline outcomes — exported for your funder.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
              value={reportQuarter}
              onChange={e => setReportQuarter(e.target.value.trim())}
              placeholder="2026-Q1"
              className="h-9 w-24 rounded-lg border border-hairline bg-surface px-2.5 text-sm text-white placeholder-faint focus:border-purple-500 focus:outline-none"
              aria-label="Report quarter (YYYY-Qn)"
            />
            <button
              type="button"
              onClick={downloadReport}
              disabled={reportBusy || !/^\d{4}-Q[1-4]$/.test(reportQuarter)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-purple-600 px-4 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {reportBusy ? 'Preparing…' : 'Export CSV'}
            </button>
          </div>
        </div>
      )}

      {/* Search + count — usable at hundreds of clients, not a flat card wall. */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients by name…"
            className="h-9 w-full pl-9 pr-3 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-purple-500 focus:outline-none"
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 inline-flex items-center text-faint text-sm">
            {listLoading ? <span className="inline-block w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" /> : <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
          </span>
        </div>
        {pagination && (
          <p className="text-xs text-faint">
            {matchCount} client{matchCount === 1 ? '' : 's'}{q ? ' matching' : ' total'}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {visibleClients.length === 0 && (
          <p className="rounded-lg border border-surface bg-ground/40 px-4 py-6 text-center text-sm text-faint">
            {q ? `No clients matching “${search.trim()}”.` : 'No clients yet — add one or import a roster below.'}
          </p>
        )}
        {visibleClients.map(c => {
          const isActive = activeWs === c.workspaceId;
          const stats = profileStats(c);
          return (
            <article
              key={c.id}
              className={`rounded-xl border p-5 transition-colors ${
                isActive
                  ? 'border-emerald-500/50 bg-emerald-500/5 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]'
                  : 'border-surface bg-ground/80 hover:border-hairline'
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
                  <p className={`mt-1 text-sm ${stats.empty ? 'text-amber-400/90' : 'text-muted'}`}>
                    {stats.line}
                  </p>
                  {!stats.empty && stats.keywords && stats.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {stats.keywords.map(kw => (
                        <span key={kw} className="rounded-md bg-surface px-2 py-0.5 text-xs text-ink-soft">
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
                      // The full client name is already the card title above — the
                      // first-word label ("Work as Cape") was ambiguous across the
                      // many "Cape Fear ..." clients. A plain action is unambiguous.
                      className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white"
                      aria-label={`Work as ${c.businessName}`}
                      title={`Work as ${c.businessName}`}
                    >
                      Work as client →
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={clearActive}
                      className="h-9 px-4 rounded-lg border border-hairline text-sm text-muted hover:text-white"
                    >
                      Exit to my account
                    </button>
                  )}
                </div>
              </div>

              {c.milestones && c.milestones.length > 0 && (
                <div className="mt-4 pt-4 border-t border-surface/80">
                  <p className="text-xs font-medium uppercase tracking-wider text-faint mb-2">
                    Capability progression
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {c.milestones.map(m => {
                      const manual = MANUAL_MILESTONE_KEYS.has(m.key);
                      const saving = savingMilestone === `${c.id}:${m.key}`;
                      const done = m.achieved;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          disabled={!manual || saving}
                          onClick={() => manual && toggleMilestone(c, m)}
                          title={
                            manual
                              ? (done ? `Marked${m.achievedAt ? ' ' + m.achievedAt.slice(0, 10) : ''} — click to unmark` : 'Click to mark reached')
                              : `Auto — from pipeline${m.achievedAt ? ' (' + m.achievedAt.slice(0, 10) + ')' : ' (not yet)'}`
                          }
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            done
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                              : 'border-hairline bg-surface/40 text-faint'
                          } ${manual ? 'hover:border-emerald-500/50 cursor-pointer' : 'cursor-default opacity-90'} ${saving ? 'opacity-50' : ''}`}
                        >
                          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                          <span>{m.label}</span>
                          {!manual && <span className="text-[9px] uppercase tracking-wide opacity-60">auto</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {isActive && (
                <div className="mt-4 pt-4 border-t border-surface/80">
                  <p className="text-xs font-medium uppercase tracking-wider text-faint mb-2">
                    Their workspace
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {WORK_PANELS.map(({ panel, label, desc }) => (
                      <button
                        key={panel}
                        type="button"
                        onClick={() => switchTo(c, panel)}
                        className="rounded-lg border border-hairline bg-surface/60 px-4 py-3 text-left hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors"
                      >
                        <div className="text-sm font-medium text-white">{label}</div>
                        <div className="text-xs text-faint mt-0.5">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Pagination — only for big orgs (server-paginated). Small orgs load the
          whole roster and filter client-side, so paging doesn't apply. */}
      {serverSearchNeeded && pagination && pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 0 || listLoading}
            onClick={() => { const np = page - 1; setPage(np); load({ search, page: np, quiet: true }); }}
            className="h-8 px-3 rounded-lg border border-hairline text-ink-soft disabled:opacity-40 disabled:cursor-not-allowed hover:border-slate-600"
          >
            ← Prev
          </button>
          <span className="text-faint text-xs">Page {page + 1} of {pagination.totalPages}</span>
          <button
            type="button"
            disabled={page >= pagination.totalPages - 1 || listLoading}
            onClick={() => { const np = page + 1; setPage(np); load({ search, page: np, quiet: true }); }}
            className="h-8 px-3 rounded-lg border border-hairline text-ink-soft disabled:opacity-40 disabled:cursor-not-allowed hover:border-slate-600"
          >
            Next →
          </button>
        </div>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <AddClientCard
          newName={newName} setNewName={setNewName}
          capabilityText={capabilityText} setCapabilityText={setCapabilityText}
          adding={adding} onAdd={addClient} seededNote={seededNote}
          compactTitle="Add another client"
        />
        <BulkImportCard
          open={bulkOpen} setOpen={setBulkOpen}
          bulkText={bulkText} setBulkText={setBulkText}
          running={bulkRunning} progress={bulkProgress} summary={bulkSummary}
          onRun={runBulkImport} parseCount={parseBulk(bulkText).length}
        />
      </div>

      {(orgTab.deadlines.length > 0 || orgTab.changes.length > 0 || orgTab.news.length > 0) && (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {orgTab.deadlines.length > 0 && (
            <section className="rounded-xl border border-surface bg-ground/60 p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Upcoming deadlines</h3>
              <div className="space-y-2">
                {orgTab.deadlines.slice(0, 8).map(d => {
                  const days = Math.ceil((new Date(d.response_deadline).getTime() - Date.now()) / 86400000);
                  return (
                    <div key={d.id} className="flex justify-between gap-2 text-sm">
                      <span className="text-ink-soft truncate"><span className="text-faint">{d.client}</span> · {d.title}</span>
                      <span className={`shrink-0 text-xs font-medium ${days <= 3 ? 'text-red-400' : days <= 7 ? 'text-amber-400' : 'text-faint'}`}>
                        {days <= 0 ? 'due' : `${days}d`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {orgTab.news.length > 0 && (
            <section className="rounded-xl border border-surface bg-ground/60 p-4">
              <h3 className="text-sm font-semibold text-white mb-3">{org?.name || 'Org'} news</h3>
              <div className="space-y-2">
                {orgTab.news.map(n => (
                  <div key={n.id} className="text-sm text-ink-soft">{n.pinned && <Pin className="inline h-3 w-3 mr-1 shrink-0 text-muted" strokeWidth={2} />}{n.title}</div>
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
    <div className="rounded-xl border border-surface bg-ground/60 p-5">
      <h3 className="text-sm font-semibold text-white">{compactTitle || 'Add a client'}</h3>
      <p className="mt-1 text-xs text-faint mb-4">
        Paste their capability statement to auto-extract NAICS, keywords, and target agencies.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Business name"
          className="h-10 flex-1 px-3 bg-surface border border-hairline rounded-lg text-white text-sm focus:border-purple-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={adding || !newName.trim()}
          className="h-10 px-5 shrink-0 bg-purple-600 hover:bg-purple-500 disabled:bg-input text-white text-sm font-medium rounded-lg"
        >
          {adding ? 'Adding…' : 'Add client'}
        </button>
      </div>
      <textarea
        value={capabilityText}
        onChange={e => setCapabilityText(e.target.value)}
        placeholder="Capability statement or website text (optional but recommended)"
        rows={3}
        className="w-full mt-3 px-3 py-2.5 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-purple-500 focus:outline-none resize-none"
      />
      {seededNote && <p className="text-xs text-emerald-300 mt-2">{seededNote}</p>}
    </div>
  );
}

function BulkImportCard({
  open, setOpen, bulkText, setBulkText, running, progress, summary, onRun, parseCount,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  bulkText: string;
  setBulkText: (v: string) => void;
  running: boolean;
  progress: { done: number; total: number } | null;
  summary: { added: number; duplicates: number; failed: number; rejectedForCap: number } | null;
  onRun: () => void;
  parseCount: number;
}) {
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="rounded-xl border border-surface bg-ground/60 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Import a client roster</h3>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="text-xs text-blue-300 hover:text-blue-200">
            Bulk add →
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-faint mb-3">
        Add dozens or hundreds of clients at once. One per line:{' '}
        <code className="text-muted">Business Name | capability text | email</code>{' '}
        (only the name is required).
      </p>

      {open && (
        <>
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={"Acme Fabrication | steel fabrication and welding for federal facilities | ops@acme.com\nCoastal IT Services | managed IT and cybersecurity\nPiedmont Logistics"}
            rows={8}
            disabled={running}
            className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-lg text-white text-xs font-mono leading-relaxed placeholder-slate-600 focus:border-purple-500 focus:outline-none resize-y disabled:opacity-60"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-faint">
              {parseCount > 0 ? `${parseCount} client${parseCount === 1 ? '' : 's'} ready` : 'Paste your roster above'}
            </span>
            <button
              type="button"
              onClick={onRun}
              disabled={running || parseCount === 0}
              className="h-9 px-5 shrink-0 bg-purple-600 hover:bg-purple-500 disabled:bg-input text-white text-sm font-medium rounded-lg"
            >
              {running ? 'Importing…' : `Import ${parseCount || ''} client${parseCount === 1 ? '' : 's'}`}
            </button>
          </div>

          {running && progress && (
            <div className="mt-3">
              <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted">{progress.done} of {progress.total} processed…</p>
            </div>
          )}
        </>
      )}

      {summary && !running && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            Imported {summary.added} client{summary.added === 1 ? '' : 's'}
            {summary.duplicates > 0 && ` · ${summary.duplicates} already existed`}
            {summary.failed > 0 && ` · ${summary.failed} failed`}
            {summary.rejectedForCap > 0 && ` · ${summary.rejectedForCap} over your plan limit`}
            . They're in your client list now.
          </span>
        </div>
      )}
    </div>
  );
}
