/**
 * Proxy SAM.gov attachment downloads through Mindy.
 *
 * SAM file URLs look like
 *   https://sam.gov/api/prod/opps/v3/opportunities/resources/files/{fileId}/download
 * and require a SAM_API_KEY to access. Clicking the link directly from
 * a browser hits SAM's CDN without the key and gets back:
 *   {"errors":{"status":"UNAUTHORIZED",...}}
 *
 * This endpoint takes the file URL (or just the fileId) as a query
 * param, appends our rotated SAM key, and streams the response back
 * with the original content-type + filename. The user sees a normal
 * file download.
 *
 * Two accepted forms:
 *   GET /api/sam-attachment?url=<encoded SAM file URL>
 *   GET /api/sam-attachment?fileId=<file id>
 *
 * No auth on this endpoint — attachments are public data SAM publishes
 * freely once you have any API key, and we don't want a sign-in wall
 * blocking download UX. The SAM key itself stays server-side; the
 * browser never sees it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRotatedSAMKey } from '@/lib/sam/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SAM_FILE_URL_PREFIX = 'https://sam.gov/api/prod/opps/v3/opportunities/resources/files/';

function buildFileUrl(url: string | null, fileId: string | null): URL | null {
  if (url) {
    try {
      const parsed = new URL(url);
      // Only allow SAM hosts to prevent open-proxy abuse.
      if (!/(^|\.)sam\.gov$/i.test(parsed.hostname)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
  if (fileId && /^[a-z0-9-]+$/i.test(fileId)) {
    try {
      return new URL(`${SAM_FILE_URL_PREFIX}${fileId}/download`);
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const fileId = request.nextUrl.searchParams.get('fileId');

  const target = buildFileUrl(url, fileId);
  if (!target) {
    return NextResponse.json(
      { error: 'Must provide url= (sam.gov host) or fileId=' },
      { status: 400 }
    );
  }

  const apiKey = getRotatedSAMKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'SAM API key not configured' },
      { status: 500 }
    );
  }

  // Append the key as the search param SAM expects.
  if (!target.searchParams.has('api_key')) {
    target.searchParams.set('api_key', apiKey);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      // Don't pass through cookies/auth headers from the original
      // request — SAM only wants the api_key param. Mindy is the
      // authenticated party here.
      headers: { Accept: '*/*' },
    });
  } catch (err) {
    console.error('[sam-attachment] fetch failed:', err);
    return NextResponse.json({ error: 'could not reach SAM.gov' }, { status: 502 });
  }

  if (!upstream.ok) {
    // Bubble SAM's status so the browser shows a real error, not a
    // 200 with garbage content.
    const errBody = await upstream.text().catch(() => '');
    return new NextResponse(errBody || `SAM.gov returned ${upstream.status}`, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Preserve content-type so PDFs open as PDFs, .docx as .docx, etc.
  // Preserve content-disposition (filename) when SAM provides it; if
  // not, leave the browser to figure it out from content-type.
  const headers = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) headers.set('Content-Type', ct);
  const cd = upstream.headers.get('content-disposition');
  if (cd) headers.set('Content-Disposition', cd);
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);

  // Mark cacheable for an hour — same file rarely changes.
  headers.set('Cache-Control', 'public, max-age=3600');

  return new NextResponse(upstream.body, {
    status: 200,
    headers,
  });
}
