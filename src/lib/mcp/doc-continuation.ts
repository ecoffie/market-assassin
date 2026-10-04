/**
 * Bounded free continuation for get_solicitation_documents (ChatGPT submission blocker #2,
 * owner decision 2026-10-04).
 *
 * The problem it closes: the tool returns long documents in windows and every call cost
 * the full 10 credits, so reading one document cost 10 × the number of windows. Measured in
 * ChatGPT developer mode: one "summarize the scope" prompt paged a 725-page reference guide
 * 9 times (90 credits) and would have needed 50 calls (500 credits) to finish.
 *
 * The rule: the FIRST retrieval of a notice is paid; continuing that SAME retrieval — the
 * exact windows the previous response handed back in `next_page` — is not. "Free
 * pagination" must not become an unlimited extraction API, so a continuation is free only
 * when it presents a token that:
 *   - was issued by a paid (or previously free) response, signed server-side (HMAC);
 *   - belongs to the SAME user;
 *   - names EXACTLY the windows being requested (document ids + offsets + limits) — a call
 *     that changes any window is a new, paid retrieval;
 *   - is within its TTL; and
 *   - is within the page cap for that retrieval (MAX_FREE_CONTINUATIONS).
 * Anything else simply bills as a normal retrieval. Nothing is refused here.
 *
 * Stateless by design: no table, no KV. Replaying an older token re-reads windows that were
 * already authorised, so it cannot reach new text beyond the cap.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Free continuation pages per paid retrieval. 50 × the default 20,000-char window reads one
 *  fully stored document (the extraction cap is 1,000,000 chars). Past the cap the next window
 *  is a new paid retrieval. */
export const MAX_FREE_CONTINUATIONS = 50;
/** How long a continuation stays free after the response that issued it. */
export const CONTINUATION_TTL_SEC = 6 * 60 * 60;
/** A window can never ask for more than the tool's own per-document maximum. */
const MAX_WINDOW_LIMIT = 120_000;

export interface ContinuationWindow {
  document_id?: string;
  offset?: number;
  limit?: number;
}

interface Payload {
  v: 1;
  /** sha256(lowercased email) — the token is opaque and never carries the address. */
  u: string;
  /** sha256 of the canonical windows this token authorises. */
  w: string;
  /** Continuation page number this token authorises (1 = first continuation). */
  p: number;
  /** Expiry, unix seconds. */
  e: number;
}

function secret(): string {
  const s = process.env.MCP_OAUTH_SIGNING_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new Error('doc-continuation: no signing secret');
  return s;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const userKey = (email: string) => sha((email || '').trim().toLowerCase());

function sign(body: string): string {
  // Domain-separated from the OAuth access tokens that share the secret.
  return b64url(createHmac('sha256', secret()).update(`doc-continuation:v1.${body}`).digest());
}

/**
 * Canonical form of a set of windows — order-independent, and a window whose limit is
 * missing or over the maximum can never be authorised (it would widen the read).
 */
export function canonicalWindows(windows: readonly ContinuationWindow[] | undefined | null): string | null {
  if (!Array.isArray(windows) || windows.length === 0) return null;
  const rows: string[] = [];
  for (const w of windows) {
    if (!w || typeof w.document_id !== 'string' || !w.document_id) return null;
    if (typeof w.offset !== 'number' || !Number.isInteger(w.offset) || w.offset < 0) return null;
    if (typeof w.limit !== 'number' || !Number.isInteger(w.limit) || w.limit <= 0 || w.limit > MAX_WINDOW_LIMIT) return null;
    rows.push(`${w.document_id}:${w.offset}:${w.limit}`);
  }
  return rows.sort().join('|');
}

/**
 * Issue the token for the NEXT page. `page` is the continuation number it authorises.
 * Returns null past the cap (that window will bill as a new retrieval) or when the windows
 * cannot be canonicalised.
 */
export function issueContinuation(
  userEmail: string,
  windows: readonly ContinuationWindow[],
  page: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): string | null {
  if (!userEmail || page < 1 || page > MAX_FREE_CONTINUATIONS) return null;
  const canon = canonicalWindows(windows);
  if (!canon) return null;
  const payload: Payload = { v: 1, u: userKey(userEmail), w: sha(canon), p: page, e: nowSec + CONTINUATION_TTL_SEC };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body)}`;
}

export type ContinuationVerdict =
  | { ok: true; page: number }
  | { ok: false; reason: 'absent' | 'malformed' | 'bad_signature' | 'wrong_user' | 'expired' | 'over_cap' | 'windows_mismatch' };

/**
 * Is this call a free continuation? `documentIds`, when given, must name exactly the
 * windows' documents — a continuation may not widen to other files.
 */
export function verifyContinuation(
  token: unknown,
  ctx: { userEmail: string; windows: readonly ContinuationWindow[] | undefined | null; documentIds?: readonly string[] | null },
  nowSec: number = Math.floor(Date.now() / 1000),
): ContinuationVerdict {
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'absent' };
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return { ok: false, reason: 'malformed' };
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload?.v !== 1 || typeof payload.p !== 'number' || typeof payload.e !== 'number') return { ok: false, reason: 'malformed' };
  if (payload.u !== userKey(ctx.userEmail)) return { ok: false, reason: 'wrong_user' };
  if (payload.e < nowSec) return { ok: false, reason: 'expired' };
  if (payload.p < 1 || payload.p > MAX_FREE_CONTINUATIONS) return { ok: false, reason: 'over_cap' };
  const canon = canonicalWindows(ctx.windows);
  if (!canon || sha(canon) !== payload.w) return { ok: false, reason: 'windows_mismatch' };
  if (ctx.documentIds && ctx.documentIds.length > 0) {
    const want = new Set((ctx.windows ?? []).map((w) => w.document_id));
    if (ctx.documentIds.length !== want.size || ctx.documentIds.some((id) => !want.has(id))) {
      return { ok: false, reason: 'windows_mismatch' };
    }
  }
  return { ok: true, page: payload.p };
}

/**
 * Billing hook, read by runMeteredTool BEFORE the call runs (so the balance pre-check uses
 * the same price): true only for a get_solicitation_documents call that continues a
 * previous retrieval with a token that verifies for this caller and these exact windows.
 * Anything else is a normal, paid retrieval — this never refuses a call.
 */
export function isFreeDocumentContinuation(name: string, args: Record<string, unknown>, userEmail: string | undefined): boolean {
  if (name !== 'get_solicitation_documents' || !userEmail) return false;
  if (typeof args.continuation !== 'string' || !args.continuation) return false;
  return verifyContinuation(args.continuation, {
    userEmail,
    windows: Array.isArray(args.documents) ? (args.documents as ContinuationWindow[]) : null,
    documentIds: Array.isArray(args.document_ids) ? (args.document_ids as string[]) : null,
  }).ok;
}
