/**
 * GET /api/app/proposal/image-proxy?url=… — relays one open-license image so the proposal editor can
 * put it into an exported PDF / Word file (a cross-origin image would taint the canvas).
 *
 * Only the image servers of the editor's search sources are allowed (IMAGE_PROXY_HOSTS), every
 * redirect hop is re-checked against that list, only image/* responses pass, and the body is capped.
 * No auth: it serves only public, openly licensed images and cannot reach any other host.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isProxyableImageUrl } from '@/lib/proposal/image-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 12 * 1024 * 1024;
const UA = 'MindyProposalEditor/1.0 (https://getmindy.ai)';

export async function GET(request: NextRequest) {
  let url = request.nextUrl.searchParams.get('url') || '';
  if (!isProxyableImageUrl(url)) return NextResponse.json({ error: 'Image host not allowed' }, { status: 400 });

  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(10000) })
      .catch(() => null);
    if (!res) return NextResponse.json({ error: 'Image unavailable' }, { status: 502 });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) break;
      url = new URL(next, url).toString();
      if (!isProxyableImageUrl(url)) return NextResponse.json({ error: 'Image host not allowed' }, { status: 400 });
      continue;
    }
    break;
  }
  if (!res || !res.ok) return NextResponse.json({ error: 'Image unavailable' }, { status: 502 });
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) return NextResponse.json({ error: 'Not an image' }, { status: 415 });
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return NextResponse.json({ error: 'Image too large' }, { status: 413 });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'Image too large' }, { status: 413 });
  return new NextResponse(buf, {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' },
  });
}
