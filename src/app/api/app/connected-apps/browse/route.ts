/**
 * POST /api/app/connected-apps/browse  {email, connection_id, folder_id?, q?}
 *
 * Mindy's OneDrive file chooser: lists folders and readable files in the user's OWN OneDrive (or searches it
 * by name) through the connection's existing Files.Read grant. Metadata only, at the customer's click; the
 * Microsoft token stays on the server. Google uses Google's Picker instead (drive.file cannot list a drive).
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectedAppsGate } from '@/lib/connected-apps/route-gate';
import { accessTokenFor } from '@/lib/connected-apps/store';
import { FileReadError, listOneDrive } from '@/lib/connected-apps/files';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const g = await connectedAppsGate(request, body.email);
  if ('error' in g) return g.error;
  const connectionId = String(body.connection_id || '');
  if (!connectionId) return NextResponse.json({ error: 'connection_id required' }, { status: 400 });
  const folderId = body.folder_id ? String(body.folder_id).slice(0, 300) : null;
  const q = body.q ? String(body.q).slice(0, 100) : null;

  const tok = await accessTokenFor(g.scopeKey, g.email, connectionId);
  if (!tok.ok) return NextResponse.json({ error: tok.reason }, { status: tok.reason === 'not_found' ? 404 : tok.reason === 'refresh_failed' ? 502 : 409 });
  if (tok.provider !== 'microsoft') return NextResponse.json({ error: 'not_supported' }, { status: 400 });
  try {
    const items = await listOneDrive(tok.token, { folderId, query: q });
    return NextResponse.json({ items }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const code = err instanceof FileReadError ? err.code : 'provider_error';
    return NextResponse.json({ error: code }, { status: code === 'not_found' ? 404 : code === 'no_access' ? 403 : 502 });
  }
}
