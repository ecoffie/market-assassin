/**
 * GET /api/admin/upgrade-intent?password=xxx&days=30
 * GET /api/admin/upgrade-intent?password=xxx&format=csv
 *
 * Lists free users who showed upgrade intent via the in-app modal.
 * Hot = clicked Go Pro. Warm = opened modal only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  UPGRADE_INTENT_DEFINITION,
  accumulateUpgradeIntent,
  fetchUpgradeEngagementRows,
  hasCustomNaics,
  intentLevel,
  recommendedUpgradeAction,
  topFeature,
} from '@/lib/mindy/upgrade-intent';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const format = searchParams.get('format');
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10), 1), 90);
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
  const levelFilter = searchParams.get('level'); // hot | warm | all

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const engagementRows = await fetchUpgradeEngagementRows(supabase, sinceIso);
    const accumulated = accumulateUpgradeIntent(engagementRows);

    // Purchases
    const purchasesByEmail = new Map<string, { totalSpent: number; products: string[] }>();
    const { data: purchases } = await supabase
      .from('purchases')
      .select('user_email, product_name, amount_paid')
      .order('created_at', { ascending: false })
      .limit(5000);
    for (const p of purchases || []) {
      const email = p.user_email?.toLowerCase();
      if (!email) continue;
      const existing = purchasesByEmail.get(email) || { totalSpent: 0, products: [] };
      existing.products.push(p.product_name);
      existing.totalSpent += (p.amount_paid || 0) / 100;
      purchasesByEmail.set(email, existing);
    }

    // Active Pro subscribers (stripe cache)
    const proEmails = new Set<string>();
    try {
      const activeCustomerIds = new Set<string>();
      const { data: subs } = await supabase
        .from('stripe_subscriptions')
        .select('customer_id, status')
        .in('status', ['active', 'trialing', 'past_due'])
        .limit(2000);
      for (const s of subs || []) {
        if (s.customer_id) activeCustomerIds.add(s.customer_id);
      }
      if (activeCustomerIds.size > 0) {
        const { data: customers } = await supabase
          .from('stripe_customers')
          .select('id, email')
          .limit(5000);
        for (const c of customers || []) {
          if (c.id && c.email && activeCustomerIds.has(c.id)) {
            proEmails.add(c.email.toLowerCase());
          }
        }
      }
    } catch {
      /* stripe cache optional */
    }

    // Profile flags
    const profileByEmail = new Map<string, { paid_status: boolean; naics_codes: string[] | null }>();
    for (let from = 0; from < 60000; from += 1000) {
      const { data, error } = await supabase
        .from('user_notification_settings')
        .select('user_email, paid_status, naics_codes')
        .range(from, from + 999);
      if (error) break;
      for (const u of data || []) {
        if (u.user_email) {
          profileByEmail.set(u.user_email.toLowerCase(), {
            paid_status: Boolean(u.paid_status),
            naics_codes: u.naics_codes,
          });
        }
      }
      if (!data || data.length < 1000) break;
    }

    let candidates = accumulated.map((row) => {
      const level = intentLevel(row);
      const feat = topFeature(row.features);
      const purchase = purchasesByEmail.get(row.email);
      const profile = profileByEmail.get(row.email);
      const isProSubscriber =
        proEmails.has(row.email) || Boolean(profile?.paid_status);
      const profileComplete = hasCustomNaics(profile?.naics_codes);

      return {
        email: row.email,
        level,
        ctaClicks: row.ctaClicks,
        modalOpens: row.modalOpens,
        lastCtaAt: row.lastCtaAt,
        lastModalAt: row.lastModalAt,
        topFeature: feat,
        planClicked: Object.entries(row.plans).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
        profileComplete,
        totalSpent: purchase?.totalSpent || 0,
        productsOwned: purchase?.products || [],
        isProSubscriber,
        recommendedAction: recommendedUpgradeAction(level, feat, isProSubscriber),
        callPriority: isProSubscriber
          ? 0
          : level === 'hot'
            ? 100 + row.ctaClicks * 10
            : 50 + row.modalOpens,
      };
    });

    if (levelFilter === 'hot') {
      candidates = candidates.filter((c) => c.level === 'hot');
    } else if (levelFilter === 'warm') {
      candidates = candidates.filter((c) => c.level === 'warm');
    }

    // Conversion targets first: hot non-Pro, then warm non-Pro
    candidates.sort((a, b) => {
      if (a.isProSubscriber !== b.isProSubscriber) return a.isProSubscriber ? 1 : -1;
      return b.callPriority - a.callPriority;
    });

    const hotCount = candidates.filter((c) => c.level === 'hot').length;
    const warmCount = candidates.filter((c) => c.level === 'warm').length;
    const callableCount = candidates.filter((c) => !c.isProSubscriber && c.level === 'hot').length;

    const limited = candidates.slice(0, limit);

    if (format === 'csv') {
      const headers = [
        'Rank',
        'Email',
        'Level',
        'CTA Clicks',
        'Modal Opens',
        'Top Feature',
        'Last CTA',
        'Profile Complete',
        'Total Spent',
        'Already Pro',
        'Recommended Action',
      ];
      const rows = limited.map((c, i) => [
        i + 1,
        c.email,
        c.level,
        c.ctaClicks,
        c.modalOpens,
        c.topFeature,
        c.lastCtaAt || '',
        c.profileComplete ? 'yes' : 'no',
        `$${c.totalSpent.toFixed(2)}`,
        c.isProSubscriber ? 'yes' : 'no',
        c.recommendedAction,
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\n');
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="upgrade-intent-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      windowDays: days,
      definition: UPGRADE_INTENT_DEFINITION,
      summary: {
        totalWithIntent: candidates.length,
        hot: hotCount,
        warm: warmCount,
        callableNow: callableCount,
        alreadyPro: candidates.filter((c) => c.isProSubscriber).length,
        modalOpens: engagementRows.filter((r) => r.metadata?.action === 'upgrade_modal_shown').length,
        ctaClicks: engagementRows.filter((r) => r.metadata?.action === 'upgrade_modal_cta_click').length,
      },
      candidates: limited,
    });
  } catch (error) {
    console.error('[upgrade-intent] error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load upgrade intent' },
      { status: 500 },
    );
  }
}
