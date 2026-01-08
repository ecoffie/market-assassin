import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Protect /database.html - require valid session cookie
  if (pathname === '/database.html') {
    const hasAccess = request.cookies.get('db_access_email')?.value;

    if (!hasAccess) {
      // Redirect to an access denied page or purchase page
      return NextResponse.redirect(new URL('/database-locked', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/database.html'],
};
