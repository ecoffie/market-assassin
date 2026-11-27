/**
 * Connected apps Slice B: save an email DRAFT in the customer's own Gmail or Outlook. Mindy never sends: the customer
 * opens the draft, reviews it and sends it themselves (Eric, 2026-11-27, beta, flag CONNECTED_APPS).
 *
 * Safety model:
 *   - The mail client below has exactly one method, createDraft. There is no send method and no send endpoint in this
 *     file (a test asserts both). Gmail uses users.drafts.create; Microsoft Graph uses POST /me/messages, which saves
 *     an unsent message in Drafts.
 *   - Authority is resolved on the server on EVERY call: the acting scope is re-resolved, and the connection must
 *     belong to that scope AND to the Mindy user who connected it (store.ts). The model supplies no token, workspace or
 *     account email; an unknown connected_account_id is refused.
 *   - The recipient is used only when it is a published contact this conversation's records cite (a notice point of
 *     contact, a federal record, or an official .gov / .mil page). Anything else is left blank, never guessed.
 *   - Content follows the outreach rules that can be checked mechanically: under 150 words before the signature, no em
 *     or en dashes, and certifications only in the credentials block under the signature. A draft that breaks one is
 *     refused with a plain instruction so the model rewrites it.
 *   - Every draft is logged as a structured event: who, which connected account, the recipient's domain and the
 *     outcome. Never the subject or body.
 *   - Retrying the same draft in the same turn returns the first result instead of creating a second draft.
 */
import { createHash } from 'node:crypto';
import type { ChatActingScope } from '@/lib/chat/chat-acting-scope';
import { OUTREACH_RULES } from '@/lib/ask-mindy/outreach-rules';
import { hasCapability, type Provider } from './config';
import { accessTokenFor, listConnections, scopeKeyFor, type ConnectionView } from './store';

type Fetch = typeof fetch;

export const CREATE_EMAIL_DRAFT = 'create_email_draft';
export const DRAFT_MAX_WORDS = 150;
export const DRAFT_MAX_SUBJECT = 150;
export const DRAFT_MAX_BODY_CHARS = 6000;
/** A line holding only this separates the message from the signature and credentials block. */
export const SIGNATURE_DELIMITER = '--';

export interface DraftPayload { to: string | null; subject: string; body: string }
export interface CreatedDraft { id: string; webLink: string }

export class DraftError extends Error {
  constructor(public code: 'permission_needed' | 'reauth_needed' | 'rate_limited' | 'provider_error') {
    super(`email draft: ${code}`);
  }
}

// ── Mail client: create a draft. Nothing else. ───────────────────────────────────────────────────────────────────

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const b64url = (s: string) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** RFC 5322 message with a base64 UTF-8 body and an RFC 2047 subject. Header values are pre-validated (no CR/LF). */
export function mimeMessage(p: DraftPayload): string {
  const lines = [
    ...(p.to ? [`To: ${p.to}`] : []),
    `Subject: =?UTF-8?B?${b64(p.subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    (b64(p.body).match(/.{1,76}/g) || []).join('\r\n'),
  ];
  return lines.join('\r\n');
}

function failFor(status: number): DraftError {
  if (status === 401) return new DraftError('reauth_needed');
  if (status === 403) return new DraftError('permission_needed');
  if (status === 429) return new DraftError('rate_limited');
  return new DraftError('provider_error');
}

async function createGmailDraft(token: string, p: DraftPayload, accountEmail: string, f: Fetch): Promise<CreatedDraft> {
  const res = await f('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: b64url(mimeMessage(p)) } }),
  });
  if (!res.ok) throw failFor(res.status);
  const j = (await res.json().catch(() => null)) as { id?: string; message?: { id?: string } } | null;
  if (!j?.id || !j.message?.id) throw new DraftError('provider_error');
  return {
    id: j.id,
    webLink: `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#drafts?compose=${encodeURIComponent(j.message.id)}`,
  };
}

async function createOutlookDraft(token: string, p: DraftPayload, f: Fetch): Promise<CreatedDraft> {
  // POST /me/messages creates the message in Drafts and does not send it.
  const res = await f('https://graph.microsoft.com/v1.0/me/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: p.subject,
      body: { contentType: 'Text', content: p.body },
      toRecipients: p.to ? [{ emailAddress: { address: p.to } }] : [],
    }),
  });
  if (!res.ok) throw failFor(res.status);
  const j = (await res.json().catch(() => null)) as { id?: string; webLink?: string } | null;
  if (!j?.id) throw new DraftError('provider_error');
  return { id: j.id, webLink: typeof j.webLink === 'string' && /^https:\/\//.test(j.webLink) ? j.webLink : 'https://outlook.office.com/mail/drafts' };
}

/** The ONLY provider mail operation Mindy has. There is deliberately no send. */
export const mailDraftClient = Object.freeze({
  createDraft(provider: Provider, token: string, p: DraftPayload, accountEmail: string, f: Fetch = fetch): Promise<CreatedDraft> {
    return provider === 'google' ? createGmailDraft(token, p, accountEmail, f) : createOutlookDraft(token, p, f);
  },
});

// ── Content rules ────────────────────────────────────────────────────────────────────────────────────────────────

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DASHES = /[‒–—―]/;
/** Certifications belong in the credentials block under the signature, never in the message or subject. */
const CERTIFICATION = /\b(sdvosb|vosb|edwosb|wosb|hubzone|service[- ]disabled|veteran[- ]owned|wom[ae]n[- ]owned|minority[- ]owned|small disadvantaged|sdb)\b|\b8\s*\(\s*a\s*\)/i;

export function splitSignature(body: string): { message: string; signature: string } {
  const lines = body.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === SIGNATURE_DELIMITER);
  return i < 0 ? { message: body, signature: '' } : { message: lines.slice(0, i).join('\n'), signature: lines.slice(i + 1).join('\n') };
}

export const wordCount = (s: string) => (s.match(/\S+/g) || []).length;

export type DraftCheck = { ok: true; payload: DraftPayload; connectedAccountId: string | null } | { ok: false; code: string; message: string };

export function checkDraftInput(args: Record<string, unknown>): DraftCheck {
  const subject = typeof args.subject === 'string' ? args.subject.trim() : '';
  const body = typeof args.body === 'string' ? args.body.replace(/\r\n/g, '\n').trim() : '';
  const toRaw = typeof args.to === 'string' ? args.to.trim() : '';
  const id = typeof args.connected_account_id === 'string' && args.connected_account_id.trim() ? args.connected_account_id.trim() : null;
  const rewrite = (code: string, message: string): DraftCheck => ({ ok: false, code, message: `${message} Rewrite the draft and call ${CREATE_EMAIL_DRAFT} again.` });

  if (!subject || subject.length > DRAFT_MAX_SUBJECT || /[\r\n]/.test(subject)) return rewrite('invalid_subject', `The subject must be one line of at most ${DRAFT_MAX_SUBJECT} characters.`);
  if (!body || body.length > DRAFT_MAX_BODY_CHARS) return rewrite('invalid_body', 'The body is empty or too long.');
  if (toRaw && (/[\r\n,;<>\s]/.test(toRaw) || !EMAIL.test(toRaw))) return rewrite('invalid_recipient', 'The recipient must be one plain email address, or empty.');
  if (DASHES.test(subject) || DASHES.test(body)) return rewrite('em_dash', 'Outreach never uses em or en dashes.');
  const { message } = splitSignature(body);
  if (wordCount(message) > DRAFT_MAX_WORDS) return rewrite('too_long', `Keep the message under ${DRAFT_MAX_WORDS} words (the signature and credentials block after a line with only "${SIGNATURE_DELIMITER}" do not count).`);
  if (CERTIFICATION.test(subject) || CERTIFICATION.test(message)) {
    return rewrite('certification_in_message', `Certifications go only in the credentials block under the signature, after a line with only "${SIGNATURE_DELIMITER}". Lead with the buyer, not the company's status.`);
  }
  return { ok: true, payload: { to: toRaw ? toRaw.toLowerCase() : null, subject, body }, connectedAccountId: id };
}

// ── Recipient provenance ─────────────────────────────────────────────────────────────────────────────────────────

/** Text a recipient may be verified against. `officialOnly`: web text counts only for .gov / .mil addresses. */
export interface VerifiedSource { text: string; officialOnly?: boolean }

const OFFICIAL_DOMAIN = /\.(gov|mil)$/i;

/** True when `to` appears, as a whole address, in a cited published record of this conversation. */
export function recipientIsCited(to: string, sources: readonly VerifiedSource[]): boolean {
  const addr = to.toLowerCase();
  const esc = addr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const whole = new RegExp(`(^|[^A-Za-z0-9._%+-])${esc}($|[^A-Za-z0-9.-]|\\.(?![A-Za-z0-9]))`, 'i');
  const domain = addr.split('@')[1] || '';
  return sources.some((s) => (!s.officialOnly || OFFICIAL_DOMAIN.test(domain)) && whole.test(s.text));
}

// ── The chat tool ────────────────────────────────────────────────────────────────────────────────────────────────

export const EMAIL_DRAFT_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: CREATE_EMAIL_DRAFT,
    description: [
      'Save an email as a DRAFT in the customer\'s own connected Gmail or Outlook. It NEVER sends: the customer opens the draft, reviews it and sends it themselves.',
      'Call it only when the customer asks to put an email in their drafts, Gmail or Outlook.',
      'Write it the way outreach is written: the first sentence is about the buyer and their own buy; under 150 words; no em dashes; certifications only in the credentials block under the signature, after a line containing only "--"; no dates except opportunity dates (deadlines, contract end dates).',
      // One source for outreach (#2515): the same rules standard Ask Mindy, research mode and create_document use.
      OUTREACH_RULES,
      'In the draft itself follow rules 1 to 6 only. The "Before you send" list and the closing line belong in your chat answer, never in the email.',
      '`to` must be an email address published in this conversation\'s records (a notice point of contact, a federal record, or an official agency page). Never infer one from a name; if none is published, leave `to` empty and name the office instead.',
      'If no account is connected, or it lacks draft permission, the result says so: give the email as copy-paste text and tell the customer how to connect or allow drafts.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['subject', 'body'],
      properties: {
        to: { type: 'string', description: 'One published email address from this conversation\'s records, or empty.' },
        subject: { type: 'string', description: 'One line.' },
        body: { type: 'string', description: 'Plain text. Message, then a line with only "--", then the signature and credentials block.' },
        connected_account_id: { type: 'string', description: 'Which connected account to use, when the customer has more than one (from an earlier result).' },
      },
    },
  },
};

export interface EmailDraftToolDeps {
  list: typeof listConnections;
  token: typeof accessTokenFor;
  client: typeof mailDraftClient;
  log: (event: Record<string, unknown>) => void;
}

const DEFAULT_DEPS: EmailDraftToolDeps = {
  list: listConnections,
  token: accessTokenFor,
  client: mailDraftClient,
  log: (e) => console.info(JSON.stringify(e)),
};

const PROVIDER_NAME: Record<Provider, string> = { google: 'Gmail', microsoft: 'Outlook' };

function unavailable(code: string, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: false, state: 'unavailable', error_category: code, message, ...extra };
}

const COPY_TEXT = 'Give the customer the email as copy-paste text in your answer instead (recipient if published, subject, body).';

export function makeEmailDraftTool(opts: {
  /** Re-resolves the acting scope from the request on every call (never the turn's cached value). */
  resolveScope: () => Promise<ChatActingScope>;
  callerEmail: string;
  /** This conversation's cited public records and the attached notice's points of contact. */
  verifiedSources: () => VerifiedSource[];
  deps?: Partial<EmailDraftToolDeps>;
}) {
  const deps: EmailDraftToolDeps = { ...DEFAULT_DEPS, ...(opts.deps ?? {}) };
  const done = new Map<string, Record<string, unknown>>();

  async function execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const scope = await opts.resolveScope();
    const scopeKey = scopeKeyFor(scope);
    if (!scopeKey) return unavailable('workspace_unavailable', `The workspace could not be confirmed, so no draft was saved. ${COPY_TEXT}`);

    const check = checkDraftInput(args);
    if (!check.ok) return unavailable(check.code, check.message);

    const all = await deps.list(scopeKey, opts.callerEmail);
    const usable = all.filter((c) => c.status === 'connected');
    if (!usable.length) {
      const reauth = all.some((c) => c.status === 'reauth_needed');
      return unavailable(reauth ? 'reauth_needed' : 'not_connected', reauth
        ? `The connected account needs to be reconnected before Mindy can save drafts. ${COPY_TEXT} Then tell them they can reconnect from the "Use a file from Drive or OneDrive" menu under the message box.`
        : `No Google or Microsoft account is connected. ${COPY_TEXT} Then offer to connect one: the "Use a file from Drive or OneDrive" menu under the message box has Connect Google Drive and Connect OneDrive; after connecting, they choose "Allow email drafts" there.`);
    }
    let conn: ConnectionView | undefined;
    if (check.connectedAccountId) {
      conn = usable.find((c) => c.id === check.connectedAccountId);
      if (!conn) return unavailable('unknown_account', 'That connected account is not available here. Use one of the accounts listed.', { accounts: usable.map((c) => ({ connected_account_id: c.id, provider: c.provider, account: c.connected_email })) });
    } else if (usable.length === 1) {
      conn = usable[0];
    } else {
      return unavailable('choose_account', 'The customer has more than one connected account. Ask which one to use, then call again with its connected_account_id.', { accounts: usable.map((c) => ({ connected_account_id: c.id, provider: c.provider, account: c.connected_email })) });
    }

    if (!hasCapability(conn.provider, conn.granted_scopes, 'draft')) {
      return unavailable('permission_needed', `${conn.connected_email} is connected for files only, so no draft was saved. ${COPY_TEXT} Then tell the customer they can choose "Allow email drafts" for that account in the "Use a file from Drive or OneDrive" menu under the message box, and Mindy can save it next time.`);
    }

    // The recipient only when this conversation's records cite it; otherwise blank, never guessed.
    const payload: DraftPayload = { ...check.payload };
    let recipientStatus: 'cited' | 'none' | 'left_blank_not_cited' = 'none';
    if (payload.to) {
      if (recipientIsCited(payload.to, opts.verifiedSources())) recipientStatus = 'cited';
      else { payload.to = null; recipientStatus = 'left_blank_not_cited'; }
    }

    const key = createHash('sha256').update(JSON.stringify([scopeKey, conn.id, payload.to, payload.subject, payload.body])).digest('hex');
    const earlier = done.get(key);
    if (earlier) return { ...earlier, note: 'This draft was already saved in this turn; no second copy was made.' };

    const recipientDomain = payload.to ? payload.to.split('@')[1] : null;
    const logEvent = (outcome: string) => {
      try {
        deps.log({ event: 'connected_apps.email_draft', who: opts.callerEmail.toLowerCase(), scope: scope.kind, provider: conn!.provider, account: conn!.connected_email, connection_id: conn!.id, recipient_domain: recipientDomain, recipient_status: recipientStatus, outcome });
      } catch { /* logging never affects the result */ }
    };

    const tok = await deps.token(scopeKey, opts.callerEmail, conn.id);
    if (!tok.ok) {
      logEvent(`token_${tok.reason}`);
      return unavailable(tok.reason === 'refresh_failed' ? 'provider_error' : 'reauth_needed', tok.reason === 'refresh_failed'
        ? `${PROVIDER_NAME[conn.provider]} could not be reached, so no draft was saved. ${COPY_TEXT}`
        : `${conn.connected_email} needs to be reconnected, so no draft was saved. ${COPY_TEXT} They can reconnect from the "Use a file from Drive or OneDrive" menu under the message box.`);
    }

    try {
      const d = await deps.client.createDraft(conn.provider, tok.token, payload, conn.connected_email);
      logEvent('created');
      const result: Record<string, unknown> = {
        ok: true,
        state: 'known',
        action: 'draft_saved_not_sent',
        provider: conn.provider,
        connected_account: conn.connected_email,
        draft_id: d.id,
        web_link: d.webLink,
        recipient: payload.to,
        recipient_status: recipientStatus,
        message: [
          `Draft saved in ${PROVIDER_NAME[conn.provider]} (${conn.connected_email}). It was NOT sent. Give the customer this link to review and send it: ${d.webLink}`,
          recipientStatus === 'left_blank_not_cited' ? 'The recipient was left blank because that address is not published in this conversation\'s records; tell the customer to add it after confirming it.' : '',
          recipientStatus === 'none' ? 'No recipient was set; tell the customer to add one.' : '',
        ].filter(Boolean).join(' '),
      };
      done.set(key, result);
      return result;
    } catch (err) {
      const code = err instanceof DraftError ? err.code : 'provider_error';
      logEvent(`failed_${code}`);
      const why = code === 'permission_needed' ? `${conn.connected_email} has not allowed email drafts. They can choose "Allow email drafts" in the "Use a file from Drive or OneDrive" menu under the message box.`
        : code === 'reauth_needed' ? `${conn.connected_email} needs to be reconnected from the "Use a file from Drive or OneDrive" menu under the message box.`
        : code === 'rate_limited' ? `${PROVIDER_NAME[conn.provider]} is busy right now.`
        : `${PROVIDER_NAME[conn.provider]} did not confirm the draft. Tell the customer to check their Drafts folder before trying again.`;
      return unavailable(code, `No draft was confirmed. ${why} ${COPY_TEXT}`);
    }
  }

  return { execute };
}
