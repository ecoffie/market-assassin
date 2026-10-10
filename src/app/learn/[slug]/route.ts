/**
 * GET /learn/<slug> — one public Mindy Learn tutorial (Learn PR B).
 *
 * Unknown slugs 404. Every known slug is generated at build time from the static mission list.
 */
import { NextResponse } from 'next/server';
import { MISSIONS, missionBySlug } from '@/lib/learn/missions';
import { missionHtml } from '@/lib/learn/render';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return MISSIONS.map((m) => ({ slug: m.slug }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const m = missionBySlug(slug);
  if (!m) return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new NextResponse(missionHtml(m), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
