/**
 * Ask Mindy tool `read_connected_file`: read the ONE file the customer picked from a connected Google Drive or
 * OneDrive account, and return the passages that answer the question, fenced as untrusted data.
 *
 * Authority (spec §4): the model supplies only a file handle issued when the customer picked the file. Every
 * call re-resolves the acting scope from the closure (never from model text), re-verifies the handle against
 * it, re-checks the connection (revoked / reauth needed fail closed), and re-reads the file from the provider.
 * Provenance is the CONNECTED file's, kept separate from federal-record provenance.
 */
import type { ChatActingScope } from '@/lib/chat/chat-acting-scope';
import { fenceUntrusted, safeName, UNTRUSTED_TEXT_RULE } from '@/lib/chat/untrusted-text';
import { selectRelevantRfp } from '@/lib/text/select-relevant';
import { accessTokenFor, scopeKeyFor } from './store';
import { FileReadError, fetchFileMeta, readFileText, verifyFileHandle } from './files';

export const READ_CONNECTED_FILE = 'read_connected_file';
const EXCERPT_BUDGET = 8_000;

export const READ_CONNECTED_FILE_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: READ_CONNECTED_FILE,
    description:
      "Read a file the user picked from their connected Google Drive or OneDrive (for example a capability statement or past-performance write-up) and return the passages relevant to their question. Call it only with a file_handle given to you in this conversation for a file the user selected; you cannot browse or search their drive. Quote only what is returned and attribute it to the file name and its source.",
    parameters: {
      type: 'object',
      properties: {
        file_handle: { type: 'string', description: 'The file_handle of a file the user selected, exactly as given in this conversation.' },
        question: { type: 'string', description: "The user's question, used to pick the relevant passages." },
      },
      required: ['file_handle'],
      additionalProperties: false,
    },
  },
};

function refuse(code: string, message: string): Record<string, unknown> {
  return { ok: false, state: 'unavailable', error_category: code, message };
}

const READ_FAIL: Record<FileReadError['code'], string> = {
  not_found: 'The file is no longer available in the connected account (it may have been moved or deleted). Ask the user to pick it again.',
  no_access: 'Mindy no longer has access to that file. Ask the user to pick it again or reconnect the account.',
  too_large: 'The file is larger than Mindy reads (15 MB). Ask the user for a smaller version.',
  unsupported_type: 'Mindy can read PDF, Word, Excel, plain text, Google Docs and Google Sheets files. Ask the user for one of those.',
  provider_error: 'The connected account did not respond. Do not treat this as an empty file; say the file could not be read right now.',
  unreadable: 'The file could not be read (it may be scanned images or damaged). Do not guess its contents.',
};

export interface ReadFileDeps {
  accessTokenFor?: typeof accessTokenFor;
  fetch?: typeof fetch;
  now?: () => Date;
}

export function makeReadConnectedFileTool(scope: ChatActingScope, deps: ReadFileDeps = {}) {
  const getToken = deps.accessTokenFor ?? accessTokenFor;
  const f = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  async function execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const scopeKey = scopeKeyFor(scope);
    if (!scopeKey) return refuse('workspace_unavailable', 'The workspace could not be confirmed, so no connected file can be read for it.');

    const v = verifyFileHandle(args.file_handle, scopeKey, Math.floor(now().getTime() / 1000));
    if (!v.ok) {
      return refuse(v.reason, v.reason === 'expired'
        ? 'That file selection has expired. Ask the user to pick the file again.'
        : 'That is not a file the user selected in this workspace. Ask the user to pick the file from their connected account.');
    }
    const h = v.handle;

    const tok = await getToken(scopeKey, h.connectionId);
    if (!tok.ok) {
      return refuse(tok.reason, tok.reason === 'reauth_needed' || tok.reason === 'revoked'
        ? 'The connected account needs to be reconnected before Mindy can read this file.'
        : tok.reason === 'not_found'
          ? 'That connected account is not available in this workspace.'
          : 'The connected account could not be reached right now. Do not treat this as an empty file.');
    }
    if (tok.provider !== h.provider) return refuse('invalid_handle', 'That file selection does not match the connected account.');

    try {
      const meta = await fetchFileMeta(h.provider, tok.token, h.fileId, f);
      if (meta.id !== h.fileId) return refuse('invalid_handle', 'The provider returned a different file than the one selected.');
      const { text, pageCount } = await readFileText(h.provider, tok.token, meta, f);
      const q = String(args.question || '').trim();
      const excerpted = text.length > EXCERPT_BUDGET;
      const picked = !excerpted ? text : q ? selectRelevantRfp(text, q, EXCERPT_BUDGET) : text.slice(0, EXCERPT_BUDGET);
      return {
        ok: true,
        file: {
          name: meta.name,
          provider: h.provider === 'google' ? 'Google Drive' : 'OneDrive',
          connected_account: tok.connection.connected_email,
          source_id: meta.id,
          source_url: meta.webUrl,
          modified: meta.modified,
          retrieved_at: now().toISOString(),
          ...(pageCount != null ? { pages: pageCount } : {}),
        },
        note: text.trim() ? undefined : 'This file has no readable text (it may be scanned images).',
        untrusted_rule: UNTRUSTED_TEXT_RULE,
        content: text.trim() ? fenceUntrusted(picked, { name: meta.name, chars: text.length, excerpted, truncatedAtUpload: false }) : '',
      };
    } catch (err) {
      if (err instanceof FileReadError) return refuse(err.code, READ_FAIL[err.code]);
      return refuse('provider_error', READ_FAIL.provider_error);
    }
  }

  return { def: READ_CONNECTED_FILE_TOOL_DEF, name: READ_CONNECTED_FILE, execute };
}

/**
 * The note that tells the model which connected files the customer picked in this conversation. Handles come
 * from the client but are VERIFIED here against the acting scope; an invalid, expired or other-workspace handle
 * is dropped silently (counted), never shown to the model. File names are sanitized (they are user-controlled).
 */
export function connectedFilesNote(rawHandles: unknown, scope: ChatActingScope, nowSec = Math.floor(Date.now() / 1000)): { note: string | null; accepted: number; dropped: number } {
  const scopeKey = scopeKeyFor(scope);
  const list = Array.isArray(rawHandles) ? rawHandles.slice(0, 10) : [];
  if (!scopeKey || !list.length) return { note: null, accepted: 0, dropped: list.length };
  const lines: string[] = [];
  let dropped = 0;
  for (const raw of list) {
    const v = verifyFileHandle(raw, scopeKey, nowSec);
    if (!v.ok) { dropped++; continue; }
    lines.push(`- "${safeName(v.handle.name)}" (${v.handle.provider === 'google' ? 'Google Drive' : 'OneDrive'}) file_handle=${String(raw)}`);
  }
  if (!lines.length) return { note: null, accepted: 0, dropped };
  return {
    note: `CONNECTED FILES the user selected from their own accounts:\n${lines.join('\n')}\nTo use one, call ${READ_CONNECTED_FILE} with its exact file_handle. You cannot read, list or search any other file in their accounts.`,
    accepted: lines.length,
    dropped,
  };
}
