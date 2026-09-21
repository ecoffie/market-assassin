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
      return NextResponse.redirect(new URL('/market-assassin-locked?error=invalid', request.url));
    }

    // Create response that redirects to Market Assassin
    const response = NextResponse.redirect(new URL('/federal-market-assassin', request.url));

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
    return NextResponse.redirect(new URL('/market-assassin-locked?error=failed', request.url));
  }
}
