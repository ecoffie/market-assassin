/**
 * POST /api/app/connected-apps/selections  {email, connection_id, file_id}
 *
 * Called after the customer picks a file in the Google Picker or OneDrive picker. Confirms, through the
 * connection's own grant, that the file exists and is a type Mindy reads, then returns a FILE HANDLE signed for
 * this acting scope + connection + file (24 h). Ask Mindy's read_connected_file accepts only such a handle.
 * Nothing is downloaded or stored here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectedAppsGate } from '@/lib/connected-apps/route-gate';
import { accessTokenFor } from '@/lib/connected-apps/store';
import { assertReadable, fetchFileMeta, FileReadError, FILE_HANDLE_TTL_SEC, signFileHandle } from '@/lib/connected-apps/files';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const g = await connectedAppsGate(request, body.email);
  if ('error' in g) return g.error;
  const connectionId = String(body.connection_id || '');
  const fileId = String(body.file_id || '');
  if (!connectionId || !fileId || fileId.length > 300) return NextResponse.json({ error: 'connection_id and file_id required' }, { status: 400 });

  const tok = await accessTokenFor(g.scopeKey, g.email, connectionId);
  if (!tok.ok) return NextResponse.json({ error: tok.reason }, { status: tok.reason === 'not_found' ? 404 : tok.reason === 'refresh_failed' ? 502 : 409 });
  try {
    const meta = await fetchFileMeta(tok.provider, tok.token, fileId);
    assertReadable(meta);
    const handle = signFileHandle({ scopeKey: g.scopeKey, ownerEmail: g.email, connectionId, provider: tok.provider, fileId: meta.id, name: meta.name });
    return NextResponse.json({
      file_handle: handle,
      expires_in: FILE_HANDLE_TTL_SEC,
      file: { name: meta.name, provider: tok.provider, connected_account: tok.connection.connected_email, source_url: meta.webUrl, modified: meta.modified },
    });
  } catch (err) {
    const code = err instanceof FileReadError ? err.code : 'provider_error';
    const status = code === 'not_found' ? 404 : code === 'no_access' ? 403 : code === 'too_large' ? 413 : code === 'unsupported_type' ? 415 : 502;
    return NextResponse.json({ error: code }, { status });
  }
}
