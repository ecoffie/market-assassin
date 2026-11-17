/**
 * GET /api/app/proposal/images?email=…&q=… — images that are free to use in a commercial proposal,
 * for the Word-style proposal editor's "Find an image" (Ask Mindy › Images).
 *
 * Sources: Wikimedia Commons + Openverse (keyless). Each source is cached for 24h per query through
 * the shared MCP external cache, so repeat searches do not spend the shared server IP's rate limit.
 * A source that fails is reported in `unavailable`; it is never shown as "no images".
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { withCache } from '@/lib/mcp/external-cache';
import {
  mergeResults, openverseUrl, parseOpenverse, parseWikimedia, wikimediaUrl, type ImageResult, type ImageSource,
} from '@/lib/proposal/image-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA = 'MindyProposalEditor/1.0 (https://getmindy.ai)';
const TTL = 24 * 60 * 60;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email') || '';
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const q = (request.nextUrl.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ success: false, error: 'Type what the picture should show.' }, { status: 400 });

  const unavailable: ImageSource[] = [];
  const run = async (source: ImageSource, url: string, parse: (j: unknown) => ImageResult[]) => {
    try {
      const { value } = await withCache(`proposal_images_${source}`, { q }, TTL, async () => parse(await fetchJson(url)));
      return value;
    } catch (e) {
      console.warn(`[proposal/images] ${source} failed:`, (e as Error).message);
      unavailable.push(source);
      return [] as ImageResult[];
    }
  };
  const [wm, ov] = await Promise.all([
    run('wikimedia', wikimediaUrl(q), parseWikimedia),
    run('openverse', openverseUrl(q), parseOpenverse),
  ]);
  const results = mergeResults(wm, ov, 16);
  return NextResponse.json({ success: true, q, results, unavailable });
}
