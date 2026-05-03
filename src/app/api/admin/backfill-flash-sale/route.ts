/**
 * Backfill Flash Sale Ultimate Giant Users
 *
 * GET /api/admin/backfill-flash-sale?password=xxx
 *   - Preview: List users with both MA Premium + Content Full Fix (Ultimate pattern)
 *
 * POST /api/admin/backfill-flash-sale?password=xxx
 *   - Execute: Set bundle_tier='Ultimate Giant' and treatment_type='briefings' for these users
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

interface KVAccessData {
  tier?: string;
  product?: string;
  grantedAt?: string;
  [key: string]: unknown;
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // Get all users
  const { data: users, error } = await supabase
    .from('user_notification_settings')
    .select('user_email, treatment_type, paid_status')
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ultimateUsers: {
    email: string;
    maAccess: KVAccessData | null;
    contentAccess: KVAccessData | null;
    dbAccess: KVAccessData | null;
    recompeteAccess: KVAccessData | null;
    currentTreatment: string;
  }[] = [];

  for (const user of users || []) {
    const email = user.user_email.toLowerCase();

    try {
      // Check KV access for all Ultimate bundle products
      const [maRaw, contentRaw, dbRaw, recompeteRaw] = await Promise.all([
        kv.get(`ma:${email}`),
        kv.get(`contentgen:${email}`),
        kv.get(`dbaccess:${email}`),
        kv.get(`recompete:${email}`),
      ]);

      // Parse access data
      const parseAccess = (raw: unknown): KVAccessData | null => {
        if (!raw) return null;
        if (typeof raw === 'string') {
          try { return JSON.parse(raw); } catch { return { tier: 'unknown' }; }
        }
        return raw as KVAccessData;
      };

      const maAccess = parseAccess(maRaw);
      const contentAccess = parseAccess(contentRaw);
      const dbAccess = parseAccess(dbRaw);
      const recompeteAccess = parseAccess(recompeteRaw);

      // Ultimate Giant pattern: has MA + Content + DB + Recompete
      // (Premium tier for MA indicates Ultimate, not just standard)
      const hasAllFour = maAccess && contentAccess && dbAccess && recompeteAccess;

      // Check for Premium tier indicators
      const isPremiumMA = maAccess?.tier === 'premium' ||
                          maAccess?.tier === 'assassin_premium' ||
                          (maAccess?.product && String(maAccess.product).toLowerCase().includes('premium'));

      const isFullFix = contentAccess?.tier === 'full_fix' ||
                        contentAccess?.tier === 'content_full_fix' ||
                        (contentAccess?.product && String(contentAccess.product).toLowerCase().includes('full'));

      // Ultimate = has all 4 products AND (Premium MA OR Full Fix Content)
      if (hasAllFour && (isPremiumMA || isFullFix)) {
        ultimateUsers.push({
          email,
          maAccess,
          contentAccess,
          dbAccess,
          recompeteAccess,
          currentTreatment: user.treatment_type || 'alerts',
        });
      }
    } catch {
      // KV error, skip this user
    }
  }

  return NextResponse.json({
    success: true,
    mode: 'preview',
    totalUsers: users?.length || 0,
    ultimateGiantCount: ultimateUsers.length,
    users: ultimateUsers.map(u => ({
      email: u.email,
      currentTreatment: u.currentTreatment,
      maGrant: u.maAccess?.grantedAt || 'unknown',
      contentGrant: u.contentAccess?.grantedAt || 'unknown',
    })),
    instructions: 'POST to this endpoint to backfill bundle_tier and treatment_type for these users',
  });
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // First, get the list (same logic as GET)
  const { data: users } = await supabase
    .from('user_notification_settings')
    .select('user_email, treatment_type, paid_status')
    .limit(2000);

  const ultimateEmails: string[] = [];

  for (const user of users || []) {
    const email = user.user_email.toLowerCase();

    try {
      const [maRaw, contentRaw, dbRaw, recompeteRaw] = await Promise.all([
        kv.get(`ma:${email}`),
        kv.get(`contentgen:${email}`),
        kv.get(`dbaccess:${email}`),
        kv.get(`recompete:${email}`),
      ]);

      const parseAccess = (raw: unknown): KVAccessData | null => {
        if (!raw) return null;
        if (typeof raw === 'string') {
          try { return JSON.parse(raw); } catch { return { tier: 'unknown' }; }
        }
        return raw as KVAccessData;
      };

      const maAccess = parseAccess(maRaw);
      const contentAccess = parseAccess(contentRaw);
      const dbAccess = parseAccess(dbRaw);
      const recompeteAccess = parseAccess(recompeteRaw);

      const hasAllFour = maAccess && contentAccess && dbAccess && recompeteAccess;

      const isPremiumMA = maAccess?.tier === 'premium' ||
                          maAccess?.tier === 'assassin_premium' ||
                          (maAccess?.product && String(maAccess.product).toLowerCase().includes('premium'));

      const isFullFix = contentAccess?.tier === 'full_fix' ||
                        contentAccess?.tier === 'content_full_fix' ||
                        (contentAccess?.product && String(contentAccess.product).toLowerCase().includes('full'));

      if (hasAllFour && (isPremiumMA || isFullFix)) {
        ultimateEmails.push(email);
      }
    } catch {
      // Skip
    }
  }

  // Backfill these users
  const results: { email: string; status: 'updated' | 'failed'; error?: string }[] = [];

  for (const email of ultimateEmails) {
    try {
      const { error: updateError } = await supabase
        .from('user_notification_settings')
        .update({
          treatment_type: 'briefings',
          paid_status: true,
          briefings_enabled: true,
        })
        .eq('user_email', email);

      if (updateError) throw updateError;

      // Log to experiment_log
      await supabase.from('experiment_log').insert({
        user_email: email,
        action: 'flash_sale_backfill',
        reason: 'Ultimate Giant flash sale ($1,000) - Feb 2026',
        metadata: { bundle_tier: 'Ultimate Giant', briefings_access: 'lifetime' },
      });

      // Ensure briefings KV access
      await kv.set(`briefings:${email}`, {
        tier: 'lifetime',
        product: 'Ultimate Giant Bundle (Flash Sale)',
        grantedAt: new Date().toISOString(),
        source: 'flash_sale_backfill',
      });

      results.push({ email, status: 'updated' });
    } catch (err) {
      results.push({
        email,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }

  const updated = results.filter(r => r.status === 'updated').length;
  const failed = results.filter(r => r.status === 'failed').length;

  return NextResponse.json({
    success: true,
    mode: 'execute',
    summary: {
      processed: ultimateEmails.length,
      updated,
      failed,
    },
    results,
  });
}
