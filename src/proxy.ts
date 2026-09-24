import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveLegacyDestination } from '@/lib/mindy/legacy-routes';

/**
 * PROXY - ROUTE PROTECTION
 * ========================
 *
 * Protected Routes:
 * 1. /database.html - Federal Contractor Database (requires db_access_email cookie)
 * 2. /contractor-database - Federal Contractor Database page (requires db_access_email cookie)
 * 3. /federal-market-assassin - retired → /app?panel=research (anonymous password holders excepted)
 *
 * Access is granted via:
 * - Purchase through Stripe (sets cookie automatically)
 * - Access code validation (sets cookie)
 * - Direct cookie set by admin
 *
 * Legacy customer interfaces (the pre-/app `/briefings` dashboard and friends) are
 * redirected to the current workspace — see src/lib/mindy/legacy-routes.ts for the table
 * and the evidence. 307, not 308: a permanent redirect is cached by browsers indefinitely,
 * and this must stay reversible by a deploy.
 */

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const legacyDestination = resolveLegacyDestination(pathname, request.nextUrl.searchParams);
  if (legacyDestination) {
    return NextResponse.redirect(new URL(legacyDestination, request.url), 307);
  }

  // Protect Federal Contractor Database (HTML version)
  if (pathname === '/database.html') {
    const hasAccess = request.cookies.get('db_access_email')?.value;

    if (!hasAccess) {
      return NextResponse.redirect(new URL('/database-locked', request.url));
    }
  }

  // Protect Federal Contractor Database (Next.js page)
  // If user has access, redirect to actual database. If not, redirect to locked page.
  if (pathname === '/contractor-database') {
    const hasAccess = request.cookies.get('db_access_email')?.value;

    if (hasAccess) {
      // User has access - send them to the actual database
      return NextResponse.redirect(new URL('/database.html', request.url));
    } else {
      return NextResponse.redirect(new URL('/database-locked', request.url));
    }
  }

  // Federal Market Assassin: retired to /app?panel=research by the resolver above, for every
  // visitor. The shared-password routes and their grace window are removed.

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/database.html',
    '/contractor-database',
    '/federal-market-assassin',
    // Legacy customer interfaces — keep in sync with LEGACY_ROUTES (a unit test enforces it).
    '/briefings',
    '/briefings/dashboard',
    '/bd-assist',
    '/federal-market-assassin/success',
    '/market-assassin-locked',
    '/market-assassin',
    '/opportunity-hunter',
    '/opportunity-scout',
    '/opportunity-scout.html',
    '/prime-lookup.html',
    '/start',
    '/bundles/ultimate',
    '/contractor-database-product',
  ],
};
