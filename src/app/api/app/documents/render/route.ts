/**
 * POST /api/app/documents/render  — render a DocModel to a downloadable file.
 *
 * Body: { email, format: 'pdf' | 'docx', model: DocModel }
 *
 * The document engine's first entry point (src/lib/documents). It is WRITE-FREE: nothing is stored,
 * logged to a table or cached; the caller's model goes in, a file comes out. Storing models (and
 * rendering by id) arrives with the chat_documents table, which needs separate approval.
 *
 * Auth: the signed Mindy session for `email`, and Pro (hasProAccess, the same gate as Ask Mindy).
 * The model is validated server-side (structure, limits, facts-must-cite) before anything renders.
 *
 * PDF uses headless Chromium (src/lib/pdf/launch-browser.ts). This route is listed in
 * next.config.ts outputFileTracingIncludes so the @sparticuz/chromium binary reaches the function.
 * If no browser can start, the route returns the printable HTML with X-Export-Degraded headers —
 * never a silent format change and never a 500.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { hasProAccess } from '@/lib/access/resolve-access';
import { renderDocument, type DocFormat } from '@/lib/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Chromium cold start (2–5 s) plus render; DOCX is sub-second.
export const maxDuration = 60;

/** A DocModel is capped at ~150K chars of content; anything far larger is not a document. */
const MAX_BODY_BYTES = 1_500_000;
const FORMATS: ReadonlySet<string> = new Set(['pdf', 'docx']);

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) return json({ success: false, error: 'document_too_large' }, 413);

  let body: { email?: unknown; format?: unknown; model?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ success: false, error: 'document_too_large' }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ success: false, error: 'invalid_json' }, 400);
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return json({ success: false, error: 'email_required' }, 400);
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;
  if (!(await hasProAccess(auth.session.email ?? email))) return json({ success: false, error: 'pro_required', upgrade: true }, 403);

  const format = typeof body.format === 'string' ? body.format : '';
  if (!FORMATS.has(format)) return json({ success: false, error: 'format must be pdf or docx' }, 400);

  const out = await renderDocument(body.model, format as DocFormat);
  if (!out.ok) {
    return json({ success: false, error: 'invalid_document', issues: out.issues.slice(0, 25) }, 422);
  }

  const disposition = (name: string) => `attachment; filename="${name.replace(/"/g, '')}"`;
  if (out.degraded) {
    return new NextResponse(new Uint8Array(out.bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': out.mime,
        'Content-Disposition': `inline; filename="${out.filename.replace(/"/g, '')}"`,
        // The format changed: say so, so the UI can tell the user honestly.
        'X-Export-Degraded': 'pdf-unavailable',
        // And why, so a production failure is diagnosable from a single request.
        'X-Export-Degraded-Reason': out.degraded.reason.replace(/[^\x20-\x7E]/g, ' ').slice(0, 200),
      },
    });
  }
  return new NextResponse(new Uint8Array(out.bytes), {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': out.mime, 'Content-Disposition': disposition(out.filename) },
  });
}
