'use client';
import { useState, useRef, useEffect } from 'react';

/**
 * Proposal Assist — Manual Drive chat (PRD v1). Perplexity-style: the user has
 * uploaded an RFP + has a Vault, and types what they want; this streams a
 * response grounded in THOSE docs via /api/app/proposal/chat. "See everything
 * happening" — tokens stream live.
 */
interface Msg { role: 'user' | 'assistant'; content: string }

const STARTERS = [
  'What does this RFP require for past performance?',
  'Draft the technical approach section.',
  'Summarize the key evaluation criteria.',
  'Write a capability statement opener using my Vault.',
];

export default function ProposalChat({ email, rfpText, rfpFileName, hasVault }: {
  email: string; rfpText: string; rfpFileName: string; hasVault: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || streaming) return;
    setInput('');
    const history = messages.slice(-6);
    setMessages(prev => [...prev, { role: 'user', content: msg }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    try {
      const res = await fetch('/api/app/proposal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, message: msg, rfpText, rfpFileName, history }),
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

  return (
    <section className="bg-slate-900 border border-purple-500/30 rounded-xl p-5 flex flex-col" style={{ minHeight: 460 }}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold text-white">🏎 Manual Drive — chat your proposal</h2>
        <span className="text-xs text-slate-500">Grounded in your files{hasVault ? ' + Vault' : ''}</span>
      </div>
      {/* active sources */}
      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        {rfpText ? <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">📄 {rfpFileName || 'Uploaded RFP'}</span> : <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-300">No RFP uploaded — upload one above for grounded answers</span>}
        {hasVault && <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">🗂 Your Vault</span>}
        {sources.length > 0 && <span className="text-slate-600">· drafting from {sources.length} source{sources.length === 1 ? '' : 's'}</span>}
      </div>

      {/* conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1" style={{ maxHeight: 360 }}>
        {messages.length === 0 ? (
          <div className="text-sm text-slate-400">
            <p className="mb-3">Tell Mindy what to write. She reads your uploaded RFP and Vault, and drafts grounded in your real info.</p>
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
            <div className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-left ${m.role === 'user' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-200'}`}>
              {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
            </div>
            {m.role === 'assistant' && m.content && !streaming && (
              <button onClick={() => copy(m.content)} className="mt-1 block text-[11px] text-slate-500 hover:text-slate-300">Copy</button>
            )}
          </div>
        ))}
      </div>

      {/* input */}
      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(input); }}
          placeholder="Draft a section, ask about the RFP, refine…"
          disabled={streaming}
          className="flex-1 h-10 px-3 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none disabled:opacity-50"
        />
        <button onClick={() => send(input)} disabled={streaming || !input.trim()} className="h-10 px-5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg">
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </section>
  );
}
