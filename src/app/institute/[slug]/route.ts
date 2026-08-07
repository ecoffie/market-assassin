/**
 * GET /institute/[slug] — one dynamic route serving every registry white paper.
 *
 * POSITIONING / RESEARCH DELIVERABLE (see src/lib/gov/shell.ts). Renders a markdown white
 * paper from INSTITUTE_PAPERS through renderPaper() — same designed, printable page as the
 * hand-built Competition Gap paper. force-static + generateStaticParams pre-renders each slug.
 *
 * NOTE: `competition-gap` is its OWN static route (src/app/institute/competition-gap/route.ts)
 * and is intentionally NOT in INSTITUTE_PAPERS, so this dynamic segment never shadows it (and
 * Next prefers the static segment regardless).
 */
import { NextResponse } from 'next/server';
import { renderPaper } from '@/lib/gov/paper';
import { INSTITUTE_PAPERS } from '@/lib/gov/papers-registry';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return INSTITUTE_PAPERS.map((p) => ({ slug: p.meta.slug }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const paper = INSTITUTE_PAPERS.find((p) => p.meta.slug === slug);

  if (!paper) {
    return new NextResponse(
      '<!doctype html><meta charset="utf-8"><title>Not found</title><p>Paper not found. <a href="/institute">The Institute</a></p>',
      { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' } },
    );
  }

  return new NextResponse(renderPaper(paper.meta, paper.markdown), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
