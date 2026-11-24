/**
 * Connected files: read ONE file the customer picked in their connected Google Drive or OneDrive.
 *
 * Selection is the authority, not the model:
 *   - Picking a file (POST /api/app/connected-apps/selections) returns a FILE HANDLE: an HMAC-signed token
 *     binding the acting scope, the connection, the provider and the file id, valid for 24 hours.
 *   - The chat tool accepts only a handle. A raw file id from the model, or a handle signed for another
 *     workspace, is refused. This matters most for Microsoft: `Files.Read` would let the grant read ANY
 *     OneDrive file, so the handle is what limits Mindy to the one the customer chose.
 *
 * Reading re-checks everything: the handle's scope must equal the CURRENT acting scope, the connection must
 * still be live (accessTokenFor), and the provider must still return the same file. Bytes are capped,
 * extracted by the one shared pipeline (src/lib/documents/extract.ts), and NUL-stripped.
 */
import crypto from 'node:crypto';
import { connectedAppsSecrets, type Provider } from './config';
import { extractByKind, inferKind, type ExtractKind } from '@/lib/documents/extract';

export const FILE_HANDLE_TTL_SEC = 24 * 3600;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export interface FileHandlePayload {
  scopeKey: string;
  connectionId: string;
  provider: Provider;
  fileId: string;
  name: string;
  exp: number;
}

const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Domain-separated from the OAuth state: a state can never verify as a file handle, or the reverse. */
function handleKey(): Buffer {
  const s = connectedAppsSecrets();
  if (!s) throw new Error('connected-apps: dedicated secrets not configured');
  return crypto.createHmac('sha256', s.stateSecret).update('connected-apps:file-handle:v1').digest();
}

export function signFileHandle(p: Omit<FileHandlePayload, 'exp'>, nowSec = Math.floor(Date.now() / 1000)): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...p, exp: nowSec + FILE_HANDLE_TTL_SEC }), 'utf8'));
  return `fh1.${body}.${b64u(crypto.createHmac('sha256', handleKey()).update(body).digest())}`;
}

export type VerifiedHandle = { ok: true; handle: FileHandlePayload } | { ok: false; reason: 'invalid_handle' | 'expired' | 'other_workspace' };

/** Signature, expiry, and the handle must belong to the acting scope of THIS request. */
export function verifyFileHandle(raw: unknown, scopeKey: string, nowSec = Math.floor(Date.now() / 1000)): VerifiedHandle {
  const [ver, body, sig] = String(raw || '').split('.');
  if (ver !== 'fh1' || !body || !sig) return { ok: false, reason: 'invalid_handle' };
  const expected = b64u(crypto.createHmac('sha256', handleKey()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid_handle' };
  let p: FileHandlePayload;
  try {
    p = JSON.parse(unb64u(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_handle' };
  }
  if (!p.exp || p.exp < nowSec) return { ok: false, reason: 'expired' };
  if (p.scopeKey !== scopeKey) return { ok: false, reason: 'other_workspace' };
  if ((p.provider !== 'google' && p.provider !== 'microsoft') || !p.fileId || !p.connectionId) return { ok: false, reason: 'invalid_handle' };
  return { ok: true, handle: p };
}

export interface FileMeta {
  id: string;
  name: string;
  mime: string;
  size: number | null;
  webUrl: string | null;
  modified: string | null;
}

type Fetch = typeof fetch;

export class FileReadError extends Error {
  constructor(public code: 'not_found' | 'no_access' | 'too_large' | 'unsupported_type' | 'provider_error' | 'unreadable') {
    super(`connected-file:${code}`);
  }
}

const GOOGLE_EXPORT: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
};

function providerFail(status: number): never {
  if (status === 404) throw new FileReadError('not_found');
  if (status === 401 || status === 403) throw new FileReadError('no_access');
  throw new FileReadError('provider_error');
}

export async function fetchFileMeta(provider: Provider, token: string, fileId: string, f: Fetch = fetch): Promise<FileMeta> {
  const id = encodeURIComponent(fileId);
  const url = provider === 'google'
    ? `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size,webViewLink,modifiedTime&supportsAllDrives=true`
    : `https://graph.microsoft.com/v1.0/me/drive/items/${id}?$select=id,name,size,file,webUrl,lastModifiedDateTime`;
  const res = await f(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) providerFail(res.status);
  const j = (await res.json()) as Record<string, unknown>;
  if (provider === 'google') {
    return { id: String(j.id), name: String(j.name || 'file'), mime: String(j.mimeType || ''), size: j.size != null ? Number(j.size) : null, webUrl: (j.webViewLink as string) ?? null, modified: (j.modifiedTime as string) ?? null };
  }
  const file = (j.file || {}) as Record<string, unknown>;
  return { id: String(j.id), name: String(j.name || 'file'), mime: String(file.mimeType || ''), size: j.size != null ? Number(j.size) : null, webUrl: (j.webUrl as string) ?? null, modified: (j.lastModifiedDateTime as string) ?? null };
}

/** What the shared extractor will parse this file as, or null when it cannot (refused before download). */
export function kindForMeta(meta: FileMeta): ExtractKind | null {
  const exp = GOOGLE_EXPORT[meta.mime];
  return exp ? inferKind(`x${exp.ext}`, exp.mime) : inferKind(meta.name, meta.mime);
}

/** Selection-time check: a type we can read and a size under the cap. */
export function assertReadable(meta: FileMeta): ExtractKind {
  const kind = kindForMeta(meta);
  if (!kind) throw new FileReadError('unsupported_type');
  if (!GOOGLE_EXPORT[meta.mime] && meta.size != null && meta.size > MAX_FILE_BYTES) throw new FileReadError('too_large');
  return kind;
}

async function readCapped(res: Response): Promise<Buffer> {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_FILE_BYTES) throw new FileReadError('too_large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new FileReadError('too_large');
  return buf;
}

export async function downloadFile(provider: Provider, token: string, meta: FileMeta, f: Fetch = fetch): Promise<Buffer> {
  const id = encodeURIComponent(meta.id);
  const exp = provider === 'google' ? GOOGLE_EXPORT[meta.mime] : undefined;
  const url = provider === 'google'
    ? exp
      ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(exp.mime)}`
      : `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`
    : `https://graph.microsoft.com/v1.0/me/drive/items/${id}/content`;
  const res = await f(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) providerFail(res.status);
  return readCapped(res);
}

/** Download + extract with the shared pipeline. NUL bytes are stripped (Postgres and prompts reject them). */
export async function readFileText(provider: Provider, token: string, meta: FileMeta, f: Fetch = fetch): Promise<{ text: string; pageCount?: number }> {
  const kind = assertReadable(meta);
  const buf = await downloadFile(provider, token, meta, f);
  try {
    const out = await extractByKind(kind, buf);
    return { text: out.text.replace(/\u0000/g, ''), ...(out.pageCount != null ? { pageCount: out.pageCount } : {}) };
  } catch {
    throw new FileReadError('unreadable');
  }
}

/**
 * Microsoft: Mindy's own file chooser over Graph, on the existing `Files.Read` grant (no SharePoint
 * `MyFiles.Read` / consumer `OneDrive.ReadOnly` scopes, which Microsoft's v8 picker requires, and no
 * Microsoft token in the browser). Lists the user's OWN drive only, at the customer's click: folders and
 * files Mindy can read, metadata only. The model never calls this.
 */
export interface DriveEntry {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  size: number | null;
  modified: string | null;
}

export const DRIVE_PAGE = 100;

export function driveListUrl(opts: { folderId?: string | null; query?: string | null }): string {
  const sel = `$select=id,name,size,file,folder,lastModifiedDateTime&$top=${DRIVE_PAGE}`;
  const q = String(opts.query || '').trim().slice(0, 100);
  if (q) return `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(q.replace(/'/g, "''"))}')?${sel}`;
  if (opts.folderId) return `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(opts.folderId)}/children?${sel}`;
  return `https://graph.microsoft.com/v1.0/me/drive/root/children?${sel}`;
}

export async function listOneDrive(token: string, opts: { folderId?: string | null; query?: string | null }, f: Fetch = fetch): Promise<DriveEntry[]> {
  const res = await f(driveListUrl(opts), { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) providerFail(res.status);
  const j = (await res.json()) as { value?: Array<Record<string, unknown>> };
  const out: DriveEntry[] = [];
  for (const it of j.value || []) {
    const isFolder = !!it.folder;
    const m: FileMeta = { id: String(it.id), name: String(it.name || ''), mime: String(((it.file || {}) as Record<string, unknown>).mimeType || ''), size: it.size != null ? Number(it.size) : null, webUrl: null, modified: (it.lastModifiedDateTime as string) ?? null };
    // Only what the customer can actually use: folders to open, and files Mindy can read under the cap.
    if (!isFolder && (!kindForMeta(m) || (m.size != null && m.size > MAX_FILE_BYTES))) continue;
    out.push({ id: m.id, name: m.name, kind: isFolder ? 'folder' : 'file', size: isFolder ? null : m.size, modified: m.modified });
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
}
