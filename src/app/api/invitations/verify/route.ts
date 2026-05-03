/**
 * Verify Invitation Token
 *
 * GET /api/invitations/verify?token=xxx
 *
 * Verifies a magic link token and returns the associated customer info.
 * Used by the signup page to pre-fill and skip payment verification.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    // Decode and verify the token
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split(':');

    if (parts.length !== 3) {
      return NextResponse.json({ error: 'Invalid token format' }, { status: 400 });
    }

    const [customerId, timestamp, providedHmac] = parts;

    // Verify HMAC
    const secret = (process.env.STRIPE_SECRET_KEY || '').slice(-32);
    const payload = `${customerId}:${timestamp}`;
    const expectedHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);

    if (providedHmac !== expectedHmac) {
      return NextResponse.json({ error: 'Invalid token signature' }, { status: 400 });
    }

    // Check if token has expired (30 days)
    const tokenTime = parseInt(timestamp, 10);
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    if (now - tokenTime > thirtyDays) {
      return NextResponse.json({ error: 'Token has expired' }, { status: 400 });
    }

    // Look up the invitation in the database
    const { data: invitation, error: dbError } = await supabase
      .from('invitation_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (dbError || !invitation) {
      // Token is valid but not in DB - still accept it (backwards compatible)
      // Just return the customer ID for Stripe lookup
      return NextResponse.json({
        valid: true,
        customerId,
        email: null,
        firstName: null,
        productName: null,
        source: 'token_only',
      });
    }

    // Check if already used
    if (invitation.used_at) {
      return NextResponse.json({
        error: 'This invitation has already been used',
        usedAt: invitation.used_at,
      }, { status: 400 });
    }

    // Check expiration from DB
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      customerId: invitation.stripe_customer_id,
      email: invitation.email,
      firstName: invitation.first_name,
      productName: invitation.product_name,
      source: 'database',
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }
}

/**
 * Mark invitation as used
 *
 * POST /api/invitations/verify
 * Body: { token: string, email: string }
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { token, email } = body;

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    // Mark the token as used
    const { error } = await supabase
      .from('invitation_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);

    if (error) {
      console.error('Error marking invitation as used:', error);
      // Don't fail the signup if this fails
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in POST /api/invitations/verify:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
