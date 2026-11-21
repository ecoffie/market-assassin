/**
 * GET /api/app/vault/documents/preview?email=&id=  — the on-screen reading copy of one GENERATED Vault
 * document, for the Opportunity Map's in-chat report pane (no download needed to read it).
 *
 * It renders the document's STORED DocModel with the same engine and theme that produced its PDF/Word
 * (renderHtml, `screen` layout), so the pane and the files say exactly the same thing. Nothing is
 * generated here and nothing is invented: a row with no doc_model has no preview.
 *
 * Same guarantees as the download route (this is its sibling):
 *   - STRONG auth for `email`;
 *   - STRICT acting scope (resolveVaultWriteOwner): an unauthorized x-active-workspace header or a
 *     resolver error is refused (409), never answered from the caller's own Vault;
 *   - the owner check is IN the query (user_email = acting-scope owner, doc_class = 'generated', not
 *     archived), so another account's document is indistinguishable from a missing one;
 *   - missing, forbidden, archived, not-generated, model-less and malformed ids all return the IDENTICAL
 *     404 body (the #2108 pattern);
 *   - gated by VAULT_GENERATED_FILES (off, or not allowlisted for this caller → the same 404).
 * Free: no credits. Response is JSON `{ html, title, version, document_id, files[] }`; the browser puts
 * `html` in a script-less sandboxed iframe (srcdoc), because an iframe cannot send the auth headers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { WORKSPACE_UNCONFIRMED_NOTE } from '@/lib/chat/chat-acting-scope';
import { resolveVaultWriteOwner } from '@/lib/vault/upload';
import { vaultDocEnabledFor, vaultDocFeatureLive } from '@/lib/vault/flags';
import { renderHtml } from '@/lib/documents/render-html';
import type { DocModel } from '@/lib/documents/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const FORMAT_BY_EXT: Record<string, string> = { pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', csv: 'csv' };

const notFound = () => NextResponse.json({ success: false, error: 'not_found' }, { status: 404, headers: NO_STORE });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const baseName = (f: string) => f.replace(/\.(pdf|docx|xlsx|csv)$/i, '');
const extOf = (f: string) => (/\.([a-z0-9]+)$/i.exec(f)?.[1] ?? '').toLowerCase();

type Row = { id: string; original_filename: string; version: number | null; parent_id: string | null; doc_model: unknown };

export async function GET(request: NextRequest) {
  if (!vaultDocFeatureLive('generate')) return notFound();
  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  const id = (request.nextUrl.searchParams.get('id') || '').trim();
  if (!email) return NextResponse.json({ success: false, error: 'email_required' }, { status: 400, headers: NO_STORE });

  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  const caller = auth.email.toLowerCase();
  if (!vaultDocEnabledFor('generate', caller)) return notFound();
  const owner = await resolveVaultWriteOwner(caller, request);
  if (!owner) {
    return NextResponse.json({ success: false, error: 'workspace_unconfirmed', message: WORKSPACE_UNCONFIRMED_NOTE }, { status: 409, headers: NO_STORE });
  }
  if (!UUID_RE.test(id)) return notFound();

  const sb = db();
  const { data, error } = await sb.from('user_boilerplate_docs')
    .select('id, original_filename, version, parent_id, doc_model')
    .eq('id', id)
    .eq('user_email', owner.ownerEmail)
    .eq('doc_class', 'generated')
    .is('archived_at', null)
    .maybeSingle();
  const row = (error ? null : data) as Row | null;
  if (!row || !row.doc_model || typeof row.doc_model !== 'object' || Array.isArray(row.doc_model)) return notFound();

  let html: string;
  try {
    html = renderHtml(row.doc_model as DocModel, { screen: true });
  } catch (e) {
    console.error('[vault/preview] render failed:', (e as Error)?.message);
    return notFound();
  }

  // The other formats saved with this one (same version + parent chain + base name) → the export chips.
  // A read failure only costs the chips; the report itself is still shown.
  const files: Array<{ format: string; document_id: string; file_name: string; version: number }> = [];
  try {
    let q = sb.from('user_boilerplate_docs')
      .select('id, original_filename, version, parent_id, doc_model')
      .eq('user_email', owner.ownerEmail).eq('doc_class', 'generated').is('archived_at', null).eq('version', row.version ?? 1);
    q = row.parent_id ? q.eq('parent_id', row.parent_id) : q.is('parent_id', null);
    const { data: sibs, error: sibErr } = await q.limit(20);
    if (!sibErr && Array.isArray(sibs)) {
      const base = baseName(row.original_filename);
      const best = new Map<string, { format: string; document_id: string; file_name: string; version: number }>();
      for (const r of sibs as Row[]) {
        const format = FORMAT_BY_EXT[extOf(r.original_filename)];
        if (!format || baseName(r.original_filename) !== base) continue;
        const version = r.version ?? 1;
        const prev = best.get(format);
        // One export chip per format — duplicate sibling rows used to stamp five "PDF" buttons.
        if (!prev || version >= prev.version) {
          best.set(format, { format, document_id: r.id, file_name: r.original_filename, version });
        }
      }
      for (const f of best.values()) files.push(f);
    }
  } catch { /* chips only */ }
  const order = ['pdf', 'docx', 'xlsx', 'csv'];
  files.sort((a, b) => order.indexOf(a.format) - order.indexOf(b.format));

  const model = row.doc_model as { title?: unknown };
  return NextResponse.json(
    {
      success: true,
      document_id: row.id,
      title: typeof model.title === 'string' && model.title.trim() ? model.title.trim() : baseName(row.original_filename),
      version: row.version ?? 1,
      html,
      files,
    },
    { status: 200, headers: NO_STORE },
  );
}
