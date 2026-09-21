/**
 * Public research render surface — /research/<slug> (The Mindy Institute).
 *
 * This is the Class-A counterpart to /reports/<id> (private capability URLs). /research/* is PUBLIC,
 * PERMANENT, and SEO-indexed — the Institute's outward publications. A slug resolves to a PUBLISHED
 * publication in the registry; anything unpublished/unknown returns a 404 (a planned report must never
 * render on a public URL as if it were live). The URL is permanent; the EDITION is a field on the
 * publication, so the 2027 edition ships at this same URL.
 *
 * A route handler (not a page) because the publication renderers emit a full self-contained
 * <!doctype html> document — same reason /reports/<id> is a route handler.
 *
 * ⚠️ Honesty: the benchmark HTML is regenerated from LIVE data on each request (force-dynamic). If the
 * data query errors, we return a clean error page — NEVER a fabricated or partial benchmark.
 */
import { NextResponse } from 'next/server';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { publishedBySlug } from '@/lib/analytics/research-publications';
import { computeSbBenchmark } from '@/lib/analytics/sb-participation-benchmark';
import { renderSbBenchmarkHtml } from '@/lib/analytics/sb-benchmark-html';

export const dynamic = 'force-dynamic';

const SITE = 'https://getmindy.ai';

function html(body: string, status = 200): NextResponse {
  return new NextResponse(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function notFound(): NextResponse {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found — The Mindy Institute</title><meta name="robots" content="noindex"></head><body style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#101828"><h1 style="color:#0b1f3a">Publication not found</h1><p style="color:#667085">No published Mindy Institute research exists at this address.</p></body></html>`,
    404,
  );
}

function errorPage(): NextResponse {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Temporarily unavailable — The Mindy Institute</title><meta name="robots" content="noindex"></head><body style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#101828"><h1 style="color:#0b1f3a">Temporarily unavailable</h1><p style="color:#667085">This benchmark regenerates from live federal data and the source is momentarily unavailable. Please try again shortly — we do not publish partial or estimated figures.</p></body></html>`,
    503,
  );
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const pub = publishedBySlug(slug);
  if (!pub) return notFound();

  // Route the published slug to its renderer. Today RES-003 is the only public publication.
  if (slug === 'small-business-participation-benchmark') {
    const nowIso = new Date().toISOString();
    let benchmark;
    try {
      benchmark = await computeSbBenchmark(getWriteClient(), nowIso);
    } catch (e) {
      console.error('[research/sb-benchmark] compute threw:', e);
      return errorPage();
    }
    // Honest failure: engine returned an error OR no ranked rows → do NOT publish an empty benchmark.
    if (benchmark.error || benchmark.rows.length === 0) {
      console.error('[research/sb-benchmark] not renderable:', benchmark.error, 'rows:', benchmark.rows.length);
      return errorPage();
    }
    const generatedDate = nowIso.slice(0, 10);
    return html(
      renderSbBenchmarkHtml(benchmark, {
        edition: pub.edition ?? '2026',
        version: pub.version ?? 'v1.0',
        generatedDate,
        canonical: `${SITE}${pub.url ?? `/research/${slug}`}`,
      }),
    );
  }

  // A published slug with no renderer wired is a build error, not a public 404.
  console.error('[research] published slug has no renderer:', slug);
  return errorPage();
}
