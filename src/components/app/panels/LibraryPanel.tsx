'use client';

/**
 * My Library panel — searchable archive of every AI output Mindy has
 * generated for the user (proposal sections, cap statements, briefings).
 *
 * Content Reaper pattern #4: silent persistence + searchable recall.
 * The user never clicks "save"; every Mindy output is automatically
 * here, forever.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { authedFetch } from '../authHeaders';

interface Props {
  email: string | null;
  tier: AppTier;
}

type ContentType = '' | 'proposal_section' | 'cap_statement' | 'briefing' | 'vault_ai_coach';

interface ListEntry {
  id: string;
  content_type: string;
  content_subtype: string | null;
  title: string;
  agency: string | null;
  naics_code: string | null;
  content_text: string | null;
  source_notice_id: string | null;
  created_at: string;
}

interface DetailEntry extends ListEntry {
  content: Record<string, unknown>;
  ai_provider: string | null;
  ai_model: string | null;
  pursuit_id: string | null;
  tags: string[];
}

const TYPE_OPTIONS: Array<{ value: ContentType; label: string }> = [
  { value: '', label: 'All' },
  { value: 'proposal_section', label: 'Proposal sections' },
  { value: 'cap_statement', label: 'Capability statements' },
  { value: 'briefing', label: 'Briefings' },
  { value: 'vault_ai_coach', label: 'Vault AI coach' },
];

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  proposal_section: { label: 'Proposal', color: 'bg-purple-900/40 text-purple-300' },
  proposal_wizard_brief: { label: 'Notice Brief', color: 'bg-slate-700/60 text-slate-300' },
  proposal_wizard_compliance: { label: 'Compliance', color: 'bg-blue-900/40 text-blue-300' },
  proposal_wizard_draft: { label: 'Draft', color: 'bg-purple-900/40 text-purple-300' },
  cap_statement: { label: 'Cap Stmt', color: 'bg-emerald-900/40 text-emerald-300' },
  briefing: { label: 'Briefing', color: 'bg-blue-900/40 text-blue-300' },
  vault_ai_coach: { label: 'Vault', color: 'bg-amber-900/40 text-amber-300' },
};

function displaySubtype(value: string | null): string {
  if (!value) return '';
  return value
    .replace(/_/g, ' ')
    .replace(/\brfp\b/gi, 'RFP')
    .replace(/\bloi\b/gi, 'LOI')
    .replace(/\brfq\b/gi, 'RFQ')
    .replace(/\brfi\b/gi, 'RFI')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function displayNextAction(nextAction: unknown): string {
  return String(nextAction || '')
    .replace(/\bSubmit\s+(?:a\s+)?Capability Statement package\b/i, 'Submit an LOI with your capability statement (if required or requested)')
    .replace(/\bSubmit\s+(?:a\s+)?capability statement\b/i, 'Submit an LOI with your capability statement (if required or requested)')
    .replace(/\bcapability statement package\b/gi, 'LOI response package');
}

function LibraryBriefView({ content }: { content: Record<string, unknown> }) {
  const sections = [
    { title: 'Summary', items: [String(content.summary || '').trim()].filter(Boolean) },
    { title: 'What They Want', items: textArray(content.what_they_want) },
    { title: 'Show-Stoppers', items: textArray(content.required) },
    { title: 'Hard Parts', items: textArray(content.hard_parts) },
    { title: 'Deadlines', items: textArray(content.deadlines) },
  ].filter((section) => section.items.length > 0);
  const nextAction = displayNextAction(content.next_action);

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.title} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{section.title}</h3>
          {section.title === 'Summary' ? (
            <p className="mt-2 text-sm leading-relaxed text-slate-200">{section.items[0]}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {section.items.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-relaxed text-slate-200">
                  <span className="mt-1 text-slate-600">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {nextAction && (
        <section className="rounded-lg border border-purple-500/30 bg-purple-950/20 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-purple-300">Next Action</h3>
          <p className="mt-2 text-sm leading-relaxed text-purple-100">{nextAction}</p>
        </section>
      )}

      {sections.length === 0 && !nextAction && (
        <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
          This archived item does not have a formatted preview.
        </p>
      )}
    </div>
  );
}

function LibraryDraftView({ content }: { content: Record<string, unknown> }) {
  const draft = typeof content.draft === 'string' ? content.draft : '';
  const sections = Array.isArray(content.sections) ? content.sections : [];

  if (draft) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
        {draft}
      </div>
    );
  }

  if (sections.length > 0) {
    return (
      <div className="space-y-4">
        {sections.map((raw, index) => {
          const section = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
          const title = displaySubtype(String(section.section || `section_${index + 1}`));
          const body = String(section.draft || '').trim();
          return (
            <section key={`${title}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{body || 'No text saved.'}</p>
            </section>
          );
        })}
      </div>
    );
  }

  return null;
}

function LibraryContentView({ selected }: { selected: DetailEntry }) {
  const content = selected.content || {};
  const isBrief = selected.content_type === 'proposal_wizard_brief' || content.stage === 'brief';

  if (isBrief) return <LibraryBriefView content={content} />;
  if (
    typeof content.draft === 'string' ||
    (Array.isArray(content.sections) && content.sections.length > 0)
  ) {
    return <LibraryDraftView content={content} />;
  }
  if (selected.content_text) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
        {selected.content_text}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
      No formatted preview is available for this item.
    </div>
  );
}

export default function LibraryPanel({ email, tier }: Props) {
  void tier;
  const [type, setType] = useState<ContentType>('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DetailEntry | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const fetchList = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ email, page: String(page) });
      if (type) params.set('type', type);
      if (debouncedQuery.length >= 2) params.set('q', debouncedQuery);
      const res = await authedFetch(`/api/app/library?${params}`, email);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load library');
    } finally {
      setLoading(false);
    }
  }, [email, type, debouncedQuery, page]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Reset page when filter or query changes
  useEffect(() => { setPage(0); }, [type, debouncedQuery]);

  // Auto-preview the top entry so the detail pane is never dead space.
  // Only when nothing is selected yet (don't yank the user off their choice).
  useEffect(() => {
    if (!selected && !selectedLoading && entries.length > 0) {
      openDetail(entries[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const openDetail = async (id: string) => {
    if (!email) return;
    setSelectedLoading(true);
    setSelected(null);
    try {
      const res = await authedFetch(`/api/app/library?email=${encodeURIComponent(email)}&id=${id}`, email);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      setSelected(data.entry);
    } catch (e) {
      alert(`Could not load entry: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSelectedLoading(false);
    }
  };

  const archive = async (id: string) => {
    if (!email) return;
    if (!confirm('Remove this from your library?')) return;
    await authedFetch(`/api/app/library?email=${encodeURIComponent(email)}&id=${id}`, email, {
      method: 'DELETE',
    });
    if (selected?.id === id) setSelected(null);
    fetchList();
  };

  if (!email) return <div className="p-8 text-center text-slate-400">Sign in to access your library.</div>;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-2xl">📚</span>
          <h1 className="text-xl font-semibold text-white">My Library</h1>
        </div>
        <p className="text-sm text-slate-400">
          Every proposal draft, capability statement, and AI output Mindy has created for you. Searchable forever.
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-6 py-3 border-b border-slate-800">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ContentType)}
          className="px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-emerald-500 focus:outline-none"
        >
          {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, agency, body…"
          className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Body — split list / detail */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_1.5fr] overflow-hidden">
        {/* List */}
        <div className="border-r border-slate-800 overflow-y-auto">
          {loading && <div className="px-6 py-4 text-sm text-slate-500">Loading…</div>}
          {error && <div className="px-6 py-4 text-sm text-rose-300">Error: {error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="p-12 text-center text-slate-500">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-sm">Nothing here yet. Drafts and outputs you generate will appear automatically.</p>
            </div>
          )}
          {entries.map((entry) => {
            const badge = TYPE_BADGE[entry.content_type] || { label: entry.content_type, color: 'bg-slate-700 text-slate-300' };
            return (
              <button
                key={entry.id}
                onClick={() => openDetail(entry.id)}
                className={`block w-full text-left px-4 py-2.5 border-b border-slate-800 hover:bg-slate-900/40 transition ${selected?.id === entry.id ? 'bg-slate-900/60 border-l-2 border-l-emerald-500' : 'border-l-2 border-l-transparent'}`}
              >
                {/* Tightened to type · title · agency · date — full content is
                    in the preview pane (no per-row snippet). Scan many fast. */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${badge.color}`}>
                    {badge.label}{entry.content_subtype ? ` · ${displaySubtype(entry.content_subtype)}` : ''}
                  </span>
                  <span className="text-[10px] text-slate-500 whitespace-nowrap shrink-0">{new Date(entry.created_at).toLocaleDateString()}</span>
                </div>
                <div className="text-sm text-white truncate mt-1">{entry.title}</div>
                {entry.agency && <div className="text-xs text-slate-400 truncate">{entry.agency}</div>}
              </button>
            );
          })}

          {/* Pagination */}
          {total > 25 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs text-slate-400 hover:text-white disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-xs text-slate-500">{page * 25 + 1}-{Math.min((page + 1) * 25, total)} of {total}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * 25 >= total}
                className="text-xs text-slate-400 hover:text-white disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="overflow-y-auto bg-slate-950/40">
          {!selected && !selectedLoading && (
            <div className="p-12 text-center text-slate-500">
              <p className="text-sm">Click any entry to preview its content.</p>
            </div>
          )}
          {selectedLoading && <div className="p-12 text-center text-slate-500">Loading…</div>}
          {selected && (
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selected.title}</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(selected.created_at).toLocaleString()}
                    {selected.agency && <> · {selected.agency}</>}
                    {selected.ai_model && <> · {selected.ai_model}</>}
                  </p>
                </div>
                <button
                  onClick={() => archive(selected.id)}
                  className="text-xs text-slate-500 hover:text-rose-400 whitespace-nowrap"
                >
                  Remove
                </button>
              </div>

              <LibraryContentView selected={selected} />

              <details className="rounded-lg border border-slate-800 bg-slate-950/40">
                <summary className="cursor-pointer px-3 py-2 text-xs text-slate-500 hover:text-slate-300">
                  Raw archive data
                </summary>
                <pre className="max-h-80 overflow-x-auto overflow-y-auto px-3 pb-3 pt-1 text-xs text-slate-500">
                  {JSON.stringify(selected.content, null, 2).slice(0, 5000)}
                </pre>
              </details>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const draft = (selected.content as { draft?: string })?.draft || selected.content_text || JSON.stringify(selected.content, null, 2);
                    navigator.clipboard.writeText(draft);
                    alert('Copied to clipboard');
                  }}
                  className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white rounded"
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
