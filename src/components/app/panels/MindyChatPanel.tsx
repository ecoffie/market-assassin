'use client';

/**
 * MindyChatPanel — RAG-backed Q&A surface (#117 v1).
 *
 * Consumes the SSE stream from POST /api/app/chat. Single-session
 * UX: each visit starts fresh (DB still records exchanges for v1.1
 * resumable history).
 *
 * Layout: thin header → scrolling message list (auto-scroll on new) →
 * sticky input row. Empty state is blank (no starter prompt ideas).
 *
 * Streaming render: tokens flush into the in-progress assistant
 * bubble as they arrive. After the stream emits `citations`, those
 * render as a small footer under that bubble.
 */

import { customerErrorMessage, CUSTOMER_ERROR_MESSAGES } from '@/lib/chat/customer-errors';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, MessageCircle, BookOpen, Lock, FileText, X } from 'lucide-react';
import type { AppTier, AppPanel } from '../UnifiedSidebar';
import { authedFetch } from '../authHeaders';
import { ChatAttachments } from '../chat/ChatAttachments';
import type { GeneratedDownloadFile } from '../chat/GeneratedDownloadChips';
import { ChatReportPreview, type ChatInlineReport } from '../chat/ChatReportPreview';
import { useVaultCapabilities } from '../chat/useVaultCapabilities';
import { UpgradeModal } from '../UpgradeModal';
import { renderSafeMarkdown } from '@/lib/chat/safe-markdown';
import { startProposalFromNotice } from '@/lib/chat/start-proposal';
import {
  CHAT_HANDOFF_KEY,
  LAST_CHAT_SESSION_KEY,
  MAP_SELECTED_OPP_KEY,
  parseChatHandoff,
  parseLastChatSessionId,
  parseMapSelectedOpp,
  serializeMapSelectedOpp,
  opportunityContextField,
  type AttachedOpportunity,
} from '@/lib/chat/chat-handoff';
import { customerText } from '@/lib/chat/view-preamble';

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

/**
 * Where a citation chip goes. A Knowledge Base doc opens the KB; a SAM.gov notice (doc_type 'sam_notice') is
 * NEVER a KB doc, even when an older saved answer carries its notice id in document_id: it opens its SAM.gov
 * link (review on #2106: the chip opened the Knowledge Base on a non-KB id).
 */
export function citationTarget(c: Pick<CitedSource, 'doc_type' | 'url' | 'document_id'>): 'kb' | 'url' | 'none' {
  if (c.document_id && c.doc_type !== 'sam_notice') return 'kb';
  if (c.url) return 'url';
  return 'none';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: CitedSource[];
  isStreaming?: boolean;
  errored?: boolean;
  followups?: string[]; // contextual "what next?" chips, fetched after the answer completes
  notices?: string[];   // server notices: data tools unavailable, a lookup failed, answer cut off
  /** P3: the compact source ledger returned with this answer; re-sent with history so "#12" resolves. */
  ledger?: unknown;
  /** W2: create_document files saved this turn — in-chat download chips mint signed URLs on click. */
  deliverables?: GeneratedDownloadFile[];
  deliverablePdfNote?: string | null;
  /** Packaged generate_market_report: the rendered report HTML, read in the chat (not persisted in History). */
  report?: ChatInlineReport;
}


// Strip [→ X] markers from the message body — the server stopped
// emitting them as of v2 (May 31), but old messages persisted to
// mindy_chat_messages still have them. Cleaning at render keeps the
// chat history readable without a backfill migration. Also collapses
// any trailing space or double-space the strip leaves behind.
export function renderMessageContent(content: string, asMarkdown = false) {
  // Export lives in the open report pane — never show vault download paths as chat bullets.
  const cleaned = content
    .replace(/\s*\[→\s*[^\]]+\]\s*/g, ' ')
    .replace(/^\s*[-*•]\s*(?:\[[^\]]*\]\()?\/?api\/app\/vault\/documents\/download[^\n)]*\)?\s*$/gim, '')
    .replace(/(?:https?:\/\/[^\s)]+)?\/api\/app\/vault\/documents\/download\?[^\s)]+/gi, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!asMarkdown) return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{cleaned}</span>;
  // Assistant answers: the shared SAFE renderer (src/lib/chat/safe-markdown.ts) HTML-escapes the model text
  // first and only then writes its own markup for a small markdown subset (http(s) links only), so this
  // innerHTML never contains unescaped model text. Before 2026-11-15 the raw **, ###, - and [text](url)
  // showed literally.
  return (
    <div
      className={MD_CLASSES}
      dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(cleaned) }}
    />
  );
}

const MD_CLASSES = [
  'mindy-md [overflow-wrap:anywhere] break-words',
  '[&_p]:my-0 [&_p+p]:mt-2.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li>ul]:my-1',
  '[&_strong]:font-semibold [&_strong]:text-slate-50 [&_em]:italic',
  '[&_.md-h]:font-semibold [&_.md-h]:text-slate-50 [&_.md-h]:mt-3 [&_.md-h]:mb-1 [&_.md-h:first-child]:mt-0 [&_.md-h1]:text-[16px] [&_.md-h2]:text-[15px] [&_.md-h3]:text-[14.5px]',
  '[&_a]:text-purple-300 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-purple-200 [&_a]:break-words',
  '[&_code]:font-mono [&_code]:text-[13px] [&_code]:bg-white/5 [&_code]:rounded [&_code]:px-1',
  // GFM tables (e.g. Coming back recompetes): scroll sideways on narrow screens instead of overflowing.
  '[&_.md-table]:my-3 [&_.md-table]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px]',
  '[&_th]:text-left [&_th]:font-semibold [&_th]:text-slate-100 [&_th]:border-b [&_th]:border-white/15 [&_th]:px-2 [&_th]:py-1.5 [&_th]:whitespace-nowrap',
  '[&_td]:border-b [&_td]:border-white/5 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top',
  // Narrow panel: cells and the links in them wrap at word boundaries only (the container's
  // overflow-wrap:anywhere broke holder names mid-word); the value column stays on one line; every
  // column stays visible at panel width. 2026-11-16.
  '[&_td]:[overflow-wrap:normal] [&_td]:[word-break:normal] [&_td_a]:![overflow-wrap:normal] [&_td_a]:![word-break:normal] [&_td:first-child]:min-w-[8rem] [&_td:nth-child(2)]:whitespace-nowrap',
].join(' ');

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
  // Attach button: on only when the SERVER says this account may upload (global flag or allowlist).
  const vaultCaps = useVaultCapabilities(email);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Attaching a file before the first question needs a conversation id: mint one here; the upload route
  // creates the conversation row only when the file is actually saved.
  const ensureSessionId = useCallback((): string => {
    if (sessionId) return sessionId;
    const sid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, '0').slice(0, 8)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
    setSessionId(sid);
    return sid;
  }, [sessionId]);
  // The opportunity this conversation is about (from the Map drawer's "Open in full workspace"). Shown as a
  // removable chip; only its id is sent.
  const [attachedOpp, setAttachedOpp] = useState<AttachedOpportunity | null>(null);
  const [proposalState, setProposalState] = useState<'idle' | 'working' | 'failed'>('idle');
  // Set when the Map hands off into this workspace — shows "Back to Map" without dropping the session.
  const [fromMap, setFromMap] = useState(false);
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
      .map(m => ({ role: m.role, content: m.content, ...(m.role === 'assistant' && m.ledger ? { sources: m.ledger } : {}) }));

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
          ...opportunityContextField(attachedOpp),
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
        // B2: the response body is never shown (it can carry server or provider detail).
        console.error('[MindyChat] chat request failed', res.status);
        setMessages(prev => prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: customerErrorMessage('service_unavailable'), errored: true, isStreaming: false }
            : m
        ));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let leftover = '';
      let finalContent = ''; // full answer text — used to fetch contextual follow-ups
      // Follow-ups only after a real outcome: a downloadable/report, or a finished
      // Q&A answer. Never invent "what next?" chips while the turn is still gathering.
      let sawOutcome = false;
      let turnErrored = false;

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
              finalContent += evt.content;
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, content: m.content + evt.content } : m
              ));
            } else if (evt.type === 'deliverables' && Array.isArray(evt.files)) {
              const files = (evt.files as GeneratedDownloadFile[]).filter(
                (f) => f && typeof f.document_id === 'string' && typeof f.format === 'string',
              );
              if (files.length) {
                sawOutcome = true;
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        deliverables: files,
                        ...(typeof evt.pdf_note === 'string' ? { deliverablePdfNote: evt.pdf_note } : {}),
                      }
                    : m
                ));
              }
            } else if (evt.type === 'market_report' && typeof evt.html === 'string' && evt.html) {
              sawOutcome = true;
              const report: ChatInlineReport = {
                html: evt.html,
                title: typeof evt.title === 'string' && evt.title ? evt.title : 'Market report',
                url: typeof evt.url === 'string' ? evt.url : null,
              };
              setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, report } : m));
            } else if (evt.type === 'sources' && evt.ledger && typeof evt.ledger === 'object') {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, ledger: evt.ledger } : m
              ));
            } else if (evt.type === 'citations' && Array.isArray(evt.sources)) {
              if (evt.sources.length) sawOutcome = true;
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, citations: evt.sources } : m
              ));
            } else if ((evt.type === 'notice' || evt.type === 'progress') && typeof evt.message === 'string') {
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id ? { ...m, notices: [...(m.notices || []), evt.message] } : m
              ));
            } else if (evt.type === 'error') {
              turnErrored = true;
              setMessages(prev => prev.map(m =>
                m.id === assistantMsg.id
                  // B2: only messages from the fixed customer-safe table are displayed verbatim.
                  ? { ...m, content: m.content || (CUSTOMER_ERROR_MESSAGES.includes(evt.message) ? evt.message : customerErrorMessage('answer_unavailable')), errored: true, isStreaming: false }
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

      // Contextual "what next?" chips — only after an outcome lands (files, report,
      // citations, or a finished Q&A answer). Never while the turn failed or is empty.
      const answerOutcome = !turnErrored && finalContent.trim().length >= 80;
      if (sawOutcome || answerOutcome) {
        authedFetch('/api/app/chat/suggestions', email, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, message: text, answer: finalContent }),
        })
          .then(r => r.json())
          .then(d => {
            const s = Array.isArray(d?.suggestions) ? d.suggestions.filter((x: unknown): x is string => typeof x === 'string') : [];
            if (s.length) setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, followups: s } : m));
          })
          .catch(() => { /* no chips on failure */ });
      }
    } catch (err) {
      console.error('[MindyChat] stream failed', err);
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: m.content || customerErrorMessage('connection_failed'), errored: true, isStreaming: false }
          : m
      ));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [email, isStreaming, messages, sessionId, isFree, attachedOpp]);

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
        setMessages((data.messages || []).map((m: {
          id: string;
          role: 'user' | 'assistant';
          content: string;
          cited_sources?: CitedSource[];
          deliverables?: { files?: GeneratedDownloadFile[]; pdf_note?: string };
        }) => {
          const files = Array.isArray(m.deliverables?.files)
            ? m.deliverables!.files!.filter((f) => f && typeof f.document_id === 'string' && typeof f.format === 'string')
            : undefined;
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            citations: Array.isArray(m.cited_sources) ? m.cited_sources : undefined,
            ...(files?.length ? { deliverables: files } : {}),
            ...(typeof m.deliverables?.pdf_note === 'string' ? { deliverablePdfNote: m.deliverables.pdf_note } : {}),
          };
        }));
        setSessionId(sid);
      }
    } catch { /* non-fatal */ } finally {
      setLoadingSession(false);
    }
  }, [email, loadingSession, sessionId]);

  // Drop a Map selection the customer explicitly dismissed (chip X / New chat) so remount does not re-attach it.
  const clearMapSelectedOpp = useCallback(() => {
    try { sessionStorage.setItem(MAP_SELECTED_OPP_KEY, serializeMapSelectedOpp(null)); } catch { /* unavailable */ }
  }, []);

  // Start a fresh conversation.
  const startNewChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setAttachedOpp(null);
    try { sessionStorage.removeItem(LAST_CHAT_SESSION_KEY); } catch { /* unavailable */ }
    clearMapSelectedOpp();
    inputRef.current?.focus();
  }, [clearMapSelectedOpp]);

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

  // Persist the active session so Map ↔ Chat remounts do not wipe an in-progress conversation.
  // Never clear on the initial null mount — that would erase the key before the boot restore runs.
  useEffect(() => {
    if (!sessionId) return;
    try { sessionStorage.setItem(LAST_CHAT_SESSION_KEY, sessionId); } catch { /* unavailable */ }
  }, [sessionId]);

  // Boot once: drawer handoff (consume) → else last session + Map selection (peek). Never auto-sends.
  // Map selection uses the same context.notice_id path the server already loads authoritatively.
  const handoffHandledRef = useRef(false);
  useEffect(() => {
    if (handoffHandledRef.current || !email) return;
    handoffHandledRef.current = true;
    let handoffRaw: string | null = null;
    let mapRaw: string | null = null;
    let lastRaw: string | null = null;
    let fromMapFlag = false;
    try {
      handoffRaw = sessionStorage.getItem(CHAT_HANDOFF_KEY);
      if (handoffRaw) sessionStorage.removeItem(CHAT_HANDOFF_KEY);
      mapRaw = sessionStorage.getItem(MAP_SELECTED_OPP_KEY);
      lastRaw = sessionStorage.getItem(LAST_CHAT_SESSION_KEY);
      fromMapFlag = sessionStorage.getItem('mindy_chat_from_map') === '1';
      if (fromMapFlag) sessionStorage.removeItem('mindy_chat_from_map');
    } catch { /* sessionStorage unavailable */ }
    const h = parseChatHandoff(handoffRaw);
    const mapOpp = parseMapSelectedOpp(mapRaw);
    const lastSid = parseLastChatSessionId(lastRaw);
    if (fromMapFlag || h || mapOpp) setFromMap(true);
    if (h?.opportunity) setAttachedOpp(h.opportunity);
    else if (mapOpp) setAttachedOpp(mapOpp);
    if (h?.sessionId) openSession(h.sessionId);
    else if (lastSid) openSession(lastSid);
    if (h || mapOpp || lastSid) inputRef.current?.focus();
  }, [email, openSession]);

  // "Start a proposal" (user click only): track the attached notice, make sure its documents are fetched,
  // and open Proposals on that pursuit. See src/lib/chat/start-proposal.ts.
  const startProposal = useCallback(async () => {
    if (!email || !attachedOpp || proposalState === 'working') return;
    setProposalState('working');
    const r = await startProposalFromNotice(
      (url, init) => authedFetch(url, email, init),
      email,
      { notice_id: attachedOpp.notice_id, title: attachedOpp.title, deadline: attachedOpp.deadline },
    );
    if (!r.ok) { setProposalState('failed'); return; }
    setProposalState('idle');
    if (onPanelChange) onPanelChange('proposals', { pursuit_id: r.pursuitId });
    else window.location.href = r.href;
  }, [email, attachedOpp, proposalState, onPanelChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline (Claude-style). Cmd/Ctrl+Enter still sends.
    // Ignore Enter while an IME composition is in progress (e.g. Japanese/Chinese input).
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.shiftKey) return;
    e.preventDefault();
    if (!isStreaming) sendMessage(input);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  if (!email) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted text-sm">Sign in to chat with Mindy.</div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-73px)] bg-ground-deep text-white">
      {/* Conversation history sidebar */}
      {sidebarOpen && (
        <aside className="w-60 shrink-0 border-r border-surface bg-ground/40 flex flex-col">
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
                    s.id === sessionId ? 'bg-surface text-white' : 'text-ink-soft hover:bg-surface/60'
                  }`}
                  onClick={() => openSession(s.id)}
                >
                  <span className="min-w-0 flex-1 truncate" title={s.title || 'Untitled'}>
                    {s.title || 'Untitled'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-faint hover:text-red-400 text-xs px-1"
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
      <header className="px-6 py-3 border-b border-surface bg-ground-deep/95 backdrop-blur shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="inline-flex items-center text-muted hover:text-white p-1 rounded hover:bg-surface transition-colors"
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
              <p className="text-xs text-faint mt-0.5">
                Ask anything about federal contracting. Mindy cites her sources from your 8-year knowledge base.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {fromMap && onPanelChange && (
              <button
                type="button"
                data-testid="back-to-map"
                onClick={() => onPanelChange('map')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-200 hover:text-white px-3 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors"
                title="Return to the Opportunity Map — this conversation stays in History"
              >
                ← Back to Map
              </button>
            )}
            {/* KB entry point (Eric: KB lives off the sidebar; reached from chat
                where its citations come from). */}
            {onPanelChange && (
              <button
                onClick={() => onPanelChange('knowledge-base')}
                className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-slate-200 px-3 py-1.5 rounded border border-hairline hover:border-slate-600 transition-colors"
                title="Browse the documents Mindy cites"
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> Browse sources
              </button>
            )}
            {messages.length > 0 && !isStreaming && (
              <button
                onClick={startNewChat}
                className="text-xs text-muted hover:text-slate-200 px-3 py-1.5 rounded border border-hairline hover:border-slate-600 transition-colors"
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
              <p className="text-sm text-muted max-w-lg mx-auto">
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
          </div>
        ) : messages.length === 0 ? (
          // Blank start — no starter chips, no how-to, no prompt ideas. The input is the product.
          <div className="flex-1" data-testid="ask-mindy-blank" aria-hidden />
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map(msg => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={msg.role === 'user'
                  ? 'max-w-[80%] rounded-2xl rounded-tr-md bg-surface border border-hairline px-4 py-3'
                  : (msg.report || msg.deliverables?.length) ? 'w-full' : 'max-w-[85%]'
                }>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-purple-300">Mindy</span>
                      {msg.isStreaming && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                      )}
                    </div>
                  )}
                  {/* Report first; Export lives in the open pane header (Claude/ChatGPT), not under the answer. */}
                  {msg.role === 'assistant' && !msg.isStreaming && !msg.errored && email && msg.report && (
                    <ChatReportPreview email={email} inline={msg.report} files={msg.deliverables} pdfNote={msg.deliverablePdfNote} />
                  )}
                  {msg.role === 'assistant' && !msg.isStreaming && !msg.errored && email && !msg.report && !!msg.deliverables?.length && (
                    <ChatReportPreview email={email} files={msg.deliverables} pdfNote={msg.deliverablePdfNote} />
                  )}
                  <div className={`text-[14.5px] leading-relaxed ${msg.errored ? 'text-red-300' : msg.role === 'user' ? 'text-slate-100' : 'text-slate-200'}`}>
                    {msg.content
                      // A Map conversation's user turn carries the Map view preamble for the model; the
                      // bubble shows only what the customer typed (history still sends msg.content as stored).
                      ? renderMessageContent(msg.role === 'user' ? customerText(msg.content) : msg.content, msg.role === 'assistant' && !msg.errored)
                      : msg.isStreaming
                        ? <span className="text-faint italic">Thinking…</span>
                        : null}
                  </div>
                  {msg.role === 'assistant' && !!msg.citations?.length && !msg.isStreaming && (
                    <div className="mt-3 pt-3 border-t border-surface/50">
                      <div className="text-[10px] font-semibold tracking-wider text-faint mb-1.5">SOURCES</div>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.citations.slice(0, 6).map((c, i) => {
                          const label = c.title.slice(0, 50) + (c.title.length > 50 ? '…' : '');
                          // Source doc → deep-link into the Knowledge Base page
                          // (the browsable repository), so "show me the source"
                          // lands on the real, searchable doc — not a dead end.
                          // Falls back to the inline drawer if navigation isn't
                          // wired.
                          const target = citationTarget(c);
                          if (target === 'kb' && c.document_id) {
                            return (
                              <button
                                key={i}
                                onClick={() => onPanelChange
                                  ? onPanelChange('knowledge-base', { doc: c.document_id })
                                  : setDrawerDocId(c.document_id)}
                                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-surface/60 border border-hairline/60 text-ink-soft hover:border-purple-500/40 hover:text-purple-200 transition-colors cursor-pointer text-left"
                                title={`Open in Knowledge Base · ${c.doc_type || ''}`}
                              >
                                <FileText className="h-3 w-3 shrink-0" strokeWidth={2} /> {label}
                              </button>
                            );
                          }
                          // External URL (podcast libsyn) — open in new tab
                          if (target === 'url' && c.url) {
                            return (
                              <a
                                key={i}
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] px-2 py-1 rounded bg-surface/60 border border-hairline/60 text-ink-soft hover:border-purple-500/40 hover:text-purple-200 transition-colors"
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
                              className="text-[11px] px-2 py-1 rounded bg-surface/60 border border-hairline/60 text-muted"
                              title={c.doc_type}
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {msg.role === 'assistant' && !!msg.notices?.length && (
                    <div className="mt-2 space-y-1" role="status">
                      {msg.notices.map((n, i) => (
                        <div key={i} className="text-[12px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">{n}</div>
                      ))}
                    </div>
                  )}
                  {/* Contextual follow-up chips — "what next?" after an answer.
                      Clicking sends the suggestion straight back to Mindy. */}
                  {msg.role === 'assistant' && !!msg.followups?.length && !msg.isStreaming && (
                    <div className="mt-3 pt-3 border-t border-surface/50">
                      <div className="text-[10px] font-semibold tracking-wider text-faint mb-1.5">SUGGESTED NEXT STEPS</div>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.followups.slice(0, 3).map((f, i) => (
                          <button
                            key={i}
                            onClick={() => sendMessage(f)}
                            disabled={isStreaming}
                            className="inline-flex items-center gap-1 text-[11.5px] px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-200 hover:bg-purple-500/20 hover:border-purple-400/50 disabled:opacity-50 disabled:cursor-default transition-colors text-left"
                          >
                            {f}
                          </button>
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
      <div className="px-6 py-4 border-t border-surface bg-ground-deep shrink-0">
        <div className="max-w-3xl mx-auto">
          {attachedOpp && (
            <div data-testid="attached-opp" className="mb-2 flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-[12.5px] text-purple-100">
              <span className="text-faint shrink-0">Asking about</span>
              <span className="font-medium truncate" title={attachedOpp.title}>{attachedOpp.title || 'this opportunity'}</span>
              {attachedOpp.deadline && <span className="text-faint shrink-0">· due {attachedOpp.deadline.slice(0, 10)}</span>}
              <button
                type="button"
                onClick={startProposal}
                disabled={proposalState === 'working'}
                title="Saves this opportunity to My Pursuits, then opens Proposals"
                className="ml-auto shrink-0 rounded-md border border-purple-400/40 px-2 py-0.5 text-[11.5px] font-medium text-purple-100 hover:bg-purple-500/20 disabled:opacity-60"
              >
                {proposalState === 'working' ? 'Starting…' : proposalState === 'failed' ? 'Try again' : 'Start a proposal'}
                <span className="block text-[10px] font-normal text-faint">Saves to My Pursuits</span>
              </button>
              <button
                type="button"
                onClick={() => { setAttachedOpp(null); setProposalState('idle'); clearMapSelectedOpp(); }}
                aria-label="Remove this opportunity from the question"
                className="shrink-0 rounded p-0.5 text-faint hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {vaultCaps.uploads && email && !isFree && (
            <ChatAttachments email={email} sessionId={sessionId} ensureSessionId={ensureSessionId} disabled={isStreaming} />
          )}
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
              className="w-full resize-none rounded-xl border border-hairline bg-ground px-4 py-3 pr-24 text-sm text-white placeholder-faint focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none disabled:opacity-60"
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-2">
              {isStreaming ? (
                <button
                  onClick={handleStop}
                  className="px-3 py-1.5 text-xs rounded-md bg-input hover:bg-slate-600 text-white"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="px-3 py-1.5 text-xs rounded-md bg-purple-600 hover:bg-purple-500 disabled:bg-surface disabled:text-slate-600 text-white font-medium transition-colors"
                >
                  Send <span className="text-[10px] text-purple-200">↵</span>
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
            <span>Press <span className="text-muted font-mono">Enter</span> to send, <span className="text-muted font-mono">Shift + Enter</span> for a new line</span>
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
      <div className="w-full max-w-xl bg-ground border-l border-surface flex flex-col shadow-2xl">
        <div className="px-5 py-3 border-b border-surface flex items-center justify-between shrink-0">
          <div className="min-w-0 pr-3">
            <div className="text-[10px] uppercase tracking-wider text-faint">
              {doc?.folder || doc?.doc_type || 'Document'}
            </div>
            <div className="text-sm font-semibold text-white truncate">
              {doc?.title || (loading ? 'Loading…' : 'Document')}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-faint hover:text-white text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="text-sm text-muted">Loading document…</div>
          )}
          {error && (
            <div className="rounded border border-red-900/60 bg-red-950/30 text-red-200 text-sm p-3">
              {error}
            </div>
          )}
          {doc && !loading && (
            <>
              {doc.word_count && (
                <div className="text-[11px] text-faint mb-3">
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
