/**
 * Contract test for the /partners → /gov/apex redirect.
 *
 * Regression guard (2026-08-16): the route shipped as `force-static` while
 * building its Location from `req.nextUrl.origin`. Next prerendered it at build
 * time and froze the build machine's origin into the header, so production
 * served `308 -> http://localhost:3000/gov/apex` and every scanned NAPEX QR
 * code landed on a dead URL. It also silently dropped the ?source= attribution.
 *
 * The invariant: the redirect target's ORIGIN must come from the incoming
 * request, and the query string must survive.
 *
 * NOTE ON WHAT THESE TESTS CAN AND CANNOT PROVE. The failure was a BUILD-time
 * effect: `force-static` made Next prerender the route and freeze the origin.
 * A unit test always invokes GET() with a live request, so `nextUrl.origin`
 * looks correct here — verified by re-running this file against the original
 * buggy source: only the `dynamic` assertion went red, the four behavioural
 * ones passed. So the FIRST test is the load-bearing guard; the rest lock in
 * the URL-shaping contract (target path, attribution) against future edits.
 * Do not delete the `dynamic` assertion because it looks trivial — it is the
 * only one that reproduces the outage.
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, dynamic } from './route';

function redirectFor(url: string) {
  const res = GET(new NextRequest(new URL(url)));
  return { status: res.status, location: res.headers.get('location')! };
}

describe('/partners redirect', () => {
  it('is never prerendered — a static origin is what broke production', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('redirects to /gov/apex on the ORIGIN OF THE REQUEST, not a build-time host', () => {
    const { status, location } = redirectFor('https://getmindy.ai/partners');
    expect(status).toBe(308);
    expect(location).toBe('https://getmindy.ai/gov/apex');
    expect(location).not.toContain('localhost');
  });

  it('follows the host it was actually called on', () => {
    // A preview deploy must redirect within the preview, not to production.
    const { location } = redirectFor('https://preview-abc.vercel.app/partners');
    expect(location).toBe('https://preview-abc.vercel.app/gov/apex');
  });

  it('preserves conference attribution', () => {
    const { location } = redirectFor('https://getmindy.ai/partners?source=napex2026');
    expect(location).toBe('https://getmindy.ai/gov/apex?source=napex2026');
  });

  it('preserves multi-param attribution', () => {
    const { location } = redirectFor(
      'https://getmindy.ai/partners?source=napex2026&utm_medium=qr',
    );
    expect(location).toContain('source=napex2026');
    expect(location).toContain('utm_medium=qr');
  });
});
