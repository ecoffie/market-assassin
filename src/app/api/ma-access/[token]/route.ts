import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

interface MAAccessToken {
  token: string;
  email: string;
  customerName?: string;
  createdAt: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Validate token from KV
    const tokenData = await kv.get<MAAccessToken>(`matoken:${token}`);

    if (!tokenData) {
      return NextResponse.redirect(new URL('/app?panel=research', request.url));
    }

    // Market Assassin is part of the /app workspace now (legacy-routes.ts): an `ma:` grant is
    // Pro there. The cookie is still set so nothing that reads it regresses.
    const response = NextResponse.redirect(new URL('/app?panel=research', request.url));

    // Set the access cookie
    response.cookies.set('ma_access_email', tokenData.email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    console.log(`🎯 Market Assassin access granted via link for ${tokenData.email}`);

    return response;
  } catch (error) {
    console.error('Error processing MA access link:', error);
    return NextResponse.redirect(new URL('/app?panel=research', request.url));
  }
}
