import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

interface MAAccessToken {
  token: string;
  email: string;
  customerName?: string;
  createdAt: string;
}

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json({ success: false, error: 'Access code required' }, { status: 400 });
    }

    // Check for Market Assassin access token
    const tokenData = await kv.get<MAAccessToken>(`matoken:${code}`);

    if (!tokenData) {
      return NextResponse.json({ success: false, error: 'Invalid access code' }, { status: 401 });
    }

    // Set cookie for access
    const response = NextResponse.json({ success: true, email: tokenData.email });

    response.cookies.set('ma_access_email', tokenData.email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Error verifying MA access:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify access' }, { status: 500 });
  }
}

// Helper function to create Market Assassin access tokens (for webhooks)
export async function createMAAccessToken(email: string, customerName?: string): Promise<MAAccessToken> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const maToken: MAAccessToken = {
    token,
    email,
    customerName,
    createdAt: new Date().toISOString(),
  };

  // Store in KV
  await kv.set(`matoken:${token}`, maToken);
  await kv.set(`maaccess:${email.toLowerCase()}`, { token, createdAt: maToken.createdAt });

  console.log(`✅ Market Assassin access token created: ${token} for ${email}`);
  return maToken;
}
