import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

// Admin secret - set this in your Vercel environment variables
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'gcg-admin-2024';

interface TokenData {
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
    const { secret, email, customerName, product } = await request.json();

    // Verify admin secret
    if (secret !== ADMIN_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!email || !product) {
      return NextResponse.json({ error: 'Email and product are required' }, { status: 400 });
    }

    if (!['database', 'market-assassin', 'both'].includes(product)) {
      return NextResponse.json({ error: 'Product must be: database, market-assassin, or both' }, { status: 400 });
    }

    const results: { database?: string; marketAssassin?: string } = {};

    // Create database token
    if (product === 'database' || product === 'both') {
      const dbToken = generateToken();
      const dbTokenData: TokenData = {
        token: dbToken,
        email,
        customerName,
        createdAt: new Date().toISOString(),
      };
      await kv.set(`dbtoken:${dbToken}`, dbTokenData);
      await kv.set(`dbaccess:${email.toLowerCase()}`, { token: dbToken, createdAt: dbTokenData.createdAt });
      results.database = dbToken;
    }

    // Create Market Assassin token
    if (product === 'market-assassin' || product === 'both') {
      const maToken = generateToken();
      const maTokenData: TokenData = {
        token: maToken,
        email,
        customerName,
        createdAt: new Date().toISOString(),
      };
      await kv.set(`matoken:${maToken}`, maTokenData);
      await kv.set(`maaccess:${email.toLowerCase()}`, { token: maToken, createdAt: maTokenData.createdAt });
      results.marketAssassin = maToken;
    }

    return NextResponse.json({
      success: true,
      email,
      tokens: results,
    });
  } catch (error) {
    console.error('Error creating token:', error);
    return NextResponse.json({ error: 'Failed to create token' }, { status: 500 });
  }
}

// GET endpoint to check if a user has access
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const email = searchParams.get('email');

  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const dbAccess = await kv.get(`dbaccess:${email.toLowerCase()}`);
  const maAccess = await kv.get(`maaccess:${email.toLowerCase()}`);

  return NextResponse.json({
    email,
    hasDatabase: !!dbAccess,
    hasMarketAssassin: !!maAccess,
    dbAccess,
    maAccess,
  });
}
