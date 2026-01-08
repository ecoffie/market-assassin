import { NextRequest, NextResponse } from 'next/server';
import { validateDatabaseToken } from '@/lib/access-codes';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Validate the token
  const { valid, tokenData } = await validateDatabaseToken(token);

  if (!valid || !tokenData) {
    // Redirect to an error page or locked page
    return NextResponse.redirect(new URL('/database-locked?error=invalid', request.url));
  }

  // Create response with redirect
  const response = NextResponse.redirect(new URL('/database.html', request.url));

  // Set the access cookie
  response.cookies.set('db_access_email', tokenData.email, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  return response;
}
