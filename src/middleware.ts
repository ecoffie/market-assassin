import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * MIDDLEWARE - ROUTE PROTECTION
 * =============================
 *
 * Protected Routes:
 * 1. /database.html - Federal Contractor Database (requires db_access_email cookie)
 * 2. /contractor-database - Federal Contractor Database page (requires db_access_email cookie)
 * 3. /federal-market-assassin - Market Assassin tool (requires ma_access_email cookie)
 *
 * Access is granted via:
 * - Purchase through Stripe/LemonSqueezy (sets cookie automatically)
 * - Access code validation (sets cookie)
 * - Direct cookie set by admin
 */

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

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

  // Protect Federal Market Assassin
  if (pathname === '/federal-market-assassin') {
    const hasAccess = request.cookies.get('ma_access_email')?.value;

    if (!hasAccess) {
      return NextResponse.redirect(new URL('/market-assassin-locked', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/database.html', '/contractor-database', '/federal-market-assassin'],
};
