'use client';

/**
 * RAG Library admin page.
 *
 * Three tabs:
 *   Stats     — counts by doc_type, folder, ingestion status
 *   Search    — probe what Mindy retrieves for any query
 *   Documents — paginated list of all indexed documents
 *
 * Built 2026-05-26 so Eric can spot-check what Mindy will surface
 * before users see it.
 *
 * Auth: same admin password as other admin pages.
 */

import { useCallback, useEffect, useState } from 'react';

type Tab = 'stats' | 'search' | 'docs';

interface Stats {
  totals: { documents: number; chunks: number; characters: number };
  byType: { type: string; docs: number; chars: number }[];
  byFolder: { folder: string; docs: number }[];
  byStatus: Record<string, number>;
}

interface SearchResult {
  document_id: string;
  chunk_index: number;
  chunk_text: string;
  chunk_preview: string;
  doc_title: string;
  doc_type: string;
  doc_top_level_folder: string;
  source_path: string;
  rank: number;
}

interface DocRow {
  id: string;
  filename: string;
  file_extension: string;
  doc_type: string;
  top_level_folder: string;
  title: string;
  text_length: number;
  word_count: number;
  page_count: number | null;
  ingestion_status: string;
  ingestion_error: string | null;
  created_at: string;
}

const DOC_TYPES = [
  'cap_statement', 'proposal_template', 'past_performance',
  'course_material', 'teaching_handout', 'webinar_resource',
  'qa_dataset', 'slide_deck', 'ebook', 'misc', 'meta_doc',
  'planner_app_code',
];

export default function RagLibraryAdminPage() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const [tab, setTab] = useState<Tab>('stats');

  // Stats
  const [stats, setStats] = useState<Stats | null>(null);

  // Search
  const [query, setQuery] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);

  // Docs
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsTotal, setDocsTotal] = useState(0);
  const [docsPage, setDocsPage] = useState(0);
  const [docsType, setDocsType] = useState('');
  const [docsLoading, setDocsLoading] = useState(false);

  const apiBase = '/api/admin/rag-library';

  const loadStats = useCallback(async () => {
    const res = await fetch(`${apiBase}?op=stats&password=${encodeURIComponent(password)}`);
    if (res.status === 401) { setAuthenticated(false); return; }
    const data = await res.json();
    if (data.success) setStats({ totals: data.totals, byType: data.byType, byFolder: data.byFolder, byStatus: data.byStatus });
  }, [password]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setExpandedChunk(null);
    try {
      const params = new URLSearchParams({
        op: 'search',
        password,
        q: query.trim(),
      });
      if (docTypeFilter) params.set('type', docTypeFilter);
      const res = await fetch(`${apiBase}?${params}`);
      const data = await res.json();
      if (data.success) setResults(data.results);
      else setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query, docTypeFilter, password]);

  const loadDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const params = new URLSearchParams({
        op: 'docs',
        password,
        page: String(docsPage),
      });
      if (docsType) params.set('type', docsType);
      const res = await fetch(`${apiBase}?${params}`);
      const data = await res.json();
      if (data.success) {
        setDocs(data.docs);
        setDocsTotal(data.total);
      }
    } finally {
      setDocsLoading(false);
    }
  }, [docsPage, docsType, password]);

  // Initial load after auth
  useEffect(() => {
    if (!authenticated) return;
    if (tab === 'stats' && !stats) loadStats();
    if (tab === 'docs') loadDocs();
  }, [authenticated, tab, stats, loadStats, loadDocs]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const res = await fetch(`${apiBase}?op=stats&password=${encodeURIComponent(password)}`);
    if (res.status === 401) {
      setAuthError('Wrong password');
      return;
    }
    const data = await res.json();
    if (data.success) {
      setStats({ totals: data.totals, byType: data.byType, byFolder: data.byFolder, byStatus: data.byStatus });
      setAuthenticated(true);
    } else {
      setAuthError(data.error || 'Could not load stats');
    }
  };

  // ---- Login gate ----
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-ground-deep flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-ground border border-surface rounded-lg p-6 w-full max-w-sm">
          <h1 className="text-xl font-semibold text-white mb-1">RAG Library Admin</h1>
          <p className="text-sm text-muted mb-5">Mindy teaching corpus + retrieval probe</p>
          <label className="block text-sm text-ink-soft mb-1">Admin password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-hairline rounded text-white text-sm focus:border-emerald-500 focus:outline-none mb-3"
            autoFocus
          />
          {authError && <p className="text-rose-400 text-sm mb-3">{authError}</p>}
          <button type="submit" className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded">
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ground-deep text-slate-200">
      <header className="border-b border-surface px-6 py-4">
        <h1 className="text-xl font-semibold text-white">🗂️ Mindy RAG Library</h1>
        <p className="text-sm text-muted">Eric Coffie 8-year teaching corpus + retrieval debugger</p>
      </header>

      <nav className="border-b border-surface px-6">
        {(['stats', 'search', 'docs'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
              tab === t ? 'border-emerald-500 text-white' : 'border-transparent text-muted hover:text-slate-200'
            }`}
          >
            {t === 'stats' && '📊 Stats'}
            {t === 'search' && '🔍 Search'}
            {t === 'docs' && '📄 Documents'}
          </button>
        ))}
      </nav>

      <main className="p-6">
        {tab === 'stats' && stats && (
          <div className="space-y-6">
            {/* Totals */}
            <section className="grid grid-cols-3 gap-4">
              <Card label="Documents indexed" value={stats.totals.documents.toLocaleString()} />
              <Card label="Chunks (FTS index)" value={stats.totals.chunks.toLocaleString()} />
              <Card label="Total characters" value={(stats.totals.characters / 1_000_000).toFixed(1) + 'M'} />
            </section>

            {/* By doc_type */}
            <section className="bg-ground border border-surface rounded-lg p-4">
              <h2 className="text-sm font-medium text-ink-soft mb-3">By document type</h2>
              <table className="w-full text-sm">
                <thead className="text-xs text-faint uppercase tracking-wider">
                  <tr>
                    <th className="text-left py-2">Type</th>
                    <th className="text-right py-2">Documents</th>
                    <th className="text-right py-2">Avg chars</th>
                    <th className="text-right py-2">Total chars</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byType.map((row) => (
                    <tr key={row.type} className="border-t border-surface">
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${docTypeColor(row.type)}`}>
                          {row.type}
                        </span>
                      </td>
                      <td className="text-right py-2 text-white">{row.docs.toLocaleString()}</td>
                      <td className="text-right py-2 text-muted">{Math.round(row.chars / row.docs).toLocaleString()}</td>
                      <td className="text-right py-2 text-muted">{(row.chars / 1000).toFixed(0)}K</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* Status + Folder side by side */}
            <section className="grid grid-cols-2 gap-4">
              <div className="bg-ground border border-surface rounded-lg p-4">
                <h2 className="text-sm font-medium text-ink-soft mb-3">Ingestion status</h2>
                <ul className="text-sm space-y-1">
                  {Object.entries(stats.byStatus).map(([s, c]) => (
                    <li key={s} className="flex justify-between">
                      <span className={s === 'extracted' ? 'text-emerald-400' : s === 'failed' ? 'text-rose-400' : 'text-muted'}>{s}</span>
                      <span className="text-white">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-ground border border-surface rounded-lg p-4">
                <h2 className="text-sm font-medium text-ink-soft mb-3">By top-level folder</h2>
                <ul className="text-sm space-y-1 max-h-64 overflow-auto">
                  {stats.byFolder.slice(0, 20).map((f) => (
                    <li key={f.folder} className="flex justify-between">
                      <span className="text-muted truncate mr-2">{f.folder}</span>
                      <span className="text-white">{f.docs}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        )}

        {tab === 'search' && (
          <div className="space-y-4">
            <form onSubmit={(e) => { e.preventDefault(); runSearch(); }} className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Try: "capability statement past performance" or "NAVFAC construction MACC"'
                className="flex-1 px-3 py-2 bg-ground border border-hairline rounded text-white text-sm focus:border-emerald-500 focus:outline-none"
              />
              <select
                value={docTypeFilter}
                onChange={(e) => setDocTypeFilter(e.target.value)}
                className="px-3 py-2 bg-ground border border-hairline rounded text-white text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="">All doc types</option>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded disabled:opacity-50"
              >
                {searching ? 'Searching…' : 'Search'}
              </button>
            </form>

            <p className="text-xs text-faint">
              Runs the same RPC <code className="text-emerald-400">get_rag_chunks()</code> that Proposal Assist uses. Doc-type boosts applied. Meta-docs (BENCHMARK, CONTENT-MAPPING) excluded.
            </p>

            {results !== null && (
              <div className="space-y-2">
                <p className="text-sm text-muted">
                  {results.length === 0 ? 'No matches.' : `${results.length} chunk${results.length === 1 ? '' : 's'} returned, sorted by rank.`}
                </p>
                {results.map((r, i) => {
                  const key = `${r.document_id}-${r.chunk_index}`;
                  const isExpanded = expandedChunk === key;
                  return (
                    <div key={key} className="bg-ground border border-surface rounded-lg p-3 hover:border-hairline transition">
                      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="text-xs text-faint font-mono">#{i + 1}</span>
                          <span className="text-xs text-emerald-400 font-mono">rank {r.rank.toFixed(3)}</span>
                          <span className={`px-2 py-0.5 rounded text-xs ${docTypeColor(r.doc_type)}`}>
                            {r.doc_type}
                          </span>
                          <span className="text-sm text-white truncate">{r.doc_title}</span>
                        </div>
                        <button
                          onClick={() => setExpandedChunk(isExpanded ? null : key)}
                          className="text-xs text-muted hover:text-white whitespace-nowrap"
                        >
                          {isExpanded ? 'Collapse' : 'Show full chunk'}
                        </button>
                      </div>
                      <p className="text-sm text-ink-soft whitespace-pre-wrap break-words">
                        {isExpanded ? r.chunk_text : r.chunk_preview + (r.chunk_text.length > 300 ? '…' : '')}
                      </p>
                      <p className="text-xs text-slate-600 mt-2 truncate" title={r.source_path}>
                        {r.source_path}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'docs' && (
          <div className="space-y-4">
            <div className="flex gap-2 items-center">
              <select
                value={docsType}
                onChange={(e) => { setDocsType(e.target.value); setDocsPage(0); }}
                className="px-3 py-2 bg-ground border border-hairline rounded text-white text-sm"
              >
                <option value="">All doc types</option>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="text-sm text-muted">
                {docsLoading ? 'Loading…' : `${docsTotal.toLocaleString()} docs · page ${docsPage + 1} of ${Math.ceil(docsTotal / 50)}`}
              </span>
              <div className="ml-auto flex gap-1">
                <button
                  onClick={() => setDocsPage((p) => Math.max(0, p - 1))}
                  disabled={docsPage === 0}
                  className="px-3 py-1 bg-surface hover:bg-input text-white text-sm rounded disabled:opacity-50"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setDocsPage((p) => p + 1)}
                  disabled={(docsPage + 1) * 50 >= docsTotal}
                  className="px-3 py-1 bg-surface hover:bg-input text-white text-sm rounded disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            </div>

            <div className="bg-ground border border-surface rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-xs text-faint uppercase tracking-wider bg-ground-deep">
                  <tr>
                    <th className="text-left px-3 py-2">Title / filename</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Folder</th>
                    <th className="text-right px-3 py-2">Chars</th>
                    <th className="text-right px-3 py-2">Words</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} className="border-t border-surface hover:bg-surface/30">
                      <td className="px-3 py-2 max-w-md">
                        <div className="text-white truncate" title={d.filename}>{d.title || d.filename}</div>
                        <div className="text-xs text-faint truncate">{d.filename}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${docTypeColor(d.doc_type)}`}>
                          {d.doc_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted max-w-[180px] truncate">{d.top_level_folder}</td>
                      <td className="px-3 py-2 text-right text-muted">{(d.text_length || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-muted">{(d.word_count || 0).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <span className={d.ingestion_status === 'extracted' ? 'text-emerald-400' : d.ingestion_status === 'failed' ? 'text-rose-400' : 'text-muted'}>
                          {d.ingestion_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ---- Helpers --------------------------------------------------------
function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ground border border-surface rounded-lg p-4">
      <div className="text-xs uppercase tracking-wider text-faint mb-1">{label}</div>
      <div className="text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function docTypeColor(t: string): string {
  switch (t) {
    case 'cap_statement':
    case 'proposal_template':
    case 'past_performance':
      return 'bg-emerald-900/40 text-emerald-300';
    case 'course_material':
    case 'teaching_handout':
    case 'webinar_resource':
      return 'bg-purple-900/40 text-purple-300';
    case 'qa_dataset':
      return 'bg-blue-900/40 text-blue-300';
    case 'slide_deck':
    case 'ebook':
      return 'bg-amber-900/40 text-amber-300';
    case 'meta_doc':
      return 'bg-rose-900/40 text-rose-300';
    default:
      return 'bg-surface text-muted';
  }
}
