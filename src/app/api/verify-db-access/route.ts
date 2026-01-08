import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

interface DBAccessToken {
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

    // Check for database access token
    const tokenData = await kv.get<DBAccessToken>(`dbtoken:${code}`);

    if (!tokenData) {
      return NextResponse.json({ success: false, error: 'Invalid access code' }, { status: 401 });
    }

    // Set cookie for access
    const response = NextResponse.json({ success: true, email: tokenData.email });

    response.cookies.set('db_access_email', tokenData.email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Error verifying DB access:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify access' }, { status: 500 });
  }
}

// Helper function to create database access tokens (for webhooks)
export async function createDBAccessToken(email: string, customerName?: string): Promise<DBAccessToken> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const dbToken: DBAccessToken = {
    token,
    email,
    customerName,
    createdAt: new Date().toISOString(),
  };

  // Store in KV
  await kv.set(`dbtoken:${token}`, dbToken);
  await kv.set(`dbaccess:${email.toLowerCase()}`, { token, createdAt: dbToken.createdAt });

  console.log(`✅ Database access token created: ${token} for ${email}`);
  return dbToken;
}
