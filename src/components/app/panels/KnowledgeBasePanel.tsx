'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { authedFetch } from '../authHeaders';

/**
 * Knowledge Base — searchable repository over Mindy's source corpus
 * (mindy_rag_documents). The browsable home for the docs Mindy Chat cites:
 * search/browse winning proposals, templates, cap statements, training, podcast
 * insights; read the full text. Split-pane (list left, preview right) mirroring
 * the redesigned Library. Chat source chips deep-link here via ?doc=<id>.
 * PRD-knowledge-base-repository.
 */
interface KbDoc {
  id: string; title: string; docType: string; docTypeLabel: string;
  summary: string; naics: string | null; words: number; pages: number | null;
}
interface Facet { docType: string; label: string; count: number }

export default function KnowledgeBasePanel({ email, initialDocId }: { email: string | null; initialDocId?: string | null }) {
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [docType, setDocType] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KbDoc | null>(null);
  const [docText, setDocText] = useState<string>('');
  const [docLoading, setDocLoading] = useState(false);
  // Playable URL (YT Live / podcast / webinar) so the doc isn't a dead end.
  const [play, setPlay] = useState<{ url: string; label: string } | null>(null);
  const didInitialDoc = useRef(false);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    const p = new URLSearchParams({ email });
    if (q.trim()) p.set('q', q.trim());
    if (docType) p.set('docType', docType);
    try {
      const res = await authedFetch(`/api/app/knowledge-base?${p}`, email);
      const d = await res.json();
      if (d.success) {
        setDocs(d.docs || []);
        setFacets(d.facets || []);
        setTotal(d.total || 0);
        // Auto-preview the top result (no dead pane) unless a doc is pinned.
        if (!selected && d.docs?.[0]) openDoc(d.docs[0]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, q, docType]);

  const openDoc = useCallback(async (doc: KbDoc) => {
    setSelected(doc);
    setDocLoading(true); setDocText(''); setPlay(null);
    try {
      const res = await authedFetch(`/api/app/rag-doc?id=${doc.id}&email=${encodeURIComponent(email || '')}`, email);
      const d = await res.json();
      setDocText(d.full_text || d.text || 'No text available for this document.');
      if (d.play_url) setPlay({ url: d.play_url, label: d.play_label || '▶ Open source' });
    } catch {
      setDocText('Could not load this document.');
    }
    setDocLoading(false);
  }, [email]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [docType]);

  // Deep-link: ?doc=<id> from a chat citation → open that doc on first load.
  useEffect(() => {
    if (didInitialDoc.current || !initialDocId || !email) return;
    didInitialDoc.current = true;
    (async () => {
      setDocLoading(true);
      try {
        const res = await authedFetch(`/api/app/rag-doc?id=${initialDocId}&email=${encodeURIComponent(email)}`, email);
        const d = await res.json();
        setSelected({ id: initialDocId, title: d.title || 'Document', docType: d.doc_type || '', docTypeLabel: d.doc_type || '', summary: '', naics: null, words: d.word_count || 0, pages: null });
        setDocText(d.full_text || d.text || 'No text available.');
        if (d.play_url) setPlay({ url: d.play_url, label: d.play_label || '▶ Open source' });
      } catch { /* ignore */ }
      setDocLoading(false);
    })();
  }, [initialDocId, email]);

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white">Knowledge Base</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Mindy&apos;s source library — winning proposals, templates, capability statements, training, and podcast insights. The documents behind every answer.
        </p>
      </div>

      {/* Search + type filter */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load(); }}
          placeholder="Search the knowledge base…"
          className="flex-1 min-w-[240px] h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <button onClick={load} className="h-10 px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg">Search</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button onClick={() => setDocType('')} className={`px-3 py-1 rounded-full text-xs ${!docType ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>All ({total})</button>
        {facets.map(f => (
          <button key={f.docType} onClick={() => setDocType(f.docType)} className={`px-3 py-1 rounded-full text-xs ${docType === f.docType ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        {/* List */}
        <div className="border border-slate-800 rounded-xl bg-slate-900 overflow-hidden">
          <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-800">
            {loading && <div className="p-4 text-sm text-slate-500">Loading…</div>}
            {!loading && docs.length === 0 && <div className="p-4 text-sm text-slate-500">No documents match.</div>}
            {docs.map(doc => (
              <button
                key={doc.id}
                onClick={() => openDoc(doc)}
                className={`w-full text-left px-4 py-3 hover:bg-slate-800/50 ${selected?.id === doc.id ? 'bg-slate-800/70 border-l-2 border-emerald-500' : 'border-l-2 border-transparent'}`}
              >
                <div className="text-sm font-medium text-white truncate">{doc.title}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {doc.docTypeLabel}{doc.pages ? ` · ${doc.pages}p` : doc.words ? ` · ${doc.words.toLocaleString()} words` : ''}
                </div>
                {doc.summary && <div className="text-xs text-slate-400 mt-1 line-clamp-2">{doc.summary}</div>}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="border border-slate-800 rounded-xl bg-slate-900 overflow-hidden">
          {selected ? (
            <div className="flex flex-col h-full">
              <div className="px-5 py-3 border-b border-slate-800 flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-white">{selected.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{selected.docTypeLabel}</div>
                </div>
                {/* Watch/Listen — so YT Live / podcast / webinar docs aren't a
                    dead end (Eric). Opens the episode in a new tab. */}
                {play && (
                  <a
                    href={play.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors"
                  >
                    {play.label}
                  </a>
                )}
              </div>
              <div className="px-5 py-4 overflow-y-auto max-h-[560px]">
                {docLoading ? (
                  <div className="text-sm text-slate-500">Loading document…</div>
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-slate-300 leading-relaxed">{docText}</pre>
                )}
              </div>
            </div>
          ) : (
            <div className="p-10 text-center text-slate-500 text-sm">Select a document to read it.</div>
          )}
        </div>
      </div>
    </div>
  );
}
