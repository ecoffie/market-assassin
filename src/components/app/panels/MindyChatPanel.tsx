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
import { Menu, MessageCircle, BookOpen, Lock, FileText } from 'lucide-react';
import type { AppTier, AppPanel } from '../UnifiedSidebar';
import { authedFetch } from '../authHeaders';
import { UpgradeModal } from '../UpgradeModal';

interface MindyChatPanelProps {
  email: string | null;
  tier: AppTier;
  onPanelChange?: (panel: AppPanel, context?: Record<string, unknown>) => void;
}

interface CitedSource {
  title: string;
  url: string | null;
  doc_type: string;
  source_path: string | null;
  // Set for internal docs (course_material etc) — opens the doc in
  // the inline drawer instead of navigating to an external URL.
  document_id: string | null;
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

// Strip [→ X] markers from the message body — the server stopped
// emitting them as of v2 (May 31), but old messages persisted to
// mindy_chat_messages still have them. Cleaning at render keeps the
// chat history readable without a backfill migration. Also collapses
// any trailing space or double-space the strip leaves behind.
function renderMessageContent(content: string) {
  const cleaned = content
    .replace(/\s*\[→\s*[^\]]+\]\s*/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1');
  return <span className="whitespace-pre-wrap">{cleaned}</span>;
}

export default function MindyChatPanel({ email, tier, onPanelChange }: MindyChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  // Pro gate (Eric, Jun 2026): Mindy Chat retrieves from the proprietary KB,
  // so it's Pro-only. The /api/app/chat route enforces this server-side (403
  // pro_required); the modal is the friendly client-side surface. We open it
  // pre-emptively for known-free users and as a fallback if the API 403s
  // (covers stale tier props after a downgrade).
  const [showUpgrade, setShowUpgrade] = useState(false);
  const isFree = tier === 'free';
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Conversation history sidebar.
  const [sessions, setSessions] = useState<Array<{ id: string; title: string | null; message_count: number; updated_at: string }>>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Document drawer state: when set, opens RagDocDrawer with the
  // requested mindy_rag_documents.id loaded from /api/app/rag-doc.
  const [drawerDocId, setDrawerDocId] = useState<string | null>(null);
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

  // Track whether we've already consumed a voice-pivot seed for this
  // mount so React StrictMode's double-invoke can't fire it twice.
  const seedHandledRef = useRef(false);

  const sendMessage = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || isStreaming || !email) return;

    // Pro gate: don't even send for free users — show the upgrade modal.
    if (isFree) {
      setShowUpgrade(true);
      return;
    }

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
      const res = await authedFetch('/api/app/chat', email, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          message: text,
          sessionId: sessionId || undefined,
          history: historyForServer,
        }),
        signal: controller.signal,
      });

      if (res.status === 403) {
        // Server says Pro-required (e.g. tier prop stale after a downgrade).
        // Drop the optimistic bubbles and surface the upgrade modal instead
        // of a cryptic error.
        setMessages(prev => prev.filter(m => m.id !== userMsg.id && m.id !== assistantMsg.id));
        setShowUpgrade(true);
        return;
      }
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
  }, [email, isStreaming, messages, sessionId, isFree]);

  // --- Conversation history ----------------------------------------
  const loadSessions = useCallback(async () => {
    if (!email) return;
    try {
      const res = await authedFetch(`/api/app/chat-sessions?email=${encodeURIComponent(email)}`, email);
      const data = await res.json().catch(() => null);
      if (data?.success) setSessions(data.sessions || []);
    } catch { /* non-fatal */ }
  }, [email]);

  // Load the session list on mount.
  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Refresh the list when a stream finishes (a new session may have been
  // created, or an existing one's title/updated_at changed).
  useEffect(() => {
    if (!isStreaming) loadSessions();
  }, [isStreaming, loadSessions]);

  // Open a past conversation: load its messages into the view.
  const openSession = useCallback(async (sid: string) => {
    if (!email || loadingSession || sid === sessionId) return;
    setLoadingSession(true);
    try {
      const res = await authedFetch(`/api/app/chat-sessions?email=${encodeURIComponent(email)}&sessionId=${encodeURIComponent(sid)}`, email);
      const data = await res.json().catch(() => null);
      if (data?.success) {
        setMessages((data.messages || []).map((m: { id: string; role: 'user' | 'assistant'; content: string; cited_sources?: CitedSource[] }) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: Array.isArray(m.cited_sources) ? m.cited_sources : undefined,
        })));
        setSessionId(sid);
      }
    } catch { /* non-fatal */ } finally {
      setLoadingSession(false);
    }
  }, [email, loadingSession, sessionId]);

  // Start a fresh conversation.
  const startNewChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    inputRef.current?.focus();
  }, []);

  // Delete a conversation from history.
  const deleteSession = useCallback(async (sid: string) => {
    if (!email) return;
    setSessions(prev => prev.filter(s => s.id !== sid));  // optimistic
    if (sid === sessionId) startNewChat();
    try {
      await authedFetch('/api/app/chat-sessions', email, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, sessionId: sid }),
      });
    } catch { loadSessions(); /* rollback by refetch */ }
  }, [email, sessionId, startNewChat, loadSessions]);

  // Voice-pivot handoff: when the voice modal classifies the user's
  // recording as a question (not a pursuit), it stashes the transcript
  // in sessionStorage and switches the panel to 'chat'. We pick it up
  // here on mount and auto-send so the user sees Mindy answering
  // without having to retype.
  useEffect(() => {
    if (seedHandledRef.current || !email) return;
    let seed: string | null = null;
    try {
      seed = sessionStorage.getItem('mindy_chat_seed');
      if (seed) sessionStorage.removeItem('mindy_chat_seed');
    } catch {
      // sessionStorage unavailable (e.g. iOS private browsing) — skip
    }
    if (seed && seed.trim()) {
      seedHandledRef.current = true;
      // Defer so React commits the state for `messages` before we
      // start streaming. Without this, sendMessage's history snapshot
      // sees a stale empty list — fine here, but the defer keeps
      // behavior predictable if we later add greeting state.
      setTimeout(() => sendMessage(seed!.trim()), 50);
    }
  }, [email, sendMessage]);

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
    <div className="flex h-[calc(100vh-73px)] bg-slate-950 text-white">
      {/* Conversation history sidebar */}
      {sidebarOpen && (
        <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-900/40 flex flex-col">
          <div className="p-3 shrink-0">
            <button
              onClick={startNewChat}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-2 text-sm font-medium text-white transition-colors"
            >
              + New chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-600">History</div>
            {sessions.length === 0 ? (
              <div className="px-2 py-2 text-xs text-slate-600">No saved conversations yet.</div>
            ) : (
              sessions.map(s => (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                    s.id === sessionId ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                  }`}
                  onClick={() => openSession(s.id)}
                >
                  <span className="min-w-0 flex-1 truncate" title={s.title || 'Untitled'}>
                    {s.title || 'Untitled'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 text-xs px-1"
                    title="Delete conversation"
                    aria-label="Delete conversation"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* Main chat column */}
      <div className="flex flex-col flex-1 min-w-0">
      {/* Header */}
      <header className="px-6 py-3 border-b border-slate-800 bg-slate-950/95 backdrop-blur shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="inline-flex items-center text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
              title={sidebarOpen ? 'Hide history' : 'Show history'}
              aria-label="Toggle conversation history"
            >
              <Menu className="h-5 w-5" strokeWidth={2} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="inline-flex items-center gap-1.5 text-lg font-semibold"><MessageCircle className="h-5 w-5 shrink-0 text-accent" strokeWidth={2} /> Mindy Chat</h1>
                <span className="text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">BETA</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Ask anything about federal contracting. Mindy cites her sources from your 8-year knowledge base.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* KB entry point (Eric: KB lives off the sidebar; reached from chat
                where its citations come from). */}
            {onPanelChange && (
              <button
                onClick={() => onPanelChange('knowledge-base')}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded border border-slate-700 hover:border-slate-600 transition-colors"
                title="Browse the documents Mindy cites"
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> Browse sources
              </button>
            )}
            {messages.length > 0 && !isStreaming && (
              <button
                onClick={startNewChat}
                className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded border border-slate-700 hover:border-slate-600 transition-colors"
              >
                New chat
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        {isFree && messages.length === 0 ? (
          // Pro-locked empty state — Mindy Chat retrieves from the proprietary
          // knowledge base, so it's a Pro feature. Show the value + a CTA.
          <div className="max-w-2xl mx-auto pt-12">
            <div className="text-center mb-8">
              <div className="relative inline-flex mb-3">
                <MessageCircle className="h-10 w-10 text-faint" strokeWidth={1.5} />
                <Lock className="absolute -bottom-1 -right-1 h-5 w-5 text-accent" strokeWidth={2} />
              </div>
              <h2 className="text-xl font-semibold text-white mb-1">Mindy Chat is a Pro feature</h2>
              <p className="text-sm text-slate-400 max-w-lg mx-auto">
                Ask Mindy anything about federal contracting and get a straight answer,
                grounded in 743 podcast interviews, real proposal templates, and 8 years
                of teaching — with her sources cited.
              </p>
            </div>
            <div className="text-center">
              <button
                onClick={() => setShowUpgrade(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 hover:bg-purple-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors"
              >
                Upgrade to Pro to chat
              </button>
            </div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3 opacity-50 pointer-events-none">
              {STARTER_PROMPTS.map((prompt) => (
                <div
                  key={prompt}
                  className="text-left rounded-lg border border-slate-800 bg-slate-900/50 p-4"
                >
                  <div className="text-sm text-slate-300">{prompt}</div>
                </div>
              ))}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="max-w-2xl mx-auto pt-12">
            <div className="text-center mb-8">
              <MessageCircle className="h-10 w-10 mx-auto mb-3 text-accent" strokeWidth={1.5} />
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
                      ? renderMessageContent(msg.content)
                      : msg.isStreaming
                        ? <span className="text-slate-500 italic">Thinking…</span>
                        : null}
                  </div>
                  {msg.role === 'assistant' && !!msg.citations?.length && !msg.isStreaming && (
                    <div className="mt-3 pt-3 border-t border-slate-800/50">
                      <div className="text-[10px] font-semibold tracking-wider text-slate-500 mb-1.5">DOCUMENTS REFERENCED</div>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.citations.slice(0, 6).map((c, i) => {
                          const label = c.title.slice(0, 50) + (c.title.length > 50 ? '…' : '');
                          // Source doc → deep-link into the Knowledge Base page
                          // (the browsable repository), so "show me the source"
                          // lands on the real, searchable doc — not a dead end.
                          // Falls back to the inline drawer if navigation isn't
                          // wired.
                          if (c.document_id) {
                            return (
                              <button
                                key={i}
                                onClick={() => onPanelChange
                                  ? onPanelChange('knowledge-base', { doc: c.document_id })
                                  : setDrawerDocId(c.document_id)}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-800/60 border border-slate-700/60 text-slate-300 hover:border-purple-500/40 hover:text-purple-200 transition-colors cursor-pointer text-left"
                                title={`Open in Knowledge Base · ${c.doc_type || ''}`}
                              >
                                <FileText className="h-3 w-3 shrink-0" strokeWidth={2} /> {label}
                              </button>
                            );
                          }
                          // External URL (podcast libsyn) — open in new tab
                          if (c.url) {
                            return (
                              <a
                                key={i}
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] px-2 py-1 rounded bg-slate-800/60 border border-slate-700/60 text-slate-300 hover:border-purple-500/40 hover:text-purple-200 transition-colors"
                              >
                                {label}
                              </a>
                            );
                          }
                          // No URL, no document_id — render plain so it
                          // doesn't look interactive when nothing happens.
                          return (
                            <span
                              key={i}
                              className="text-[11px] px-2 py-1 rounded bg-slate-800/60 border border-slate-700/60 text-slate-400"
                              title={c.doc_type}
                            >
                              {label}
                            </span>
                          );
                        })}
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
      </div>{/* end main chat column */}

      {/* Inline doc drawer — opens when a citation chip targets an
          internal mindy_rag_documents row (course material etc) */}
      {drawerDocId && email && (
        <RagDocDrawer
          docId={drawerDocId}
          email={email}
          onClose={() => setDrawerDocId(null)}
        />
      )}

      {/* Pro-gate upsell — shown when a free user tries to chat */}
      {showUpgrade && (
        <UpgradeModal featureId="chat" onClose={() => setShowUpgrade(false)} />
      )}
    </div>
  );
}

interface RagDocDrawerProps {
  docId: string;
  email: string;
  onClose: () => void;
}

interface RagDoc {
  id: string;
  title: string;
  doc_type: string | null;
  folder: string | null;
  source_path: string | null;
  full_text: string;
  word_count: number | null;
}

/**
 * Right-anchored drawer that fetches and displays a single
 * mindy_rag_documents row. Lazy load: only fires the API call when
 * docId changes. ESC to close, click backdrop to close.
 */
function RagDocDrawer({ docId, email, onClose }: RagDocDrawerProps) {
  const [doc, setDoc] = useState<RagDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDoc(null);
    // Must send the MI auth headers — /api/app/rag-doc is gated by
    // verifyUserOwnsEmail. Without them the fetch 401'd and clicking a
    // citation chip "went nowhere".
    authedFetch(`/api/app/rag-doc?email=${encodeURIComponent(email)}&id=${encodeURIComponent(docId)}`, email)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Load failed (${res.status})`);
        }
        return res.json();
      })
      .then((data: RagDoc) => { if (!cancelled) { setDoc(data); setLoading(false); } })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [docId, email]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close drawer"
      />
      {/* Drawer */}
      <div className="w-full max-w-xl bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl">
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="min-w-0 pr-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              {doc?.folder || doc?.doc_type || 'Document'}
            </div>
            <div className="text-sm font-semibold text-white truncate">
              {doc?.title || (loading ? 'Loading…' : 'Document')}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="text-sm text-slate-400">Loading document…</div>
          )}
          {error && (
            <div className="rounded border border-red-900/60 bg-red-950/30 text-red-200 text-sm p-3">
              {error}
            </div>
          )}
          {doc && !loading && (
            <>
              {doc.word_count && (
                <div className="text-[11px] text-slate-500 mb-3">
                  {doc.word_count.toLocaleString()} words
                </div>
              )}
              <div className="text-[14.5px] text-slate-200 whitespace-pre-wrap leading-relaxed">
                {doc.full_text}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
