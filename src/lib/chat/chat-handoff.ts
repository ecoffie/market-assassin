/**
 * The Map Ask Mindy drawer's "Open in full workspace" handoff (sessionStorage `mindy_chat_handoff`).
 * The drawer writes {v:1, sessionId, context}; MindyChatPanel reads it ONCE, continues that conversation
 * and keeps the attached notice as a chip. It never auto-sends. Only the notice id goes to the server
 * (context:{kind:'opportunity',notice_id}); title/deadline are display-only.
 */
export const CHAT_HANDOFF_KEY = 'mindy_chat_handoff';

export interface AttachedOpportunity {
  notice_id: string;
  title: string;
  deadline: string;
}

export interface ChatHandoff {
  sessionId: string | null;
  opportunity: AttachedOpportunity | null;
}

const NOTICE_ID = /^[0-9a-f]{32}$/;
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

export function parseChatHandoff(raw: string | null | undefined): ChatHandoff | null {
  if (!raw) return null;
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== 'object' || (d as { v?: unknown }).v !== 1) return null;
  const o = d as { sessionId?: unknown; context?: unknown };
  const sessionId = typeof o.sessionId === 'string' && SESSION_ID.test(o.sessionId) ? o.sessionId : null;
  let opportunity: AttachedOpportunity | null = null;
  const c = o.context as Record<string, unknown> | null | undefined;
  if (c && typeof c === 'object' && c.kind === 'opportunity' && typeof c.notice_id === 'string') {
    const id = c.notice_id.toLowerCase();
    if (NOTICE_ID.test(id)) {
      opportunity = {
        notice_id: id,
        title: typeof c.title === 'string' ? c.title.slice(0, 300) : '',
        deadline: typeof c.deadline === 'string' ? c.deadline.slice(0, 40) : '',
      };
    }
  }
  if (!sessionId && !opportunity) return null;
  return { sessionId, opportunity };
}

/** The request field the chat route parses (agreed with the server side, 2026-11-16). */
export function opportunityContextField(o: AttachedOpportunity | null): { context?: { kind: 'opportunity'; notice_id: string } } {
  return o ? { context: { kind: 'opportunity', notice_id: o.notice_id } } : {};
}
