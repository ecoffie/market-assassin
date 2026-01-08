import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

// Admin password - set this in your environment variables
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'govcon-admin-2024';

interface MAAccessToken {
  token: string;
  email: string;
  customerName?: string;
  createdAt: string;
}

function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export async function POST(request: NextRequest) {
  try {
    const { email, name, adminPassword } = await request.json();

    // Validate admin password
    if (adminPassword !== ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: 'Invalid admin password' },
        { status: 401 }
      );
    }

    // Validate email
    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email is required' },
        { status: 400 }
      );
    }

    // Create Market Assassin access token
    const token = generateToken();
    const maToken: MAAccessToken = {
      token,
      email,
      customerName: name || undefined,
      createdAt: new Date().toISOString(),
    };

    // Store in KV
    await kv.set(`matoken:${token}`, maToken);
    await kv.set(`maaccess:${email.toLowerCase()}`, { token, createdAt: maToken.createdAt });

    const accessLink = `https://tools.govcongiants.org/api/ma-access/${token}`;

    console.log(`🎯 Admin granted Market Assassin access to ${email}, token: ${token}`);

    return NextResponse.json({
      success: true,
      message: `Market Assassin access granted to ${email}`,
      token,
      accessLink,
    });
  } catch (error) {
    console.error('❌ Error granting Market Assassin access:', error);
    return NextResponse.json(
      { error: 'Failed to grant access' },
      { status: 500 }
    );
  }
}
