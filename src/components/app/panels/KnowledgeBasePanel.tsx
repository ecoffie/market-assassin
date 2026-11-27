'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { authedFetch } from '../authHeaders';
import TabAskBox from '@/components/app/TabAskBox';
import { isTabAskEnabled, type TabAskCount } from '@/lib/app/tab-ask';
import { knowledgeBaseAskAdapter, type KnowledgeBaseAskParams } from '@/lib/app/tab-ask-adapters/knowledge-base';

/**
 * Knowledge Base — searchable repository over Mindy's source corpus
 * (mindy_rag_documents). The browsable home for the docs Mindy Chat cites:
 * search/browse winning proposals, templates, cap statements and training; read the full text. Podcast insights
 * are hidden (src/lib/knowledge-base/hidden-types.ts). Split-pane (list left, preview right) mirroring
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
  // Monotonic request token: the preview body (docText/play) is fetched async, so
  // a slow fetch for doc A can resolve AFTER the user (or the deep-link/auto-preview
  // race) has moved to doc B — leaving B's title over A's body (Eric QC: webinar
  // title showing an 82k-word book's text). Only the LATEST openDoc call may write.
  const reqSeq = useRef(0);

  // The tab's ONE list load (GET /api/app/knowledge-base). Resolves to the rows it showed, or null when
  // the load failed (unknown — never reported as 0). The search box and Ask Mindy both go through it.
  const fetchList = async (qv: string, dt: string): Promise<TabAskCount> => {
    if (!email) return null;
    setLoading(true);
    const p = new URLSearchParams({ email });
    if (qv.trim()) p.set('q', qv.trim());
    if (dt) p.set('docType', dt);
    let count: TabAskCount = null;
    try {
      const res = await authedFetch(`/api/app/knowledge-base?${p}`, email);
      const d = await res.json();
      if (d.success) {
        setDocs(d.docs || []);
        setFacets(d.facets || []);
        setTotal(d.total || 0);
        // Auto-preview the top result (no dead pane) unless a doc is pinned or a
        // ?doc=<id> deep-link is loading (else the auto-preview races the deep-link
        // and the two can land title-of-one over body-of-the-other).
        if (!selected && !initialDocId && d.docs?.[0]) openDoc(d.docs[0]);
        const shown = (d.docs || []).length;
        count = { shown, more: (d.total || 0) > shown };
      }
    } catch { /* ignore */ }
    setLoading(false);
    return count;
  };

  const load = useCallback(async () => {
    await fetchList(q, docType);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, q, docType]);

  const openDoc = useCallback(async (doc: KbDoc) => {
    const seq = ++reqSeq.current;          // claim this as the latest request
    setSelected(doc);
    setDocLoading(true); setDocText(''); setPlay(null);
    try {
      const res = await authedFetch(`/api/app/rag-doc?id=${doc.id}&email=${encodeURIComponent(email || '')}`, email);
      const d = await res.json();
      if (reqSeq.current !== seq) return;   // a newer doc was opened — drop this stale body
      setDocText(d.full_text || d.text || 'No text available for this document.');
      if (d.play_url) setPlay({ url: d.play_url, label: d.play_label || '▶ Open source' });
    } catch {
      if (reqSeq.current === seq) setDocText('Could not load this document.');
    }
    if (reqSeq.current === seq) setDocLoading(false);
  }, [email]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [docType]);

  // Deep-link: ?doc=<id> from a chat citation → open that doc on first load.
  useEffect(() => {
    if (didInitialDoc.current || !initialDocId || !email) return;
    didInitialDoc.current = true;
    const seq = ++reqSeq.current;          // claim latest — beats a racing auto-preview
    (async () => {
      setDocLoading(true);
      try {
        const res = await authedFetch(`/api/app/rag-doc?id=${initialDocId}&email=${encodeURIComponent(email)}`, email);
        const d = await res.json();
        if (reqSeq.current !== seq) return;
        setSelected({ id: initialDocId, title: d.title || 'Document', docType: d.doc_type || '', docTypeLabel: d.doc_type || '', summary: '', naics: null, words: d.word_count || 0, pages: null });
        setDocText(d.full_text || d.text || 'No text available.');
        if (d.play_url) setPlay({ url: d.play_url, label: d.play_label || '▶ Open source' });
      } catch { /* ignore */ }
      if (reqSeq.current === seq) setDocLoading(false);
    })();
  }, [initialDocId, email]);

  // ── Ask Mindy on this tab (OFF unless NEXT_PUBLIC_TAB_ASK=on) ────────────────────────────────
  // The question becomes THIS tab's search phrase (within the type pill the user picked) and reloads
  // THIS tab's list; Clear puts back exactly what was on screen before the first question, no request.
  const tabAskOn = isTabAskEnabled();
  const [askSnapshot, setAskSnapshot] = useState<null | { q: string; docs: KbDoc[]; facets: Facet[]; total: number }>(null);

  const handleTabAsk = async (p: KnowledgeBaseAskParams): Promise<TabAskCount> => {
    if (!askSnapshot) setAskSnapshot({ q, docs, facets, total });
    setQ(p.q);
    return fetchList(p.q, docType);
  };

  const clearTabAsk = () => {
    if (!askSnapshot) return;
    setQ(askSnapshot.q);
    setDocs(askSnapshot.docs);
    setFacets(askSnapshot.facets);
    setTotal(askSnapshot.total);
    setAskSnapshot(null);
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white">Knowledge Base</h1>
        <p className="text-muted mt-1 text-sm">
          Mindy&apos;s source library: winning proposals, templates, capability statements and training.
        </p>
      </div>

      {tabAskOn && (
        <div className="mb-4">
          <TabAskBox adapter={knowledgeBaseAskAdapter} onAsk={handleTabAsk} onClear={clearTabAsk} />
        </div>
      )}

      {/* Search + type filter */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') load(); }}
          placeholder="Search the knowledge base…"
          data-tip="knowledge-base-search"
          className="flex-1 min-w-[240px] h-10 px-3 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-emerald-500 focus:outline-none"
        />
        <button onClick={load} className="h-10 px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg">Search</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4" data-tip="knowledge-base-types">
        <button onClick={() => setDocType('')} className={`px-3 py-1 rounded-full text-xs ${!docType ? 'bg-emerald-600 text-white' : 'bg-surface text-muted hover:text-white'}`}>All ({total})</button>
        {facets.map(f => (
          <button key={f.docType} onClick={() => setDocType(f.docType)} className={`px-3 py-1 rounded-full text-xs ${docType === f.docType ? 'bg-emerald-600 text-white' : 'bg-surface text-muted hover:text-white'}`}>
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
        {/* List */}
        <div className="border border-surface rounded-xl bg-ground overflow-hidden" data-tip="knowledge-base-list">
          <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-800">
            {loading && <div className="p-4 text-sm text-faint">Loading…</div>}
            {!loading && docs.length === 0 && <div className="p-4 text-sm text-faint">No documents match.</div>}
            {docs.map(doc => (
              <button
                key={doc.id}
                onClick={() => openDoc(doc)}
                className={`w-full text-left px-4 py-3 hover:bg-surface/50 ${selected?.id === doc.id ? 'bg-surface/70 border-l-2 border-emerald-500' : 'border-l-2 border-transparent'}`}
              >
                <div className="text-sm font-medium text-white truncate">{doc.title}</div>
                <div className="text-[11px] text-faint mt-0.5">
                  {doc.docTypeLabel}{doc.pages ? ` · ${doc.pages}p` : doc.words ? ` · ${doc.words.toLocaleString()} words` : ''}
                </div>
                {doc.summary && <div className="text-xs text-muted mt-1 line-clamp-2">{doc.summary}</div>}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="border border-surface rounded-xl bg-ground overflow-hidden">
          {selected ? (
            <div className="flex flex-col h-full">
              <div className="px-5 py-3 border-b border-surface flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-white">{selected.title}</div>
                  <div className="text-xs text-faint mt-0.5">{selected.docTypeLabel}</div>
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
                  <div className="text-sm text-faint">Loading document…</div>
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-ink-soft leading-relaxed">{docText}</pre>
                )}
              </div>
            </div>
          ) : (
            <div className="p-10 text-center text-faint text-sm">Select a document to read it.</div>
          )}
        </div>
      </div>
    </div>
  );
}
