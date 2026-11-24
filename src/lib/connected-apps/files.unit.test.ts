import { describe, it, expect, beforeEach } from 'vitest';
import { assertReadable, downloadFile, fetchFileMeta, FileReadError, kindForMeta, MAX_FILE_BYTES, readFileText, signFileHandle, verifyFileHandle, FILE_HANDLE_TTL_SEC, type FileMeta } from './files';
import { newBrowserBinding, signState } from './oauth';

beforeEach(() => {
  process.env.CONNECTED_APPS_STATE_SECRET = 'state-secret-test-0123456789abcdef0123';
  process.env.CONNECTED_APPS_TOKEN_ENC_KEY = 'token-key-test-0123456789abcdef01234567';
});

const base = { scopeKey: 'own:a@b.com', connectionId: 'conn-1', provider: 'microsoft' as const, fileId: 'item-1', name: 'Cap Statement.pdf' };

describe('file handle', () => {
  it('round-trips for the same acting scope', () => {
    const v = verifyFileHandle(signFileHandle(base), 'own:a@b.com');
    expect(v).toEqual({ ok: true, handle: expect.objectContaining(base) });
  });
  it('a handle from another workspace is refused', () => {
    expect(verifyFileHandle(signFileHandle(base), 'ws:other')).toEqual({ ok: false, reason: 'other_workspace' });
  });
  it('tampering with the file id breaks the signature', () => {
    const [v, body, sig] = signFileHandle(base).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()), fileId: 'someone-elses-file' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifyFileHandle(`${v}.${forged}.${sig}`, 'own:a@b.com')).toEqual({ ok: false, reason: 'invalid_handle' });
  });
  it('expires after 24 hours', () => {
    const now = Math.floor(Date.now() / 1000);
    const h = signFileHandle(base, now);
    expect(verifyFileHandle(h, 'own:a@b.com', now + FILE_HANDLE_TTL_SEC - 1).ok).toBe(true);
    expect(verifyFileHandle(h, 'own:a@b.com', now + FILE_HANDLE_TTL_SEC + 1)).toEqual({ ok: false, reason: 'expired' });
  });
  it('a raw file id or an OAuth state never verifies as a handle (domain separation)', () => {
    expect(verifyFileHandle('item-1', 'own:a@b.com').ok).toBe(false);
    const state = signState({ provider: 'google', ownerEmail: 'a@b.com', scopeKey: 'own:a@b.com', caps: ['file'], returnTo: '/app' }, 'v', newBrowserBinding().hash);
    expect(verifyFileHandle(`fh1.${state}`, 'own:a@b.com').ok).toBe(false);
  });
  it('refuses to sign without the dedicated secrets', () => {
    delete process.env.CONNECTED_APPS_STATE_SECRET;
    expect(() => signFileHandle(base)).toThrow(/dedicated secrets/);
  });
});

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

describe('provider metadata', () => {
  it('maps Google and Microsoft metadata', async () => {
    const g = await fetchFileMeta('google', 't', 'g1', (async () => json({ id: 'g1', name: 'Cap.docx', mimeType: 'application/vnd.google-apps.document', webViewLink: 'https://docs.google.com/x', modifiedTime: '2026-11-01T00:00:00Z' })) as typeof fetch);
    expect(g).toEqual({ id: 'g1', name: 'Cap.docx', mime: 'application/vnd.google-apps.document', size: null, webUrl: 'https://docs.google.com/x', modified: '2026-11-01T00:00:00Z' });
    const m = await fetchFileMeta('microsoft', 't', 'm1', (async () => json({ id: 'm1', name: 'Cap.pdf', size: 1000, file: { mimeType: 'application/pdf' }, webUrl: 'https://onedrive/x', lastModifiedDateTime: '2026-11-02T00:00:00Z' })) as typeof fetch);
    expect(m).toMatchObject({ id: 'm1', mime: 'application/pdf', size: 1000 });
  });
  it('404 → not_found, 403 → no_access, 500 → provider_error', async () => {
    for (const [status, code] of [[404, 'not_found'], [403, 'no_access'], [500, 'provider_error']] as const) {
      const err = await fetchFileMeta('google', 't', 'x', (async () => json({}, status)) as typeof fetch).catch((e) => e);
      expect(err).toBeInstanceOf(FileReadError);
      expect(err.code).toBe(code);
    }
  });
});

const meta = (o: Partial<FileMeta>): FileMeta => ({ id: 'f1', name: 'a.pdf', mime: 'application/pdf', size: 100, webUrl: null, modified: null, ...o });

describe('readable types and size', () => {
  it('native Google Docs/Sheets read as docx/xlsx; images are refused', () => {
    expect(kindForMeta(meta({ name: 'Cap', mime: 'application/vnd.google-apps.document' }))).toBe('docx');
    expect(kindForMeta(meta({ name: 'Rates', mime: 'application/vnd.google-apps.spreadsheet' }))).toBe('xlsx');
    expect(() => assertReadable(meta({ name: 'logo.png', mime: 'image/png' }))).toThrow(/unsupported_type/);
  });
  it('over the cap is refused before download', () => {
    expect(() => assertReadable(meta({ size: MAX_FILE_BYTES + 1 }))).toThrow(/too_large/);
  });
});

describe('download', () => {
  it('Google Docs are exported; binaries use alt=media; OneDrive uses /content', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response('x'); }) as typeof fetch;
    await downloadFile('google', 't', meta({ id: 'g1', mime: 'application/vnd.google-apps.document' }), f);
    await downloadFile('google', 't', meta({ id: 'g2' }), f);
    await downloadFile('microsoft', 't', meta({ id: 'm1' }), f);
    expect(urls[0]).toContain('/files/g1/export?mimeType=');
    expect(urls[1]).toContain('/files/g2?alt=media');
    expect(urls[2]).toBe('https://graph.microsoft.com/v1.0/me/drive/items/m1/content');
  });
  it('a body over the cap is refused even when metadata understated it', async () => {
    const f = (async () => new Response('x', { headers: { 'content-length': String(MAX_FILE_BYTES + 1) } })) as typeof fetch;
    await expect(downloadFile('microsoft', 't', meta({}), f)).rejects.toThrow(/too_large/);
  });
  it('extracts with the shared pipeline and strips NUL bytes', async () => {
    const f = (async () => new Response('hello\u0000 world')) as typeof fetch;
    expect((await readFileText('microsoft', 't', meta({ name: 'notes.txt', mime: 'text/plain' }), f)).text).toBe('hello world');
  });
});
