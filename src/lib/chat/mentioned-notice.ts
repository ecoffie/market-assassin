/**
 * The notice the user NAMED in plain /app chat (Agent 4 scorecard 2026-11-16, C1/C1b/C3).
 *
 * With a notice attached (#2096) chat reads the notice body and keeps its contact. Without one it lost both:
 * "Email the contracting officer" two turns after "Tell me about solicitation SPRPA127RUA05" answered "I don't
 * have the contracting officer's contact details", and a Key West answer told the user to "verify the
 * set-aside" on a notice that says 100% small business. This resolves the notice the user typed, so the SAME
 * loader (selected-notice.ts) and the SAME context block (card-chat.ts) ground the answer. Nothing new is stored.
 *
 * Rules:
 *   - Only the USER's words are read (the current message, then earlier user turns, newest first). An id that
 *     appears only in an assistant answer (a FIND list, say) never attaches a notice.
 *   - The newest user message that names a notice decides. If it names two or more different notices, none is
 *     attached (a comparison is answered with tools, not one notice's block).
 *   - A token is looked up only if it has the shape of a notice id or a solicitation number, and only an exact
 *     match on our own record counts. A miss attaches nothing; nothing is guessed.
 */
import {
  isNoticeUuid,
  isSolicitationIdentifier,
  normalizeNoticeUuid,
  selectCanonicalVersion,
} from '@/lib/sam/resolve-solicitation';
import { SELECTED_NOTICE_COLUMNS, type SelectedNoticeRecord } from './selected-notice';

/** At most this many candidate tokens are looked up per request (each costs one indexed read). */
const MAX_LOOKUPS = 4;

export type NoticeRef = { kind: 'notice_id' | 'solicitation_number'; value: string };

/** Candidate notice ids / solicitation numbers in one piece of text, in order, de-duplicated. */
export function extractNoticeRefs(text: string): NoticeRef[] {
  const out: NoticeRef[] = [];
  const seen = new Set<string>();
  for (const raw of String(text || '').split(/[\s,;:()"'“”‘’<>[\]{}!?]+/)) {
    // Sentence punctuation is not part of the token ("SPRPA127RUA05." / "…/").
    const tok = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (!tok) continue;
    let ref: NoticeRef | null = null;
    if (isNoticeUuid(tok)) ref = { kind: 'notice_id', value: normalizeNoticeUuid(tok) };
    // A solicitation number has at least three digits ("COVID-19" is not one; 70ZL26-27-… and SPRPA127RUA05 are).
    else if (isSolicitationIdentifier(tok) && (tok.match(/\d/g) || []).length >= 3) ref = { kind: 'solicitation_number', value: tok };
    if (!ref) continue;
    const key = `${ref.kind}:${ref.value.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export type MentionHistory = Array<{ role?: string; content?: unknown }>;

/**
 * The user texts to search, newest first: the current message, then earlier USER turns (assistant turns are
 * skipped). Each entry keeps its own refs so "the newest message that names a notice decides".
 */
export function userTextsNewestFirst(message: string, history: MentionHistory): string[] {
  const prior = (Array.isArray(history) ? history : [])
    .filter((h) => h && h.role === 'user')
    .map((h) => String(h.content ?? ''));
  return [String(message || ''), ...prior.reverse()];
}

type Db = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

function escapeIlike(token: string): string {
  return token.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** One ref → its record (the newest posted version for a solicitation number), or null on a miss/error. */
export async function lookupNoticeRef(db: Db, ref: NoticeRef): Promise<SelectedNoticeRecord | null> {
  try {
    const q = db.from('sam_opportunities').select(SELECTED_NOTICE_COLUMNS);
    const { data, error } = ref.kind === 'notice_id'
      ? await q.eq('notice_id', ref.value).limit(1)
      : await q.ilike('solicitation_number', escapeIlike(ref.value)).limit(25);
    if (error || !Array.isArray(data) || !data.length) return null;
    return selectCanonicalVersion(data as SelectedNoticeRecord[]);
  } catch {
    return null;
  }
}

export type MentionedNotice = {
  record: SelectedNoticeRecord;
  /** What the user typed that resolved it. */
  ref: NoticeRef;
  /** True when it came from an earlier user turn, not the current message. */
  fromEarlierTurn: boolean;
};

export type MentionedNoticeResult =
  | { status: 'resolved'; notice: MentionedNotice }
  | { status: 'none' }
  | { status: 'ambiguous'; count: number };

/**
 * Resolve the notice the user named. Walks user texts newest first; the first text whose refs resolve to at
 * least one record decides: exactly one distinct notice → resolved, two or more → ambiguous (nothing attached).
 */
export async function resolveMentionedNotice(db: Db, message: string, history: MentionHistory): Promise<MentionedNoticeResult> {
  let lookups = 0;
  const texts = userTextsNewestFirst(message, history);
  for (let i = 0; i < texts.length; i++) {
    const refs = extractNoticeRefs(texts[i]);
    if (!refs.length) continue;
    const found = new Map<string, MentionedNotice>();
    for (const ref of refs) {
      if (lookups >= MAX_LOOKUPS) break;
      lookups++;
      const rec = await lookupNoticeRef(db, ref);
      if (!rec) continue;
      // Versions of one solicitation are one notice for this purpose.
      const key = String(rec.solicitation_number || rec.notice_id).toUpperCase();
      if (!found.has(key)) found.set(key, { record: rec, ref, fromEarlierTurn: i > 0 });
    }
    if (found.size === 1) return { status: 'resolved', notice: [...found.values()][0] };
    if (found.size > 1) return { status: 'ambiguous', count: found.size };
    if (lookups >= MAX_LOOKUPS) break;
  }
  return { status: 'none' };
}
