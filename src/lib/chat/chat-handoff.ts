/**
 * The Map Ask Mindy drawer's "Open in full workspace" handoff (sessionStorage `mindy_chat_handoff`).
 * The drawer writes {v:1, sessionId, context}; MindyChatPanel reads it ONCE, continues that conversation
 * and keeps the attached notice as a chip. It never auto-sends. Only the notice id goes to the server
 * (context:{kind:'opportunity',notice_id}); title/deadline are display-only.
 *
 * Map → App Chat (2026-11-18): the framed Opportunity Map posts the open listing to the parent; the
 * parent stores it under `mindy_map_selected_opp`. Chat reads that on mount (does not consume — the
 * Map owns the live selection). Closing the listing clears the key so Chat does not attach a stale id.
 *
 * Last session: `mindy_last_chat_session` survives Map↔Chat panel remounts so switching panels does
 * not wipe an in-progress conversation.
 */
export const CHAT_HANDOFF_KEY = 'mindy_chat_handoff';
/** Latest SAM listing open on the Map inside /app (written by MapShellPanel). */
export const MAP_SELECTED_OPP_KEY = 'mindy_map_selected_opp';
/** Last Ask Mindy session id in this browser tab (owner-checked on load). */
export const LAST_CHAT_SESSION_KEY = 'mindy_last_chat_session';

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

function opportunityFromContext(c: unknown): AttachedOpportunity | null {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const o = c as Record<string, unknown>;
  if (o.kind !== 'opportunity' || typeof o.notice_id !== 'string') return null;
  const id = o.notice_id.toLowerCase();
  if (!NOTICE_ID.test(id)) return null;
  return {
    notice_id: id,
    title: typeof o.title === 'string' ? o.title.slice(0, 300) : '',
    deadline: typeof o.deadline === 'string' ? o.deadline.slice(0, 40) : '',
  };
}

export function parseChatHandoff(raw: string | null | undefined): ChatHandoff | null {
  if (!raw) return null;
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== 'object' || (d as { v?: unknown }).v !== 1) return null;
  const o = d as { sessionId?: unknown; context?: unknown };
  const sessionId = typeof o.sessionId === 'string' && SESSION_ID.test(o.sessionId) ? o.sessionId : null;
  const opportunity = opportunityFromContext(o.context);
  if (!sessionId && !opportunity) return null;
  return { sessionId, opportunity };
}

/** Shape for MAP_SELECTED_OPP_KEY: `{v:1, context:{kind:'opportunity',notice_id,…}}` or `{v:1, context:null}`. */
export function parseMapSelectedOpp(raw: string | null | undefined): AttachedOpportunity | null {
  if (!raw) return null;
  let d: unknown;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== 'object' || (d as { v?: unknown }).v !== 1) return null;
  return opportunityFromContext((d as { context?: unknown }).context);
}

export function serializeMapSelectedOpp(o: AttachedOpportunity | null): string {
  if (!o) return JSON.stringify({ v: 1, context: null });
  return JSON.stringify({
    v: 1,
    context: { kind: 'opportunity', notice_id: o.notice_id, title: o.title, deadline: o.deadline },
  });
}

export function parseLastChatSessionId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return SESSION_ID.test(id) ? id : null;
}

/** The request field the chat route parses (agreed with the server side, 2026-11-16). */
export function opportunityContextField(o: AttachedOpportunity | null): { context?: { kind: 'opportunity'; notice_id: string } } {
  return o ? { context: { kind: 'opportunity', notice_id: o.notice_id } } : {};
}
