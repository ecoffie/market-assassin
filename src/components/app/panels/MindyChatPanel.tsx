'use client';

/**
 * MindyChatPanel — RAG-backed Q&A surface (#117 v1).
 *
 * Consumes the SSE stream from POST /api/app/chat. Single-session
 * UX: each visit starts fresh (DB still records exchanges for v1.1
 * resumable history).
 *
 * Layout: thin header → scrolling message list (auto-scroll on new) →
 * sticky input row. Empty state shows 4 starter prompt chips.
 *
 * Streaming render: tokens flush into the in-progress assistant
 * bubble as they arrive. After the stream emits `citations`, those
 * render as a small footer under that bubble.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

interface MindyChatPanelProps {
  email: string | null;
  tier: AppTier;
}

interface CitedSource {
  title: string;
  url: string | null;
  doc_type: string;
  source_path: string | null;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: CitedSource[];
  isStreaming?: boolean;
  errored?: boolean;
}

const STARTER_PROMPTS = [
  'How do I respond to a Sources Sought?',
  "What's the difference between 8(a) and HUBZone?",
  'How do I win my first federal contract with no past performance?',
  'Draft me a one-paragraph capability statement intro',
];

// Renders text with [→ Citation] markers turned into clickable links.
// Cheap inline replacement — splits on the bracket pattern, walks
// segments. v1 doesn't try to be markdown-smart beyond that.
function renderMessageContent(content: string, citations?: CitedSource[]) {
  const re = /\[→ ([^\]]+)\]/g;
  const segments: Array<{ kind: 'text' | 'cite'; value: string; href?: string | null }> = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > lastIdx) {
      segments.push({ kind: 'text', value: content.slice(lastIdx, m.index) });
    }
    const label = m[1];
    const matched = citations?.find(c =>
      (c.title || '').toLowerCase().includes(label.toLowerCase()) ||
      label.toLowerCase().includes((c.title || '').toLowerCase().slice(0, 30))
    );
    segments.push({ kind: 'cite', value: label, href: matched?.url || null });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < content.length) {
    segments.push({ kind: 'text', value: content.slice(lastIdx) });
  }

  return segments.map((seg, i) => {
    if (seg.kind === 'text') {
      // Render as whitespace-preserving plain text (newlines matter for lists)
      return <span key={i} className="whitespace-pre-wrap">{seg.value}</span>;
    }
    if (seg.href) {
      return (
        <a
          key={i}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-purple-300 hover:text-purple-200 underline decoration-purple-500/50 underline-offset-2"
        >
          [→ {seg.value}]
        </a>
      );
    }
    return (
      <span key={i} className="inline-flex items-center gap-0.5 text-purple-300/80">
        [→ {seg.value}]
      </span>
    );
  });
}

export default function MindyChatPanel({ email, tier: _tier }: MindyChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll on every render where messages or in-flight streaming changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || isStreaming || !email) return;

    // Build the history payload from existing messages BEFORE we mutate state
    const historyForServer = messages
      .filter(m => !m.errored)
      .slice(-6)
      .map(m => ({ role: m.role, content: m.content }));

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'user',
      content: text,
    };
    const assistantMsg: ChatMessage = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/app/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getMIApiHeaders(email),
        },
        body: JSON.stringify({
          email,
          message: text,
          sessionId: sessionId || undefined,
          history: historyForServer,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Chat ${res.status}: ${errBody.slice(0, 200) || 'no response body'}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let leftover = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = leftover + decoder.decode(value, { stream: true });
        const lines = text.split('\n');
        leftover = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === 'session' && evt.sessionId) {
              setSessionId(evt.sessionId);
            } else if (evt.type === 'token' && typeof evt.content === 'string') {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, content: m.content + evt.content } : m
              ));
            } else if (evt.type === 'citations' && Array.isArray(evt.sources)) {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, citations: evt.sources } : m
              ));
            } else if (evt.type === 'error') {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content || `Sorry — ${evt.message || 'something broke'}.`, errored: true, isStreaming: false }
                  : m
              ));
            } else if (evt.type === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
              ));
            }
          } catch {
            // Ignore unparseable lines — usually SSE keep-alive comments
          }
        }
      }
    } catch (err) {
      const errMsg = (err as Error)?.message || 'Stream failed';
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: m.content || `Couldn't reach Mindy: ${errMsg}`, errored: true, isStreaming: false }
          : m
      ));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [email, isStreaming, messages, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter sends; plain Enter inserts newline (Slack-style)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  if (!email) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400 text-sm">Sign in to chat with Mindy.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-73px)] bg-slate-950 text-white">
      {/* Header */}
      <header className="px-6 py-3 border-b border-slate-800 bg-slate-950/95 backdrop-blur shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">💬 Mindy Chat</h1>
              <span className="text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">BETA</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ask anything about federal contracting. Mindy cites her sources from your 8-year knowledge base.
            </p>
          </div>
          {messages.length > 0 && !isStreaming && (
            <button
              onClick={() => { setMessages([]); setSessionId(null); inputRef.current?.focus(); }}
              className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded border border-slate-700 hover:border-slate-600 transition-colors"
            >
              New chat
            </button>
          )}
        </div>
      </header>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="max-w-2xl mx-auto pt-12">
            <div className="text-center mb-8">
              <div className="text-4xl mb-3">💬</div>
              <h2 className="text-xl font-semibold text-white mb-1">What do you want to know?</h2>
              <p className="text-sm text-slate-400">
                Mindy draws on 743 podcast interviews, real proposal templates, and 8 years of federal contracting teaching.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  disabled={isStreaming}
                  className="text-left rounded-lg border border-slate-800 bg-slate-900/50 hover:border-purple-500/40 hover:bg-purple-500/5 transition-colors p-4 group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="text-sm text-slate-200 group-hover:text-white">{prompt}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map(msg => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={msg.role === 'user'
                  ? 'max-w-[80%] rounded-2xl rounded-tr-md bg-slate-800 border border-slate-700 px-4 py-3'
                  : 'max-w-[85%]'
                }>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-purple-300">Mindy</span>
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                      )}
                    </div>
                  )}
                  <div className={`text-[14.5px] leading-relaxed ${msg.errored ? 'text-red-300' : msg.role === 'user' ? 'text-slate-100' : 'text-slate-200'}`}>
                    {msg.content
                      ? renderMessageContent(msg.content, msg.citations)
                      : msg.isStreaming
                        ? <span className="text-slate-500 italic">Thinking…</span>
                        : null}
                  </div>
                  {msg.role === 'assistant' && !!msg.citations?.length && !msg.isStreaming && (
                    <div className="mt-3 pt-3 border-t border-slate-800/50">
                      <div className="text-[10px] font-semibold tracking-wider text-slate-500 mb-1.5">SOURCES</div>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.citations.slice(0, 6).map((c, i) => (
                          c.url ? (
                            <a
                              key={i}
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] px-2 py-1 rounded bg-slate-800/60 border border-slate-700/60 text-slate-300 hover:border-purple-500/40 hover:text-purple-200 transition-colors"
                            >
                              {c.title.slice(0, 50)}{c.title.length > 50 ? '…' : ''}
                            </a>
                          ) : (
                            <span
                              key={i}
                              className="text-[11px] px-2 py-1 rounded bg-slate-800/60 border border-slate-700/60 text-slate-400"
                              title={c.doc_type}
                            >
                              {c.title.slice(0, 50)}{c.title.length > 50 ? '…' : ''}
                            </span>
                          )
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? 'Mindy is thinking…' : 'Ask Mindy anything about federal contracting…'}
              disabled={isStreaming}
              rows={2}
              maxLength={2000}
              className="w-full resize-none rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 pr-24 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none disabled:opacity-60"
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-2">
              {isStreaming ? (
                <button
                  onClick={handleStop}
                  className="px-3 py-1.5 text-xs rounded-md bg-slate-700 hover:bg-slate-600 text-white"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="px-3 py-1.5 text-xs rounded-md bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium transition-colors"
                >
                  Send <span className="text-[10px] text-purple-200">⌘↵</span>
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>Press <span className="text-slate-400 font-mono">⌘ Enter</span> to send</span>
            <span>{input.length} / 2000</span>
          </div>
        </div>
      </div>
    </div>
  );
}
