'use client';
import { useState, useRef, useEffect } from 'react';

/**
 * Proposal Assist — Manual Drive (Perplexity Spaces format). Two columns:
 *  - CENTER: the proposal chat (threads + a "Start a task" input). You type
 *    what you want; Mindy streams a response grounded in your files + Vault +
 *    the proposal RAG. "See everything happening."
 *  - RIGHT RAIL: Files (your uploaded context docs — add / remove) +
 *    Instructions (standing guidance applied to every answer).
 * Eric: match the Perplexity Spaces layout from the writeup.
 */
interface Msg { role: 'user' | 'assistant'; content: string }
interface FileRow { fileName: string; charCount?: number; pageCount?: number }

const STARTERS = [
  'What does this RFP require for past performance?',
  'Draft the technical approach section.',
  'Summarize the key evaluation criteria.',
  'Write a capability statement opener using my Vault.',
];

export default function ProposalChat({
  email, rfpText, rfpFileName, hasVault, files, onAddFile, onRemoveFile, uploading, pipelineId,
}: {
  email: string; rfpText: string; rfpFileName: string; hasVault: boolean;
  files: FileRow[]; onAddFile: (f: File) => void; onRemoveFile: (name: string) => void; uploading?: boolean;
  pipelineId?: string | null;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || streaming) return;
    setInput('');
    const history = messages.slice(-6);
    // Standing instructions are prepended so they shape every answer.
    const fullMsg = instructions.trim() ? `[Standing instructions: ${instructions.trim()}]\n\n${msg}` : msg;
    setMessages(prev => [...prev, { role: 'user', content: msg }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    try {
      const res = await fetch('/api/app/proposal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send pipeline_id so the server reuses the already-extracted docs +
        // cached matrix (Eric) instead of us re-sending the full text.
        body: JSON.stringify({ email, message: fullMsg, rfpText, rfpFileName, history, pipeline_id: pipelineId || undefined }),
      });
      if (!res.body) throw new Error('No stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let leftover = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = leftover + decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        leftover = lines.pop() || '';
        for (const line of lines) {
          const l = line.trim();
          if (!l.startsWith('data:')) continue;
          try {
            const ev = JSON.parse(l.slice(5).trim());
            if (ev.type === 'sources') setSources(ev.sources || []);
            else if (ev.type === 'token') {
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + ev.content };
                return next;
              });
            } else if (ev.type === 'error') {
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: `⚠️ ${ev.message}` };
                return next;
              });
            }
          } catch { /* keep-alive */ }
        }
      }
    } catch (e) {
      setMessages(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: `⚠️ ${(e as Error).message}` };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  };

  const copy = (text: string) => navigator.clipboard?.writeText(text);
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onAddFile(f);
    e.target.value = '';
  };

  return (
    <section className="bg-slate-900 border border-purple-500/30 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_300px]">
      {/* CENTER — chat */}
      <div className="flex flex-col p-5" style={{ minHeight: 480 }}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-white">🏎 Manual Drive — chat your proposal</h2>
          {sources.length > 0 && <span className="text-[11px] text-slate-500">drafting from {sources.length} source{sources.length === 1 ? '' : 's'}</span>}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1" style={{ maxHeight: 380 }}>
          {messages.length === 0 ? (
            <div className="text-sm text-slate-400">
              <p className="mb-3">Tell Mindy what to write. She reads your Files (right) + Vault + the proposal corpus, and drafts grounded in your real info.</p>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map(s => (
                  <button key={s} onClick={() => send(s)} className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 hover:border-purple-500/50 hover:text-white">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <div className={`inline-block max-w-[92%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-left ${m.role === 'user' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
                {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
              </div>
              {m.role === 'assistant' && m.content && !streaming && (
                <button onClick={() => copy(m.content)} className="mt-1 block text-[11px] text-slate-500 hover:text-slate-300">Copy</button>
              )}
            </div>
          ))}
        </div>

        {/* Start a task */}
        <div className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(input); }}
            placeholder="Start a task — draft a section, ask about the RFP, refine…"
            disabled={streaming}
            className="flex-1 h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
          />
          <button onClick={() => send(input)} disabled={streaming || !input.trim()} className="h-10 px-5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg">
            {streaming ? '…' : 'Send'}
          </button>
        </div>
      </div>

      {/* RIGHT RAIL — Files + Instructions (Perplexity Spaces) */}
      <aside className="border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950/40 p-4 flex flex-col gap-5">
        {/* Files */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Files in context</h3>
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs text-purple-300 hover:text-purple-200 disabled:opacity-50">
              {uploading ? 'Adding…' : '+ Add'}
            </button>
            <input ref={fileRef} type="file" className="hidden" onChange={onPick} accept=".pdf,.doc,.docx,.txt" />
          </div>
          <p className="text-[11px] text-slate-500 mb-2">Mindy reads everything here. Add or remove to control what she sees.</p>
          <div className="space-y-1.5">
            {files.length === 0 && !rfpText && (
              <p className="text-xs text-amber-300/80">No files yet — add an RFP/attachment so answers are grounded.</p>
            )}
            {files.map(f => (
              <div key={f.fileName} className="group flex items-center justify-between gap-2 rounded bg-slate-800/60 px-2 py-1.5 text-xs">
                <span className="truncate text-slate-300" title={f.fileName}>📄 {f.fileName}</span>
                <button onClick={() => onRemoveFile(f.fileName)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100" title="Remove from context">✕</button>
              </div>
            ))}
            {hasVault && (
              <div className="flex items-center gap-2 rounded bg-slate-800/40 px-2 py-1.5 text-xs text-slate-400">
                🗂 Your Vault <span className="text-[10px] text-slate-600">(always on)</span>
              </div>
            )}
            <div className="flex items-center gap-2 rounded bg-slate-800/40 px-2 py-1.5 text-xs text-slate-400">
              📚 Proposal corpus <span className="text-[10px] text-slate-600">(winning volumes)</span>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Instructions</h3>
          <p className="text-[11px] text-slate-500 mb-2">Standing guidance applied to every answer.</p>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="e.g. Write in plain language. Always cite the RFP section. Keep sections under 2 pages."
            rows={4}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none resize-none"
          />
        </div>
      </aside>
    </section>
  );
}
