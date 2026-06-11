import { NextRequest, NextResponse } from 'next/server';
import { fetchSamAttachmentFilename, parseSamAttachment } from '@/lib/sam/attachment-metadata';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Resolve a SAM attachment's display filename without downloading the full file.
 * GET /api/sam-attachment/metadata?url=<encoded sam.gov file URL>
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  const ref = parseSamAttachment(url);
  if (!ref) {
    return NextResponse.json({ error: 'invalid SAM attachment url' }, { status: 400 });
  }

  if (ref.name && !/^document\s+\d+/i.test(ref.name)) {
    return NextResponse.json(
      { filename: ref.name },
      { headers: { 'Cache-Control': 'public, max-age=86400' } },
    );
  }

  const filename = await fetchSamAttachmentFilename(ref.url);
  if (!filename) {
    return NextResponse.json({ error: 'filename not available' }, { status: 404 });
  }

  return NextResponse.json(
    { filename },
    { headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
