import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { recordAudit } from '@/lib/audit-log';

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
    const ip = getClientIP(request);
    const rl = await checkAdminRateLimit(ip);
    if (!rl.allowed) return rateLimitResponse(rl);

    const { email, name, adminPassword } = await request.json();

    if (!verifyAdminPassword(adminPassword)) {
      await recordAudit({
        action: 'admin_auth_failed',
        targetEmail: email,
        targetTable: 'grant-ma-access',
        detail: { route: 'grant-ma-access' },
        request,
        actorIp: ip,
      });
      return NextResponse.json(
        { error: 'Unauthorized' },
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

    const accessLink = `https://getmindy.ai/api/ma-access/${token}`;

    console.log(`🎯 Admin granted Market Assassin access to ${email}, token: ${token}`);

    // Queryable audit trail (never store the full token).
    await recordAudit({
      action: 'grant_ma_access',
      targetEmail: email,
      targetTable: 'kv:matoken',
      detail: { tokenPrefix: token.slice(0, 6), customerName: name || null },
      request,
      actorIp: ip,
    });

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
