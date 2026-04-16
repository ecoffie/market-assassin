/**
 * Admin: Seed all paying customers into user_alert_settings
 *
 * GET /api/admin/seed-alerts?password=...&mode=preview
 * GET /api/admin/seed-alerts?password=...&mode=execute
 *
 * Fetches all buyers from shop.govcongiants.org and creates
 * alert profiles for them so they receive weekly SAM alerts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const SHOP_ADMIN_PASSWORD = 'admin123';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

interface ShopPurchase {
  email: string;
  productId: string;
  productName: string;
}

// Default NAICS codes for general small business (broad categories)
const DEFAULT_NAICS_CODES = [
  '541611', // Administrative Management Consulting
  '541612', // HR Consulting
  '541618', // Other Management Consulting
  '541511', // Custom Computer Programming
  '541512', // Computer Systems Design
  '541519', // Other Computer Services
  '561110', // Office Administrative Services
  '561210', // Facilities Support Services
  '541990', // Other Professional Services
  '611430', // Professional Development Training
];

async function fetchShopPurchases(): Promise<ShopPurchase[]> {
  try {
    const res = await fetch('https://shop.govcongiants.org/api/admin/purchases-report?days=365', {
      headers: { 'x-admin-password': SHOP_ADMIN_PASSWORD },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.purchases || [];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch all purchases from shop
  const purchases = await fetchShopPurchases();

  if (purchases.length === 0) {
    return NextResponse.json({
      error: 'Could not fetch purchases from shop',
      hint: 'Check shop.govcongiants.org/api/admin/purchases-report',
    }, { status: 500 });
  }

  // Get unique buyer emails
  const buyerEmails = [...new Set(purchases.map(p => p.email.toLowerCase()))];

  // Check which already have alert settings
  const { data: existingAlerts } = await getSupabase()
    .from('user_alert_settings')
    .select('user_email')
    .in('user_email', buyerEmails);

  const existingEmails = new Set(existingAlerts?.map((a: { user_email: string }) => a.user_email.toLowerCase()) || []);
  const needsSeeding = buyerEmails.filter(email => !existingEmails.has(email));

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      total_buyers: buyerEmails.length,
      already_enrolled: existingEmails.size,
      needs_seeding: needsSeeding.length,
      will_seed: needsSeeding,
      default_naics: DEFAULT_NAICS_CODES,
      instructions: 'Add ?mode=execute to seed all buyers',
    });
  }

  // Execute mode - seed all buyers
  const results = {
    success: [] as string[],
    failed: [] as { email: string; error: string }[],
  };

  for (const email of needsSeeding) {
    try {
      const { error } = await getSupabase()
        .from('user_alert_settings')
        .upsert({
          user_email: email,
          naics_codes: DEFAULT_NAICS_CODES,
          business_type: null,
          target_agencies: [],
          location_state: null,
          is_active: true,
          alert_frequency: 'weekly',
        }, {
          onConflict: 'user_email',
        });

      if (error) {
        results.failed.push({ email, error: error.message });
      } else {
        results.success.push(email);
      }
    } catch (err) {
      results.failed.push({ email, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  return NextResponse.json({
    mode: 'execute',
    total_buyers: buyerEmails.length,
    already_enrolled: existingEmails.size,
    newly_seeded: results.success.length,
    failed: results.failed.length,
    success_emails: results.success,
    failures: results.failed,
    default_naics: DEFAULT_NAICS_CODES,
  });
}
